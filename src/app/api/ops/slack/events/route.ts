import crypto from "node:crypto";
import { after, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import {
  getSlackDisplayName,
  getThreadHistory,
  postSlackMessage,
  processAbraMessage,
} from "@/lib/ops/abra-slack-responder";
import { notify } from "@/lib/ops/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SlackEventBody = {
  type?: string;
  challenge?: string;
  event_id?: string;
  event?: {
    type?: string;
    text?: string;
    user?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
    subtype?: string;
  };
};

function verifySlackSignature(req: Request, body: string): boolean {
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!timestamp || !signature || !signingSecret) return false;
  const timestampNum = Number(timestamp);
  if (!Number.isFinite(timestampNum)) return false;
  if (Math.abs(Date.now() / 1000 - timestampNum) > 300) return false;

  const sigBaseString = `v0:${timestamp}:${body}`;
  const hmac = crypto
    .createHmac("sha256", signingSecret)
    .update(sigBaseString)
    .digest("hex");
  const expected = `v0=${hmac}`;

  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

async function isDuplicateEvent(eventId: string): Promise<boolean> {
  if (!eventId) return false;
  const key = `abra:slack:event:${eventId}`;
  try {
    const existing = await kv.get(key);
    if (existing) return true;
    await kv.set(key, "1", { ex: 300 });
  } catch {
    // KV unavailable — fail open
  }
  return false;
}

export async function POST(req: Request) {
  if (!process.env.SLACK_SIGNING_SECRET) {
    return NextResponse.json(
      { error: "Slack events not configured (missing SLACK_SIGNING_SECRET)" },
      { status: 501 },
    );
  }

  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!verifySlackSignature(req, rawBody)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: SlackEventBody = {};
  try {
    body = rawBody ? (JSON.parse(rawBody) as SlackEventBody) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge || "" });
  }

  const event = body.event;
  const supportedEvent =
    body.type === "event_callback" &&
    event &&
    (event.type === "message" || event.type === "app_mention");
  if (!supportedEvent) {
    return NextResponse.json({ ok: true });
  }

  const { text, user, channel, ts, thread_ts, bot_id, subtype } = event;
  if (bot_id || subtype === "bot_message") {
    return NextResponse.json({ ok: true });
  }
  if (!text || !user || !channel || !ts) {
    return NextResponse.json({ ok: true });
  }

  if (await isDuplicateEvent(body.event_id || "")) {
    return NextResponse.json({ ok: true });
  }

  after(async () => {
    try {
      const [displayName, history] = await Promise.all([
        getSlackDisplayName(user),
        thread_ts ? getThreadHistory(channel, thread_ts) : Promise.resolve([]),
      ]);
      const result = await processAbraMessage({
        text,
        user,
        displayName,
        channel,
        ts,
        ...(thread_ts ? { threadTs: thread_ts } : {}),
        ...(history.length > 0 ? { history } : {}),
        forceRespond: event.type === "app_mention",
      });
      if (!result.handled) return;
      const rootThreadTs = thread_ts || ts;
      await postSlackMessage(channel, result.reply, {
        threadTs: rootThreadTs,
        sources: result.sources,
        answerLogId: result.answerLogId,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Slack events processing error";
      console.error("[ops/slack/events] async processing failed:", message);
      void notify({
        channel: "alerts",
        text: `🚨 Slack events async processing failed: ${message}`,
      });
    }
  });

  return NextResponse.json({ ok: true });
}
