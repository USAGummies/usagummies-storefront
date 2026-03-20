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

type StructuredDocKind = "chart_of_accounts";

type StructuredDocSession = {
  kind: StructuredDocKind;
  actor: string;
  chunks: string[];
  totalChars: number;
  createdAt: string;
  updatedAt: string;
};

type CoaRow = {
  accountNumber: string;
  description: string;
  accountType: string;
  subType: string;
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
const DATA_INGEST_THRESHOLD = 3000;
const STRUCTURED_DOC_TTL_SECONDS = 24 * 60 * 60;

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

function rootSlackThreadTs(ctx: SlackMessageContext): string {
  return ctx.threadTs || ctx.ts;
}

function structuredDocKey(ctx: SlackMessageContext): string {
  return `abra:slack:structured-doc:${ctx.channel}:${rootSlackThreadTs(ctx)}`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function looksLikeChartOfAccounts(text: string): boolean {
  // Must be substantial — short messages are never COA data pastes
  if (text.length < 300) return false;

  // Explicit header match — always a COA (requires multiple header keywords)
  const headerKeywords = ["gl account", "account type", "sub type", "account name", "detail type"].filter(
    kw => text.toLowerCase().includes(kw),
  );
  if (headerKeywords.length >= 2) return true;

  const lines = text.split(/\n/).filter(l => l.trim().length > 0);

  // 10+ lines that contain tab characters → structured tabular data (raised threshold)
  const tabLines = lines.filter((l) => /\t/.test(l));
  if (tabLines.length >= 10) return true;

  // 10+ lines that each start with or contain a 4–6 digit account number
  // AND look like structured rows (have separators like tabs, pipes, or multiple spaces)
  const structuredNumericLines = lines.filter(
    (l) => /\b\d{4,6}\b/.test(l) && (/\t/.test(l) || /\|/.test(l) || /  {2,}/.test(l)),
  );
  if (structuredNumericLines.length >= 10) return true;

  return false;
}

function isDocumentResetCommand(text: string): boolean {
  return /\b(fresh start|start over|reset|clear)\b/i.test(text);
}

function isDocumentFinalizeCommand(text: string): boolean {
  return /\b(done|build it|compile|finish|finalize)\b/i.test(text);
}

function requestedDocumentFormat(
  text: string,
): "notion" | "csv" | "markdown" | null {
  const normalized = text.toLowerCase();
  if (
    /\b(option 3|notion version|notion page|save to notion|give me notion)\b/.test(
      normalized,
    )
  ) {
    return "notion";
  }
  if (/\b(csv|excel-ready|spreadsheet|tab-separated|tsv)\b/.test(normalized)) {
    return "csv";
  }
  if (/\b(option 2|markdown|table)\b/.test(normalized)) {
    return "markdown";
  }
  return null;
}

function normalizeChartOfAccountsText(text: string): string {
  return (
    text
      // Normalize non-breaking spaces
      .replace(/\u00a0/g, " ")
      // Normalize Windows line endings
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      // Strip header rows (they aren't data)
      .replace(/GL\s*Account\s*Description\s*Account\s*Type\s*Sub\s*Type/gi, "")
      // Convert tabs to pipe separators so column structure is preserved
      .replace(/\t+/g, "|")
      // Collapse multiple spaces within a line (but NOT across newlines)
      .split("\n")
      .map((line) => line.replace(/  +/g, " ").trim())
      .filter((line) => line.length > 0)
      .join("\n")
  );
}

function parseChartOfAccountsRows(rawText: string): CoaRow[] {
  const normalized = normalizeChartOfAccountsText(rawText);
  const rows = new Map<string, CoaRow>();

  // Accounting type code letters used by QBO
  const TYPE_CODES = new Set(["A", "L", "E", "I", "C", "P"]);

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    let accountNumber = "";
    let description = "";
    let accountType = "";
    let subType = "";

    // --- Strategy 1: pipe/tab-separated columns ---
    // After normalizeChartOfAccountsText, tabs are already converted to "|"
    if (line.includes("|")) {
      const cols = line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      // Expected order: GL Account | Description | Account Type | Sub Type
      // But be flexible — first col with a number = account number
      const numIdx = cols.findIndex((c) => /^\d{2,6}$/.test(c));
      if (numIdx !== -1) {
        accountNumber = cols[numIdx];
        description = cols[numIdx + 1] || "";
        accountType = cols[numIdx + 2] || "";
        subType = cols[numIdx + 3] || "";
      } else {
        // No clean numeric col; fall through to Strategy 2
      }
    }

    // --- Strategy 2: line-start number, trailing type code ---
    if (!accountNumber) {
      // Match: optional-period-terminated number at line start
      // then arbitrary text (description, may contain digits)
      // then a standalone type-code letter at/near end of line
      // then optional sub-type letter
      const lineMatch = line.match(
        /^(\d{2,6})\.?\s+(.+?)\s+([ALCIPE])\s*([A-Z])?$/,
      );
      if (lineMatch) {
        accountNumber = lineMatch[1].trim();
        description = lineMatch[2].trim();
        accountType = lineMatch[3].trim();
        subType = (lineMatch[4] || "").trim();
      }
    }

    // --- Strategy 3: any number in the line + type code somewhere ---
    if (!accountNumber) {
      const numMatch = line.match(/\b(\d{2,6})\b/);
      // Grab the last standalone type-code token in the line
      const tokens = line.split(/\s+/);
      const lastTypeIdx = tokens
        .map((t, i) => (TYPE_CODES.has(t) ? i : -1))
        .filter((i) => i !== -1)
        .pop();
      if (numMatch && lastTypeIdx !== undefined) {
        accountNumber = numMatch[1];
        accountType = tokens[lastTypeIdx];
        subType =
          lastTypeIdx + 1 < tokens.length &&
          /^[A-Z]$/.test(tokens[lastTypeIdx + 1])
            ? tokens[lastTypeIdx + 1]
            : "";
        // Description = everything between the account number and the type code
        const numPos = line.indexOf(accountNumber);
        const typePos = line.lastIndexOf(accountType);
        description = normalizeWhitespace(
          line.slice(numPos + accountNumber.length, typePos),
        ).replace(/^[.\s]+/, "");
      }
    }

    // Validate and deduplicate
    accountNumber = accountNumber.trim();
    description = normalizeWhitespace(
      description.replace(/\s*[|,;:-]+\s*$/g, ""),
    );
    accountType = accountType.trim();
    subType = subType.trim();

    if (!accountNumber || !description || !accountType) continue;
    if (!TYPE_CODES.has(accountType)) continue;

    const nextRow: CoaRow = { accountNumber, description, accountType, subType };
    const existing = rows.get(accountNumber);
    if (!existing || nextRow.description.length > existing.description.length) {
      rows.set(accountNumber, nextRow);
    }
  }

  return Array.from(rows.values()).sort(
    (a, b) => Number(a.accountNumber) - Number(b.accountNumber),
  );
}

function renderChartOfAccountsMarkdown(rows: CoaRow[]): string {
  const lines = [
    "# TEST Chart of Accounts — Notion Version",
    "",
    `Parsed accounts: ${rows.length}`,
    "",
    "| GL Account | Description | Account Type | Sub Type |",
    "|---|---|---|---|",
    ...rows.map(
      (row) =>
        `| ${row.accountNumber} | ${row.description.replace(/\|/g, "/")} | ${row.accountType} | ${row.subType || "—"} |`,
    ),
  ];
  return lines.join("\n");
}

function renderChartOfAccountsCsv(rows: CoaRow[]): string {
  const escape = (value: string) => `"${String(value).replace(/"/g, '""')}"`;
  return [
    "GL Account,Description,Account Type,Sub Type",
    ...rows.map((row) =>
      [
        escape(row.accountNumber),
        escape(row.description),
        escape(row.accountType),
        escape(row.subType),
      ].join(","),
    ),
  ].join("\n");
}

async function getStructuredDocSession(
  ctx: SlackMessageContext,
): Promise<StructuredDocSession | null> {
  try {
    const session = await kv.get<StructuredDocSession>(structuredDocKey(ctx));
    if (!session || typeof session !== "object") return null;
    if (!Array.isArray(session.chunks)) return null;
    return session;
  } catch {
    return null;
  }
}

async function saveStructuredDocSession(
  ctx: SlackMessageContext,
  session: StructuredDocSession,
): Promise<void> {
  await kv.set(structuredDocKey(ctx), session, {
    ex: STRUCTURED_DOC_TTL_SECONDS,
  });
}

async function clearStructuredDocSession(
  ctx: SlackMessageContext,
): Promise<void> {
  try {
    await kv.del(structuredDocKey(ctx));
  } catch {
    // non-critical
  }
}

async function appendStructuredDocChunk(
  ctx: SlackMessageContext,
  kind: StructuredDocKind,
): Promise<StructuredDocSession> {
  const existing = await getStructuredDocSession(ctx);
  const actor = ctx.displayName || ctx.user;
  const nextChunks = [...(existing?.chunks || []), ctx.text];
  const session: StructuredDocSession = {
    kind,
    actor,
    chunks: nextChunks,
    totalChars: nextChunks.reduce((sum, chunk) => sum + chunk.length, 0),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveStructuredDocSession(ctx, session);
  return session;
}

async function handleStructuredDocumentConversation(
  ctx: SlackMessageContext,
): Promise<SlackResponse | null> {
  const existing = await getStructuredDocSession(ctx);
  const format = requestedDocumentFormat(ctx.text);

  if (isDocumentResetCommand(ctx.text) && existing) {
    await clearStructuredDocSession(ctx);
    return {
      handled: true,
      reply:
        "Cleared the structured document session for this thread. Send the first chunk when you want to start again.",
      sources: [],
      answerLogId: null,
    };
  }

  // Only continue an existing session if the new message also looks like structured data
  // (not just any long message). This prevents normal conversation from being captured as chunks.
  const isStructuredData = looksLikeChartOfAccounts(ctx.text);
  const isSessionContinuation = existing && ctx.text.length >= 500 && /\t/.test(ctx.text);
  if (isStructuredData || isSessionContinuation) {
    const session = await appendStructuredDocChunk(ctx, "chart_of_accounts");
    const rows = parseChartOfAccountsRows(session.chunks.join("\n"));
    return {
      handled: true,
      reply:
        `Captured chart of accounts chunk ${session.chunks.length} for this thread.\n\n` +
        `Current parse status: ${rows.length} account rows across ${session.totalChars.toLocaleString()} characters.\n\n` +
        `Keep sending chunks in this thread. When you're done, say \`done\`, \`build it\`, \`give me notion version\`, or \`give me csv\`.`,
      sources: [],
      answerLogId: null,
    };
  }

  if (!existing) return null;

  if (isDocumentFinalizeCommand(ctx.text) || format) {
    const rows = parseChartOfAccountsRows(existing.chunks.join("\n"));
    if (rows.length === 0) {
      return {
        handled: true,
        reply:
          "I have the chunks for this thread, but I couldn't parse any chart-of-accounts rows yet. Send another chunk with the raw account lines, or say `start over` to reset.",
        sources: [],
        answerLogId: null,
      };
    }

    const resolvedFormat = format || "markdown";
    const body =
      resolvedFormat === "csv"
        ? renderChartOfAccountsCsv(rows)
        : renderChartOfAccountsMarkdown(rows);

    return {
      handled: true,
      reply:
        resolvedFormat === "csv"
          ? `CSV version ready below.\n\n\`\`\`\ncsv\n${body}\n\`\`\``
          : `${body}\n\n_This was built from the chunks stored in this Slack thread. Say \`start over\` if you want me to discard and rebuild it._`,
      sources: [],
      answerLogId: null,
    };
  }

  return null;
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
          slack_channel_id: ctx.channel,
          slack_thread_ts: ctx.threadTs || ctx.ts,
        }),
      },
      55000, // Must exceed chat route's 50s internal deadline
    );

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const errMsg = typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
      console.error("[abra-slack-responder] Chat API error:", errMsg);
      // Return a graceful error reply instead of null (which throws)
      return {
        reply: `I had trouble processing that message (${errMsg}). Could you try again, or break it into smaller pieces?`,
        sources: [],
        answerLogId: null,
      };
    }

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
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[abra-slack-responder] Chat API exception:", errMsg);
    // Return a graceful error reply instead of null (which causes upstream failures)
    return {
      reply: errMsg.includes("abort") || errMsg.includes("timeout")
        ? "I'm taking longer than expected to process that. Give me a moment and try again — if the message was large, try breaking it into smaller pieces."
        : `I ran into a problem (${errMsg.slice(0, 100)}). Could you try again?`,
      sources: [],
      answerLogId: null,
    };
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

  const structuredDocResponse = await handleStructuredDocumentConversation(ctx);
  if (structuredDocResponse) {
    return structuredDocResponse;
  }

  // Large structured data that is not a managed document session still gets
  // persisted before chat, so the operator does not lose the payload if chat fails.
  if (text.length > DATA_INGEST_THRESHOLD) {
    const actor = ctx.displayName || ctx.user;
    const titleSnippet = text.slice(0, 120).replace(/\n/g, " ").trim();
    try {
      const embedding = await buildEmbedding(
        `Data upload from ${actor}: ${titleSnippet}`,
      );
      await sbFetch("/rest/v1/open_brain_entries", {
        method: "POST",
        headers: {
          Prefer: "return=minimal",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source_type: "manual",
          source_ref: `slack-data-ingest-${ctx.channel}-${ctx.ts}`,
          entry_type: "data_upload",
          title: `Data from ${actor}: ${titleSnippet}`,
          raw_text: text.slice(0, 50000),
          summary_text: `Data upload (${text.length} chars) from ${actor} via Slack. First 500 chars: ${text.slice(0, 500)}`,
          category: "operational",
          department: "executive",
          confidence: "high",
          priority: "important",
          processed: true,
          embedding,
          metadata: { uploaded_by: actor, channel: ctx.channel, char_count: text.length },
        }),
      });
      console.log(`[abra-slack] Stored large data paste (${text.length} chars) from ${actor}`);
    } catch (err) {
      console.error("[abra-slack] Failed to store data paste:", err instanceof Error ? err.message : err);
    }
  }

  const answer = await callAbraChatViaInternalApi(ctx);
  if (!answer) {
    return {
      handled: true,
      reply:
        "I had trouble reaching my chat backend. I kept this thread intact, so please retry or break the request into smaller pieces if it was a large payload.",
      sources: [],
      answerLogId: null,
    };
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
