import { buildAbraSystemPrompt, type AbraCorrection, type AbraDepartment } from "@/lib/ops/abra-system-prompt";
import { buildTieredContext, searchTiered } from "@/lib/ops/abra-memory-tiers";
import { getActiveSignals, buildSignalsContext } from "@/lib/ops/abra-operational-signals";
import {
  extractClaudeUsage,
  getMonthlySpend,
  getPreferredClaudeModel,
  logAICost,
} from "@/lib/ops/abra-cost-tracker";
import { notify } from "@/lib/ops/notify";
import { saveMessage } from "@/lib/ops/abra-chat-history";

export type SlackMessageContext = {
  text: string;
  user: string;
  channel: string;
  ts: string;
  thread_ts?: string;
};

type SearchSource = {
  title: string;
  source_table: "brain" | "email";
  days_ago?: number;
};

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Supabase not configured");
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  if (!res.ok) {
    throw new Error(
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
    );
  }
  return json;
}

function monitoredChannelSet(): Set<string> {
  const raw = process.env.SLACK_MONITORED_CHANNELS || "";
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function shouldAbraRespond(text: string, channel: string): boolean {
  const normalized = (text || "").trim().toLowerCase();
  const mention =
    /(^|\s)@abra\b/i.test(normalized) ||
    /^abra[\s,:]/i.test(normalized) ||
    /\babra,\b/i.test(normalized) ||
    /^correct:/i.test(normalized) ||
    /^teach:/i.test(normalized);
  const monitored = monitoredChannelSet().has(channel);
  return mention || monitored;
}

function asChannel(channel: string): "alerts" | "pipeline" | "daily" {
  if (channel.includes("daily")) return "daily";
  if (channel.includes("pipeline")) return "pipeline";
  return "alerts";
}

async function postSlackReply(params: {
  channel: string;
  threadTs: string;
  text: string;
  sources?: SearchSource[];
}): Promise<void> {
  const sourceText =
    params.sources && params.sources.length > 0
      ? `\n\n_Sources: ${params.sources
          .slice(0, 4)
          .map((source) => `${source.source_table === "email" ? "📧" : "🧠"} ${source.title}${typeof source.days_ago === "number" ? ` (${source.days_ago}d)` : ""}`)
          .join(" · ")}_`
      : "";
  const message = `🧠 *Abra*\n\n${params.text}${sourceText}`;

  const botToken = process.env.SLACK_BOT_TOKEN;
  if (botToken) {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: params.channel,
        thread_ts: params.threadTs,
        text: `🧠 Abra: ${params.text.slice(0, 280)}`,
        mrkdwn: true,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: message.slice(0, 2950),
            },
          },
        ],
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const data = (await res.json()) as { ok?: boolean };
      if (data.ok) return;
    }
  }

  await notify({
    channel: asChannel(params.channel),
    text: `[ABRA][${params.channel}] ${params.text}`,
  });
}

async function hasAbraThreadReply(threadId: string): Promise<boolean> {
  try {
    const rows = (await sbFetch(
      `/rest/v1/abra_chat_history?thread_id=eq.${encodeURIComponent(threadId)}&role=eq.assistant&select=id&limit=1`,
    )) as Array<{ id: string }>;
    return !!rows[0]?.id;
  } catch {
    return false;
  }
}

async function fetchCorrections(): Promise<AbraCorrection[]> {
  try {
    const rows = (await sbFetch(
      "/rest/v1/abra_corrections?active=eq.true&order=created_at.desc&limit=10&select=original_claim,correction,corrected_by,department",
    )) as AbraCorrection[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function fetchDepartments(): Promise<AbraDepartment[]> {
  try {
    const rows = (await sbFetch(
      "/rest/v1/abra_departments?select=name,owner_name,description,key_context&order=name",
    )) as AbraDepartment[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function buildEmbedding(input: string): Promise<number[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: input.slice(0, 8000),
      dimensions: 1536,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Embedding failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const payload = (await res.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const embedding = payload.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) throw new Error("Embedding payload missing vector");

  const approxTokens = Math.max(1, Math.round(input.length / 4));
  void logAICost({
    model: "text-embedding-3-small",
    provider: "openai",
    inputTokens: approxTokens,
    outputTokens: 0,
    endpoint: "slack/events-embedding",
    department: "operations",
  });

  return embedding;
}

function parseCorrection(text: string): { original: string; correction: string } | null {
  const body = text.replace(/^correct:\s*/i, "").trim();
  if (!body) return null;
  const match = body.match(/^(.+?)\s+but\s+actually\s+(.+)$/i);
  if (!match) return null;
  return {
    original: match[1].trim(),
    correction: match[2].trim(),
  };
}

async function handleCorrection(msg: SlackMessageContext): Promise<string> {
  const parsed = parseCorrection(msg.text);
  if (!parsed) {
    return "Couldn't parse correction. Use `correct: <old> but actually <new>`.";
  }

  const embeddingText = `CORRECTION: ${parsed.original} -> ${parsed.correction}`;
  const embedding = await buildEmbedding(embeddingText);
  await sbFetch("/rest/v1/abra_corrections", {
    method: "POST",
    headers: {
      Prefer: "return=minimal",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      corrected_by: msg.user,
      original_claim: parsed.original,
      correction: parsed.correction,
      embedding,
    }),
  });
  await sbFetch("/rest/v1/open_brain_entries", {
    method: "POST",
    headers: {
      Prefer: "return=minimal",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_type: "manual",
      source_ref: `slack-correction-${Date.now()}`,
      entry_type: "correction",
      title: `Correction: ${parsed.original.slice(0, 100)}`,
      raw_text: `WRONG: ${parsed.original}\nCORRECT: ${parsed.correction}\nCorrected by: ${msg.user}`,
      summary_text: parsed.correction.slice(0, 500),
      category: "correction",
      department: "executive",
      confidence: "high",
      priority: "critical",
      processed: true,
      embedding,
    }),
  });
  return `Stored correction: "${parsed.original}" → "${parsed.correction}".`;
}

async function handleTeaching(msg: SlackMessageContext): Promise<string> {
  const body = msg.text.replace(/^teach:\s*/i, "").trim();
  if (!body) return "No content to teach. Use `teach: [department] <content>`.";

  const deptMatch = body.match(/^\[([^\]]+)\]\s*(.+)$/s);
  const department = deptMatch?.[1]?.trim().toLowerCase() || "executive";
  const content = deptMatch?.[2]?.trim() || body;
  if (!content) return "No teaching content found.";

  const title = `Teaching: ${department} — ${content.slice(0, 60)}`;
  const embedding = await buildEmbedding(`${title}. ${content}`);

  await sbFetch("/rest/v1/open_brain_entries", {
    method: "POST",
    headers: {
      Prefer: "return=minimal",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_type: "manual",
      source_ref: `slack-teaching-${Date.now()}`,
      entry_type: "teaching",
      title,
      raw_text: `Taught by ${msg.user}:\n${content}`,
      summary_text: content.slice(0, 500),
      category: "teaching",
      department,
      confidence: "high",
      priority: "important",
      processed: true,
      embedding,
    }),
  });

  return `Stored teaching for ${department}: "${content.slice(0, 180)}"`;
}

async function generateAnswer(params: {
  message: string;
  threadId: string;
  userId: string;
}): Promise<{ reply: string; sources: SearchSource[]; modelUsed: string }> {
  const embedding = await buildEmbedding(params.message);
  const tiered = await searchTiered({ embedding, matchCount: 8, filterTables: ["brain", "email"] });
  const [corrections, departments, signals, costSummary] = await Promise.all([
    fetchCorrections(),
    fetchDepartments(),
    getActiveSignals({ limit: 5 }),
    getMonthlySpend(),
  ]);
  const signalsContext = buildSignalsContext(signals);
  const systemPrompt = buildAbraSystemPrompt({
    format: "slack",
    corrections,
    departments,
    costSummary,
    signalsContext,
  });
  const context = buildTieredContext(tiered);
  const model = await getPreferredClaudeModel(DEFAULT_MODEL);
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const userPrompt = `User message:\n${params.message}\n\nRetrieved context:\n${context}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let payload: { content?: Array<{ text?: string }>; usage?: Record<string, unknown> } = {};
  if (text) {
    try {
      payload = JSON.parse(text) as {
        content?: Array<{ text?: string }>;
        usage?: Record<string, unknown>;
      };
    } catch {
      payload = {};
    }
  }
  if (!res.ok) {
    throw new Error(`Claude API failed (${res.status}): ${text.slice(0, 250)}`);
  }

  const reply = (payload.content || [])
    .map((item) => String(item?.text || ""))
    .join("\n")
    .trim();
  if (!reply) throw new Error("Claude returned empty reply");

  const usage = extractClaudeUsage(payload as Record<string, unknown>);
  if (usage) {
    void logAICost({
      model,
      provider: "anthropic",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      endpoint: "slack/events",
      department: "operations",
    });
  }

  const sources: SearchSource[] = tiered.all.slice(0, 4).map((row) => ({
    title: row.title || "(untitled)",
    source_table: row.source_table,
    ...(typeof row.days_ago === "number" ? { days_ago: row.days_ago } : {}),
  }));

  await saveMessage({
    thread_id: params.threadId,
    role: "user",
    content: params.message,
    user_email: params.userId,
    metadata: { channel: "slack" },
  });
  await saveMessage({
    thread_id: params.threadId,
    role: "assistant",
    content: reply,
    user_email: params.userId,
    model_used: model,
    token_count: usage ? usage.inputTokens + usage.outputTokens : undefined,
    metadata: {
      channel: "slack",
      source_count: sources.length,
      sources,
    },
  });

  return { reply, sources, modelUsed: model };
}

export async function processSlackMessage(msg: SlackMessageContext): Promise<void> {
  const text = (msg.text || "").trim();
  if (!text) return;
  const rootThreadTs = msg.thread_ts || msg.ts;
  const threadId = `slack:${msg.channel}:${rootThreadTs}`;
  const shouldRespond = shouldAbraRespond(text, msg.channel);
  const threadFollowUp = await hasAbraThreadReply(threadId);
  if (!shouldRespond && !threadFollowUp) return;

  try {
    let reply = "";
    let sources: SearchSource[] = [];
    if (/^correct:/i.test(text)) {
      reply = await handleCorrection(msg);
    } else if (/^teach:/i.test(text)) {
      reply = await handleTeaching(msg);
    } else {
      const answer = await generateAnswer({
        message: text,
        threadId,
        userId: `slack:${msg.user}`,
      });
      reply = answer.reply;
      sources = answer.sources;
    }

    await postSlackReply({
      channel: msg.channel,
      threadTs: rootThreadTs,
      text: reply,
      ...(sources.length > 0 ? { sources } : {}),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Slack processing error";
    console.error("[abra-slack-processor] processSlackMessage failed:", message);
    void notify({
      channel: "alerts",
      text: `🚨 Slack message processing failed: ${message}`,
    });
  }
}
