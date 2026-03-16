/**
 * POST /api/ops/abra/slack-monitor — Slack Events API webhook
 *
 * Monitors Slack channels for:
 * - Direct @abra mentions
 * - Messages in #abra-control that need attention
 * - Questions that Abra can answer proactively
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json();

  // Handle Slack URL verification challenge
  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

  // Handle events
  if (body.type === "event_callback") {
    const event = body.event;

    // Ignore bot messages (prevent loops)
    if (event.bot_id || event.subtype === "bot_message") {
      return NextResponse.json({ ok: true });
    }

    // Handle app_mention events
    if (event.type === "app_mention") {
      const text =
        event.text?.replace(/<@[A-Z0-9]+>/g, "").trim() || "";
      const channelId = event.channel;
      const threadTs = event.thread_ts || event.ts;

      if (!text) {
        return NextResponse.json({ ok: true });
      }

      // Process in background
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      const botToken = process.env.SLACK_BOT_TOKEN;

      if (anthropicKey && botToken) {
        // Fire and forget — respond in thread
        (async () => {
          try {
            const llmRes = await fetch(
              "https://api.anthropic.com/v1/messages",
              {
                method: "POST",
                headers: {
                  "x-api-key": anthropicKey,
                  "anthropic-version": "2023-06-01",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model:
                    process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
                  max_tokens: 1024,
                  system:
                    "You are Abra, the AI operations assistant for USA Gummies. You're responding to a Slack mention. Be concise, helpful, and professional. Use Slack markdown formatting.",
                  messages: [{ role: "user", content: text }],
                }),
                signal: AbortSignal.timeout(30000),
              },
            );

            if (!llmRes.ok) return;

            const data = await llmRes.json();
            const reply = data.content?.[0]?.text || "";

            if (reply) {
              await fetch("https://slack.com/api/chat.postMessage", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${botToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  channel: channelId,
                  text: reply,
                  thread_ts: threadTs,
                  mrkdwn: true,
                }),
                signal: AbortSignal.timeout(10000),
              });
            }
          } catch (err) {
            console.error("[slack-monitor] Error responding to mention:", err);
          }
        })();
      }
    }

    // Handle message events in monitored channels
    if (event.type === "message" && !event.subtype) {
      console.log(
        `[slack-monitor] Message in ${event.channel}: ${(event.text || "").slice(0, 100)}`,
      );
    }
  }

  return NextResponse.json({ ok: true });
}
