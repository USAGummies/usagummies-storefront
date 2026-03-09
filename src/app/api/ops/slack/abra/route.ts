/**
 * POST /api/ops/slack/abra — Slack slash command webhook for /abra
 *
 * Slack sends form-urlencoded payload. We:
 * 1. Verify Slack request signature
 * 2. Immediately respond with "thinking..." (ephemeral)
 * 3. In the background, call /api/ops/abra/chat internally
 * 4. POST the reply to Slack's response_url
 *
 * Env: SLACK_SIGNING_SECRET (from Slack app config)
 */

import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "";

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

async function callAbraChat(message: string): Promise<{
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
        {
          role: "user",
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
  // Then process in background via a detached promise
  const backgroundPromise = (async () => {
    try {
      const { reply, sources } = await callAbraChat(text);
      await postToSlack(responseUrl, reply, sources);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Unknown error";
      await postToSlack(responseUrl, `⚠️ Abra encountered an error: ${errorMsg}`, []).catch(
        () => {},
      );
    }
  })();

  // Edge: In serverless, we can't truly "fire and forget" — but Next.js
  // will keep the function alive until all promises resolve within maxDuration.
  // We use waitUntil-like pattern by not awaiting but returning immediately.
  // For Vercel, the function stays alive for the response + any pending I/O.
  void backgroundPromise;

  return NextResponse.json({
    response_type: "ephemeral",
    text: `🧠 Abra is thinking about: _${text}_`,
  });
}
