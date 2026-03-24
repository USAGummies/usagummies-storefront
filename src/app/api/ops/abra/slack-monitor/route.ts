/**
 * Download a Slack file (requires bot token auth) and return as base64.
 */
async function downloadSlackImage(
  url: string,
  botToken: string,
): Promise<{ base64: string; mediaType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const contentType = res.headers.get("content-type") || "image/png";
    return { base64, mediaType: contentType };
  } catch {
    return null;
  }
}

/**
 * POST /api/ops/abra/slack-monitor — Slack Events API webhook
 *
 * Monitors Slack channels for:
 * - Direct @abra mentions
 * - Messages in #abra-control that need attention
 * - Questions that Abra can answer proactively
 */
import { NextResponse } from "next/server";
import { after } from "next/server";
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

/**
 * Split a multi-part message into separate questions.
 * Detects numbered patterns: "One,", "1.", "Two,", "2.", "Three,", "3.", etc.
 * Also detects "And then", "my last question", "finally" as separators.
 * Returns array of parts — if only 1 part, the message is not multi-part.
 */
function splitMultiPartMessage(text: string): string[] {
  // Only split long messages (short ones are likely single questions)
  if (text.length < 200) return [text];

  // Try numbered word patterns first: "One,", "Two,", "Three,", etc.
  const wordPattern = /\b(one|two|three|four|five|six|seven|eight|nine|ten),?\s/gi;
  const digitPattern = /\b(\d+)[.)]\s/g;
  const transitionPattern = /\b(and then my last|my last question|and then,|finally,?\s|i would (?:also )?love to)\b/gi;

  // Collect all split points
  const splitPoints: Array<{ index: number; length: number }> = [];

  for (const pattern of [wordPattern, digitPattern, transitionPattern]) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      // Only use split points that are near the start of a sentence
      // (preceded by newline, period+space, or start of string)
      const before = text.slice(Math.max(0, match.index - 3), match.index);
      if (match.index === 0 || /[.\n!?]\s*$/.test(before) || /,\s*$/.test(before)) {
        splitPoints.push({ index: match.index, length: match[0].length });
      }
    }
  }

  if (splitPoints.length < 2) return [text]; // Not enough splits

  // Sort by position and deduplicate nearby splits
  splitPoints.sort((a, b) => a.index - b.index);
  const dedupedPoints: typeof splitPoints = [splitPoints[0]];
  for (let i = 1; i < splitPoints.length; i++) {
    if (splitPoints[i].index - dedupedPoints[dedupedPoints.length - 1].index > 50) {
      dedupedPoints.push(splitPoints[i]);
    }
  }

  if (dedupedPoints.length < 2) return [text];

  // Extract parts — include preamble if the first split point isn't at the start
  const parts: string[] = [];
  if (dedupedPoints[0].index > 30) {
    // There's meaningful preamble before the first numbered section
    const preamble = text.slice(0, dedupedPoints[0].index).trim();
    if (preamble.length > 20) {
      // Prepend preamble to first part for context
      const firstEnd = dedupedPoints.length > 1 ? dedupedPoints[1].index : text.length;
      parts.push(preamble + " " + text.slice(dedupedPoints[0].index, firstEnd).trim());
      // Start from second split point
      for (let i = 1; i < dedupedPoints.length; i++) {
        const start = dedupedPoints[i].index;
        const end = i + 1 < dedupedPoints.length ? dedupedPoints[i + 1].index : text.length;
        const part = text.slice(start, end).trim();
        if (part.length > 20) parts.push(part);
      }
      return parts.length >= 2 ? parts : [text];
    }
  }
  for (let i = 0; i < dedupedPoints.length; i++) {
    const start = dedupedPoints[i].index;
    const end = i + 1 < dedupedPoints.length ? dedupedPoints[i + 1].index : text.length;
    const part = text.slice(start, end).trim();
    if (part.length > 20) parts.push(part); // Skip tiny fragments
  }

  // If we couldn't get meaningful parts, return original
  return parts.length >= 2 ? parts : [text];
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Hobby plan max

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

// ── Event deduplication: prevent duplicate processing on Slack retries ──
const processedEvents = new Set<string>();
const DEDUP_MAX_SIZE = 500;

function isDuplicate(eventId: string): boolean {
  if (!eventId) return false;
  if (processedEvents.has(eventId)) return true;
  processedEvents.add(eventId);
  // Prevent memory leak — trim oldest entries when set gets too large
  if (processedEvents.size > DEDUP_MAX_SIZE) {
    const first = processedEvents.values().next().value;
    if (first) processedEvents.delete(first);
  }
  return false;
}

export async function POST(req: Request) {
  // Reject Slack retries immediately
  const retryNum = req.headers.get("x-slack-retry-num");
  if (retryNum) {
    console.log(`[slack-monitor] Skipping Slack retry #${retryNum}`);
    return NextResponse.json({ ok: true });
  }

  const rawBody = await req.text();
  const body = JSON.parse(rawBody);

  // Deduplicate by event_id
  const eventId = body?.event_id || body?.event?.event_ts || "";
  if (isDuplicate(eventId)) {
    console.log(`[slack-monitor] Duplicate event ${eventId}, skipping`);
    return NextResponse.json({ ok: true });
  }

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

      // ── Extract image attachments from Slack files ──
      const imageFiles: Array<{ url: string; mimetype: string; name: string }> = [];
      if (Array.isArray(event.files)) {
        for (const file of event.files) {
          const mime = file.mimetype || "";
          if (mime.startsWith("image/") && file.url_private) {
            imageFiles.push({
              url: file.url_private,
              mimetype: mime,
              name: file.name || "image",
            });
          }
        }
      }

      if (!text && imageFiles.length === 0) {
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
        // Use after() to process in background — Vercel keeps the function alive
        after(async () => {
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

            // ── Multi-part message splitting ──
            // If the message has numbered sections (One/1./Two/2./etc),
            // split into separate requests and reply to each in the thread
            const parts = splitMultiPartMessage(text);
            const actorCtx = getActorContext(event.user || "");

            if (parts.length > 1) {
              console.log(`[slack-monitor] Multi-part message detected: ${parts.length} parts`);

              // Post an ack first
              await fetch("https://slack.com/api/chat.postMessage", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${botToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  channel: channelId,
                  text: `:brain: *Abra*\n\nGot it — ${parts.length} questions. Answering each one:`,
                  thread_ts: threadTs,
                  mrkdwn: true,
                }),
                signal: AbortSignal.timeout(5000),
              });

              // Process ALL parts in parallel — each gets its own 55s budget
              // Results are collected, then posted in order
              const processPart = async (partText: string, idx: number): Promise<{ idx: number; reply: string }> => {
                const isCapabilityQuestion = /\b(can you|how do(?:es)? (?:that|this|it) work|is (?:that|it) possible|can we have|how does (?:collaboration|that work)|while i'?m driving|voice|hands.?free|conversational(?:ly)?|shared (?:worksheet|spreadsheet|document))\b/i.test(partText);
                const isActionHeavy = /\b(create a|build a|come up with|make a|draft a|list of to.?dos|dashboard|tracker|tracking)\b/i.test(partText);

                const useQuickMode = isCapabilityQuestion;
                const endpoint = useQuickMode ? `${host}/api/ops/abra/chat?mode=quick` : `${host}/api/ops/abra/chat`;
                const timeout = useQuickMode ? 20000 : 55000;
                let message = partText;
                if (useQuickMode) {
                  message = `Answer this question about Abra's capabilities concisely (under 500 chars). Be honest about what you can and can't do: ${partText}`;
                } else if (isActionHeavy) {
                  // For action-heavy requests, prepend a hint to respond with the action/list
                  // rather than doing extensive data lookups first
                  message = `[PRIORITY: Respond with actionable content immediately. Use what you know from brain entries — don't wait for all data sources.] ${partText}`;
                }

                const res = await fetch(endpoint, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${cronSecret}`,
                  },
                  body: JSON.stringify({
                    message,
                    history: isCapabilityQuestion ? [] : threadHistory,
                    channel: "slack",
                    slack_channel_id: channelId,
                    slack_thread_ts: threadTs,
                    actor_label: isCapabilityQuestion ? undefined : event.user,
                    actor_context: isCapabilityQuestion ? undefined : actorCtx,
                  }),
                  signal: AbortSignal.timeout(timeout),
                });

                if (!res.ok) return { idx, reply: "" };
                const data = (await res.json()) as { reply?: string };
                return { idx, reply: typeof data.reply === "string" ? data.reply.trim() : "" };
              };

              // Fire parts with slight stagger to avoid Vercel concurrency limits
              // Capability (quick) parts go first (fast), then data parts with 2s gaps
              const partEntries = parts.map((p, i) => ({ text: p, idx: i }));
              const quickParts = partEntries.filter((_, i) => {
                return /\b(can you|how do(?:es)? (?:that|this|it) work|is (?:that|it) possible|can we have|how does (?:collaboration|that work)|while i'?m driving|voice|hands.?free|conversational(?:ly)?|shared (?:worksheet|spreadsheet|document))\b/i.test(parts[i]);
              });
              const fullParts = partEntries.filter(e => !quickParts.includes(e));

              // Quick parts fire immediately (they finish in <5s)
              const quickPromises = quickParts.map(e => processPart(e.text, e.idx));

              // Full parts fire with 3s stagger to avoid concurrency contention
              const fullPromises = fullParts.map((e, staggerIdx) =>
                new Promise<{ idx: number; reply: string }>(resolve => {
                  setTimeout(async () => {
                    try {
                      resolve(await processPart(e.text, e.idx));
                    } catch (err) {
                      resolve({ idx: e.idx, reply: `⚠️ Timed out — try asking this separately.` });
                    }
                  }, staggerIdx * 3000); // 0s, 3s, 6s stagger
                })
              );

              const results = await Promise.allSettled([...quickPromises, ...fullPromises]);

              // Post results in order
              for (let i = 0; i < results.length; i++) {
                const result = results[i];
                let partReply: string;
                if (result.status === "fulfilled" && result.value.reply) {
                  partReply = result.value.reply;
                } else {
                  const errMsg = result.status === "rejected" && result.reason instanceof Error
                    ? result.reason.message : "timed out";
                  partReply = `⚠️ This part ${errMsg.includes("timeout") || errMsg.includes("Timeout") ? "timed out" : "failed"} — try asking it separately.`;
                  console.error(`[slack-monitor] Part ${i + 1} failed:`, errMsg);
                }
                await fetch("https://slack.com/api/chat.postMessage", {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${botToken}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    channel: channelId,
                    text: `*Part ${i + 1}/${parts.length}:*\n\n${partReply}`.slice(0, 4000),
                    thread_ts: threadTs,
                    mrkdwn: true,
                  }),
                  signal: AbortSignal.timeout(10000),
                });
              }
            } else {
              // Download any attached images for vision
              let imageData: Array<{ base64: string; mediaType: string }> | undefined;
              if (imageFiles.length > 0 && botToken) {
                const downloaded = await Promise.all(
                  imageFiles.slice(0, 3).map((f) => downloadSlackImage(f.url, botToken)),
                );
                const valid = downloaded.filter(Boolean) as Array<{ base64: string; mediaType: string }>;
                if (valid.length > 0) imageData = valid;
              }

              // Single question — normal flow
              const chatRes = await fetch(`${host}/api/ops/abra/chat`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${cronSecret}`,
                },
                body: JSON.stringify({
                  message: text || "Describe what you see in this image.",
                  history: threadHistory,
                  channel: "slack",
                  slack_channel_id: channelId,
                  slack_thread_ts: threadTs,
                  actor_label: event.user || undefined,
                  actor_context: actorCtx,
                  ...(imageData ? { images: imageData } : {}),
                }),
                signal: AbortSignal.timeout(55000),
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
            }
          } catch (err) {
            console.error("[slack-monitor] Error responding to mention:", err);
          }
        });
      }
    }

    // Handle message events in monitored channels
    if (event.type === "message" && !event.subtype) {
      console.log(
        `[slack-monitor] Message in ${event.channel}: ${(event.text || "").slice(0, 100)}`,
      );

      // Auto-respond channels — Abra responds to ALL messages even without @mention
      const AUTO_RESPOND_CHANNELS = new Set([
        "C0AKG9FSC2J", // #financials — Rene's workspace with Abra
      ]);

      if (AUTO_RESPOND_CHANNELS.has(event.channel) && event.user !== "U0AKMSTL0GL") {
        const text = event.text?.replace(/<@[A-Z0-9]+>/g, "").trim() || "";
        if (text.length > 5) {
          const channelId = event.channel;
          const threadTs = event.thread_ts || event.ts;
          const cronSecret = process.env.CRON_SECRET?.trim();
          const botToken = process.env.SLACK_BOT_TOKEN;
          const host =
            process.env.NEXTAUTH_URL ||
            (process.env.VERCEL_URL
              ? `https://${process.env.VERCEL_URL}`
              : "http://localhost:4000");

          if (cronSecret && botToken) {
            const actorCtx = getActorContext(event.user || "");

            // Fetch thread history for context
            let threadHistory: Array<{ role: string; content: string }> = [];
            if (event.thread_ts) {
              try {
                const threadRes = await fetch(
                  `https://slack.com/api/conversations.replies?channel=${channelId}&ts=${event.thread_ts}&limit=15`,
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
                  const abraBotId = "U0AKMSTL0GL";
                  for (const msg of threadData.messages) {
                    if (msg.ts === event.ts) continue;
                    const isAbra = msg.user === abraBotId || !!msg.bot_id;
                    threadHistory.push({
                      role: isAbra ? "assistant" : "user",
                      content: (msg.text || "").slice(0, 1000),
                    });
                  }
                }
              } catch { /* non-fatal */ }
            }

            after(async () => {
              try {
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
                    slack_channel_id: channelId,
                    slack_thread_ts: threadTs,
                    actor_label: event.user || undefined,
                    actor_context: actorCtx,
                  }),
                  signal: AbortSignal.timeout(55000),
                });

                if (chatRes.ok) {
                  const chatData = (await chatRes.json()) as { reply?: string };
                  const reply = typeof chatData.reply === "string" ? chatData.reply.trim() : "";
                  if (reply) {
                    await fetch("https://slack.com/api/chat.postMessage", {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${botToken}`,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        channel: channelId,
                        text: reply.slice(0, 4000),
                        thread_ts: threadTs,
                        mrkdwn: true,
                      }),
                      signal: AbortSignal.timeout(10000),
                    });
                  }
                }
              } catch (err) {
                console.error("[slack-monitor] Auto-respond error:", err instanceof Error ? err.message : err);
              }
            });
          }
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
