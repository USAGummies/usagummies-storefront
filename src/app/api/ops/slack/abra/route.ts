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
  buildTemporalContext,
  type TemporalSearchRow,
  type AbraCorrection,
  type AbraDepartment,
} from "@/lib/ops/abra-system-prompt";
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

  // --------------- Step 2: Temporal search (with graceful degradation) ---------------
  let results: TemporalSearchRow[] = [];

  if (embedding) {
    try {
      const searchRes = await fetchWithRetry(
        `${supabaseUrl}/rest/v1/rpc/search_temporal`,
        {
          method: "POST",
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query_embedding: embedding,
            match_count: 8,
            filter_tables: ["brain", "email"],
          }),
          cache: "no-store",
        },
        { timeoutMs: 12000, maxRetries: 1 },
      );

      if (searchRes.ok) {
        results = await searchRes.json();
      }
    } catch {
      // Brain search failed — degrade to general knowledge
    }
  }

  // --------------- Step 3: Fetch corrections + departments for prompt ---------------
  const [corrections, departments] = await Promise.all([
    fetchCorrections(),
    fetchDepartments(),
  ]);

  // --------------- Step 4: Build dynamic system prompt + context ---------------
  const systemPrompt = buildAbraSystemPrompt({
    format: "slack",
    corrections,
    departments,
  });

  let context = "";
  let degraded = false;
  let confidence = 0;

  if (results.length > 0) {
    context = buildTemporalContext(results);
    confidence = computeConfidence(results);
  } else {
    degraded = true;
    context =
      "(No brain context available — embedding or search failed. Answer based on your general knowledge about USA Gummies, a dye-free gummy candy company. Be transparent about not having specific data.)";
  }

  // Add confidence hint to prompt
  const confidenceHint =
    !degraded && shouldAskQuestions(confidence, results)
      ? "\n\nIMPORTANT: Your confidence for this query is LOW. Consider asking the user to confirm or provide more information rather than guessing."
      : "";

  const userContent = `Question: ${message}\n\nContext from brain:\n${context}${confidenceHint}`;

  // Build conversation history
  const historyMessages =
    history && history.length > 0
      ? history.map((m) => ({ role: m.role, content: m.content }))
      : [];

  let reply = "";

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
          content?: Array<{ text?: string }>;
        };
        reply =
          claudeData.content
            ?.map((item) => item.text || "")
            .join("\n")
            .trim() || "";
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
          choices?: Array<{ message?: { content?: string } }>;
        };
        reply = openaiData.choices?.[0]?.message?.content?.trim() || "";
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
    if (detectedQuestions.length > 0 || shouldAskQuestions(confidence, results)) {
      for (const q of detectedQuestions.slice(0, 3)) {
        await logUnansweredQuestion(
          q,
          userName || "slack-user",
          `Original question: ${message}`,
        );
      }
    }
  }

  const sources = results.slice(0, 8).map((r) => ({
    title: r.title || "(untitled)",
    source_table: r.source_table,
    days_ago: r.days_ago,
  }));

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
  const correctMatch = trimmedText.match(/^correct:\s*(.+)$/is);
  const teachMatch = trimmedText.match(/^teach:\s*(.+)$/is);

  if (correctMatch || teachMatch) {
    // Subcommands run inline (fast enough for 3s Slack timeout)
    after(async () => {
      try {
        let reply: string;
        if (correctMatch) {
          reply = await handleCorrectCommand(
            correctMatch[1],
            userName,
          );
        } else {
          reply = await handleTeachCommand(teachMatch![1], userName);
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

    const label = correctMatch ? "storing correction" : "learning";
    return NextResponse.json({
      response_type: "ephemeral",
      text: `🧠 Abra is ${label}...`,
    });
  }

  // Normal RAG query
  after(async () => {
    try {
      let history: ChatMessage[] = [];
      if (threadTs && channelId && BOT_TOKEN) {
        history = await fetchThreadHistory(channelId, threadTs);
      }

      const { reply, sources } = await callAbraChat(
        text,
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
        `Unhandled error for question "${text.slice(0, 100)}": ${errorMsg}`,
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
    text: `🧠 Abra is thinking about: _${text}_`,
  });
}
