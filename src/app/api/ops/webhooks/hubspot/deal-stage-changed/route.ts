/**
 * POST /api/ops/webhooks/hubspot/deal-stage-changed
 *
 * HubSpot `deal.propertyChange` webhook adapter for S-08. Flow:
 *   1. Verify HubSpot v3 signature (optional — gated on HUBSPOT_APP_SECRET)
 *   2. Scan event array for dealstage changes into STAGE_PO_RECEIVED
 *      or STAGE_CLOSED_WON
 *   3. For each matching event:
 *        getDealWithContact → normalize → classifyDispatch
 *        → post proposal to #ops-approvals
 *
 * HubSpot sends batched event arrays. One webhook call may carry many
 * events; we iterate and accumulate per-event outcomes.
 *
 * Auth: HubSpot signature (no session auth).
 */
import { NextResponse } from "next/server";
import crypto from "node:crypto";

import { getChannel } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack";
import {
  getDealWithContact,
  HUBSPOT,
} from "@/lib/ops/hubspot-client";
import { normalizeHubSpotDeal } from "@/lib/ops/hubspot-deal-to-intent";
import {
  classifyDispatch,
  composeShipmentProposal,
} from "@/lib/ops/sample-order-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * HubSpot Signature v3:
 *   hmacSHA256(secret, `${method}${fullUrl}${body}${timestamp}`) in base64
 * Header `X-HubSpot-Signature-v3` + `X-HubSpot-Request-Timestamp`.
 * Reject timestamps older than 5 minutes (replay protection).
 */
function verifyHubSpotSignature(
  method: string,
  fullUrl: string,
  body: string,
  signature: string | null,
  timestamp: string | null,
  secret: string,
): boolean {
  if (!signature || !timestamp) return false;
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() - ts) > 5 * 60 * 1000) return false;
  const data = method + fullUrl + body + timestamp;
  const digest = crypto
    .createHmac("sha256", secret)
    .update(data, "utf8")
    .digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

interface HubSpotEvent {
  subscriptionType?: string;
  propertyName?: string;
  propertyValue?: string;
  objectId?: number | string;
  eventId?: number;
  occurredAt?: number;
}

const RELEVANT_STAGES = new Set([
  HUBSPOT.STAGE_PO_RECEIVED,
  HUBSPOT.STAGE_CLOSED_WON,
]);

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const secret = process.env.HUBSPOT_APP_SECRET?.trim();
  const signature = req.headers.get("x-hubspot-signature-v3");
  const timestamp = req.headers.get("x-hubspot-request-timestamp");

  if (secret) {
    const url = new URL(req.url);
    // HubSpot signs the FULL URL including the host + path.
    if (
      !verifyHubSpotSignature(
        req.method,
        `${url.protocol}//${url.host}${url.pathname}${url.search}`,
        rawBody,
        signature,
        timestamp,
        secret,
      )
    ) {
      return NextResponse.json(
        { ok: false, error: "Invalid HubSpot signature" },
        { status: 401 },
      );
    }
  }

  let events: HubSpotEvent[];
  try {
    const parsed = JSON.parse(rawBody) as HubSpotEvent[] | HubSpotEvent;
    events = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const results: Array<Record<string, unknown>> = [];
  const degraded: string[] = [];

  for (const ev of events) {
    // Only react to dealstage changes INTO a ship-trigger stage.
    if (ev.propertyName !== "dealstage") {
      results.push({ eventId: ev.eventId, skipped: "not-dealstage" });
      continue;
    }
    if (!ev.propertyValue || !RELEVANT_STAGES.has(ev.propertyValue)) {
      results.push({
        eventId: ev.eventId,
        skipped: "stage-not-relevant",
        dealstage: ev.propertyValue ?? null,
      });
      continue;
    }
    const dealId = ev.objectId ? String(ev.objectId) : "";
    if (!dealId) {
      results.push({ eventId: ev.eventId, skipped: "no-objectId" });
      continue;
    }

    // Fetch the deal + contact. HubSpot API occasionally 404s on
    // same-request reads; log and continue instead of failing the batch.
    const deal = await getDealWithContact(dealId);
    if (!deal) {
      degraded.push(`hubspot deal ${dealId} unreadable`);
      results.push({ eventId: ev.eventId, dealId, skipped: "deal-unreadable" });
      continue;
    }

    const norm = normalizeHubSpotDeal(deal);
    if (!norm.ok) {
      const skipped = (norm as { skipped?: boolean }).skipped;
      results.push({
        eventId: ev.eventId,
        dealId,
        skipped: skipped ? (norm as { reason: string }).reason : false,
        error: skipped ? undefined : (norm as { error: string }).error,
      });
      continue;
    }

    const classification = classifyDispatch(norm.intent);

    if (classification.refuse) {
      // Hard refuse → #ops-alerts (e.g. ar_hold flipped on the deal).
      const alerts = getChannel("ops-alerts");
      if (alerts) {
        try {
          await postMessage({
            channel: alerts.name,
            text:
              `:no_entry: *HubSpot dispatch refused — deal ${dealId} (${deal.dealname})*\n` +
              `${classification.refuseReason}`,
          });
        } catch (err) {
          degraded.push(
            `slack-alerts: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      results.push({
        eventId: ev.eventId,
        dealId,
        refuse: true,
        refuseReason: classification.refuseReason,
      });
      continue;
    }

    const proposal = composeShipmentProposal(norm.intent, classification);
    const approvals = getChannel("ops-approvals");
    let posted = false;
    if (approvals) {
      try {
        const res = await postMessage({
          channel: approvals.name,
          text: proposal.renderedMarkdown,
        });
        posted = res.ok;
        if (!res.ok) {
          degraded.push(`slack-approvals-post: deal ${dealId} not ok`);
        }
      } catch (err) {
        degraded.push(
          `slack-approvals-post: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      degraded.push("slack-approvals: #ops-approvals channel not registered");
    }

    // Enqueue for retry when the Slack post failed.
    let enqueuedForRetry = false;
    if (!posted) {
      try {
        const { enqueueRetry } = await import("@/lib/ops/dispatch-retry-queue");
        await enqueueRetry({
          reason:
            `deal ${dealId}: slack post did not succeed (${degraded.slice(-1)[0] ?? "unknown"})`,
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

    results.push({
      eventId: ev.eventId,
      dealId,
      posted,
      enqueuedForRetry,
      classification,
      proposalSummary: proposal.summary,
    });
  }

  return NextResponse.json({
    ok: true,
    eventsProcessed: events.length,
    results,
    degraded,
  });
}
