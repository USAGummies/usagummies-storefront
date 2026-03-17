/**
 * POST /api/ops/abra/slack-monitor — Slack Events API webhook
 *
 * Monitors Slack channels for:
 * - Direct @abra mentions
 * - Messages in #abra-control that need attention
 * - Questions that Abra can answer proactively
 */
import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verify Slack request signature (v0) to prevent spoofed webhooks */
async function verifySlackSignature(req: Request, rawBody: string): Promise<boolean> {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) return false;
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  if (!timestamp || !signature) return false;
  // Reject requests older than 5 minutes (replay protection)
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const basestring = `v0:${timestamp}:${rawBody}`;
  const computed = "v0=" + createHmac("sha256", signingSecret).update(basestring).digest("hex");
  // Constant-time comparison
  if (computed.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const body = JSON.parse(rawBody);

  // Handle Slack URL verification challenge (skip sig check — Slack sends this during setup)
  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

  // Verify Slack signature for all other requests
  if (!await verifySlackSignature(req, rawBody)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Handle events
  if (body.type === "event_callback") {
    const event = body.event;

    // Ignore bot messages (prevent loops)
    if (event.bot_id || event.subtype === "bot_message") {
      return NextResponse.json({ ok: true });
    }

    // Handle app_mention events — route through the full Abra pipeline
    // instead of a raw LLM call (ensures memory, provenance, action gating,
    // freshness, and cost tracking are all applied).
    if (event.type === "app_mention") {
      const text =
        event.text?.replace(/<@[A-Z0-9]+>/g, "").trim() || "";
      const channelId = event.channel;
      const threadTs = event.thread_ts || event.ts;

      if (!text) {
        return NextResponse.json({ ok: true });
      }

      const botToken = process.env.SLACK_BOT_TOKEN;
      const cronSecret = (process.env.CRON_SECRET || "").trim();

      if (botToken && cronSecret) {
        // Fire and forget — call the full Abra chat API and reply in thread
        (async () => {
          try {
            const host =
              process.env.NEXTAUTH_URL ||
              (process.env.VERCEL_URL
                ? `https://${process.env.VERCEL_URL}`
                : "http://localhost:4000");

            const chatRes = await fetch(`${host}/api/ops/abra/chat`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${cronSecret}`,
              },
              body: JSON.stringify({
                message: text,
                history: [],
                channel: "slack",
              }),
              signal: AbortSignal.timeout(45000),
            });

            if (!chatRes.ok) {
              console.error(`[slack-monitor] Chat API returned ${chatRes.status}`);
              return;
            }

            const data = (await chatRes.json()) as { reply?: string };
            const reply = typeof data.reply === "string" ? data.reply.trim() : "";

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
