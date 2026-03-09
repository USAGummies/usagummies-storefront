/**
 * POST /api/ops/slack/abra — Slack slash command webhook for /abra
 *
 * Slack sends form-urlencoded payload. We:
 * 1. Verify Slack request signature
 * 2. Immediately respond with "thinking..." (ephemeral)
 * 3. In the background:
 *    a. If thread_ts present + SLACK_BOT_TOKEN available, fetch thread history for multi-turn context
 *    b. Embed → search brain → Claude with thread history
 *    c. Post reply (threaded if thread_ts, else via response_url)
 *
 * Env: SLACK_SIGNING_SECRET (from Slack app config)
 *       SLACK_BOT_TOKEN (optional — enables thread history + threaded replies)
 */

import { NextResponse } from "next/server";
import { after } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "";
const BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "";

type ChatMessage = { role: "user" | "assistant"; content: string };

function verifySlackSignature(
  body: string,
  timestamp: string | null,
  signature: string | null,
): boolean {
  if (!SIGNING_SECRET || !timestamp || !signature) return false;

  // Reject requests older than 5 minutes
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

/**
 * Fetch thread replies from Slack to build multi-turn context.
 * Returns messages in chronological order, mapped to ChatMessage format.
 * Bot messages (from Abra) → "assistant", user messages → "user".
 */
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

    // Skip the parent message (first in array) — we only want replies
    // Map: bot messages → assistant, human messages → user
    const history: ChatMessage[] = [];
    for (const msg of data.messages.slice(1)) {
      // Skip system subtypes
      if (msg.subtype && msg.subtype !== "bot_message") continue;

      const isBot = Boolean(msg.bot_id);
      // Strip Abra prefix from bot messages
      const content = isBot
        ? msg.text.replace(/^🧠\s*\*Abra\*\s*\n\n?/i, "").trim()
        : msg.text.trim();

      if (!content) continue;
      history.push({ role: isBot ? "assistant" : "user", content });
    }

    // Keep last 6 exchanges to stay within context limits
    return history.slice(-12);
  } catch {
    // Thread fetch failure is non-critical — continue without history
    return [];
  }
}

/**
 * Post a message to a Slack channel/thread using chat.postMessage.
 * Requires BOT_TOKEN. Falls back to response_url if unavailable.
 */
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
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: channelId,
        thread_ts: threadTs,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `🧠 *Abra*\n\n${text}${sourceText}`,
            },
          },
        ],
        text: `🧠 Abra: ${text.slice(0, 200)}`,
      }),
      signal: AbortSignal.timeout(10000),
    });

    const data = (await res.json()) as { ok: boolean };
    return data.ok;
  } catch {
    return false;
  }
}

async function callAbraChat(message: string, history?: ChatMessage[]): Promise<{
  reply: string;
  sources: Array<{ title: string; source_table: string }>;
}> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  // Use internal fetch — this bypasses auth since we already verified Slack signature
  // We need to call the insights endpoint instead (which is lighter) or handle auth
  // For now, we use the Abra brain directly via Supabase + Claude

  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!openaiKey || !anthropicKey || !supabaseUrl || !serviceKey) {
    return { reply: "⚠️ Abra is not fully configured. Missing API keys.", sources: [] };
  }

  // 1. Generate embedding
  const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
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
    signal: AbortSignal.timeout(15000),
  });

  if (!embedRes.ok) {
    return { reply: "⚠️ Failed to process your question (embedding error).", sources: [] };
  }

  const embedData = await embedRes.json();
  const embedding = embedData?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    return { reply: "⚠️ Failed to generate query embedding.", sources: [] };
  }

  // 2. Search brain
  const searchRes = await fetch(`${supabaseUrl}/rest/v1/rpc/search_unified`, {
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
    signal: AbortSignal.timeout(15000),
  });

  if (!searchRes.ok) {
    return { reply: "⚠️ Brain search failed. Try again later.", sources: [] };
  }

  const results = (await searchRes.json()) as Array<{
    title: string | null;
    raw_text: string | null;
    summary_text: string | null;
    source_table: string;
  }>;

  if (results.length === 0) {
    return { reply: "No relevant data found in the brain for your question.", sources: [] };
  }

  // 3. Build context and ask Claude
  const context = results
    .map(
      (r) =>
        `[${r.source_table}] ${r.title || "(untitled)"}: ${(r.raw_text || r.summary_text || "").slice(0, 2000)}`,
    )
    .join("\n\n");

  const claudeModel = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";
  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
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
      system:
        "You are Abra, the AI operations assistant for USA Gummies. Answer using the provided context from emails and business data. Be concise and actionable. Format for Slack (use *bold*, _italic_, and bullet lists). Cite sources briefly.",
      messages: [
        // Include thread history for multi-turn context
        ...(history && history.length > 0
          ? history.map((m) => ({ role: m.role, content: m.content }))
          : []),
        {
          role: "user" as const,
          content: `Question: ${message}\n\nContext from brain:\n${context}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!claudeRes.ok) {
    return { reply: "⚠️ Abra reasoning failed. Try again later.", sources: [] };
  }

  const claudeData = (await claudeRes.json()) as {
    content?: Array<{ text?: string }>;
  };
  const reply =
    claudeData.content
      ?.map((item) => item.text || "")
      .join("\n")
      .trim() || "No response generated.";

  const sources = results.map((r) => ({
    title: r.title || "(untitled)",
    source_table: r.source_table,
  }));

  return { reply, sources };
}

async function postToSlack(
  responseUrl: string,
  text: string,
  sources: Array<{ title: string; source_table: string }>,
) {
  const sourceText =
    sources.length > 0
      ? `\n\n_Sources: ${sources.map((s) => `${s.source_table === "email" ? "📧" : "🧠"} ${s.title}`).join(" · ")}_`
      : "";

  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      response_type: "in_channel",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🧠 *Abra*\n\n${text}${sourceText}`,
          },
        },
      ],
    }),
    signal: AbortSignal.timeout(10000),
  });
}

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

  // Parse form-urlencoded payload
  const params = new URLSearchParams(bodyText);
  const text = params.get("text") || "";
  const responseUrl = params.get("response_url") || "";
  const userId = params.get("user_id") || "";
  const channelId = params.get("channel_id") || "";
  // thread_ts is present when slash command is invoked within a thread
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
  // Use Next.js after() to run background work — Vercel keeps the function
  // alive after the response is sent until the callback completes or maxDuration.
  after(async () => {
    try {
      // Fetch thread history for multi-turn context (if in a thread + bot token available)
      let history: ChatMessage[] = [];
      if (threadTs && channelId && BOT_TOKEN) {
        history = await fetchThreadHistory(channelId, threadTs);
      }

      const { reply, sources } = await callAbraChat(text, history);

      // If in a thread and bot token available, reply in thread
      if (threadTs && channelId) {
        const threaded = await postThreadReply(channelId, threadTs, reply, sources);
        if (threaded) return; // Successfully posted in thread
      }

      // Fallback: post via response_url
      await postToSlack(responseUrl, reply, sources);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Unknown error";
      await postToSlack(responseUrl, `⚠️ Abra encountered an error: ${errorMsg}`, []).catch(
        () => {},
      );
    }
  });

  return NextResponse.json({
    response_type: "ephemeral",
    text: `🧠 Abra is thinking about: _${text}_`,
  });
}
