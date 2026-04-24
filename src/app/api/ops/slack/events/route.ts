/**
 * POST /api/ops/slack/events
 *
 * Slack Events API receiver. Handles two use cases:
 *   1. `url_verification` — one-time challenge when Ben configures
 *      the Events API subscription in Slack App Admin.
 *   2. `event_callback` — message events in watched channels. Sample-
 *      dispatch trigger per /contracts/agents/sample-order-dispatch.md:
 *      messages in #operations matching /sample\s*(request|dispatch)/i
 *      get a threaded reply with a copy-paste dispatch template.
 *
 * Auth: Slack `X-Slack-Signature` v0 HMAC verified when
 * `SLACK_SIGNING_SECRET` is set. Missing secret → accept but
 * don't take destructive action (we only post informational replies).
 *
 * Sample-request handling is intentionally conservative: we DON'T try
 * to parse a free-form ship-to from chat. Instead we reply with a
 * pre-formatted JSON template Ben can fill + paste back, or a
 * deeplink to /ops/amazon-fbm for the FBM path.
 */
import { NextResponse } from "next/server";

import { getChannel } from "@/lib/ops/control-plane/channels";
import { postMessage, verifySlackSignature } from "@/lib/ops/control-plane/slack";
import type { ChannelId } from "@/lib/ops/control-plane/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAMPLE_TRIGGER_REGEX = /\bsample\s*(request|dispatch)\b/i;
const DISPATCH_TRIGGER_REGEX = /^\/?dispatch\s+(shopify|amazon|hubspot|manual)\b/i;

interface SlackMessageEvent {
  type: string;
  text?: string;
  channel?: string;
  user?: string;
  ts?: string;
  thread_ts?: string;
  subtype?: string;
  bot_id?: string;
}

interface SlackEventCallback {
  type: "event_callback";
  event?: SlackMessageEvent;
  team_id?: string;
  api_app_id?: string;
  event_id?: string;
  event_time?: number;
}

interface SlackUrlVerification {
  type: "url_verification";
  challenge: string;
}

type SlackPayload =
  | SlackEventCallback
  | SlackUrlVerification
  | { type: string; [k: string]: unknown };

export async function buildReadOnlyChatRouteRequest(input: {
  message: string;
  history: Array<{ role: string; content: string }>;
  actorLabel: string;
  channel: string;
  slackChannelId?: string;
  slackThreadTs?: string;
  uploadedFiles?: Array<{ name: string; mimeType: string; buffer: Buffer }>;
}): Promise<{ body: BodyInit; headers: Record<string, string> }> {
  const files = input.uploadedFiles ?? [];
  if (files.length > 0) {
    const form = new FormData();
    form.set("message", input.message);
    form.set("actorLabel", input.actorLabel);
    form.set("channel", input.channel);
    if (input.slackChannelId) form.set("slackChannelId", input.slackChannelId);
    if (input.slackThreadTs) form.set("slackThreadTs", input.slackThreadTs);
    form.set("history", JSON.stringify(input.history));
    for (const file of files) {
      form.append(
        "file",
        new Blob([file.buffer], { type: file.mimeType }),
        file.name,
      );
    }
    return { body: form, headers: {} };
  }

  return {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
  };
}

export function isRedundantMentionMirrorEvent(event: {
  type?: string;
  text?: string;
}): boolean {
  return event.type === "message" && /<@[^>]+>/.test(event.text ?? "");
}

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();

  // Slack signature verification (when configured).
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  const sigCheck = await verifySlackSignature({ rawBody, timestamp, signature });
  // When SLACK_SIGNING_SECRET isn't set, verify returns ok:false with
  // reason "not configured" — we accept but don't act destructively.
  const signatureConfigured =
    sigCheck.ok || sigCheck.reason !== "SLACK_SIGNING_SECRET not configured";
  if (signatureConfigured && !sigCheck.ok) {
    return NextResponse.json(
      { ok: false, error: `Slack signature: ${sigCheck.reason}` },
      { status: 401 },
    );
  }

  let body: SlackPayload;
  try {
    body = JSON.parse(rawBody) as SlackPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  // URL verification handshake — return the challenge token verbatim.
  if (body.type === "url_verification") {
    return NextResponse.json({
      challenge: (body as SlackUrlVerification).challenge ?? "",
    });
  }

  if (body.type === "event_callback") {
    const event = (body as SlackEventCallback).event;
    if (event && event.type === "message") {
      // Skip our own bot replies + edits + threaded replies so we
      // don't infinite-loop on our own responses.
      if (event.subtype || event.bot_id || event.thread_ts) {
        return NextResponse.json({ ok: true, skipped: "non-new-message" });
      }

      const text = event.text ?? "";
      const inOperationsChannel = isChannel(event.channel, "operations");
      const inSalesChannel = isChannel(event.channel, "sales");

      if (inOperationsChannel && SAMPLE_TRIGGER_REGEX.test(text)) {
        return handleSampleTrigger(event);
      }
      if (
        (inOperationsChannel || inSalesChannel) &&
        DISPATCH_TRIGGER_REGEX.test(text)
      ) {
        return handleDispatchTrigger(event, text);
      }
    }
  }

  // Every other event type is acknowledged silently.
  return NextResponse.json({ ok: true });
}

function isChannel(channelId: string | undefined, name: ChannelId): boolean {
  if (!channelId) return false;
  const ch = getChannel(name);
  return ch?.id === channelId;
}

async function handleSampleTrigger(
  event: SlackMessageEvent,
): Promise<Response> {
  const channel = getChannel("operations");
  if (!channel || !event.ts) {
    return NextResponse.json({ ok: true, handled: "sample", skipped: "no channel" });
  }
  const reply =
    ":bust_in_silhouette: *Sample-request trigger detected.* Here's how to dispatch:\n\n" +
    "*Amazon FBM orders:* open `/ops/amazon-fbm` → copy ship-to from Seller Central → click Dispatch.\n\n" +
    "*Shopify DTC:* paid orders auto-dispatch via webhook (no action needed).\n\n" +
    "*HubSpot wholesale:* `dealstage → PO Received` on the deal auto-dispatches.\n\n" +
    "*Ad-hoc / booth / email orders:* `POST /api/ops/agents/sample-dispatch/dispatch` with:\n" +
    "```\n" +
    JSON.stringify(
      {
        channel: "manual",
        sourceId: "booth-2026-04-21-001",
        orderNumber: "Becca Jones sample",
        tags: ["sample"],
        shipTo: {
          name: "Becca Jones",
          street1: "123 Main St",
          city: "Boise",
          state: "ID",
          postalCode: "83702",
        },
        packagingType: "case",
        cartons: 1,
      },
      null,
      2,
    ) +
    "\n```\n_Class B proposal appears in `#ops-approvals` — approve there to buy the label._";
  try {
    await postMessage({
      channel: channel.name,
      text: reply,
      threadTs: event.ts,
    });
  } catch {
    /* best-effort */
  }
  return NextResponse.json({ ok: true, handled: "sample" });
}

async function handleDispatchTrigger(
  event: SlackMessageEvent,
  text: string,
): Promise<Response> {
  const channelForPost =
    (event.channel && getChannel("operations")?.id === event.channel
      ? getChannel("operations")
      : getChannel("sales")) ?? null;
  if (!channelForPost || !event.ts) {
    return NextResponse.json({ ok: true, handled: "dispatch", skipped: "no channel" });
  }
  const match = DISPATCH_TRIGGER_REGEX.exec(text);
  const channelName = match?.[1]?.toLowerCase() ?? "manual";
  const reply =
    `:package: *Dispatch shortcut* — \`${channelName}\` channel recognized.\n` +
    (channelName === "amazon"
      ? "Open <https://www.usagummies.com/ops/amazon-fbm|/ops/amazon-fbm> for the Amazon FBM queue."
      : channelName === "shopify"
        ? "Shopify orders auto-dispatch via the `orders/paid` webhook. No action needed."
        : channelName === "hubspot"
          ? "HubSpot deals auto-dispatch on `dealstage → PO Received | Closed Won`. Open the deal in HubSpot."
          : "POST to `/api/ops/agents/sample-dispatch/dispatch` with the OrderIntent payload. See `#ops-daily` pinned doc.");
  try {
    await postMessage({
      channel: channelForPost.name,
      text: reply,
      threadTs: event.ts,
    });
  } catch {
    /* best-effort */
  }
  return NextResponse.json({ ok: true, handled: "dispatch", channel: channelName });
}
