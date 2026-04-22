/**
 * POST /api/ops/webhooks/shopify/orders-paid
 *
 * Shopify `orders/paid` webhook adapter for the Sample/Order Dispatch
 * specialist (S-08). Flow:
 *   1. Verify HMAC with `SHOPIFY_WEBHOOK_SECRET`
 *   2. Normalize payload → OrderIntent
 *   3. Classify via `classifyDispatch()` + compose proposal
 *   4. Post to `#ops-approvals` (Class B shipment.create) OR
 *      to `#ops-alerts` on refusal
 *
 * Skipped gracefully (HTTP 200) for cancelled / refunded / digital-only
 * orders so Shopify doesn't retry them.
 *
 * Auth: Shopify HMAC (NOT CRON_SECRET — webhook comes from Shopify).
 * Middleware should NOT whitelist this path for session auth.
 */
import { NextResponse } from "next/server";
import crypto from "node:crypto";

import { getChannel } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack";
import { auditDispatch } from "@/lib/ops/dispatch-audit";
import {
  classifyDispatch,
  composeShipmentProposal,
} from "@/lib/ops/sample-order-dispatch";
import {
  normalizeShopifyOrder,
  type ShopifyOrderPayload,
} from "@/lib/ops/shopify-order-to-intent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function verifyShopifyHmac(rawBody: string, header: string | null): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET?.trim();
  if (!secret || !header) return false;
  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(header));
  } catch {
    return false;
  }
}

/**
 * Shopify delivers `X-Shopify-Triggered-At` (ISO-8601) + a retry
 * history. Reject webhooks whose trigger time is more than 5 minutes
 * stale to prevent replay attacks on old captured payloads.
 *
 * Returns true when no triggered-at header is present so existing
 * tests / local curl pokes still work. Shopify always sends the
 * header in production.
 */
function verifyShopifyTriggeredAt(triggeredAtHeader: string | null): boolean {
  if (!triggeredAtHeader) return true; // absence → don't block
  const t = Date.parse(triggeredAtHeader);
  if (!Number.isFinite(t)) return true;
  // Shopify retries for up to 48 hours but deliveries are usually
  // seconds-fresh; 5-min tolerance matches HubSpot + Slack.
  return Math.abs(Date.now() - t) <= 5 * 60 * 1000;
}

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  const triggeredAt = req.headers.get("x-shopify-triggered-at");

  // HMAC is mandatory in production. In dev, allow when SHOPIFY_WEBHOOK_SECRET
  // is unset so local testing is easy (matches the loyalty webhook pattern).
  const secretConfigured = Boolean(process.env.SHOPIFY_WEBHOOK_SECRET?.trim());
  if (secretConfigured && !verifyShopifyHmac(rawBody, hmac)) {
    return NextResponse.json(
      { ok: false, error: "Invalid HMAC signature" },
      { status: 401 },
    );
  }

  // Replay protection via Shopify's triggered-at header.
  if (!verifyShopifyTriggeredAt(triggeredAt)) {
    return NextResponse.json(
      { ok: false, error: "Webhook triggered-at outside 5-min tolerance" },
      { status: 401 },
    );
  }

  let payload: ShopifyOrderPayload;
  try {
    payload = JSON.parse(rawBody) as ShopifyOrderPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const norm = normalizeShopifyOrder(payload);
  if (!norm.ok) {
    if ((norm as { skipped?: boolean }).skipped) {
      // Ack Shopify so it doesn't retry; log reason for post-hoc review.
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: (norm as { reason: string }).reason,
      });
    }
    return NextResponse.json(
      {
        ok: false,
        error: (norm as { error: string }).error,
      },
      { status: 400 },
    );
  }

  const classification = classifyDispatch(norm.intent);
  const proposal = composeShipmentProposal(norm.intent, classification);
  const degraded: string[] = [];

  // Hard refuse path → #ops-alerts, HTTP 422 so operators notice but
  // Shopify still treats the webhook as handled (2xx) after we convert.
  if (classification.refuse) {
    const alerts = getChannel("ops-alerts");
    if (alerts) {
      try {
        await postMessage({
          channel: alerts.name,
          text:
            `:no_entry: *Shopify dispatch refused — ${norm.intent.orderNumber ?? norm.intent.sourceId}*\n` +
            `${classification.refuseReason}\n` +
            `Ship-to: ${norm.intent.shipTo.name} · ${norm.intent.shipTo.city}, ${norm.intent.shipTo.state}`,
        });
      } catch (err) {
        degraded.push(
          `slack-alerts: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      degraded.push("slack-alerts: #ops-alerts channel not registered");
    }
    await auditDispatch({
      agentId: "shopify-webhook-adapter",
      division: "production-supply-chain",
      channel: "shopify",
      sourceId: norm.intent.sourceId,
      orderNumber: norm.intent.orderNumber,
      classification,
      proposal,
      action: "shipment.proposal.refuse",
      refuseReason: classification.refuseReason,
    });
    // 2xx so Shopify doesn't retry the refused order forever.
    return NextResponse.json({
      ok: false,
      refuse: true,
      refuseReason: classification.refuseReason,
      classification,
      degraded,
    });
  }

  // Happy path — post Class B proposal to #ops-approvals.
  let posted = false;
  let postedTo: string | null = null;
  let enqueuedForRetry = false;
  const approvals = getChannel("ops-approvals");
  if (!approvals) {
    degraded.push("slack-approvals: #ops-approvals channel not registered");
  } else {
    try {
      const res = await postMessage({
        channel: approvals.name,
        text: proposal.renderedMarkdown,
      });
      if (res.ok) {
        posted = true;
        postedTo = approvals.name;
      } else {
        degraded.push("slack-approvals-post: not ok");
      }
    } catch (err) {
      degraded.push(
        `slack-approvals-post: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Enqueue for retry when we failed to get the proposal into Slack.
  // Shopify retries the webhook, but a Slack outage shouldn't mean the
  // intent is lost — the retry cron re-posts from KV.
  if (!posted) {
    try {
      const { enqueueRetry } = await import("@/lib/ops/dispatch-retry-queue");
      await enqueueRetry({
        reason:
          degraded.join(" | ") || "slack post did not succeed",
        intent: norm.intent,
        classification,
        proposal,
      });
      enqueuedForRetry = true;
    } catch (err) {
      degraded.push(
        `retry-enqueue: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  await auditDispatch({
    agentId: "shopify-webhook-adapter",
    division: "production-supply-chain",
    channel: "shopify",
    sourceId: norm.intent.sourceId,
    orderNumber: norm.intent.orderNumber,
    classification,
    proposal,
    action: posted
      ? "shipment.proposal.post"
      : enqueuedForRetry
        ? "shipment.proposal.retry-enqueue"
        : "shipment.proposal.post.failed",
    postedToChannel: postedTo,
    error: !posted ? degraded.join(" | ") : undefined,
  });

  return NextResponse.json({
    ok: true,
    posted,
    postedTo,
    enqueuedForRetry,
    classification,
    proposal: { summary: proposal.summary, actionSlug: proposal.actionSlug },
    degraded,
  });
}
