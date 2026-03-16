/**
 * POST /api/ops/slack/abra — Slack slash command webhook for /abra
 *
 * Self-healing RAG pipeline with temporal awareness and learning:
 * 1. Verify Slack request signature
 * 2. Parse subcommands: correct:, teach:, or normal query
 * 3. Immediately respond with "thinking..." (ephemeral)
 * 4. In the background (via Next.js after()):
 *    a. If thread_ts present + SLACK_BOT_TOKEN available, fetch thread history
 *    b. Embed → temporal search → LLM with dynamic prompt → post reply
 *    c. Log unanswered questions if confidence is low
 *
 * Subcommands:
 * - /abra correct: You said X but actually Y → stores correction
 * - /abra teach: [department] content → stores teaching
 * - /abra <question> → normal RAG pipeline
 *
 * Resilience:
 * - Retry with exponential backoff on transient failures
 * - Dual LLM provider: Claude first, OpenAI gpt-4o-mini fallback
 * - Graceful degradation: if brain fails, use general knowledge
 * - Temporal-weighted search: recent data beats old data
 * - Dynamic system prompt with corrections + departments
 * - Slack block splitting for responses > 3000 chars
 * - Ops alerts on repeated failures
 */

import { NextResponse } from "next/server";
import { after } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  detectDepartment,
  OPERATING_PILLARS,
} from "@/lib/ops/department-playbooks";
import {
  buildAbraSystemPrompt,
  type AbraCorrection,
  type AbraDepartment,
} from "@/lib/ops/abra-system-prompt";
import { searchTiered, buildTieredContext, type TieredSearchResult } from "@/lib/ops/abra-memory-tiers";
import { logAnswer, extractProvenance } from "@/lib/ops/abra-source-provenance";
import { getActiveSignals, buildSignalsContext } from "@/lib/ops/abra-operational-signals";
import { extractClaudeUsage, getMonthlySpend, logAICost } from "@/lib/ops/abra-cost-tracker";
import {
  detectQuestions,
  computeConfidence,
  shouldAskQuestions,
} from "@/lib/ops/abra-question-detector";
import {
  getAvailableActions,
  parseActionDirectives,
  proposeAndMaybeExecute,
  buildActionInstructions,
  stripActionBlocks,
} from "@/lib/ops/abra-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "";
const BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "";
const ALL_DEPARTMENTS = Array.from(
  new Set(
    Object.values(OPERATING_PILLARS).flatMap((pillar) => pillar.departments),
  ),
);

const DEPARTMENT_HELP_TEXT = Object.entries(OPERATING_PILLARS)
  .map(
    ([pillarId, pillar]) =>
      `• ${pillar.name} [${pillarId}]: ${pillar.departments.join(", ")}`,
  )
  .join("\n");

// ---------------------------------------------------------------------------
// Resilience: retry with exponential backoff
// ---------------------------------------------------------------------------
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  {
    maxRetries = 2,
    baseDelayMs = 400,
    timeoutMs = 10000,
  }: { maxRetries?: number; baseDelayMs?: number; timeoutMs?: number } = {},
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) {
        if (attempt < maxRetries) {
          const delay = Math.min(baseDelayMs * Math.pow(2, attempt), 3000);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }
      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt), 3000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError || new Error("fetchWithRetry: all attempts failed");
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------
function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}) {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase not configured");

  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(12000),
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

// ---------------------------------------------------------------------------
// Slack block builder — respects 3000-char section text limit
// ---------------------------------------------------------------------------
const SLACK_BLOCK_TEXT_LIMIT = 3000;

type SlackSectionBlock = {
  type: "section";
  text: { type: "mrkdwn"; text: string };
};

type SlackActionsBlock = {
  type: "actions";
  elements: Array<{
    type: "button";
    text: { type: "plain_text"; text: string; emoji?: boolean };
    action_id: string;
    value: string;
  }>;
};

type SlackBlock = SlackSectionBlock | SlackActionsBlock;

function buildSlackBlocks(
  fullText: string,
): SlackSectionBlock[] {
  if (fullText.length <= SLACK_BLOCK_TEXT_LIMIT) {
    return [{ type: "section", text: { type: "mrkdwn", text: fullText } }];
  }

  const blocks: SlackSectionBlock[] = [];
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

function buildFeedbackBlock(answerLogId: string): SlackActionsBlock {
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ChatMessage = { role: "user" | "assistant"; content: string };

const INITIATIVE_TRIGGERS =
  /\b(get .+ under control|let'?s work on|build .+ structure|set up .+ department|organize .+ department|establish .+ process)\b/i;
const SESSION_TRIGGERS =
  /\b(let'?s (have a |)meet|start a (meeting|session|review)|review .+ department|how'?s .+ doing|check in on)\b/i;
const COST_TRIGGERS =
  /\b(ai spend|ai cost|how much .+ spend|budget|monthly spend|cost report)\b/i;
const REFRESH_QUERY_TRIGGERS =
  /\b(today|latest|current|up to date|up-to-date|incoming|right now|refresh)\b/i;

type DetectedIntent =
  | { type: "initiative"; department: string | null; goal: string }
  | { type: "session"; department: string | null; sessionType: "meeting" | "review" }
  | { type: "cost" }
  | { type: "chat" };

function detectIntent(message: string): DetectedIntent {
  if (COST_TRIGGERS.test(message)) {
    return { type: "cost" };
  }
  if (INITIATIVE_TRIGGERS.test(message)) {
    return {
      type: "initiative",
      department: detectDepartment(message),
      goal: message,
    };
  }
  if (SESSION_TRIGGERS.test(message)) {
    return {
      type: "session",
      department: detectDepartment(message),
      sessionType: /review/i.test(message) ? "review" : "meeting",
    };
  }
  return { type: "chat" };
}

// ---------------------------------------------------------------------------
// Slack signature verification
// ---------------------------------------------------------------------------
function verifySlackSignature(
  body: string,
  timestamp: string | null,
  signature: string | null,
): boolean {
  if (!SIGNING_SECRET || !timestamp || !signature) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - parseInt(timestamp, 10)) > 300) return false;

  const baseString = `v0:${timestamp}:${body}`;
  const hmac = createHmac("sha256", SIGNING_SECRET)
    .update(baseString)
    .digest("hex");
  const expected = `v0=${hmac}`;

  try {
    return timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(signature, "utf8"),
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Thread history (multi-turn context)
// ---------------------------------------------------------------------------
async function fetchThreadHistory(
  channelId: string,
  threadTs: string,
): Promise<ChatMessage[]> {
  if (!BOT_TOKEN) return [];

  try {
    const url = new URL("https://slack.com/api/conversations.replies");
    url.searchParams.set("channel", channelId);
    url.searchParams.set("ts", threadTs);
    url.searchParams.set("limit", "20");

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${BOT_TOKEN}` },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as {
      ok: boolean;
      messages?: Array<{
        text: string;
        user?: string;
        bot_id?: string;
        subtype?: string;
        ts: string;
      }>;
    };

    if (!data.ok || !data.messages) return [];

    const history: ChatMessage[] = [];
    for (const msg of data.messages.slice(1)) {
      if (msg.subtype && msg.subtype !== "bot_message") continue;
      const isBot = Boolean(msg.bot_id);
      const content = isBot
        ? msg.text.replace(/^🧠\s*\*Abra\*\s*\n\n?/i, "").trim()
        : msg.text.trim();
      if (!content) continue;
      history.push({ role: isBot ? "assistant" : "user", content });
    }

    return history.slice(-12);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Post reply to Slack thread (via chat.postMessage)
// ---------------------------------------------------------------------------
async function postThreadReply(
  channelId: string,
  threadTs: string,
  text: string,
  sources: Array<{ title: string; source_table: string; days_ago?: number }>,
  answerLogId?: string | null,
): Promise<boolean> {
  if (!BOT_TOKEN) return false;

  const sourceText =
    sources.length > 0
      ? `\n\n_Sources: ${sources.map((s) => `${s.source_table === "email" ? "📧" : "🧠"} ${s.title}${typeof s.days_ago === "number" ? ` (${s.days_ago}d ago)` : ""}`).join(" · ")}_`
      : "";

  try {
    const fullText = `🧠 *Abra*\n\n${text}${sourceText}`;
    const blocks: SlackBlock[] = [...buildSlackBlocks(fullText)];
    if (answerLogId) {
      blocks.push(buildFeedbackBlock(answerLogId));
    }
    const res = await fetchWithRetry(
      "https://slack.com/api/chat.postMessage",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: channelId,
          thread_ts: threadTs,
          blocks,
          text: `🧠 Abra: ${text.slice(0, 200)}`,
        }),
      },
      { timeoutMs: 10000, maxRetries: 1 },
    );

    const data = (await res.json()) as { ok: boolean; error?: string };
    return data.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Post reply via Slack response_url (with retry)
// ---------------------------------------------------------------------------
async function postToSlack(
  responseUrl: string,
  text: string,
  sources: Array<{ title: string; source_table: string; days_ago?: number }>,
  answerLogId?: string | null,
) {
  const sourceText =
    sources.length > 0
      ? `\n\n_Sources: ${sources.map((s) => `${s.source_table === "email" ? "📧" : "🧠"} ${s.title}${typeof s.days_ago === "number" ? ` (${s.days_ago}d ago)` : ""}`).join(" · ")}_`
      : "";

  const fullText = `🧠 *Abra*\n\n${text}${sourceText}`;
  const blocks: SlackBlock[] = [...buildSlackBlocks(fullText)];
  if (answerLogId) {
    blocks.push(buildFeedbackBlock(answerLogId));
  }
  await fetchWithRetry(
    responseUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "in_channel",
        blocks,
      }),
    },
    { timeoutMs: 10000, maxRetries: 2 },
  );
}

// ---------------------------------------------------------------------------
// Ops alert
// ---------------------------------------------------------------------------
async function alertOps(message: string) {
  const opsWebhook = process.env.SLACK_SUPPORT_WEBHOOK_URL;
  if (!opsWebhook) return;
  try {
    await fetch(opsWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `[ALERTS] 🧠 Abra Error: ${message}`,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Best-effort
  }
}

// ---------------------------------------------------------------------------
// Fetch corrections + departments for dynamic prompt
// ---------------------------------------------------------------------------
async function fetchCorrections(): Promise<AbraCorrection[]> {
  try {
    const rows = (await sbFetch(
      "/rest/v1/abra_corrections?active=eq.true&order=created_at.desc&limit=10&select=original_claim,correction,corrected_by,department",
    )) as AbraCorrection[];
    return rows;
  } catch {
    return [];
  }
}

async function fetchDepartments(): Promise<AbraDepartment[]> {
  try {
    const rows = (await sbFetch(
      "/rest/v1/abra_departments?select=name,owner_name,description,key_context,operating_pillar,executive_role,sub_departments,parent_department&order=name",
    )) as AbraDepartment[];
    return rows;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Log unanswered questions
// ---------------------------------------------------------------------------
async function logUnansweredQuestion(
  question: string,
  askedBy: string,
  context: string,
  department?: string,
) {
  try {
    await sbFetch("/rest/v1/abra_unanswered_questions", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question,
        asked_by: askedBy,
        context: context.slice(0, 500),
        department: department || null,
      }),
    });
  } catch {
    // Best-effort — don't block the main flow
  }
}

// ---------------------------------------------------------------------------
// Subcommand: correct
// ---------------------------------------------------------------------------
async function handleCorrectCommand(
  correctionText: string,
  userEmail: string,
): Promise<string> {
  // Parse "You said X but actually Y" or similar patterns
  // Accept flexible formats: "X → Y", "X but Y", "X, actually Y"
  let original = "";
  let correction = "";

  const arrowMatch = correctionText.match(
    /^(.+?)\s*(?:→|->|but actually|but|, actually)\s+(.+)$/i,
  );
  if (arrowMatch) {
    original = arrowMatch[1].trim();
    correction = arrowMatch[2].trim();
  } else {
    // If no clear delimiter, treat whole thing as the correction
    correction = correctionText;
    original = "(unspecified — general correction)";
  }

  if (!correction) {
    return "❌ Couldn't parse the correction. Try: `/abra correct: You said X but actually Y`";
  }

  try {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) throw new Error("OPENAI_API_KEY not configured");

    const embeddingText = `CORRECTION: ${original} → ${correction}`;
    const embedRes = await fetchWithRetry(
      "https://api.openai.com/v1/embeddings",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: embeddingText.slice(0, 8000),
          dimensions: 1536,
        }),
      },
      { timeoutMs: 12000, maxRetries: 1 },
    );

    let embedding: number[] | null = null;
    if (embedRes.ok) {
      const embedData = await embedRes.json();
      const vec = embedData?.data?.[0]?.embedding;
      if (Array.isArray(vec)) embedding = vec;
    }

    // Insert correction
    await sbFetch("/rest/v1/abra_corrections", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        corrected_by: userEmail,
        original_claim: original,
        correction,
        embedding,
      }),
    });

    // Also write brain entry
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
        title: `Correction: ${original.slice(0, 100)}`,
        raw_text: `WRONG: ${original}\nCORRECT: ${correction}\nCorrected by: ${userEmail}`,
        summary_text: correction,
        category: "correction",
        department: "executive",
        confidence: "high",
        priority: "critical",
        processed: true,
        embedding,
      }),
    });

    return `✅ *Correction stored.*\n• _Wrong:_ ${original}\n• _Correct:_ ${correction}\n\nAbra will prioritize this over conflicting older data.`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return `❌ Failed to store correction: ${msg.slice(0, 200)}`;
  }
}

// ---------------------------------------------------------------------------
// Subcommand: teach
// ---------------------------------------------------------------------------
async function handleTeachCommand(
  teachText: string,
  userEmail: string,
): Promise<string> {
  // Parse "[department] content" or just "content"
  let department = "";
  let content = teachText;

  const deptMatch = teachText.match(/^\[([^\]]+)\]\s*(.+)$/s);
  if (deptMatch) {
    department = deptMatch[1].trim().toLowerCase();
    content = deptMatch[2].trim();
  }

  if (!content) {
    return "❌ No content to teach. Try: `/abra teach: [operations] Powers Confections is our repacker in Spokane`";
  }

  try {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) throw new Error("OPENAI_API_KEY not configured");

    const title = `Teaching: ${department || "general"} — ${content.slice(0, 60)}`;
    const embeddingText = `${title}. ${content}`;

    const embedRes = await fetchWithRetry(
      "https://api.openai.com/v1/embeddings",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: embeddingText.slice(0, 8000),
          dimensions: 1536,
        }),
      },
      { timeoutMs: 12000, maxRetries: 1 },
    );

    let embedding: number[] | null = null;
    if (embedRes.ok) {
      const embedData = await embedRes.json();
      const vec = embedData?.data?.[0]?.embedding;
      if (Array.isArray(vec)) embedding = vec;
    }

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
        raw_text: `Taught by ${userEmail}:\n${content}`,
        summary_text: content.slice(0, 500),
        category: "teaching",
        department: department || "executive",
        confidence: "high",
        priority: "important",
        processed: true,
        embedding,
      }),
    });

    return `✅ *Teaching stored${department ? ` in ${department}` : ""}.*\n\n_"${content.slice(0, 200)}"_\n\nAbra will use this in future answers.`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return `❌ Failed to store teaching: ${msg.slice(0, 200)}`;
  }
}

// ---------------------------------------------------------------------------
// Subcommand: cost
// ---------------------------------------------------------------------------
async function handleCostCommand(): Promise<string> {
  try {
    const spend = await getMonthlySpend();
    const month = new Date().toISOString().slice(0, 7);
    return `**AI Spend Report (${month})**\n\n` +
      `• Total: $${spend.total.toFixed(2)}\n` +
      `• Budget: $${spend.budget.toFixed(2)}\n` +
      `• Remaining: $${spend.remaining.toFixed(2)}\n` +
      `• Usage: ${spend.pctUsed}%\n` +
      `• Calls: ${spend.callCount.toLocaleString("en-US")}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return `❌ Failed to fetch cost summary: ${message.slice(0, 200)}`;
  }
}

function resolveInternalHost(): string {
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL.replace(/\/+$/, "");
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "https://www.usagummies.com";
}

type RefreshRunResult = {
  attempted: boolean;
  ok: boolean;
  emailFetchOk: boolean;
  autoTeachOk: boolean;
  reason: string;
};

async function runKnowledgeRefresh(reason: string): Promise<RefreshRunResult> {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret) {
    return {
      attempted: false,
      ok: false,
      emailFetchOk: false,
      autoTeachOk: false,
      reason: "CRON_SECRET is not configured",
    };
  }

  const host = resolveInternalHost();
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cronSecret}`,
  };

  let emailFetchOk = false;
  let autoTeachOk = false;

  try {
    const res = await fetchWithRetry(
      `${host}/api/ops/abra/email-fetch`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ limit: 50 }),
      },
      { timeoutMs: 30000, maxRetries: 1 },
    );
    emailFetchOk = res.ok;
  } catch {
    emailFetchOk = false;
  }

  try {
    const res = await fetchWithRetry(
      `${host}/api/ops/abra/auto-teach`,
      {
        method: "POST",
        headers,
      },
      { timeoutMs: 35000, maxRetries: 1 },
    );
    autoTeachOk = res.ok;
  } catch {
    autoTeachOk = false;
  }

  return {
    attempted: true,
    ok: emailFetchOk || autoTeachOk,
    emailFetchOk,
    autoTeachOk,
    reason,
  };
}

function formatFreshnessNote(
  freshestDays: number | null,
  refresh: RefreshRunResult,
): string {
  const ageText =
    freshestDays == null
      ? "I could not determine a recent source age"
      : `latest source age is ~${freshestDays.toFixed(1)} day(s)`;

  if (!refresh.attempted) {
    return `⚠️ Data freshness: ${ageText}. I could not auto-refresh (${refresh.reason}). Run \`/abra refresh\` after cron auth is configured.`;
  }

  if (refresh.ok) {
    return `🔄 Data freshness: ${ageText}. I detected stale context and started a refresh now (email-fetch: ${refresh.emailFetchOk ? "ok" : "failed"}, auto-teach: ${refresh.autoTeachOk ? "ok" : "failed"}).`;
  }

  return `⚠️ Data freshness: ${ageText}. I attempted refresh but both jobs failed.`;
}

function freshestSourceAgeDays(
  sources: Array<{ days_ago?: number }>,
): number | null {
  const values = sources
    .map((source) =>
      typeof source.days_ago === "number" && Number.isFinite(source.days_ago)
        ? source.days_ago
        : null,
    )
    .filter((value): value is number => value != null);
  if (values.length === 0) return null;
  return Math.min(...values);
}

async function handleRefreshCommand(): Promise<string> {
  const refresh = await runKnowledgeRefresh("manual_slack_refresh");
  if (!refresh.attempted) {
    return `❌ Refresh not started: ${refresh.reason}`;
  }
  if (!refresh.ok) {
    return "❌ Refresh attempted, but both email-fetch and auto-teach failed.";
  }
  return `✅ Refresh started.\n• Email fetch: ${refresh.emailFetchOk ? "ok" : "failed"}\n• Auto-teach: ${refresh.autoTeachOk ? "ok" : "failed"}`;
}

function parseInitiativeInput(
  initiativeText: string,
): { department: string | null; goal: string } {
  const raw = initiativeText.trim();
  if (!raw) return { department: null, goal: "" };

  const lowered = raw.toLowerCase();
  const departmentCandidates = [...ALL_DEPARTMENTS].sort(
    (a, b) => b.length - a.length,
  );

  for (const department of departmentCandidates) {
    const aliases = [
      department,
      department.replace(/_/g, " "),
      department.replace(/_/g, "-"),
    ];
    for (const alias of aliases) {
      if (lowered === alias) {
        return { department, goal: "" };
      }
      if (lowered.startsWith(`${alias} `)) {
        return {
          department,
          goal: raw.slice(alias.length).trim(),
        };
      }
    }
  }

  return { department: null, goal: raw };
}

// ---------------------------------------------------------------------------
// Subcommand: initiative
// ---------------------------------------------------------------------------
async function handleInitiativeCommand(
  initiativeText: string,
  userEmail: string,
): Promise<string> {
  const { department, goal } = parseInitiativeInput(initiativeText);
  if (!department) {
    return `❌ Invalid format. Use: \`/abra initiative: <department> <goal>\`\nValid departments:\n${DEPARTMENT_HELP_TEXT}`;
  }
  if (!goal) {
    return "❌ Initiative goal is required.";
  }

  try {
    const rows = (await sbFetch("/rest/v1/abra_initiatives", {
      method: "POST",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        department,
        title: goal.slice(0, 120),
        goal,
        status: "researching",
        approved_by: userEmail,
      }),
    })) as Array<{ id: string; department: string; title: string; status: string }>;

    const created = rows[0];
    if (!created?.id) {
      return "❌ Initiative creation returned no record.";
    }

    return `✅ Initiative created.\n• Department: ${created.department}\n• Title: ${created.title}\n• Status: ${created.status}\n• ID: ${created.id.slice(0, 8)}…`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return `❌ Failed to create initiative: ${message.slice(0, 200)}`;
  }
}

async function handleSessionIntentCommand(params: {
  department: string | null;
  sessionType: "meeting" | "review";
  goalText: string;
}): Promise<string> {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return "❌ CRON_SECRET is not configured; cannot start session from Slack intent yet.";
  }

  const host =
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const department = params.department || "executive";

  const res = await fetchWithRetry(
    `${host}/api/ops/abra/session`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({
        department,
        session_type: params.sessionType,
      }),
    },
    { timeoutMs: 15000, maxRetries: 1 },
  );

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errorText =
      typeof data.error === "string"
        ? data.error
        : `HTTP ${res.status}`;
    return `❌ Failed to start session: ${errorText}`;
  }

  const agenda = Array.isArray(data.agenda)
    ? data.agenda
        .slice(0, 5)
        .map((item, idx) => `${idx + 1}. ${String(item)}`)
        .join("\n")
    : "";
  const title =
    typeof data.title === "string" && data.title.trim()
      ? data.title
      : `${department} ${params.sessionType}`;
  const sessionId =
    typeof data.id === "string" && data.id
      ? data.id
      : "unknown";

  return [
    `✅ Session started: *${title}*`,
    `Department: ${department}`,
    `Type: ${params.sessionType}`,
    agenda ? `Agenda:\n${agenda}` : "",
    `Session ID: ${sessionId}`,
    `Trigger: "${params.goalText}"`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function callAbraChatViaInternalApi(
  message: string,
  history?: ChatMessage[],
): Promise<{
  reply: string;
  sources: Array<{ title: string; source_table: string; days_ago?: number }>;
  answerLogId: string | null;
} | null> {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret) return null;

  const host = resolveInternalHost();

  try {
    const res = await fetchWithRetry(
      `${host}/api/ops/abra/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cronSecret}`,
        },
        body: JSON.stringify({
          message,
          history: history || [],
        }),
      },
      { timeoutMs: 45000, maxRetries: 0 },
    );

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return null;

    const reply =
      typeof data.reply === "string" && data.reply.trim()
        ? data.reply.trim()
        : "";
    if (!reply) return null;

    const sources = Array.isArray(data.sources)
      ? data.sources
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const row = item as Record<string, unknown>;
            const sourceTable =
              row.source_table === "email" ? "email" : "brain";
            const title =
              typeof row.title === "string" && row.title.trim()
                ? row.title.trim()
                : "(untitled)";
            const daysAgo =
              typeof row.days_ago === "number" && Number.isFinite(row.days_ago)
                ? row.days_ago
                : undefined;
            return { title, source_table: sourceTable, days_ago: daysAgo };
          })
          .filter(
            (value): value is { title: string; source_table: string; days_ago: number | undefined } =>
              !!value,
          )
      : [];

    return {
      reply,
      sources,
      answerLogId: null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core RAG pipeline with temporal awareness
// ---------------------------------------------------------------------------
async function callAbraChat(
  message: string,
  history?: ChatMessage[],
  userName?: string,
): Promise<{
  reply: string;
  sources: Array<{ title: string; source_table: string; days_ago?: number }>;
  answerLogId: string | null;
}> {
  const proxied = await callAbraChatViaInternalApi(message, history);
  if (proxied) return proxied;

  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!openaiKey || !supabaseUrl || !serviceKey) {
    const missing = [
      !openaiKey && "OPENAI_API_KEY",
      !supabaseUrl && "SUPABASE_URL",
      !serviceKey && "SUPABASE_SERVICE_ROLE_KEY",
    ]
      .filter(Boolean)
      .join(", ");
    await alertOps(`Missing env vars: ${missing}`);
    return {
      reply: `⚠️ Abra is not fully configured (missing: ${missing}). Ping Ben to fix.`,
      sources: [],
      answerLogId: null,
    };
  }

  // --------------- Step 1: Generate embedding (with retry) ---------------
  let embedding: number[] | null = null;
  try {
    const embedRes = await fetchWithRetry(
      "https://api.openai.com/v1/embeddings",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: message,
          dimensions: 1536,
        }),
      },
      { timeoutMs: 12000, maxRetries: 2 },
    );

    if (embedRes.ok) {
      const embedData = await embedRes.json();
      const vec = embedData?.data?.[0]?.embedding;
      if (Array.isArray(vec) && vec.length === 1536) {
        embedding = vec;
      }
    }
  } catch {
    // Embedding failed — will degrade
  }

  // --------------- Step 2: Tiered search (with graceful degradation) ---------------
  let tieredResults: TieredSearchResult = {
    hot: [],
    warm: [],
    cold: [],
    all: [],
    tierCounts: { hot: 0, warm: 0, cold: 0 },
  };

  if (embedding) {
    try {
      tieredResults = await searchTiered({
        embedding,
        matchCount: 8,
        filterTables: ["brain", "email"],
      });
    } catch {
      // Brain search failed — degrade to general knowledge
    }
  }

  // --------------- Step 3: Fetch corrections + departments + active signals ---------------
  const [corrections, departments, activeSignals] = await Promise.all([
    fetchCorrections(),
    fetchDepartments(),
    getActiveSignals({ limit: 8 }),
  ]);
  const messageDepartment = detectDepartment(message);

  // --------------- Step 4: Build dynamic system prompt + context ---------------
  const signalsContext = buildSignalsContext(activeSignals);
  const availableActions = getAvailableActions();
  const actionInstructions = buildActionInstructions(availableActions);
  const systemPrompt = buildAbraSystemPrompt({
    format: "slack",
    corrections,
    departments,
    conversationDepartment: messageDepartment,
    signalsContext,
  }) + actionInstructions;

  let context = "";
  let degraded = false;
  let confidence = 0;

  if (tieredResults.all.length > 0) {
    context = buildTieredContext(tieredResults);
    confidence = computeConfidence(tieredResults.all);
  } else {
    degraded = true;
    context =
      "(No brain context available — embedding or search failed. Answer based on your general knowledge about USA Gummies, a dye-free gummy candy company. Be transparent about not having specific data.)";
  }

  // Add confidence hint to prompt
  const confidenceHint =
    !degraded && shouldAskQuestions(confidence, tieredResults.all)
      ? "\n\nIMPORTANT: Your confidence for this query is LOW. Consider asking the user to confirm or provide more information rather than guessing."
      : "";

  const userContent = `Question: ${message}\n\nContext from brain:\n${context}${confidenceHint}`;

  // Build conversation history
  const historyMessages =
    history && history.length > 0
      ? history.map((m) => ({ role: m.role, content: m.content }))
      : [];

  let reply = "";
  let modelUsed = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let answerLogId: string | null = null;

  // --------------- Step 5: LLM call — Claude first, OpenAI fallback ---------------
  if (anthropicKey) {
    try {
      const claudeModel =
        process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
      const claudeRes = await fetchWithRetry(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: claudeModel,
            max_tokens: 1200,
            temperature: 0.2,
            system: systemPrompt,
            messages: [
              ...historyMessages,
              { role: "user" as const, content: userContent },
            ],
          }),
        },
        { timeoutMs: 15000, maxRetries: 0 },
      );

      if (claudeRes.ok) {
        const claudeData = (await claudeRes.json()) as {
          usage?: Record<string, unknown>;
          content?: Array<{ text?: string }>;
        };
        const usage = extractClaudeUsage(
          claudeData as unknown as Record<string, unknown>,
        );
        if (usage) {
          inputTokens = usage.inputTokens;
          outputTokens = usage.outputTokens;
          void logAICost({
            model: claudeModel,
            provider: "anthropic",
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            endpoint: "/api/ops/slack/abra",
          });
        }
        reply =
          claudeData.content
            ?.map((item) => item.text || "")
            .join("\n")
            .trim() || "";
        if (reply) {
          modelUsed = claudeModel;
        }
      }
    } catch {
      // Claude failed — try OpenAI
    }
  }

  if (!reply && openaiKey) {
    try {
      const openaiModel = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
      const openaiRes = await fetchWithRetry(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: openaiModel,
            max_tokens: 800,
            temperature: 0.2,
            messages: [
              { role: "system" as const, content: systemPrompt },
              ...historyMessages,
              { role: "user" as const, content: userContent },
            ],
          }),
        },
        { timeoutMs: 15000, maxRetries: 1 },
      );

      if (openaiRes.ok) {
        const openaiData = (await openaiRes.json()) as {
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
          };
          choices?: Array<{ message?: { content?: string } }>;
        };
        reply = openaiData.choices?.[0]?.message?.content?.trim() || "";
        if (reply) {
          modelUsed = openaiModel;
          inputTokens =
            typeof openaiData.usage?.prompt_tokens === "number"
              ? openaiData.usage.prompt_tokens
              : 0;
          outputTokens =
            typeof openaiData.usage?.completion_tokens === "number"
              ? openaiData.usage.completion_tokens
              : 0;
        }
      }
    } catch {
      // OpenAI also failed
    }
  }

  if (!reply) {
    await alertOps(
      "Both Claude and OpenAI failed to generate a response. Check API keys and billing.",
    );
    return {
      reply:
        "⚠️ Abra is temporarily unable to reason. Both AI providers failed. The ops team has been notified.",
      sources: [],
      answerLogId: null,
    };
  }

  // Parse and execute any action directives from the LLM response
  const parsedActions = parseActionDirectives(reply);
  reply = parsedActions.cleanReply || reply;

  for (const directive of parsedActions.actions.slice(0, 3)) {
    try {
      await proposeAndMaybeExecute(directive.action);
    } catch (actionErr) {
      console.error(
        `[slack/abra] action ${directive.action.action_type} failed:`,
        actionErr instanceof Error ? actionErr.message : actionErr,
      );
    }
  }

  if (degraded) {
    reply +=
      "\n\n_⚠️ Note: This answer was generated without access to the business brain. Results may be less specific._";
  }

  // --------------- Step 6: Log questions if confidence is low ---------------
  if (!degraded && reply) {
    const detectedQuestions = detectQuestions(reply);
    if (detectedQuestions.length > 0 || shouldAskQuestions(confidence, tieredResults.all)) {
      for (const q of detectedQuestions.slice(0, 3)) {
        await logUnansweredQuestion(
          q,
          userName || "slack-user",
          `Original question: ${message}`,
        );
      }
    }
  }

  const sources = tieredResults.all.slice(0, 8).map((r) => ({
    title: r.title || "(untitled)",
    source_table: r.source_table,
    days_ago: r.days_ago,
  }));

  if (!degraded && tieredResults.all.length > 0) {
    const provenance = extractProvenance(tieredResults.all.slice(0, 8));
    answerLogId = await logAnswer({
      question: message,
      answer: reply,
      source_ids: provenance.source_ids,
      source_tables: provenance.source_tables,
      memory_tiers_used: provenance.memory_tiers_used,
      confidence,
      department: null,
      asked_by: userName || "slack-user",
      channel: "slack",
      model_used: modelUsed || "unknown",
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    });
  }

  return { reply, sources, answerLogId };
}

// ---------------------------------------------------------------------------
// Email-to-Abra command approval
// ---------------------------------------------------------------------------

async function postToSlackResponse(responseUrl: string, text: string) {
  if (!responseUrl) return;
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      response_type: "in_channel",
      text,
    }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Supabase helpers for email command queue
// ---------------------------------------------------------------------------
type EmailCommandRow = {
  id: string;
  status: string;
  task: string;
  sender_name: string;
  sender_email: string;
  subject: string;
  body_snippet?: string;
  draft_reply_subject?: string;
  draft_reply_body?: string;
  execution_summary?: string;
};

function sbHeaders() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
}

function sbUrl() {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
}

async function fetchCommand(commandId: string): Promise<EmailCommandRow | null> {
  const res = await fetch(
    `${sbUrl()}/rest/v1/abra_email_commands?id=eq.${encodeURIComponent(commandId)}&select=*&limit=1`,
    { headers: sbHeaders() },
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as EmailCommandRow[];
  return rows[0] || null;
}

async function updateCommand(commandId: string, fields: Record<string, unknown>) {
  const body = { ...fields, updated_at: new Date().toISOString() };
  await fetch(`${sbUrl()}/rest/v1/abra_email_commands?id=eq.${encodeURIComponent(commandId)}`, {
    method: "PATCH",
    headers: { ...sbHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

async function postToSlackChannel(channelId: string, text: string) {
  if (!BOT_TOKEN) return;
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel: channelId, text, mrkdwn: true }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => {});
}

const ABRA_COMMAND_CHANNEL = "C0ALS6W7VB4"; // #abra-control

// ---------------------------------------------------------------------------
// Phase 1: Approve → Execute task via LLM → Draft reply → await send approval
// ---------------------------------------------------------------------------
async function handleAbraCommandDecision(
  commandId: string,
  decision: "approved" | "denied",
  responseUrl: string,
) {
  if (!sbUrl() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    await postToSlackResponse(responseUrl, `❌ Supabase not configured — cannot process commands.`);
    return;
  }

  const entry = await fetchCommand(commandId);
  if (!entry) {
    await postToSlackResponse(responseUrl, `❌ Command ${commandId} not found.`);
    return;
  }
  if (entry.status !== "pending_approval") {
    await postToSlackResponse(responseUrl, `⚠️ Command ${commandId} already ${entry.status}.`);
    return;
  }

  if (decision === "denied") {
    await updateCommand(commandId, { status: "denied", decided_at: new Date().toISOString() });
    await postToSlackResponse(responseUrl, `❌ Denied command from ${entry.sender_name}: ${entry.task}`);
    return;
  }

  // ── Approved: execute the task directly via LLM ──
  await updateCommand(commandId, { status: "executing", decided_at: new Date().toISOString() });
  await postToSlackResponse(responseUrl, `✅ Approved. Abra is executing: _${entry.task}_`);

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    await updateCommand(commandId, { status: "execution_failed", result_text: "No ANTHROPIC_API_KEY" });
    await postToSlackResponse(responseUrl, `❌ No ANTHROPIC_API_KEY configured.`);
    return;
  }

  try {
    // Call Claude directly — the task is already approved, no approval queue needed
    const llmRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        max_tokens: 2048,
        system: `You are Abra, the AI operations assistant for USA Gummies. Ben (the founder) has approved an email command from an external person. Your job:

1. EXECUTE the requested task. Describe exactly what you did (or what needs to be done if you can't do it directly).
2. DRAFT a reply email to the sender confirming what was done.

Respond in this exact JSON format:
{
  "execution_summary": "What was done (1-3 sentences, be specific)",
  "draft_reply_subject": "Re: <original subject>",
  "draft_reply_body": "The email body to send back to the sender. Professional, friendly, concise. Sign off as Ben."
}

IMPORTANT: Respond ONLY with valid JSON, no markdown fences, no extra text.`,
        messages: [{
          role: "user",
          content: `Email command approved by Ben. Execute and draft reply.

FROM: ${entry.sender_name} (${entry.sender_email})
SUBJECT: ${entry.subject}
TASK: ${entry.task}
EMAIL CONTEXT: ${entry.body_snippet || "(no additional context)"}

Note: The task may already have been partially or fully completed by Ben. If the task sounds like it's been handled, write the execution summary accordingly and draft a confirmation reply.`,
        }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text().catch(() => "");
      throw new Error(`LLM API ${llmRes.status}: ${errText.slice(0, 200)}`);
    }

    const llmData = (await llmRes.json()) as {
      content: Array<{ type: string; text: string }>;
    };
    const rawText = llmData.content?.[0]?.text || "";

    // Parse LLM response
    let parsed: { execution_summary: string; draft_reply_subject: string; draft_reply_body: string };
    try {
      parsed = JSON.parse(rawText.trim());
    } catch {
      // If JSON parsing fails, use raw text as summary and generate simple reply
      parsed = {
        execution_summary: rawText.slice(0, 1000),
        draft_reply_subject: `Re: ${entry.subject}`,
        draft_reply_body: `Hi ${entry.sender_name},\n\nYour request has been processed: ${entry.task}\n\nBest,\nBen`,
      };
    }

    // Store draft reply + execution summary, move to draft_reply_pending
    await updateCommand(commandId, {
      status: "draft_reply_pending",
      execution_summary: (parsed.execution_summary || "").slice(0, 5000),
      draft_reply_subject: (parsed.draft_reply_subject || `Re: ${entry.subject}`).slice(0, 500),
      draft_reply_body: (parsed.draft_reply_body || "").slice(0, 10000),
      result_text: (parsed.execution_summary || "").slice(0, 5000),
    });

    // Post to Slack: show what was done + draft reply for approval
    const draftPreview = (parsed.draft_reply_body || "").slice(0, 800);
    await postToSlackChannel(
      ABRA_COMMAND_CHANNEL,
      `✅ *Task executed for ${entry.sender_name}*\n` +
      `*Task:* ${entry.task}\n` +
      `*What was done:* ${parsed.execution_summary}\n\n` +
      `📧 *Draft reply to ${entry.sender_email}:*\n` +
      `> *Subject:* ${parsed.draft_reply_subject}\n` +
      `> ${draftPreview.split("\n").join("\n> ")}\n\n` +
      `_Reply with:_ \`/abra sendreply ${commandId}\` _to send, or_ \`/abra deny ${commandId}\` _to discard_`,
    );

    // Also respond to the original slash command thread
    await postToSlackResponse(
      responseUrl,
      `✅ Task done. Draft reply posted to #abra-control for your review.\nUse \`/abra sendreply ${commandId}\` to send it.`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown";
    await updateCommand(commandId, { status: "execution_failed", result_text: msg.slice(0, 5000) });
    await postToSlackResponse(responseUrl, `❌ Execution error: ${msg.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Send the draft reply email
// ---------------------------------------------------------------------------
async function handleSendReply(commandId: string, responseUrl: string) {
  if (!sbUrl() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    await postToSlackResponse(responseUrl, `❌ Supabase not configured.`);
    return;
  }

  const entry = await fetchCommand(commandId);
  if (!entry) {
    await postToSlackResponse(responseUrl, `❌ Command ${commandId} not found.`);
    return;
  }
  if (entry.status !== "draft_reply_pending") {
    await postToSlackResponse(responseUrl, `⚠️ Command ${commandId} is ${entry.status} — expected draft_reply_pending.`);
    return;
  }
  if (!entry.draft_reply_body || !entry.sender_email) {
    await postToSlackResponse(responseUrl, `❌ No draft reply found for ${commandId}.`);
    return;
  }

  await updateCommand(commandId, { status: "reply_approved" });
  await postToSlackResponse(responseUrl, `📧 Sending reply to ${entry.sender_email}...`);

  try {
    // Send via the ops email utility
    const host =
      process.env.NEXTAUTH_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:4000");
    const authToken = process.env.CRON_SECRET?.trim() || "";

    // Use internal API to send email (goes through sendOpsEmail)
    const sendRes = await fetch(`${host}/api/ops/abra/send-reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        to: entry.sender_email,
        subject: entry.draft_reply_subject || `Re: ${entry.subject}`,
        body: entry.draft_reply_body,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!sendRes.ok) {
      const errText = await sendRes.text().catch(() => "");
      throw new Error(`Send failed (${sendRes.status}): ${errText.slice(0, 200)}`);
    }

    await updateCommand(commandId, { status: "completed" });
    await postToSlackResponse(responseUrl, `✅ Reply sent to ${entry.sender_email}!`);
    await postToSlackChannel(
      ABRA_COMMAND_CHANNEL,
      `📧 *Reply sent to ${entry.sender_name}* (${entry.sender_email})\n*Subject:* ${entry.draft_reply_subject}\n*Command:* ${commandId} — completed`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown";
    await updateCommand(commandId, { status: "execution_failed", result_text: `Send reply failed: ${msg}` });
    await postToSlackResponse(responseUrl, `❌ Failed to send reply: ${msg.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  const bodyText = await req.text();
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");

  if (SIGNING_SECRET) {
    if (!verifySlackSignature(bodyText, timestamp, signature)) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 },
      );
    }
  }

  const params = new URLSearchParams(bodyText);
  const text = params.get("text") || "";
  const responseUrl = params.get("response_url") || "";
  const channelId = params.get("channel_id") || "";
  const threadTs = params.get("thread_ts") || "";
  const userName = params.get("user_name") || "slack-user";

  if (!text.trim()) {
    return NextResponse.json({
      response_type: "ephemeral",
      text:
        "Usage:\n" +
        "• `/abra <question>` — Ask Abra anything\n" +
        "• `/abra correct: X but actually Y` — Correct wrong info\n" +
        "• `/abra teach: [dept] content` — Teach Abra new knowledge\n" +
        "• `/abra initiative: <department> <goal>` — Create initiative\n" +
        "• `/abra approve <cmd-id>` — Approve an email command\n" +
        "• `/abra deny <cmd-id>` — Deny an email command\n" +
        "• `/abra sendreply <cmd-id>` — Send the draft reply email\n" +
        "• `/abra refresh` — Refresh latest email + teaching feeds\n\n" +
        "Departments (20) grouped by operating pillar:\n" +
        DEPARTMENT_HELP_TEXT,
    });
  }

  if (!responseUrl) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "⚠️ Missing response_url from Slack. Please try again.",
    });
  }

  // Check for subcommands
  const trimmedText = text.trim();
  const helpMatch = /^help$/i.test(trimmedText);
  const statusMatch = /^status$/i.test(trimmedText);
  const correctMatch = trimmedText.match(/^correct:\s*(.+)$/is);
  const teachMatch = trimmedText.match(/^teach:\s*(.+)$/is);
  const initiativeMatch = trimmedText.match(/^initiative:\s*(.+)$/is);
  const refreshMatch = /^refresh(?:\s+(?:now|data|brain))?$/i.test(trimmedText);
  const costMatch = /^cost(?:\s+report)?$/i.test(trimmedText);
  const answerMatch = trimmedText.match(/^answer:\s*(.+)$/is);
  const searchMatch = trimmedText.match(/^search:\s*(.+)$/is);
  const approveMatch = trimmedText.match(/^approve\s+(cmd-[\w-]+)$/i);
  const denyMatch = trimmedText.match(/^deny\s+(cmd-[\w-]+)$/i);
  const sendReplyMatch = trimmedText.match(/^sendreply\s+(cmd-[\w-]+)$/i);

  // Handle sendreply for email-to-Abra commands (phase 2: send draft reply)
  if (sendReplyMatch) {
    const commandId = sendReplyMatch[1];
    after(async () => {
      try {
        await handleSendReply(commandId, responseUrl);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        await postToSlackResponse(responseUrl, `❌ Failed to send reply: ${msg.slice(0, 200)}`);
      }
    });
    return NextResponse.json({
      response_type: "in_channel",
      text: `Sending reply for ${commandId}...`,
    });
  }

  // Handle approve/deny for email-to-Abra commands
  if (approveMatch || denyMatch) {
    const commandId = (approveMatch || denyMatch)?.[1] || "";
    const decision = approveMatch ? "approved" : "denied";

    // Respond immediately
    after(async () => {
      try {
        // deny can also cancel a draft reply
        if (decision === "denied") {
          const entry = await fetchCommand(commandId);
          if (entry && entry.status === "draft_reply_pending") {
            await updateCommand(commandId, { status: "denied", result_text: "Draft reply discarded by Ben" });
            await postToSlackResponse(responseUrl, `❌ Draft reply for ${commandId} discarded.`);
            return;
          }
        }
        await handleAbraCommandDecision(commandId, decision, responseUrl);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        await postToSlackResponse(responseUrl, `❌ Failed to process ${decision}: ${msg.slice(0, 200)}`);
      }
    });

    return NextResponse.json({
      response_type: "in_channel",
      text: `Processing ${decision} for ${commandId}...`,
    });
  }
  const intent =
    answerMatch || searchMatch ? ({ type: "chat" } as const) : detectIntent(trimmedText);
  const inferredInitiativeText =
    !initiativeMatch &&
    intent.type === "initiative" &&
    intent.department
      ? `${intent.department} ${intent.goal}`
      : null;
  const inferredSessionIntent =
    intent.type === "session"
      ? {
          department: intent.department,
          sessionType: intent.sessionType,
          goalText: trimmedText,
        }
      : null;
  const inferredCostIntent = !costMatch && intent.type === "cost";

  if (helpMatch) {
    return NextResponse.json({
      response_type: "ephemeral",
      text:
        "Usage:\n" +
        "• `/abra <question>` — Ask Abra anything\n" +
        "• `/abra answer: <question>` — Alias for question mode\n" +
        "• `/abra search: <query>` — Search-focused answer\n" +
        "• `/abra correct: X but actually Y` — Correct wrong info\n" +
        "• `/abra teach: [dept] content` — Teach Abra new knowledge\n" +
        "• `/abra initiative: <department> <goal>` — Create initiative\n" +
        "• `/abra refresh` — Refresh latest email + teaching feeds\n" +
        "• `/abra cost` — Show monthly AI spend\n" +
        "• `/abra status` — Check service status\n\n" +
        "Departments (20) grouped by operating pillar:\n" +
        DEPARTMENT_HELP_TEXT,
    });
  }

  if (statusMatch) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: `🧠 Abra status: online${BOT_TOKEN ? " | thread-enabled" : " | no-bot-token"}${SIGNING_SECRET ? " | signature-check:on" : " | signature-check:off"}`,
    });
  }

  if (
    correctMatch ||
    teachMatch ||
    initiativeMatch ||
    refreshMatch ||
    costMatch ||
    inferredInitiativeText ||
    inferredSessionIntent ||
    inferredCostIntent
  ) {
    // Subcommands run inline (fast enough for 3s Slack timeout)
    after(async () => {
      try {
        let reply: string;
        if (correctMatch) {
          reply = await handleCorrectCommand(
            correctMatch[1],
            userName,
          );
        } else if (teachMatch) {
          reply = await handleTeachCommand(teachMatch![1], userName);
        } else if (initiativeMatch) {
          reply = await handleInitiativeCommand(initiativeMatch[1], userName);
        } else if (refreshMatch) {
          reply = await handleRefreshCommand();
        } else if (inferredInitiativeText) {
          reply = await handleInitiativeCommand(inferredInitiativeText, userName);
        } else if (inferredSessionIntent) {
          reply = await handleSessionIntentCommand(inferredSessionIntent);
        } else {
          reply = await handleCostCommand();
        }

        const fullText = `🧠 *Abra*\n\n${reply}`;
        await fetchWithRetry(
          responseUrl,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              response_type: "in_channel",
              blocks: buildSlackBlocks(fullText),
            }),
          },
          { timeoutMs: 10000, maxRetries: 2 },
        );
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Unknown error";
        await postToSlack(
          responseUrl,
          `⚠️ Subcommand failed: ${errorMsg.slice(0, 200)}`,
          [],
        ).catch(() => {});
      }
    });

    const label = correctMatch
      ? "storing correction"
      : teachMatch
        ? "learning"
        : initiativeMatch || inferredInitiativeText
          ? "creating initiative"
          : refreshMatch
            ? "refreshing data"
          : inferredSessionIntent
            ? "starting session"
          : "fetching cost summary";
    return NextResponse.json({
      response_type: "ephemeral",
      text: `🧠 Abra is ${label}...`,
    });
  }

  // Normal RAG query
  const queryText = answerMatch?.[1] || searchMatch?.[1] || text;
  after(async () => {
    try {
      let history: ChatMessage[] = [];
      if (threadTs && channelId && BOT_TOKEN) {
        history = await fetchThreadHistory(channelId, threadTs);
      }

      const { reply, sources, answerLogId } = await callAbraChat(
        queryText,
        history,
        userName,
      );

      if (threadTs && channelId) {
        const threaded = await postThreadReply(
          channelId,
          threadTs,
          reply,
          sources,
          answerLogId,
        );
        if (threaded) return;
      }

      await postToSlack(responseUrl, reply, sources, answerLogId);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Unknown error";
      await alertOps(
        `Unhandled error for question "${queryText.slice(0, 100)}": ${errorMsg}`,
      );
      await postToSlack(
        responseUrl,
        `⚠️ Abra encountered an unexpected error. The ops team has been notified.\n\n_Error: ${errorMsg.slice(0, 200)}_`,
        [],
        null,
      ).catch(() => {});
    }
  });

  return NextResponse.json({
    response_type: "ephemeral",
    text: `🧠 Abra is thinking about: _${queryText}_`,
  });
}
