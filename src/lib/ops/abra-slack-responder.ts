import { createHash } from "node:crypto";
import { kv } from "@vercel/kv";
import {
  buildAbraSystemPrompt,
  type AbraCorrection,
  type AbraDepartment,
} from "@/lib/ops/abra-system-prompt";
import {
  extractClaudeUsage,
  logAICost,
} from "@/lib/ops/abra-cost-tracker";

export type SlackThreadMessage = {
  role: "user" | "assistant";
  content: string;
};

export type SlackMessageContext = {
  text: string;
  user: string;
  channel: string;
  ts: string;
  threadTs?: string;
  displayName?: string;
  history?: SlackThreadMessage[];
  forceRespond?: boolean;
};

export type SlackResponse = {
  handled: boolean;
  reply: string;
  sources: Array<{
    title: string;
    source_table: "brain" | "email";
    days_ago?: number;
  }>;
  answerLogId: string | null;
};

type SlackPostOptions = {
  threadTs?: string;
  sources?: Array<{
    title: string;
    source_table: "brain" | "email";
    days_ago?: number;
  }>;
  answerLogId?: string | null;
  blocks?: Array<Record<string, unknown>>;
};

type ProactiveMessageOptions = {
  target: "channel" | "user";
  channelOrUserId: string;
  message: string;
  context?: string;
  requiresResponse?: boolean;
  blocks?: Array<Record<string, unknown>>;
  threadTs?: string;
};

const SLACK_BLOCK_TEXT_LIMIT = 3000;

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

function resolveInternalHost(): string {
  return (
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000")
  );
}

function stableSlackThreadId(channel: string, threadTs: string): string {
  const hex = createHash("sha1")
    .update(`${channel}:${threadTs}`)
    .digest("hex")
    .slice(0, 32);
  const part4 = ((Number.parseInt(hex[16] || "0", 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${part4}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function buildSlackBlocks(fullText: string): Array<Record<string, unknown>> {
  if (fullText.length <= SLACK_BLOCK_TEXT_LIMIT) {
    return [
      {
        type: "section",
        text: { type: "mrkdwn", text: fullText },
      },
    ];
  }

  const blocks: Array<Record<string, unknown>> = [];
  let remaining = fullText;
  while (remaining.length > 0) {
    if (remaining.length <= SLACK_BLOCK_TEXT_LIMIT) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: remaining },
      });
      break;
    }
    let splitIdx = remaining.lastIndexOf("\n", SLACK_BLOCK_TEXT_LIMIT);
    if (splitIdx < SLACK_BLOCK_TEXT_LIMIT * 0.3) {
      splitIdx = remaining.lastIndexOf(" ", SLACK_BLOCK_TEXT_LIMIT);
    }
    if (splitIdx <= 0) splitIdx = SLACK_BLOCK_TEXT_LIMIT;
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: remaining.slice(0, splitIdx) },
    });
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return blocks;
}

function buildFeedbackBlock(answerLogId: string): Record<string, unknown> {
  return {
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "👍 Helpful", emoji: true },
        action_id: "feedback_positive",
        value: answerLogId,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "👎 Not helpful", emoji: true },
        action_id: "feedback_negative",
        value: answerLogId,
      },
    ],
  };
}

function formatSources(
  sources: Array<{
    title: string;
    source_table: "brain" | "email";
    days_ago?: number;
  }>,
): string {
  if (sources.length === 0) return "";
  return `\n\n_Sources: ${sources
    .slice(0, 4)
    .map((source) => {
      const age =
        typeof source.days_ago === "number" ? ` (${source.days_ago}d ago)` : "";
      return `${source.source_table === "email" ? "📧" : "🧠"} ${source.title}${age}`;
    })
    .join(" · ")}_`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  return fetch(url, {
    ...init,
    signal: init.signal || AbortSignal.timeout(timeoutMs),
  });
}

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
    endpoint: "slack/responder-embedding",
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

  const actor = msg.displayName || msg.user;
  const embeddingText = `CORRECTION: ${parsed.original} -> ${parsed.correction}`;
  const embedding = await buildEmbedding(embeddingText);
  await sbFetch("/rest/v1/abra_corrections", {
    method: "POST",
    headers: {
      Prefer: "return=minimal",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      corrected_by: actor,
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
      raw_text: `WRONG: ${parsed.original}\nCORRECT: ${parsed.correction}\nCorrected by: ${actor}`,
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

  const actor = msg.displayName || msg.user;
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
      raw_text: `Taught by ${actor}:\n${content}`,
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

async function callAbraChatViaInternalApi(
  ctx: SlackMessageContext,
): Promise<{
  reply: string;
  sources: Array<{ title: string; source_table: "brain" | "email"; days_ago?: number }>;
  answerLogId: string | null;
} | null> {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret) return null;

  const host = resolveInternalHost();

  try {
    const res = await fetchWithTimeout(
      `${host}/api/ops/abra/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cronSecret}`,
        },
        body: JSON.stringify({
          message: ctx.text,
          history: ctx.history || [],
          channel: "slack",
          actor_label: ctx.displayName || ctx.user,
          thread_id: stableSlackThreadId(ctx.channel, ctx.threadTs || ctx.ts),
        }),
      },
      45000,
    );

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return null;

    const reply =
      typeof data.reply === "string" && data.reply.trim() ? data.reply.trim() : "";
    if (!reply) return null;

    const sources = Array.isArray(data.sources)
      ? data.sources
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const row = item as Record<string, unknown>;
            return {
              title:
                typeof row.title === "string" && row.title.trim()
                  ? row.title.trim()
                  : "(untitled)",
              source_table: row.source_table === "email" ? "email" : "brain",
              days_ago:
                typeof row.days_ago === "number" && Number.isFinite(row.days_ago)
                  ? row.days_ago
                  : undefined,
            } as {
              title: string;
              source_table: "brain" | "email";
              days_ago?: number;
            };
          })
          .filter((value): value is {
            title: string;
            source_table: "brain" | "email";
            days_ago?: number;
          } => !!value)
      : [];

    const answerLogId =
      typeof data.answerLogId === "string" && data.answerLogId
        ? data.answerLogId
        : typeof data.answer_log_id === "string" && data.answer_log_id
          ? data.answer_log_id
          : null;

    return { reply, sources, answerLogId };
  } catch {
    return null;
  }
}

export async function getThreadHistory(
  channelId: string,
  threadTs: string,
  limit = 20,
): Promise<SlackThreadMessage[]> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) return [];

  try {
    const url = new URL("https://slack.com/api/conversations.replies");
    url.searchParams.set("channel", channelId);
    url.searchParams.set("ts", threadTs);
    url.searchParams.set("limit", String(Math.max(1, Math.min(limit, 50))));

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      ok?: boolean;
      messages?: Array<{
        text?: string;
        bot_id?: string;
        subtype?: string;
      }>;
    };
    if (!data.ok || !Array.isArray(data.messages)) return [];

    return data.messages
      .slice(1)
      .map((message) => {
        const text = String(message.text || "").trim();
        if (!text) return null;
        if (message.subtype && message.subtype !== "bot_message") return null;
        const isBot = Boolean(message.bot_id);
        return {
          role: isBot ? "assistant" : "user",
          content: isBot
            ? text.replace(/^🧠\s*\*Abra\*\s*\n\n?/i, "").trim()
            : text,
        } as SlackThreadMessage;
      })
      .filter((value): value is SlackThreadMessage => !!value)
      .slice(-12);
  } catch {
    return [];
  }
}

export async function getSlackDisplayName(userId: string): Promise<string> {
  if (!userId) return "slack-user";
  const cacheKey = `abra:slack:user:${userId}`;
  try {
    const cached = await kv.get<string>(cacheKey);
    if (typeof cached === "string" && cached.trim()) return cached.trim();
  } catch {
    // fall through to live lookup
  }

  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) return userId;

  try {
    const url = new URL("https://slack.com/api/users.info");
    url.searchParams.set("user", userId);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return userId;
    const data = (await res.json()) as {
      ok?: boolean;
      user?: {
        profile?: { display_name?: string; real_name?: string };
        real_name?: string;
        name?: string;
      };
    };
    if (!data.ok) return userId;

    const displayName =
      data.user?.profile?.display_name?.trim() ||
      data.user?.profile?.real_name?.trim() ||
      data.user?.real_name?.trim() ||
      data.user?.name?.trim() ||
      userId;

    try {
      await kv.set(cacheKey, displayName, { ex: 3600 });
    } catch {
      // cache failure is non-critical
    }

    return displayName;
  } catch {
    return userId;
  }
}

export async function postSlackMessage(
  channelId: string,
  text: string,
  opts: SlackPostOptions = {},
): Promise<boolean> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken || !channelId) return false;

  const sourceText = formatSources(opts.sources || []);
  const fullText = `🧠 *Abra*\n\n${text}${sourceText}`;
  const blocks = opts.blocks && opts.blocks.length > 0 ? opts.blocks : buildSlackBlocks(fullText);
  if (opts.answerLogId) {
    blocks.push(buildFeedbackBlock(opts.answerLogId));
  }

  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: channelId,
        ...(opts.threadTs ? { thread_ts: opts.threadTs } : {}),
        text: `🧠 Abra: ${text.slice(0, 200)}`,
        mrkdwn: true,
        blocks,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

export async function proactiveMessage(
  opts: ProactiveMessageOptions,
): Promise<boolean> {
  const message = [
    opts.message.trim(),
    opts.context?.trim(),
    opts.requiresResponse ? "_Reply in thread if you want Abra to continue._" : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return postSlackMessage(opts.channelOrUserId, message, {
    threadTs: opts.threadTs,
    blocks: opts.blocks,
  });
}

/**
 * Open a DM channel with a Slack user.
 * Uses conversations.open to get or create a DM channel ID.
 */
export async function openDmChannel(userId: string): Promise<string | null> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken || !userId) return null;

  try {
    const res = await fetch("https://slack.com/api/conversations.open", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ users: userId }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok?: boolean;
      channel?: { id?: string };
    };
    return data.ok && data.channel?.id ? data.channel.id : null;
  } catch {
    return null;
  }
}

/**
 * Send a direct message to a Slack user.
 * Opens a DM channel first, then posts the message.
 */
export async function sendDirectMessage(
  userId: string,
  message: string,
  opts?: { blocks?: Array<Record<string, unknown>> },
): Promise<boolean> {
  const dmChannelId = await openDmChannel(userId);
  if (!dmChannelId) return false;
  return postSlackMessage(dmChannelId, message, { blocks: opts?.blocks });
}

/**
 * Look up a Slack user by email address.
 */
export async function findSlackUserByEmail(email: string): Promise<string | null> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken || !email) return null;

  try {
    const url = new URL("https://slack.com/api/users.lookupByEmail");
    url.searchParams.set("email", email);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok?: boolean;
      user?: { id?: string };
    };
    return data.ok && data.user?.id ? data.user.id : null;
  } catch {
    return null;
  }
}

export async function processAbraMessage(
  ctx: SlackMessageContext,
): Promise<SlackResponse> {
  const text = (ctx.text || "").trim();
  if (!text) {
    return { handled: false, reply: "", sources: [], answerLogId: null };
  }

  const shouldRespondNow =
    ctx.forceRespond ||
    shouldAbraRespond(text, ctx.channel) ||
    Boolean(ctx.threadTs);
  if (!shouldRespondNow) {
    return { handled: false, reply: "", sources: [], answerLogId: null };
  }

  if (/^correct:/i.test(text)) {
    return {
      handled: true,
      reply: await handleCorrection(ctx),
      sources: [],
      answerLogId: null,
    };
  }

  if (/^teach:/i.test(text)) {
    return {
      handled: true,
      reply: await handleTeaching(ctx),
      sources: [],
      answerLogId: null,
    };
  }

  const answer = await callAbraChatViaInternalApi(ctx);
  if (!answer) {
    throw new Error("Slack responder could not reach Abra chat");
  }

  return {
    handled: true,
    reply: answer.reply,
    sources: answer.sources,
    answerLogId: answer.answerLogId,
  };
}

export async function fetchSlackKnowledgeContext(): Promise<{
  corrections: AbraCorrection[];
  departments: AbraDepartment[];
}> {
  const [corrections, departments] = await Promise.all([
    sbFetch(
      "/rest/v1/abra_corrections?active=eq.true&order=created_at.desc&limit=10&select=original_claim,correction,corrected_by,department",
    ).then((rows) => (Array.isArray(rows) ? (rows as AbraCorrection[]) : [])),
    sbFetch(
      "/rest/v1/abra_departments?select=name,owner_name,description,key_context&order=name",
    ).then((rows) => (Array.isArray(rows) ? (rows as AbraDepartment[]) : [])),
  ]);
  return { corrections, departments };
}

export async function buildSlackSystemPrompt(): Promise<string> {
  const { corrections, departments } = await fetchSlackKnowledgeContext();
  return buildAbraSystemPrompt({
    format: "slack",
    corrections,
    departments,
  });
}

export function extractSlackUsage(payload: Record<string, unknown>) {
  return extractClaudeUsage(payload);
}
