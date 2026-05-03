/**
 * Class A under-cap auto-executor for shipment.create.under-cap.
 *
 * Mirrors the post-approval Class B closer (`approval-closer.ts`) but
 * runs without an approval object — for single-case Ashford samples
 * where the cap predicate qualifies. The result is the same:
 *
 *   1. ShipStation order in `awaiting_shipment` so the auto-ship cron
 *      buys the label on its next tick.
 *   2. HubSpot timeline note on the deal (when dealId present).
 *   3. #shipping channel mirror so the operator sees the queue.
 *   4. Audit envelope via `record()` with `shipment.create.under-cap`.
 *
 * Hard guardrails preserved from the closer:
 *   - This module NEVER buys a label. Label purchase is the auto-ship
 *     cron's job; we just queue the order.
 *   - Idempotency: a per-sourceId KV marker prevents double-creates
 *     when the dispatch route is retried.
 *   - Fail-soft on HubSpot + Slack — ShipStation create is the only
 *     "must succeed" step; everything else degrades gracefully.
 *
 * Why a parallel module instead of refactoring the closer:
 * the closer is structurally tied to the `ApprovalRequest` shape
 * (uses `approval.id` for idempotency keys, reads payloadRef + targetEntity).
 * Synthesizing a fake approval would be more confusing than copying
 * the ~50 lines of order-create logic. When the closer is rewritten
 * to take a generic input, this module becomes a thin caller.
 */
import { kv } from "@vercel/kv";

import { record } from "@/lib/ops/control-plane/record";
import { slackChannelRef, getChannel } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack/client";
import {
  createNote,
  isHubSpotConfigured,
} from "@/lib/ops/hubspot-client";
import {
  createShipStationOrder,
  isShipStationConfigured,
} from "@/lib/ops/shipstation-client";
import type { RunContext } from "@/lib/ops/control-plane/types";
import type {
  DispatchClassification,
  OrderIntent,
} from "@/lib/ops/sample-order-dispatch";

const UNDER_CAP_KEY_PREFIX = "sample-dispatch:under-cap:";
const UNDER_CAP_TTL_SECONDS = 30 * 24 * 3600; // 30d, matches Class B closer

export type UnderCapExecutionResult =
  | {
      ok: true;
      kind: "under-cap-auto-executed";
      idempotencyKey: string;
      alreadyExisted: boolean;
      shipStationOrderId: number;
      shipStationOrderNumber: string;
      shipStationOrderUrl: string;
      hubspotNoteId: string | null;
      shippingChannelPosted: boolean;
      threadMessage: string;
    }
  | { ok: false; error: string };

interface UnderCapInputs {
  intent: OrderIntent;
  classification: DispatchClassification;
}

interface ShipStationCreateResult {
  orderId: number;
  orderNumber: string;
  orderUrl: string;
}

/**
 * Idempotency key for the under-cap auto-executor.
 * Scoped by channel:sourceId so a dispatch retry returns the same
 * ShipStation order rather than creating a duplicate.
 */
function idempotencyKey(channel: string, sourceId: string): string {
  return `${UNDER_CAP_KEY_PREFIX}${channel}:${sourceId}`;
}

async function readExistingOrder(
  key: string,
): Promise<ShipStationCreateResult | null> {
  let raw: unknown = null;
  try {
    raw = await kv.get(key);
  } catch {
    return null; // KV unreachable — treat as "not yet created"
  }
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as ShipStationCreateResult;
      return typeof parsed.orderId === "number" ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") {
    const o = raw as ShipStationCreateResult;
    return typeof o.orderId === "number" ? o : null;
  }
  return null;
}

/**
 * Execute the under-cap auto-shipment path. Caller is the dispatch
 * route; the predicate `qualifiesForUnderCapAutoExecute` MUST have
 * returned true before this is called.
 */
export async function executeUnderCapAutoShipment(
  run: RunContext,
  inputs: UnderCapInputs,
): Promise<UnderCapExecutionResult> {
  const { intent, classification } = inputs;

  if (!isShipStationConfigured()) {
    return {
      ok: false,
      error: "ShipStation not configured (SHIPSTATION_API_KEY/SECRET unset)",
    };
  }

  const key = idempotencyKey(intent.channel, intent.sourceId);
  const existing = await readExistingOrder(key);
  let shipStationOrder: ShipStationCreateResult;
  let alreadyExisted = false;
  if (existing) {
    shipStationOrder = existing;
    alreadyExisted = true;
  } else {
    const orderNumber = intent.orderNumber || intent.sourceId;
    const customField1 = "tag:sample,tag:no-revenue";
    const customField2 = `origin:${classification.origin}`;
    const customField3 = `under-cap:${run.runId}`;
    const items = [
      {
        sku: "UG-AAGB-6CT",
        name: "All American Gummy Bears 7.5oz Sample Case (6-ct)",
        quantity: 1,
        unitPrice: 0,
      },
    ];
    const result = await createShipStationOrder({
      orderNumber,
      orderStatus: "awaiting_shipment",
      customerEmail: undefined,
      customerNotes: intent.note,
      internalNotes: `Under-cap auto-execute · run ${run.runId} · ${classification.originReason}`,
      shipTo: {
        name: intent.shipTo.name,
        company: intent.shipTo.company,
        street1: intent.shipTo.street1,
        street2: intent.shipTo.street2,
        city: intent.shipTo.city,
        state: intent.shipTo.state,
        postalCode: intent.shipTo.postalCode,
        country: intent.shipTo.country || "US",
        phone: intent.shipTo.phone,
        residential: intent.shipTo.residential ?? true,
      },
      items,
      weight: { value: 3.4, units: "pounds" },
      dimensions: { length: 7, width: 7, height: 7, units: "inches" },
      packageCode: "package",
      requestedShippingService: classification.serviceCode,
      customField1,
      customField2,
      customField3,
    });
    if (!result.ok) {
      return {
        ok: false,
        error: `ShipStation create failed: ${result.error}`,
      };
    }
    shipStationOrder = result.order;
    try {
      await kv.set(key, JSON.stringify(shipStationOrder), {
        ex: UNDER_CAP_TTL_SECONDS,
      });
    } catch {
      /* non-fatal — audit captures the create regardless */
    }
  }

  // Audit envelope (Class A `shipment.create.under-cap`).
  await record(run, {
    actionSlug: "shipment.create.under-cap",
    entityType: "shipment",
    entityId: intent.sourceId,
    result: "ok",
    after: {
      shipStationOrderId: shipStationOrder.orderId,
      shipStationOrderNumber: shipStationOrder.orderNumber,
      shipStationOrderUrl: shipStationOrder.orderUrl,
      idempotencyKey: key,
      alreadyExisted,
      origin: classification.origin,
      carrier: classification.carrierCode,
      service: classification.serviceCode,
      hubspotDealId: intent.hubspot?.dealId,
    },
    sourceCitations: [
      { system: intent.channel, id: intent.sourceId },
      {
        system: "shipstation:order",
        id: String(shipStationOrder.orderId),
        url: shipStationOrder.orderUrl,
      },
    ],
    confidence: 1.0,
  });

  // HubSpot note (best-effort).
  let hubspotNoteId: string | null = null;
  if (isHubSpotConfigured() && intent.hubspot?.dealId) {
    const recipient =
      intent.shipTo.company || intent.shipTo.name || "(unnamed recipient)";
    const cityState = `${intent.shipTo.city}, ${intent.shipTo.state}`;
    const carrier =
      classification.carrierCode === "stamps_com"
        ? "USPS via Stamps.com"
        : classification.carrierCode === "ups_walleted"
          ? "UPS"
          : classification.carrierCode === "fedex_walleted"
            ? "FedEx"
            : classification.carrierCode;
    const noteBody = [
      "<b>📦 Sample shipment queued (auto-execute, under-cap)</b>",
      `Recipient: ${recipient} · ${cityState}`,
      `Origin: Ashford WA (Ben)`,
      `Carrier: ${carrier} (${classification.serviceCode})`,
      `Packaging: 1 × case (~3.4 lb)`,
      `ShipStation order: <a href="${shipStationOrder.orderUrl}">${shipStationOrder.orderNumber}</a>`,
      `Auto-ship cron will buy the label on the next tick. Tracking number will follow in #shipping.`,
      `Run: <code>${run.runId}</code>`,
    ].join("<br>");
    try {
      hubspotNoteId = await createNote({
        dealId: intent.hubspot.dealId,
        body: noteBody,
      });
    } catch {
      /* fail-soft */
    }
  }

  // #shipping channel mirror (best-effort).
  let shippingChannelPosted = false;
  const sampleLabel = intent.orderNumber ?? intent.sourceId;
  const shippingText =
    `:zap: *Sample auto-queued (under-cap)* — ${sampleLabel}\n` +
    `*Origin:* Ashford WA (Ben) · *Ship-to:* ${intent.shipTo.name} · ${intent.shipTo.city}, ${intent.shipTo.state}\n` +
    `*Carrier:* \`${classification.carrierCode}\` / \`${classification.serviceCode}\`\n` +
    `ShipStation order: \`${shipStationOrder.orderNumber}\` · <${shipStationOrder.orderUrl}|Open in ShipStation>\n` +
    `_Class A — no approval card opened. Auto-ship cron buys the label on next tick._`;
  if (getChannel("shipping")) {
    try {
      await postMessage({
        channel: slackChannelRef("shipping"),
        text: shippingText,
      });
      shippingChannelPosted = true;
    } catch {
      /* fail-soft — audit envelope is still source of truth */
    }
  }

  const threadMessage = alreadyExisted
    ? `:white_check_mark: Under-cap auto-execute resumed for existing ShipStation order \`${shipStationOrder.orderNumber}\` (idempotent retry).`
    : `:zap: Under-cap auto-execute — ShipStation order \`${shipStationOrder.orderNumber}\` created in awaiting_shipment for Ashford pack-out. No approval card; Class A.`;

  return {
    ok: true,
    kind: "under-cap-auto-executed",
    idempotencyKey: key,
    alreadyExisted,
    shipStationOrderId: shipStationOrder.orderId,
    shipStationOrderNumber: shipStationOrder.orderNumber,
    shipStationOrderUrl: shipStationOrder.orderUrl,
    hubspotNoteId,
    shippingChannelPosted,
    threadMessage,
  };
}
