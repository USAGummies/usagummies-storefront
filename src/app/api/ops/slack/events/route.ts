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
import {
  clearDispatched,
  findArtifactBySlackTs,
  markDispatched,
} from "@/lib/ops/shipping-artifacts";
import { recordDispatchAudit } from "@/lib/ops/shipping-dispatch-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAMPLE_TRIGGER_REGEX = /\bsample\s*(request|dispatch)\b/i;
const DISPATCH_TRIGGER_REGEX = /^\/?dispatch\s+(shopify|amazon|hubspot|manual)\b/i;

/**
 * Reactions that count as "this package physically left the warehouse."
 * Single canonical reaction (`:white_check_mark:`) — we deliberately
 * don't accept synonyms so the dispatched-vs-not state stays
 * unambiguous on the message.
 */
const DISPATCH_REACTION = "white_check_mark";

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

interface SlackReactionEvent {
  type: "reaction_added" | "reaction_removed";
  user?: string;
  reaction?: string;
  item?: {
    type?: string;
    channel?: string;
    ts?: string;
  };
  item_user?: string;
  event_ts?: string;
}

interface SlackEventCallback {
  type: "event_callback";
  event?: SlackMessageEvent | SlackReactionEvent;
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

// Pure helpers extracted to src/lib/ops/slack-events-helpers.ts —
// Next.js App Router forbids non-handler exports from route files.

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
    if (event?.type === "message") {
      const msg = event as SlackMessageEvent;
      // Skip our own bot replies + edits + threaded replies so we
      // don't infinite-loop on our own responses.
      if (msg.subtype || msg.bot_id || msg.thread_ts) {
        return NextResponse.json({ ok: true, skipped: "non-new-message" });
      }

      const text = msg.text ?? "";
      const inOperationsChannel = isChannel(msg.channel, "operations");
      const inSalesChannel = isChannel(msg.channel, "sales");

      if (inOperationsChannel && SAMPLE_TRIGGER_REGEX.test(text)) {
        return handleSampleTrigger(msg);
      }
      if (
        (inOperationsChannel || inSalesChannel) &&
        DISPATCH_TRIGGER_REGEX.test(text)
      ) {
        return handleDispatchTrigger(msg, text);
      }
    }
    if (
      event?.type === "reaction_added" ||
      event?.type === "reaction_removed"
    ) {
      return handleReaction(event as SlackReactionEvent);
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

/**
 * `:white_check_mark:` reaction handler — the "I dropped this off"
 * button. Resolves the (channel, ts) tuple back to the shipping
 * artifact record we persisted at label-buy time, then stamps
 * dispatchedAt / dispatchedBy on it.
 *
 * Hard rules:
 *   - Only `:white_check_mark:` counts. Other emoji are ignored
 *     (no fuzzy matching — keep the dispatch state unambiguous).
 *   - Only reactions in `#shipping` count. The same emoji elsewhere
 *     is just a normal Slack reaction.
 *   - Only reactions on bot-posted label messages count. The artifact
 *     lookup is by `slackPermalink`, which we only set on label
 *     uploads — so reactions on random messages return null and exit.
 *   - First-time mark posts a thread reply; re-marks (duplicate
 *     reaction events) are idempotent and don't re-post.
 *   - `reaction_removed` clears `dispatchedAt` so an accidental
 *     reaction can be undone by un-reacting.
 */
async function handleReaction(
  event: SlackReactionEvent,
): Promise<Response> {
  if (event.reaction !== DISPATCH_REACTION) {
    return NextResponse.json({ ok: true, skipped: "non-dispatch-reaction" });
  }
  const channelId = event.item?.channel;
  const messageTs = event.item?.ts;
  if (!channelId || !messageTs) {
    return NextResponse.json({ ok: true, skipped: "incomplete-reaction" });
  }
  const shipping = getChannel("shipping");
  if (!shipping || shipping.slackChannelId !== channelId) {
    return NextResponse.json({ ok: true, skipped: "non-shipping-channel" });
  }
  const record = await findArtifactBySlackTs({ channelId, messageTs });
  if (!record) {
    return NextResponse.json({ ok: true, skipped: "no-matching-artifact" });
  }

  if (event.type === "reaction_removed") {
    const cleared = await clearDispatched({
      source: record.source,
      orderNumber: record.orderNumber,
    });
    // Audit: only emit when the stamp was actually present — clearing
    // an already-clear record is a no-op and shouldn't pollute the trail.
    if (cleared.ok && cleared.before) {
      await recordDispatchAudit({
        action: "shipping.dispatch.clear",
        surface: "slack-reaction",
        source: record.source,
        orderNumber: record.orderNumber,
        actorRef: event.user ?? null,
        before: cleared.before,
        after: null,
      });
    }
    return NextResponse.json({
      ok: true,
      handled: "reaction_removed",
      orderNumber: record.orderNumber,
      hadStamp: Boolean(cleared.before),
    });
  }

  // reaction_added
  const result = await markDispatched({
    source: record.source,
    orderNumber: record.orderNumber,
    dispatchedBy: event.user ?? null,
  });

  // Only post the dispatched-confirmation thread reply on first-time
  // marks. Slack delivers reaction_added even when a different user
  // adds the same emoji — we want one (and only one) reply per shipment.
  let postedThreadReply = false;
  if (result.ok && !result.before) {
    try {
      await postMessage({
        channel: shipping.name,
        text:
          `:package: *Dispatched* — physically left WA Warehouse ` +
          (event.user ? `by <@${event.user}>` : "") +
          ` at ${formatStamp(result.after)}.`,
        threadTs: messageTs,
      });
      postedThreadReply = true;
    } catch {
      /* best-effort */
    }
  }
  if (result.ok) {
    await recordDispatchAudit({
      action: "shipping.dispatch.mark",
      surface: "slack-reaction",
      source: record.source,
      orderNumber: record.orderNumber,
      actorRef: event.user ?? null,
      before: result.before,
      after: result.after,
      postedThreadReply,
    });
  }
  return NextResponse.json({
    ok: true,
    handled: "reaction_added",
    orderNumber: record.orderNumber,
    firstMark: !result.before,
  });
}

function formatStamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    // Pacific time, since Ben/Drew/warehouse all live there for ops purposes.
    return d.toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}
