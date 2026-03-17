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
  execUpdateNotion,
  execCreateNotionPage,
  execSendSlack,
  execCreateBrainEntry,
  execQueryLedger,
  queryNotionDatabase,
} from "@/lib/ops/abra-actions";
import type { ActionResult } from "@/lib/ops/abra-actions";

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
          channel: "slack",
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

    const logId =
      typeof data.answerLogId === "string" && data.answerLogId
        ? data.answerLogId
        : typeof data.answer_log_id === "string" && data.answer_log_id
          ? data.answer_log_id
          : null;

    return {
      reply,
      sources,
      answerLogId: logId,
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

  // --------------- Step 2b: Auto-refresh if query asks about "today" / "latest" ---------------
  let refreshNote = "";
  if (REFRESH_QUERY_TRIGGERS.test(message)) {
    const freshestDays = freshestSourceAgeDays(
      tieredResults.all.map((r) => ({ days_ago: r.days_ago })),
    );
    // If data is stale (>0.5 days) or no results, trigger background refresh
    if (freshestDays === null || freshestDays > 0.5) {
      const refreshResult = await runKnowledgeRefresh("auto-refresh for time-sensitive query");
      refreshNote = formatFreshnessNote(freshestDays, refreshResult);
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
  if (refreshNote) {
    reply += `\n\n_${refreshNote}_`;
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
  thread_id?: string;
  gmail_thread_id?: string;
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

async function updateCommand(commandId: string, fields: Record<string, unknown>): Promise<boolean> {
  const body = { ...fields, updated_at: new Date().toISOString() };
  try {
    const res = await fetch(`${sbUrl()}/rest/v1/abra_email_commands?id=eq.${encodeURIComponent(commandId)}`, {
      method: "PATCH",
      headers: { ...sbHeaders(), Prefer: "return=minimal" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error(`[abra-cmd] updateCommand ${commandId} failed: ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[abra-cmd] updateCommand ${commandId} error:`, err);
    return false;
  }
}

/** Sanitize untrusted text before injecting into LLM prompts (prevents prompt injection) */
function sanitizeForPrompt(text: string, maxLen = 2000): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").slice(0, maxLen);
}

/** Atomic status transition — only updates if current status matches expectedStatus (prevents race conditions) */
async function claimCommand(commandId: string, expectedStatus: string, newStatus: string, extraFields?: Record<string, unknown>): Promise<boolean> {
  const body = { status: newStatus, updated_at: new Date().toISOString(), ...extraFields };
  try {
    const res = await fetch(
      `${sbUrl()}/rest/v1/abra_email_commands?id=eq.${encodeURIComponent(commandId)}&status=eq.${encodeURIComponent(expectedStatus)}`,
      {
        method: "PATCH",
        headers: { ...sbHeaders(), Prefer: "return=headers-only" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      },
    );
    // PostgREST returns Content-Range header: "*/0" (no match) or "0-0/1" (matched)
    const range = res.headers.get("content-range") || "";
    if (!range) return res.ok; // Fallback: assume success if 2xx
    // Extract total count after the slash: "*/0" → 0, "0-0/1" → 1, "0-N/*" → treat as matched
    const totalMatch = range.match(/\/(\d+|\*)\s*$/);
    if (!totalMatch) return res.ok;
    if (totalMatch[1] === "*") return true; // unknown count but rows returned
    return parseInt(totalMatch[1], 10) > 0;
  } catch (err) {
    console.error(`[abra-cmd] claimCommand ${commandId} ${expectedStatus}→${newStatus} error:`, err);
    return false;
  }
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

// ---------------------------------------------------------------------------
// Thread context for multi-turn email conversations
// ---------------------------------------------------------------------------
async function fetchThreadContext(threadId: string): Promise<string> {
  try {
    const rows = (await fetch(
      `${sbUrl()}/rest/v1/abra_email_commands?thread_id=eq.${encodeURIComponent(threadId)}&order=created_at.asc&select=task,execution_summary,sender_name,created_at&limit=10`,
      { headers: sbHeaders(), signal: AbortSignal.timeout(10000) },
    ).then((r) => r.json())) as Array<{
      task: string;
      execution_summary?: string;
      sender_name: string;
      created_at: string;
    }>;

    if (rows.length <= 1) return "";

    const context = rows
      .slice(0, -1)
      .map(
        (r, i) =>
          `[${i + 1}] ${r.sender_name}: ${r.task.slice(0, 300)}${r.execution_summary ? `\n   Result: ${r.execution_summary.slice(0, 200)}` : ""}`,
      )
      .join("\n");
    // Cap total thread context to prevent bloating the prompt
    return ("\n\nPREVIOUS MESSAGES IN THIS THREAD:\n" + context).slice(0, 1500);
  } catch {
    return "";
  }
}

async function fetchEmailThreadHistory(threadId: string): Promise<string> {
  try {
    const rows = (await fetch(
      `${sbUrl()}/rest/v1/abra_email_commands?thread_id=eq.${encodeURIComponent(threadId)}&order=created_at.asc&select=id,task,execution_summary,sender_name,status,created_at&limit=20`,
      { headers: sbHeaders(), signal: AbortSignal.timeout(10000) },
    ).then((r) => r.json())) as Array<{
      id: string;
      task: string;
      execution_summary?: string;
      sender_name: string;
      status: string;
      created_at: string;
    }>;

    if (rows.length === 0) return "No commands found in this thread.";

    const lines = rows.map((r, i) => {
      const statusEmoji =
        r.status === "completed"
          ? "\u2705"
          : r.status === "denied"
            ? "\u274c"
            : r.status === "execution_failed"
              ? "\u26a0\ufe0f"
              : "\u23f3";
      return (
        `${statusEmoji} *[${i + 1}]* \`${r.id}\`\n` +
        `   *From:* ${r.sender_name} | *Status:* ${r.status}\n` +
        `   *Task:* ${r.task.slice(0, 200)}` +
        (r.execution_summary
          ? `\n   *Result:* ${r.execution_summary.slice(0, 300)}`
          : "")
      );
    });

    return lines.join("\n\n");
  } catch {
    return "Failed to fetch thread history.";
  }
}

const ABRA_COMMAND_CHANNEL = "C0ALS6W7VB4"; // #abra-control

// ---------------------------------------------------------------------------
// Tool definitions for Claude tool_use (maps to abra-actions.ts handlers)
// ---------------------------------------------------------------------------
const ABRA_TOOLS = [
  {
    name: "query_notion_database",
    description: "Query a Notion database to understand current structure and data. Use this BEFORE making changes.",
    input_schema: {
      type: "object" as const,
      properties: {
        database_key: { type: "string", description: "Database key: meeting_notes, b2b_prospects, distributor_prospects, daily_performance, fleet_ops, inventory, sku_registry, cash_transactions, content_drafts, kpis" },
        filter_text: { type: "string", description: "Optional text to filter results" },
      },
      required: ["database_key"],
    },
  },
  {
    name: "update_notion_page",
    description: "Update an existing Notion page's properties or content",
    input_schema: {
      type: "object" as const,
      properties: {
        page_id: { type: "string", description: "32-char hex Notion page ID" },
        properties: { type: "object", description: "Notion property updates" },
        content: { type: "string", description: "New page content (replaces existing)" },
      },
      required: ["page_id"],
    },
  },
  {
    name: "create_notion_page",
    description: "Create a new page in a Notion database",
    input_schema: {
      type: "object" as const,
      properties: {
        database: { type: "string", description: "Database key" },
        title: { type: "string" },
        properties: { type: "object" },
        content: { type: "string" },
      },
      required: ["database", "title"],
    },
  },
  {
    name: "query_ledger",
    description: "Query the financial ledger for transaction data",
    input_schema: {
      type: "object" as const,
      properties: {
        fiscal_year: { type: "string" },
        category: { type: "string" },
        account_code: { type: "string" },
      },
    },
  },
  {
    name: "send_slack_message",
    description: "Send a message to a Slack channel (alerts, pipeline, or daily)",
    input_schema: {
      type: "object" as const,
      properties: {
        channel: { type: "string", enum: ["alerts", "pipeline", "daily"] },
        message: { type: "string" },
      },
      required: ["message"],
    },
  },
  {
    name: "create_brain_entry",
    description: "Store knowledge in Abra's brain for future reference",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        text: { type: "string" },
        category: { type: "string" },
        department: { type: "string" },
      },
      required: ["title", "text"],
    },
  },
];

async function executeToolCall(
  toolName: string,
  input: Record<string, unknown>,
): Promise<ActionResult> {
  try {
    switch (toolName) {
      case "query_notion_database":
        return await queryNotionDatabase(
          String(input.database_key || ""),
          typeof input.filter_text === "string" ? input.filter_text : undefined,
        );
      case "update_notion_page":
        return await execUpdateNotion(input);
      case "create_notion_page":
        return await execCreateNotionPage(input);
      case "query_ledger":
        return await execQueryLedger(input);
      case "send_slack_message":
        return await execSendSlack(input);
      case "create_brain_entry":
        return await execCreateBrainEntry(input);
      default:
        return { success: false, message: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return { success: false, message: `Tool error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

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
    const claimed = await claimCommand(commandId, "pending_approval", "denied", { decided_at: new Date().toISOString() });
    if (!claimed) {
      await postToSlackResponse(responseUrl, `⚠️ Command ${commandId} was already claimed by another action.`);
      return;
    }
    await postToSlackResponse(responseUrl, `❌ Denied command from ${entry.sender_name}: ${entry.task}`);
    return;
  }

  // ── Approved: atomically claim the command (prevents double-approve race) ──
  const claimed = await claimCommand(commandId, "pending_approval", "executing", { decided_at: new Date().toISOString() });
  if (!claimed) {
    await postToSlackResponse(responseUrl, `⚠️ Command ${commandId} was already claimed — possible double-approve.`);
    return;
  }
  await postToSlackResponse(responseUrl, `✅ Approved. Abra is executing: _${entry.task}_`);

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    await updateCommand(commandId, { status: "execution_failed", result_text: "No ANTHROPIC_API_KEY" });
    await postToSlackResponse(responseUrl, `❌ No ANTHROPIC_API_KEY configured.`);
    return;
  }

  try {
    // ── Tool_use loop: Claude can actually execute actions via tools ──
    const systemPrompt = `You are Abra, the AI operations assistant for USA Gummies. Ben (the founder) has approved an email command from an external person.

You have tools to query and modify Notion databases, send Slack messages, create tasks, and more. Use them to ACTUALLY EXECUTE the requested task.

WORKFLOW:
1. First, use query_notion_database to understand the current state
2. Then use the appropriate tool(s) to make the changes
3. Finally, provide an execution_summary and draft_reply

After completing all tool calls, respond with this JSON:
{
  "execution_summary": "What was actually done (reference specific changes made)",
  "draft_reply_subject": "Re: <original subject>",
  "draft_reply_body": "Email body to sender confirming what was done. Professional, friendly, concise. Sign off as Ben. Do NOT mention Abra or AI."
}

IMPORTANT: Actually execute the task using tools. Do not just describe what should be done.`;

    // Fetch conversation history if this command is part of a thread
    const threadContext = entry.thread_id ? await fetchThreadContext(entry.thread_id) : "";

    const messages: Array<{ role: string; content: unknown }> = [{
      role: "user",
      content: `Email command approved by Ben. Execute the task.

FROM: ${sanitizeForPrompt(entry.sender_name, 200)} (${sanitizeForPrompt(entry.sender_email, 200)})
SUBJECT: ${sanitizeForPrompt(entry.subject, 500)}
TASK: ${sanitizeForPrompt(entry.task, 1000)}
EMAIL CONTEXT: ${sanitizeForPrompt(entry.body_snippet || "(no additional context)", 1500)}${threadContext}`,
    }];

    const toolCallLog: string[] = [];
    let finalResponse = "";
    const MAX_TOOL_ROUNDS = 8;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const llmRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
          max_tokens: 4096,
          system: systemPrompt,
          tools: ABRA_TOOLS,
          messages,
        }),
        signal: AbortSignal.timeout(45000),
      });

      if (!llmRes.ok) {
        const errText = await llmRes.text().catch(() => "");
        throw new Error(`LLM API ${llmRes.status}: ${errText.slice(0, 200)}`);
      }

      const llmData = await llmRes.json();
      const content = llmData.content || [];

      // Add assistant response to messages
      messages.push({ role: "assistant", content });

      // Check if there are tool_use blocks
      const toolUses = content.filter((b: { type: string }) => b.type === "tool_use");
      const textBlocks = content.filter((b: { type: string }) => b.type === "text");

      if (toolUses.length === 0) {
        // No tool calls — this is the final response
        finalResponse = textBlocks.map((b: { text: string }) => b.text).join("\n");
        break;
      }

      // Execute each tool call (individually wrapped to prevent one failure from killing the batch)
      const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
      for (const toolUse of toolUses) {
        let result: ActionResult;
        try {
          result = await executeToolCall(toolUse.name, toolUse.input || {});
        } catch (toolErr) {
          result = { success: false, message: `Tool error: ${toolErr instanceof Error ? toolErr.message : "Unknown"}` };
        }
        toolCallLog.push(`${toolUse.name}: ${result.success ? "✅" : "❌"} ${result.message.slice(0, 200)}`);
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }

      // Add tool results to messages
      messages.push({ role: "user", content: toolResults });

      // If this was the last round and stop_reason is end_turn, capture text
      if (llmData.stop_reason === "end_turn") {
        finalResponse = textBlocks.map((b: { text: string }) => b.text).join("\n");
        break;
      }
    }

    // Safety: if MAX_TOOL_ROUNDS exhausted without a final text response, synthesize one
    if (!finalResponse && toolCallLog.length > 0) {
      finalResponse = JSON.stringify({
        execution_summary: `Completed after ${MAX_TOOL_ROUNDS} tool rounds.\n${toolCallLog.join("\n")}`,
        draft_reply_subject: `Re: ${entry.subject}`,
        draft_reply_body: `Hi ${entry.sender_name},\n\nYour request has been processed.\n\nBest,\nBen`,
      });
    }

    // Parse the final response (should be JSON with execution_summary + draft)
    let parsed: { execution_summary: string; draft_reply_subject: string; draft_reply_body: string };
    try {
      parsed = JSON.parse(finalResponse.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    } catch {
      parsed = {
        execution_summary: finalResponse.slice(0, 1000) || toolCallLog.join("\n"),
        draft_reply_subject: `Re: ${entry.subject}`,
        draft_reply_body: `Hi ${entry.sender_name},\n\nYour request has been processed: ${entry.task}\n\nBest,\nBen`,
      };
    }

    // Prepend tool execution log to summary
    const fullSummary = toolCallLog.length > 0
      ? `Tool actions:\n${toolCallLog.join("\n")}\n\nSummary: ${parsed.execution_summary}`
      : parsed.execution_summary;

    // Store draft reply + execution summary, move to draft_reply_pending
    await updateCommand(commandId, {
      status: "draft_reply_pending",
      execution_summary: fullSummary.slice(0, 5000),
      draft_reply_subject: (parsed.draft_reply_subject || `Re: ${entry.subject}`).slice(0, 500),
      draft_reply_body: (parsed.draft_reply_body || "").slice(0, 10000),
      result_text: fullSummary.slice(0, 5000),
    });

    // Post to Slack: show what was done + draft reply for approval
    const draftPreview = (parsed.draft_reply_body || "").slice(0, 800);
    await postToSlackChannel(
      ABRA_COMMAND_CHANNEL,
      `✅ *Task executed for ${entry.sender_name}*\n` +
      `*Task:* ${entry.task}\n` +
      `*What was done:* ${fullSummary.slice(0, 1000)}\n\n` +
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
    // Post to both response_url AND channel (response_url may have expired)
    await postToSlackResponse(responseUrl, `❌ Execution error: ${msg.slice(0, 200)}`);
    await postToSlackChannel(ABRA_COMMAND_CHANNEL, `❌ *Command ${commandId} failed*\n*Task:* ${entry.task}\n*Error:* ${msg.slice(0, 300)}`);
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

  // Atomically claim to prevent double-send
  const claimed = await claimCommand(commandId, "draft_reply_pending", "reply_approved");
  if (!claimed) {
    await postToSlackResponse(responseUrl, `⚠️ Reply for ${commandId} was already claimed.`);
    return;
  }
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

    // Fire-and-forget: auto-evaluate the completed command
    const evalHost = process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:4000");
    fetch(`${evalHost}/api/ops/abra/eval-command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CRON_SECRET?.trim() || ""}`,
      },
      body: JSON.stringify({ commandId }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown";
    // Revert to draft_reply_pending so the operator can retry instead of
    // leaving the draft stranded in a dead-end "execution_failed" state.
    await updateCommand(commandId, {
      status: "draft_reply_pending",
      result_text: `Send attempt failed (reverted to pending): ${msg}`,
    });
    await postToSlackResponse(
      responseUrl,
      `❌ Failed to send reply: ${msg.slice(0, 200)}\n_Draft has been returned to pending — retry with_ \`/abra sendreply ${commandId}\``,
    );
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
        "• `/abra commands` — List pending email commands\n" +
        "• `/abra triage [N]` — Show recent email triage summary\n" +
        "• `/abra thread <cmd-id|thread-id>` — Show email thread history\n" +
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
  const threadMatch = trimmedText.match(/^thread\s+(cmd-[\w-]+|thread-[\w-]+)$/i);
  const commandsMatch = /^commands$/i.test(trimmedText);
  const triageMatch = /^triage(?:\s+(\d+))?$/i.exec(trimmedText);
  const rateMatch = trimmedText.match(/^rate\s+(cmd-[\w-]+)\s+([1-5])(?:\s+(.+))?$/i);
  const scoresMatch = /^scores$/i.test(trimmedText);

  // Handle /abra rate <cmd-id> <1-5> [feedback] — rate a command execution
  if (rateMatch) {
    const rateCommandId = rateMatch[1];
    const humanRating = parseInt(rateMatch[2], 10);
    const humanFeedback = rateMatch[3]?.trim() || null;
    after(async () => {
      try {
        if (!sbUrl() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
          await postToSlackResponse(responseUrl, `❌ Supabase not configured.`);
          return;
        }
        // Check if eval already exists for this command
        const existingRes = await fetch(
          `${sbUrl()}/rest/v1/abra_command_evals?command_id=eq.${encodeURIComponent(rateCommandId)}&limit=1&select=id`,
          { headers: sbHeaders(), signal: AbortSignal.timeout(10000) },
        );
        const existing = existingRes.ok ? await existingRes.json() : [];
        if (existing.length > 0) {
          // Update existing eval with human rating
          await fetch(
            `${sbUrl()}/rest/v1/abra_command_evals?id=eq.${encodeURIComponent(existing[0].id)}`,
            {
              method: "PATCH",
              headers: { ...sbHeaders(), Prefer: "return=minimal" },
              body: JSON.stringify({ human_rating: humanRating, human_feedback: humanFeedback }),
              signal: AbortSignal.timeout(10000),
            },
          );
        } else {
          // Create new eval with just the human rating
          await fetch(`${sbUrl()}/rest/v1/abra_command_evals`, {
            method: "POST",
            headers: { ...sbHeaders(), Prefer: "return=minimal" },
            body: JSON.stringify({
              command_id: rateCommandId,
              human_rating: humanRating,
              human_feedback: humanFeedback,
            }),
            signal: AbortSignal.timeout(10000),
          });
        }
        const stars = "\u2605".repeat(humanRating) + "\u2606".repeat(5 - humanRating);
        await postToSlackResponse(responseUrl, `\u2705 Rated ${rateCommandId}: ${stars}${humanFeedback ? `\nFeedback: ${humanFeedback}` : ""}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown";
        await postToSlackResponse(responseUrl, `\u274C Error rating command: ${msg.slice(0, 200)}`);
      }
    });
    return NextResponse.json({ response_type: "ephemeral", text: `Rating ${rateCommandId}...` });
  }

  // Handle /abra scores — show eval summary
  if (scoresMatch) {
    after(async () => {
      try {
        if (!sbUrl() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
          await postToSlackResponse(responseUrl, `\u274C Supabase not configured.`);
          return;
        }
        const res = await fetch(
          `${sbUrl()}/rest/v1/abra_command_evals?order=created_at.desc&limit=20&select=task_understanding,execution_quality,reply_quality,overall_score,human_rating,created_at`,
          { headers: sbHeaders(), signal: AbortSignal.timeout(10000) },
        );
        if (!res.ok) {
          await postToSlackResponse(responseUrl, `\u274C Failed to fetch evals.`);
          return;
        }
        const evals = (await res.json()) as Array<{
          task_understanding: number | null;
          execution_quality: number | null;
          reply_quality: number | null;
          overall_score: number | null;
          human_rating: number | null;
          created_at: string;
        }>;
        if (evals.length === 0) {
          await postToSlackResponse(responseUrl, `No command evaluations yet.`);
          return;
        }
        const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        const taskScores = evals.filter((e) => e.task_understanding != null).map((e) => e.task_understanding!);
        const execScores = evals.filter((e) => e.execution_quality != null).map((e) => e.execution_quality!);
        const replyScores = evals.filter((e) => e.reply_quality != null).map((e) => e.reply_quality!);
        const overallScores = evals.filter((e) => e.overall_score != null).map((e) => e.overall_score!);
        const humanRatings = evals.filter((e) => e.human_rating != null).map((e) => e.human_rating!);

        // Trend: compare first half vs second half
        const half = Math.floor(overallScores.length / 2);
        const recentHalf = overallScores.slice(0, half);
        const olderHalf = overallScores.slice(half);
        let trend = "\u2192 Stable";
        if (recentHalf.length > 0 && olderHalf.length > 0) {
          const diff = avg(recentHalf) - avg(olderHalf);
          if (diff > 0.05) trend = "\uD83D\uDCC8 Improving";
          else if (diff < -0.05) trend = "\uD83D\uDCC9 Declining";
        }

        const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
        const text =
          `\uD83D\uDCCA *Abra Command Eval Scores* (last ${evals.length} evals)\n\n` +
          `\u2022 *Task Understanding:* ${pct(avg(taskScores))} (${taskScores.length} scored)\n` +
          `\u2022 *Execution Quality:* ${pct(avg(execScores))} (${execScores.length} scored)\n` +
          `\u2022 *Reply Quality:* ${pct(avg(replyScores))} (${replyScores.length} scored)\n` +
          `\u2022 *Overall:* ${pct(avg(overallScores))} (${overallScores.length} scored)\n` +
          (humanRatings.length > 0 ? `\u2022 *Human Avg:* ${avg(humanRatings).toFixed(1)}/5 (${humanRatings.length} ratings)\n` : "") +
          `\n*Trend:* ${trend}`;
        await postToSlackResponse(responseUrl, text);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown";
        await postToSlackResponse(responseUrl, `\u274C Error fetching scores: ${msg.slice(0, 200)}`);
      }
    });
    return NextResponse.json({ response_type: "ephemeral", text: "Fetching eval scores..." });
  }

  // Handle /abra triage [N] — show recent email triage summary
  if (triageMatch) {
    const triageLimit = Math.min(parseInt(triageMatch[1] || "20", 10), 50);
    after(async () => {
      try {
        if (!sbUrl() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
          await postToSlackResponse(responseUrl, `\u274c Supabase not configured \u2014 cannot fetch triage data.`);
          return;
        }
        const triageRes = await fetch(
          `${sbUrl()}/rest/v1/abra_email_triage?order=created_at.desc&limit=${triageLimit}&select=id,email_id,sender,subject,category,summary,suggested_action,auto_handled,created_at`,
          { headers: sbHeaders(), signal: AbortSignal.timeout(10000) },
        );
        if (!triageRes.ok) {
          await postToSlackResponse(responseUrl, `\u274c Failed to fetch triage data (${triageRes.status}).`);
          return;
        }
        const triageRows = (await triageRes.json()) as Array<{
          id: string;
          email_id: string;
          sender: string;
          subject: string;
          category: string;
          summary: string;
          suggested_action: string | null;
          auto_handled: boolean;
          created_at: string;
        }>;
        if (triageRows.length === 0) {
          await postToSlackResponse(responseUrl, `No email triage results found.`);
          return;
        }

        // Group by category
        const grouped: Record<string, typeof triageRows> = {};
        for (const r of triageRows) {
          if (!grouped[r.category]) grouped[r.category] = [];
          grouped[r.category].push(r);
        }

        const categoryEmojis: Record<string, string> = {
          urgent: "\u{1F6A8}",
          action_needed: "\u{1F4CB}",
          informational: "\u{2139}\u{FE0F}",
          routine: "\u{1F504}",
          spam: "\u{1F6AB}",
        };
        const categoryOrder = ["urgent", "action_needed", "informational", "routine", "spam"];

        let triageText = `*Email Triage Summary (last ${triageRows.length}):*\n`;
        for (const cat of categoryOrder) {
          const items = grouped[cat];
          if (!items || items.length === 0) continue;
          const emoji = categoryEmojis[cat] || "\u{1F4E7}";
          triageText += `\n${emoji} *${cat.toUpperCase().replace("_", " ")}* (${items.length}):\n`;
          for (const item of items.slice(0, 5)) {
            const senderShort = item.sender.length > 40 ? item.sender.slice(0, 37) + "..." : item.sender;
            triageText += `  \u2022 *${item.subject.slice(0, 60)}* \u2014 ${senderShort}\n    ${item.summary || "No summary"}\n`;
            if (item.suggested_action) {
              triageText += `    _Action: ${item.suggested_action}_\n`;
            }
          }
          if (items.length > 5) {
            triageText += `  _...and ${items.length - 5} more_\n`;
          }
        }

        await postToSlackResponse(responseUrl, triageText);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown";
        await postToSlackResponse(responseUrl, `\u274c Error: ${msg.slice(0, 200)}`);
      }
    });
    return NextResponse.json({ response_type: "ephemeral", text: "Fetching email triage summary..." });
  }

  // Handle /abra thread <id> — show conversation history for a thread
  if (threadMatch) {
    const lookupId = threadMatch[1];
    after(async () => {
      try {
        if (!sbUrl() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
          await postToSlackResponse(responseUrl, `\u274c Supabase not configured.`);
          return;
        }

        let threadId = lookupId;

        // If a cmd-id was given, resolve it to its thread_id
        if (lookupId.startsWith("cmd-")) {
          const cmd = await fetchCommand(lookupId);
          if (!cmd) {
            await postToSlackResponse(responseUrl, `\u274c Command ${lookupId} not found.`);
            return;
          }
          if (!cmd.thread_id) {
            await postToSlackResponse(
              responseUrl,
              `\u26a0\ufe0f Command ${lookupId} is not linked to a thread (pre-thread-tracking command).`,
            );
            return;
          }
          threadId = cmd.thread_id;
        }

        // Fetch thread metadata
        const threadRes = await fetch(
          `${sbUrl()}/rest/v1/abra_email_threads?id=eq.${encodeURIComponent(threadId)}&select=*&limit=1`,
          { headers: sbHeaders(), signal: AbortSignal.timeout(10000) },
        );
        const threads = threadRes.ok ? ((await threadRes.json()) as Array<Record<string, unknown>>) : [];
        const threadMeta = threads[0];

        const history = await fetchEmailThreadHistory(threadId);

        const header = threadMeta
          ? `\ud83e\uddf5 *Thread:* \`${threadId}\`\n*Subject:* ${threadMeta.subject || "(unknown)"}\n*From:* ${threadMeta.sender_name} (${threadMeta.sender_email})\n*Messages:* ${threadMeta.message_count || "?"} | *Status:* ${threadMeta.status}\n\n`
          : `\ud83e\uddf5 *Thread:* \`${threadId}\`\n\n`;

        await postToSlackResponse(responseUrl, header + history);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown";
        await postToSlackResponse(responseUrl, `\u274c Error: ${msg.slice(0, 200)}`);
      }
    });
    return NextResponse.json({ response_type: "ephemeral", text: `Fetching thread history for ${lookupId}...` });
  }

  // Handle /abra commands — list pending email commands
  if (commandsMatch) {
    after(async () => {
      try {
        if (!sbUrl() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
          await postToSlackResponse(responseUrl, `❌ Supabase not configured.`);
          return;
        }
        const res = await fetch(
          `${sbUrl()}/rest/v1/abra_email_commands?status=in.(pending_approval,executing,draft_reply_pending)&order=created_at.desc&limit=10&select=id,status,sender_name,task,created_at`,
          { headers: sbHeaders(), signal: AbortSignal.timeout(10000) },
        );
        if (!res.ok) {
          await postToSlackResponse(responseUrl, `❌ Failed to fetch commands.`);
          return;
        }
        const cmds = (await res.json()) as Array<{ id: string; status: string; sender_name: string; task: string; created_at: string }>;
        if (cmds.length === 0) {
          await postToSlackResponse(responseUrl, `No pending email commands.`);
          return;
        }
        const lines = cmds.map((c) => {
          const statusEmoji = c.status === "pending_approval" ? "⏳" : c.status === "draft_reply_pending" ? "📧" : "⚙️";
          const action = c.status === "pending_approval" ? `\`/abra approve ${c.id}\`` : c.status === "draft_reply_pending" ? `\`/abra sendreply ${c.id}\`` : "_processing..._";
          return `${statusEmoji} \`${c.id}\` — *${c.sender_name}*: ${c.task.slice(0, 80)}\n  Status: ${c.status} | ${action}`;
        });
        await postToSlackResponse(responseUrl, `*Pending Email Commands (${cmds.length}):*\n\n${lines.join("\n\n")}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown";
        await postToSlackResponse(responseUrl, `❌ Error: ${msg.slice(0, 200)}`);
      }
    });
    return NextResponse.json({ response_type: "ephemeral", text: "Fetching pending commands..." });
  }

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
        "• `/abra thread <cmd-id|thread-id>` — Show email thread history\n" +
        "• `/abra refresh` — Refresh latest email + teaching feeds\n" +
        "• `/abra cost` — Show monthly AI spend\n" +
        "• `/abra rate <cmd-id> <1-5> [feedback]` — Rate a command execution\n" +
        "• `/abra scores` — Show eval score summary\n" +
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
