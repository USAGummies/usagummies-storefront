/**
 * POST /api/ops/slack/abra — Slack slash command webhook for /abra
 *
 * Self-healing RAG pipeline:
 * 1. Verify Slack request signature
 * 2. Immediately respond with "thinking..." (ephemeral)
 * 3. In the background (via Next.js after()):
 *    a. If thread_ts present + SLACK_BOT_TOKEN available, fetch thread history for multi-turn context
 *    b. Embed → search brain → LLM with thread history (retry + fallback at every step)
 *    c. Post reply (threaded if thread_ts, else via response_url)
 *
 * Resilience:
 * - Retry with exponential backoff on transient failures (429, 5xx, timeouts)
 * - Dual LLM provider: Claude first, OpenAI gpt-4o-mini fallback
 * - Graceful degradation: if brain search fails, answer with LLM general knowledge
 * - Slack block splitting for responses > 3000 chars
 * - Error diagnostics posted to user, never silent failures
 * - Ops alerts via Slack webhook on repeated failures
 *
 * Env: SLACK_SIGNING_SECRET, SLACK_BOT_TOKEN (optional),
 *       OPENAI_API_KEY, ANTHROPIC_API_KEY (optional),
 *       SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { NextResponse } from "next/server";
import { after } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

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
  { maxRetries = 2, baseDelayMs = 400, timeoutMs = 10000 }: { maxRetries?: number; baseDelayMs?: number; timeoutMs?: number } = {},
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      // Retry on transient errors (429 rate limit, 5xx server errors)
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
// Slack block builder — respects 3000-char section text limit
// ---------------------------------------------------------------------------
const SLACK_BLOCK_TEXT_LIMIT = 3000;

function buildSlackBlocks(fullText: string): Array<{ type: string; text: { type: string; text: string } }> {
  if (fullText.length <= SLACK_BLOCK_TEXT_LIMIT) {
    return [{ type: "section", text: { type: "mrkdwn", text: fullText } }];
  }

  const blocks: Array<{ type: string; text: { type: string; text: string } }> = [];
  let remaining = fullText;
  while (remaining.length > 0) {
    if (remaining.length <= SLACK_BLOCK_TEXT_LIMIT) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: remaining } });
      break;
    }
    let splitIdx = remaining.lastIndexOf("\n", SLACK_BLOCK_TEXT_LIMIT);
    if (splitIdx < SLACK_BLOCK_TEXT_LIMIT * 0.3) {
      splitIdx = remaining.lastIndexOf(" ", SLACK_BLOCK_TEXT_LIMIT);
    }
    if (splitIdx <= 0) splitIdx = SLACK_BLOCK_TEXT_LIMIT;
    blocks.push({ type: "section", text: { type: "mrkdwn", text: remaining.slice(0, splitIdx) } });
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
  sources: Array<{ title: string; source_table: string }>,
): Promise<boolean> {
  if (!BOT_TOKEN) return false;

  const sourceText =
    sources.length > 0
      ? `\n\n_Sources: ${sources.map((s) => `${s.source_table === "email" ? "📧" : "🧠"} ${s.title}`).join(" · ")}_`
      : "";

  try {
    const fullText = `🧠 *Abra*\n\n${text}${sourceText}`;
    const res = await fetchWithRetry("https://slack.com/api/chat.postMessage", {
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
    }, { timeoutMs: 10000, maxRetries: 1 });

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
  sources: Array<{ title: string; source_table: string }>,
) {
  const sourceText =
    sources.length > 0
      ? `\n\n_Sources: ${sources.map((s) => `${s.source_table === "email" ? "📧" : "🧠"} ${s.title}`).join(" · ")}_`
      : "";

  const fullText = `🧠 *Abra*\n\n${text}${sourceText}`;
  await fetchWithRetry(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      response_type: "in_channel",
      blocks: buildSlackBlocks(fullText),
    }),
  }, { timeoutMs: 10000, maxRetries: 2 });
}

// ---------------------------------------------------------------------------
// Ops alert — notify Slack ops channel on critical failures
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
    // Best-effort — don't throw on alert failure
  }
}

// ---------------------------------------------------------------------------
// Core RAG pipeline with self-healing
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT =
  "You are Abra, the AI operations assistant for USA Gummies. Answer using the provided context from emails and business data. Be concise and actionable. Format for Slack (use *bold*, _italic_, and bullet lists). Cite sources briefly.";

async function callAbraChat(message: string, history?: ChatMessage[]): Promise<{
  reply: string;
  sources: Array<{ title: string; source_table: string }>;
}> {
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!openaiKey || !supabaseUrl || !serviceKey) {
    const missing = [
      !openaiKey && "OPENAI_API_KEY",
      !supabaseUrl && "SUPABASE_URL",
      !serviceKey && "SUPABASE_SERVICE_ROLE_KEY",
    ].filter(Boolean).join(", ");
    await alertOps(`Missing env vars: ${missing}`);
    return { reply: `⚠️ Abra is not fully configured (missing: ${missing}). Ping Ben to fix.`, sources: [] };
  }

  // --------------- Step 1: Generate embedding (with retry) ---------------
  let embedding: number[] | null = null;
  try {
    const embedRes = await fetchWithRetry("https://api.openai.com/v1/embeddings", {
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
    }, { timeoutMs: 12000, maxRetries: 2 });

    if (embedRes.ok) {
      const embedData = await embedRes.json();
      const vec = embedData?.data?.[0]?.embedding;
      if (Array.isArray(vec) && vec.length === 1536) {
        embedding = vec;
      }
    }
  } catch {
    // Embedding failed after retries — will degrade to no-context LLM
  }

  // --------------- Step 2: Search brain (with retry + graceful degradation) ---------------
  let results: Array<{
    title: string | null;
    raw_text: string | null;
    summary_text: string | null;
    source_table: string;
  }> = [];

  if (embedding) {
    try {
      const searchRes = await fetchWithRetry(`${supabaseUrl}/rest/v1/rpc/search_unified`, {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query_embedding: embedding,
          match_count: 6,
          filter_tables: ["brain", "email"],
        }),
        cache: "no-store",
      }, { timeoutMs: 12000, maxRetries: 1 });

      if (searchRes.ok) {
        results = await searchRes.json();
      }
    } catch {
      // Brain search failed — degrade to general knowledge
    }
  }

  // --------------- Step 3: Build context and ask LLM ---------------
  let context = "";
  let degraded = false;

  if (results.length > 0) {
    context = results
      .map(
        (r) =>
          `[${r.source_table}] ${r.title || "(untitled)"}: ${(r.raw_text || r.summary_text || "").slice(0, 2000)}`,
      )
      .join("\n\n");
  } else {
    // Graceful degradation — answer without brain context
    degraded = true;
    context = "(No brain context available — embedding or search failed. Answer based on your general knowledge about USA Gummies, a gummy candy company.)";
  }

  const userContent = `Question: ${message}\n\nContext from brain:\n${context}`;

  let reply = "";

  // Try Anthropic Claude first (8s timeout — leaves room for OpenAI fallback within 30s budget)
  if (anthropicKey) {
    try {
      const claudeModel = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
      const claudeRes = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: claudeModel,
          max_tokens: 600,
          temperature: 0.2,
          system: SYSTEM_PROMPT,
          messages: [
            ...(history && history.length > 0
              ? history.map((m) => ({ role: m.role, content: m.content }))
              : []),
            { role: "user" as const, content: userContent },
          ],
        }),
      }, { timeoutMs: 8000, maxRetries: 0 }); // No retry on Claude — fail fast to OpenAI

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
      // Claude failed — will try OpenAI below
    }
  }

  // Fall back to OpenAI if Claude didn't produce a reply
  if (!reply && openaiKey) {
    try {
      const openaiModel = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
      const openaiRes = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: openaiModel,
          max_tokens: 600,
          temperature: 0.2,
          messages: [
            { role: "system" as const, content: SYSTEM_PROMPT },
            ...(history && history.length > 0
              ? history.map((m) => ({ role: m.role, content: m.content }))
              : []),
            { role: "user" as const, content: userContent },
          ],
        }),
      }, { timeoutMs: 15000, maxRetries: 1 });

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
    await alertOps("Both Claude and OpenAI failed to generate a response. Check API keys and billing.");
    return { reply: "⚠️ Abra is temporarily unable to reason. Both AI providers failed. The ops team has been notified.", sources: [] };
  }

  // Add degradation notice if we answered without brain context
  if (degraded) {
    reply = reply + "\n\n_⚠️ Note: This answer was generated without access to the business brain. Results may be less specific._";
  }

  const sources = results.map((r) => ({
    title: r.title || "(untitled)",
    source_table: r.source_table,
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

  // Verify Slack signature (skip in dev if no secret configured)
  if (SIGNING_SECRET) {
    if (!verifySlackSignature(bodyText, timestamp, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  const params = new URLSearchParams(bodyText);
  const text = params.get("text") || "";
  const responseUrl = params.get("response_url") || "";
  const channelId = params.get("channel_id") || "";
  const threadTs = params.get("thread_ts") || "";

  if (!text.trim()) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Usage: `/abra <your question>` — Ask Abra anything about the business.",
    });
  }

  if (!responseUrl) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "⚠️ Missing response_url from Slack. Please try again.",
    });
  }

  // Immediately respond with "thinking" (Slack requires response within 3s)
  // Next.js after() guarantees Vercel keeps the function alive for background work.
  after(async () => {
    try {
      // Fetch thread history for multi-turn context
      let history: ChatMessage[] = [];
      if (threadTs && channelId && BOT_TOKEN) {
        history = await fetchThreadHistory(channelId, threadTs);
      }

      const { reply, sources } = await callAbraChat(text, history);

      // Try threaded reply first, fall back to response_url
      if (threadTs && channelId) {
        const threaded = await postThreadReply(channelId, threadTs, reply, sources);
        if (threaded) return;
      }

      await postToSlack(responseUrl, reply, sources);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";

      // Alert ops on unexpected errors
      await alertOps(`Unhandled error for question "${text.slice(0, 100)}": ${errorMsg}`);

      // Always try to tell the user something went wrong
      await postToSlack(
        responseUrl,
        `⚠️ Abra encountered an unexpected error. The ops team has been notified and this will be fixed.\n\n_Error: ${errorMsg.slice(0, 200)}_`,
        [],
      ).catch(() => {});
    }
  });

  return NextResponse.json({
    response_type: "ephemeral",
    text: `🧠 Abra is thinking about: _${text}_`,
  });
}
