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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "";
const BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "";

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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${typeof json === "string" ? json : JSON.stringify(json)}`,
    );
  }

  return json;
}

// ---------------------------------------------------------------------------
// Slack block builder — respects 3000-char section text limit
// ---------------------------------------------------------------------------
const SLACK_BLOCK_TEXT_LIMIT = 3000;

function buildSlackBlocks(
  fullText: string,
): Array<{ type: string; text: { type: string; text: string } }> {
  if (fullText.length <= SLACK_BLOCK_TEXT_LIMIT) {
    return [{ type: "section", text: { type: "mrkdwn", text: fullText } }];
  }

  const blocks: Array<{
    type: string;
    text: { type: string; text: string };
  }> = [];
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ChatMessage = { role: "user" | "assistant"; content: string };

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
): Promise<boolean> {
  if (!BOT_TOKEN) return false;

  const sourceText =
    sources.length > 0
      ? `\n\n_Sources: ${sources.map((s) => `${s.source_table === "email" ? "📧" : "🧠"} ${s.title}${typeof s.days_ago === "number" ? ` (${s.days_ago}d ago)` : ""}`).join(" · ")}_`
      : "";

  try {
    const fullText = `🧠 *Abra*\n\n${text}${sourceText}`;
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
          blocks: buildSlackBlocks(fullText),
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
) {
  const sourceText =
    sources.length > 0
      ? `\n\n_Sources: ${sources.map((s) => `${s.source_table === "email" ? "📧" : "🧠"} ${s.title}${typeof s.days_ago === "number" ? ` (${s.days_ago}d ago)` : ""}`).join(" · ")}_`
      : "";

  const fullText = `🧠 *Abra*\n\n${text}${sourceText}`;
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
      "/rest/v1/abra_departments?select=name,owner_name,description,key_context&order=name",
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

// ---------------------------------------------------------------------------
// Subcommand: initiative
// ---------------------------------------------------------------------------
async function handleInitiativeCommand(
  initiativeText: string,
  userEmail: string,
): Promise<string> {
  const match = initiativeText.match(
    /^(finance|operations|sales_and_growth|supply_chain|executive)\s+(.+)$/i,
  );
  if (!match) {
    return "❌ Invalid format. Try: `/abra initiative: finance Improve gross margin by 3% this quarter`";
  }

  const department = match[1].toLowerCase();
  const goal = match[2].trim();
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
}> {
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

  // --------------- Step 4: Build dynamic system prompt + context ---------------
  const signalsContext = buildSignalsContext(activeSignals);
  const systemPrompt = buildAbraSystemPrompt({
    format: "slack",
    corrections,
    departments,
    signalsContext,
  });

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

  // --------------- Step 5: LLM call — Claude first, OpenAI fallback ---------------
  if (anthropicKey) {
    try {
      const claudeModel =
        process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
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
            max_tokens: 800,
            temperature: 0.2,
            system: systemPrompt,
            messages: [
              ...historyMessages,
              { role: "user" as const, content: userContent },
            ],
          }),
        },
        { timeoutMs: 10000, maxRetries: 0 },
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
    };
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
    void logAnswer({
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

  return { reply, sources };
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
      text: "Usage:\n• `/abra <question>` — Ask Abra anything\n• `/abra correct: X but actually Y` — Correct wrong info\n• `/abra teach: [dept] content` — Teach Abra new knowledge",
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
  const costMatch = /^cost(?:\s+report)?$/i.test(trimmedText);
  const answerMatch = trimmedText.match(/^answer:\s*(.+)$/is);
  const searchMatch = trimmedText.match(/^search:\s*(.+)$/is);

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
        "• `/abra cost` — Show monthly AI spend\n" +
        "• `/abra status` — Check service status",
    });
  }

  if (statusMatch) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: `🧠 Abra status: online${BOT_TOKEN ? " | thread-enabled" : " | no-bot-token"}${SIGNING_SECRET ? " | signature-check:on" : " | signature-check:off"}`,
    });
  }

  if (correctMatch || teachMatch || initiativeMatch || costMatch) {
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
        : initiativeMatch
          ? "creating initiative"
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

      const { reply, sources } = await callAbraChat(
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
        );
        if (threaded) return;
      }

      await postToSlack(responseUrl, reply, sources);
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
      ).catch(() => {});
    }
  });

  return NextResponse.json({
    response_type: "ephemeral",
    text: `🧠 Abra is thinking about: _${queryText}_`,
  });
}
