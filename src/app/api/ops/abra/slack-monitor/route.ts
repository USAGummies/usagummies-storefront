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

// ── Actor Profiles — calibrate Abra's tone per user ──
const ACTOR_PROFILES: Record<string, string> = {
  // Rene Gonzalez — bookkeeper/investor rep
  U0ALL27JM38: `ACTOR: Rene Gonzalez (bookkeeper, investor representative)
COMMUNICATION STYLE FOR RENE:
- Be CONCISE. Max 200 chars for simple answers. No essays.
- NEVER ask more than 1 clarifying question per message.
- If his intent is 80% clear, ACT on it. Don't ask for confirmation.
- Default to ACTION over explanation. "Done" beats "Here's what I would do..."
- Use simple language. No jargon, no acronyms he hasn't used first.
- If he mentions a Notion page, he means the one he's been working on (TEST COA template).
- Format for mobile: shorter lines, bullet points over tables.
- He is building the books from scratch. Be collaborative, not interrogative.
- CRITICAL: Rene's experience = investor's perception of Abra. Every interaction matters.`,

  // Ben Stutman — founder/CEO
  U08JY86Q508: `ACTOR: Ben Stutman (founder, CEO)
COMMUNICATION STYLE FOR BEN:
- Data-heavy responses welcome. Include source citations.
- Tables and detailed breakdowns are fine.
- Can handle technical jargon and financial terminology.
- Proactively flag anomalies and risks.
- Be direct but thorough. Ben wants the full picture.
- When he corrects data, log it immediately and confirm the correction.`,
};

function getActorContext(userId: string): string {
  return ACTOR_PROFILES[userId] || `Slack user ${userId}`;
}

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

      // Skip side conversations — messages directed at another human, not Abra
      // e.g., "ben asking about X?" or "Rene, did you see this?"
      const isSideConversation =
        // Starts with someone's name + question/statement (not "@Abra")
        /^(ben|rene|greg|patrick|andrew)\b[,\s]/i.test(text) ||
        // Short question clearly to another person
        (/^(hey |yo |dude |bro )/i.test(text) && text.length < 60 && !/abra/i.test(text)) ||
        // "asking about X?" pattern — relaying, not commanding
        /\basking about\b/i.test(text) ||
        // "did you see/hear/get" — human-to-human
        /\bdid (you|he|she|they) (see|hear|get|send|check)\b/i.test(text);

      if (isSideConversation) {
        console.log(`[slack-monitor] Skipping side conversation: "${text.slice(0, 60)}"`);
        return NextResponse.json({ ok: true });
      }

      const botToken = process.env.SLACK_BOT_TOKEN;
      const cronSecret = (process.env.CRON_SECRET || "").trim();
      const abraBotId = "U0AKMSTL0GL"; // Abra's Slack user ID

      if (botToken && cronSecret) {
        // Fire and forget — call the full Abra chat API and reply in thread
        (async () => {
          try {
            // ── Fetch thread history for context ──
            const threadHistory: Array<{ role: string; content: string }> = [];
            if (threadTs && threadTs !== event.ts) {
              // This is a threaded reply — fetch the thread
              try {
                const threadRes = await fetch(
                  `https://slack.com/api/conversations.replies?channel=${channelId}&ts=${threadTs}&limit=15`,
                  {
                    headers: { Authorization: `Bearer ${botToken}` },
                    signal: AbortSignal.timeout(5000),
                  },
                );
                const threadData = (await threadRes.json()) as {
                  ok: boolean;
                  messages?: Array<{ user?: string; bot_id?: string; text?: string; ts?: string }>;
                };
                if (threadData.ok && threadData.messages) {
                  // Convert to chat history format, excluding the current message
                  for (const msg of threadData.messages) {
                    if (msg.ts === event.ts) continue; // skip current message
                    const msgText = (msg.text || "").replace(/<@[A-Z0-9]+>/g, "").trim();
                    if (!msgText) continue;
                    const isAbra = msg.user === abraBotId || !!msg.bot_id;
                    threadHistory.push({
                      role: isAbra ? "assistant" : "user",
                      content: msgText,
                    });
                  }
                }
                console.log(`[slack-monitor] Thread context: ${threadHistory.length} messages from thread ${threadTs}`);
              } catch (threadErr) {
                console.warn("[slack-monitor] Failed to fetch thread history:", threadErr instanceof Error ? threadErr.message : threadErr);
              }
            }

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
                history: threadHistory,
                channel: "slack",
                actor_label: event.user || undefined,
                actor_context: getActorContext(event.user || ""),
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
