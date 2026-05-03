/**
 * Closer for approved Class B `shipment.create` approvals.
 *
 * When Ben clicks Approve on a shipment.create card, the Slack interactive
 * route flips the approval status to "approved" and then calls this
 * function. The closer's job:
 *
 *   - Manual channel (free-form email sample → Ben, Ashford WA, per
 *     CLAUDE.md REVISED 2026-04-30 + /contracts/integrations/
 *     shipstation.md §3.5): create a ShipStation order in
 *     `awaiting_shipment` so the existing auto-ship cron can buy the
 *     label on its next tick. Queue + Slack mirror happen in lock-step.
 *     If ShipStation is unreachable or the structured payload was never
 *     persisted, fall back to the legacy manual-handoff path (Ben packs
 *     + buys label by hand). The fallback is what shipped during the
 *     2026-05-02 CNHA repro (approval `12ebec77-…`).
 *   - Non-manual channels (shopify / amazon / faire / hubspot): the
 *     order already exists in ShipStation via the marketplace sync, so
 *     we just hand off to the auto-ship cron with a thread reply. We
 *     deliberately do NOT call ShipStation here — the dedicated cron
 *     (with its own validation + dedup + drift audit) is the only path
 *     that buys labels.
 *
 * Hard rule (preserved): the closer NEVER buys a label. It only creates
 * a ShipStation order so the auto-ship cron has something to pick up.
 * Label purchase stays in `/api/ops/shipping/auto-ship`.
 *
 * Idempotency: a per-approval KV marker (`sample-dispatch:shipstation-
 * order:<approvalId>`) guards `createShipStationOrder` — double fires
 * (KV race, Slack retry) read the marker and skip the create. The
 * existing approval-queue marker (`sample-dispatch:approved:<id>`) is
 * preserved as the operator hand-off signal.
 *
 * "If label buying needs missing data, do not guess" — Ben, 2026-04-24.
 *
 * Returns a structured result so the caller (slack-approvals route) can
 * post a single thread message that mirrors what was actually executed.
 */
import { kv } from "@vercel/kv";

import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { getChannel, slackChannelRef } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack/client";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { auditSurface } from "@/lib/ops/control-plane/slack";
import type {
  ApprovalRequest,
  RunContext,
} from "@/lib/ops/control-plane/types";
import {
  createShipStationOrder,
  isShipStationConfigured,
} from "@/lib/ops/shipstation-client";
import { loadDispatchPayload } from "@/lib/ops/sample-order-dispatch/payload-store";
import {
  createNote,
  isHubSpotConfigured,
} from "@/lib/ops/hubspot-client";
import type { DispatchPayload } from "@/lib/ops/sample-order-dispatch/payload-store";

const QUEUE_KEY_PREFIX = "sample-dispatch:approved:";
const SHIPSTATION_ORDER_KEY_PREFIX = "sample-dispatch:shipstation-order:";
const QUEUE_TTL_SECONDS = 30 * 24 * 3600; // 30 days

export type ShipmentApprovalExecutionResult =
  | {
      ok: true;
      handled: true;
      kind: "manual-handoff";
      approvalId: string;
      queuedKey: string;
      threadMessage: string;
      shippingChannelPosted: boolean;
      shipStationOrderId?: number;
      shipStationOrderNumber?: string;
      shipStationOrderUrl?: string;
      shipStationFallbackReason?: string;
      /** HubSpot note id when a "queued" timeline note was written to the deal. */
      hubspotNoteId?: string | null;
    }
  | {
      ok: true;
      handled: true;
      kind: "auto-ship-pipeline-handoff";
      approvalId: string;
      threadMessage: string;
    }
  | { ok: true; handled: false; reason: string }
  | { ok: false; handled: true; error: string };

interface ParsedPayloadRef {
  channel: string;
  sourceId: string;
}

/**
 * Parse the payloadRef into channel + sourceId. We accept the two
 * formats the upstream routes emit:
 *
 *   - `dispatch:<channel>:<sourceId>` — `/api/ops/agents/sample-
 *     dispatch/dispatch` (webhook adapter path).
 *   - `sample-queue:<sourceId>` — `/api/ops/sample/queue` (operator
 *     queue path; channel is always "manual").
 *
 * Other formats return null so the caller fails closed.
 */
function parsePayloadRef(ref: string | undefined): ParsedPayloadRef | null {
  if (!ref) return null;
  const dispatchMatch = /^dispatch:([^:]+):(.+)$/.exec(ref);
  if (dispatchMatch) {
    return { channel: dispatchMatch[1], sourceId: dispatchMatch[2] };
  }
  const queueMatch = /^sample-queue:(.+)$/.exec(ref);
  if (queueMatch) {
    return { channel: "manual", sourceId: queueMatch[1] };
  }
  return null;
}

interface CloseAuditFields {
  result: "ok" | "error";
  kind?: string;
  queuedKey?: string;
  shipStationOrderId?: number;
  shipStationOrderNumber?: string;
  shipStationOrderUrl?: string;
  hubspotNoteId?: string | null;
  fallbackReason?: string;
  error?: string;
}

async function appendCloseAudit(
  run: RunContext,
  approval: ApprovalRequest,
  fields: CloseAuditFields,
) {
  const action =
    fields.kind === "shipstation-order-created"
      ? "shipment.approved.shipstation-order.created"
      : fields.kind === "shipstation-order-failed"
        ? "shipment.approved.shipstation-order.failed"
        : "shipment.approved.handoff";
  const entry = buildAuditEntry(run, {
    action,
    entityType: "shipment",
    entityId: approval.targetEntity?.id,
    result: fields.result,
    approvalId: approval.id,
    after: {
      kind: fields.kind,
      queuedKey: fields.queuedKey,
      shipStationOrderId: fields.shipStationOrderId,
      shipStationOrderNumber: fields.shipStationOrderNumber,
      shipStationOrderUrl: fields.shipStationOrderUrl,
      hubspotNoteId: fields.hubspotNoteId,
      fallbackReason: fields.fallbackReason,
    },
    error: fields.error ? { message: fields.error } : undefined,
    sourceCitations: [
      { system: "control-plane:approval", id: approval.id },
      ...(approval.payloadRef
        ? [{ system: "dispatch:payloadRef", id: approval.payloadRef }]
        : []),
      ...(fields.shipStationOrderId
        ? [
            {
              system: "shipstation:order",
              id: String(fields.shipStationOrderId),
            },
          ]
        : []),
    ],
    confidence: approval.evidence.confidence,
  });
  await auditStore().append(entry);
  await auditSurface()
    .mirror(entry)
    .catch(() => void 0);
}

interface ShipStationCreateResult {
  orderId: number;
  orderNumber: string;
  orderUrl: string;
}

/**
 * Try to create (or recover an idempotent prior create of) a
 * ShipStation order for an approved manual-channel sample. Returns
 * `{ created, order }` on success, `{ skipped, reason }` if no
 * structured payload was persisted (legacy approvals predating the
 * 2026-05-02 wiring) or ShipStation isn't configured, and `{ failed,
 * error }` on a real ShipStation API failure. The caller falls through
 * to the manual-handoff Slack message + queue in any non-success case.
 */
async function attemptShipStationOrderCreate(
  run: RunContext,
  approval: ApprovalRequest,
): Promise<
  | { status: "created"; order: ShipStationCreateResult; alreadyExisted: false }
  | { status: "created"; order: ShipStationCreateResult; alreadyExisted: true }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string }
> {
  // Idempotency check FIRST so a retry never double-creates.
  const idempotencyKey = `${SHIPSTATION_ORDER_KEY_PREFIX}${approval.id}`;
  let existingRaw: unknown = null;
  try {
    existingRaw = await kv.get(idempotencyKey);
  } catch {
    // KV unreachable — treat as not-yet-created (better to risk a
    // duplicate than to skip the create entirely; ShipStation's
    // upsert-by-orderNumber dedup catches duplicates anyway).
  }
  if (existingRaw) {
    let existing: ShipStationCreateResult | null = null;
    if (typeof existingRaw === "string") {
      try {
        existing = JSON.parse(existingRaw) as ShipStationCreateResult;
      } catch {
        existing = null;
      }
    } else if (typeof existingRaw === "object") {
      existing = existingRaw as ShipStationCreateResult;
    }
    if (existing && typeof existing.orderId === "number") {
      return { status: "created", order: existing, alreadyExisted: true };
    }
  }

  if (!isShipStationConfigured()) {
    return {
      status: "skipped",
      reason: "ShipStation not configured (SHIPSTATION_API_KEY/SECRET unset)",
    };
  }

  const payload = await loadDispatchPayload(approval.id);
  if (!payload) {
    return {
      status: "skipped",
      reason:
        "no structured dispatch payload persisted for this approval (likely a legacy/pre-2026-05-02 card)",
    };
  }

  // Normalise the dispatch into a sample-shipment ShipStation order
  // matching `/contracts/integrations/shipstation.md` §3.5: a single
  // 6-bag inner case in a 7×7×7 box, ~3.4 lb, Ashford ship-from
  // (handled inside createShipStationOrder via getShipFromAddress).
  const intent = payload.orderIntent;
  const classification = payload.classification;
  const orderNumber = intent.orderNumber || intent.sourceId;

  // Tag set: tag:sample + tag:no-revenue (per §3.5) + origin tag from
  // the classifier so drift audits can verify the closer respected
  // the Ashford rule.
  const customField1 = "tag:sample,tag:no-revenue";
  const customField2 = `origin:${classification.origin}`;
  const customField3 = `approval:${approval.id}`;

  // Item: 1 × UG-AAGB-6CT (6-bag inner case). The auto-ship cron's
  // `totalBagsForItems` maps this SKU to 6 bags → `inner_box_7x7x7`
  // packaging profile, which is auto-buy eligible.
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
    internalNotes: `Sample dispatch · approval ${approval.id} · ${classification.originReason}`,
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
    return { status: "failed", error: result.error };
  }

  // Persist idempotency marker so a retry returns the same orderId.
  // KV failure here is non-fatal — the audit still captures the create.
  try {
    await kv.set(idempotencyKey, JSON.stringify(result.order), {
      ex: QUEUE_TTL_SECONDS,
    });
  } catch {
    /* swallow — audit captures the create either way */
  }

  await appendCloseAudit(run, approval, {
    result: "ok",
    kind: "shipstation-order-created",
    shipStationOrderId: result.order.orderId,
    shipStationOrderNumber: result.order.orderNumber,
    shipStationOrderUrl: result.order.orderUrl,
  });

  return { status: "created", order: result.order, alreadyExisted: false };
}

/**
 * Best-effort HubSpot timeline note when a sample shipment is queued.
 * Writes "Sample queued in ShipStation" with ship-to + carrier details
 * so the deal record reflects reality even before the auto-ship cron
 * buys the label. Fixes the 17-deal stage-drift gap Ben caught 2026-04-27
 * (Reunion samples in "Sample Shipped" with no tracking note).
 *
 * Tracking number is intentionally NOT in this note — it doesn't exist
 * yet at closer time. Tracking lands separately in #shipping when the
 * auto-ship cron buys the label.
 *
 * Fail-soft: HubSpot down, missing config, missing dealId → silent skip.
 * Returns the noteId on success so the caller can audit it.
 */
async function writeHubSpotSampleQueuedNote(
  approvalId: string,
  shipStationOrder: ShipStationCreateResult | null,
): Promise<string | null> {
  if (!isHubSpotConfigured()) return null;
  let payload: DispatchPayload | null;
  try {
    payload = await loadDispatchPayload(approvalId);
  } catch {
    return null;
  }
  if (!payload) return null;
  const dealId = payload.orderIntent.hubspot?.dealId;
  if (!dealId) return null;

  const intent = payload.orderIntent;
  const classification = payload.classification;
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
  const origin =
    classification.origin === "ashford"
      ? "Ashford WA (Ben)"
      : "East Coast (Drew)";

  const lines: string[] = [
    "<b>📦 Sample shipment queued</b>",
    `Recipient: ${recipient} · ${cityState}`,
    `Origin: ${origin}`,
    `Carrier: ${carrier} (${classification.serviceCode})`,
    `Packaging: 1 × ${classification.packagingType} (~3.4 lb)`,
  ];
  if (shipStationOrder) {
    lines.push(
      `ShipStation order: <a href="${shipStationOrder.orderUrl}">${shipStationOrder.orderNumber}</a>`,
    );
    lines.push(
      "Auto-ship cron will buy the label on the next tick. Tracking number will follow in #shipping.",
    );
  } else {
    lines.push(
      "<i>ShipStation order not auto-created — Ben packs + buys label by hand from Ashford.</i>",
    );
  }
  lines.push(`Approval: <code>${approvalId}</code>`);

  try {
    return await createNote({
      dealId,
      body: lines.join("<br>"),
    });
  } catch {
    return null;
  }
}

/**
 * Execute the closer for an approved shipment.create approval.
 *
 * Idempotency: a per-approval KV marker guards the ShipStation create.
 * The legacy `sample-dispatch:approved:<id>` queue entry is preserved
 * as the manual hand-off signal even when the create succeeds, so
 * #shipping always shows the same trail of "queued" → "label bought".
 */
export async function executeApprovedShipmentCreate(
  approval: ApprovalRequest,
): Promise<ShipmentApprovalExecutionResult> {
  if (approval.status !== "approved") {
    return {
      ok: true,
      handled: false,
      reason: `approval status is ${approval.status}`,
    };
  }
  // Only fire for shipment.create — other action slugs route elsewhere.
  if (!approval.action.toLowerCase().includes("shipment")) {
    return { ok: true, handled: false, reason: "not a shipment approval" };
  }
  const parsed = parsePayloadRef(approval.payloadRef);
  if (!parsed) {
    const err = `shipment.create approval ${approval.id} missing dispatch:<channel>:<sourceId> or sample-queue:<sourceId> payloadRef`;
    return { ok: false, handled: true, error: err };
  }

  const run: RunContext = {
    runId: approval.runId,
    agentId: "sample-dispatch-approved-closer",
    division: approval.division,
    startedAt: new Date().toISOString(),
    source: "event",
    trigger: `approval:${approval.id}`,
  };

  // Manual channel = free-form email sample → Ben packs from Ashford
  // (CLAUDE.md REVISED 2026-04-30 + shipstation.md §3.5). Try to
  // create the ShipStation order so the auto-ship cron can buy the
  // label on its next tick; on any failure fall through to the legacy
  // manual-handoff path so Ben can pack + label by hand.
  if (parsed.channel === "manual") {
    const queuedKey = `${QUEUE_KEY_PREFIX}${approval.id}`;
    try {
      await kv.set(
        queuedKey,
        JSON.stringify({
          approvalId: approval.id,
          channel: parsed.channel,
          sourceId: parsed.sourceId,
          targetEntity: approval.targetEntity,
          payloadPreview: approval.payloadPreview,
          approvedAt: new Date().toISOString(),
        }),
        { ex: QUEUE_TTL_SECONDS },
      );
    } catch (err) {
      // KV failure is non-fatal — we still post the hand-off message and
      // audit the closer fired. Ben picks up via Slack, not via KV scan.
      const errMsg = err instanceof Error ? err.message : String(err);
      await appendCloseAudit(run, approval, {
        result: "error",
        kind: "manual-handoff-kv-degraded",
        error: errMsg,
      });
    }

    // Attempt ShipStation order create. Surface the result in the
    // thread + #shipping mirror so Ben can see at a glance whether the
    // auto-ship cron will pick this up or whether he needs to pack +
    // label by hand.
    const ssAttempt = await attemptShipStationOrderCreate(run, approval);
    let shipStationOrderId: number | undefined;
    let shipStationOrderNumber: string | undefined;
    let shipStationOrderUrl: string | undefined;
    let shipStationFallbackReason: string | undefined;

    if (ssAttempt.status === "created") {
      shipStationOrderId = ssAttempt.order.orderId;
      shipStationOrderNumber = ssAttempt.order.orderNumber;
      shipStationOrderUrl = ssAttempt.order.orderUrl;
    } else if (ssAttempt.status === "failed") {
      shipStationFallbackReason = ssAttempt.error;
      await appendCloseAudit(run, approval, {
        result: "error",
        kind: "shipstation-order-failed",
        error: ssAttempt.error,
        fallbackReason: ssAttempt.error,
      });
    } else {
      // status === "skipped" — no payload found or ShipStation not
      // configured. This is the legacy fallback path; not an error.
      shipStationFallbackReason = ssAttempt.reason;
    }

    // Best-effort HubSpot timeline note. Writes "Sample queued" with
    // ship-to + carrier metadata so the deal record reflects reality
    // even before the auto-ship cron buys the label. Closes the
    // 17-deal stage-drift gap Ben caught 2026-04-27 (Reunion samples
    // in "Sample Shipped" with no tracking note).
    let hubspotNoteId: string | null = null;
    try {
      hubspotNoteId = await writeHubSpotSampleQueuedNote(
        approval.id,
        shipStationOrderId
          ? {
              orderId: shipStationOrderId,
              orderNumber: shipStationOrderNumber!,
              orderUrl: shipStationOrderUrl!,
            }
          : null,
      );
    } catch {
      /* fail-soft — HubSpot is a writeback mirror, not the system of record */
    }

    const sampleLabel = approval.targetEntity?.label ?? parsed.sourceId;
    const threadMessage = shipStationOrderId
      ? `:package: Approved \`shipment.create\` — ShipStation order \`${shipStationOrderNumber}\` ` +
        `created in awaiting_shipment for Ashford pack-out (${sampleLabel}). ` +
        `*No label purchased by closer.* The auto-ship cron will buy the label on its next tick ` +
        `and post tracking + PDF in #shipping. ` +
        `<${shipStationOrderUrl}|Open in ShipStation> · _Queue key: \`${queuedKey}\`_`
      : `:package: Approved \`shipment.create\` — queued for Ben to pack from Ashford ` +
        `(${sampleLabel}). ` +
        `*No label purchased by closer.* Ben packs the case sample (6 × 7.5 oz bags + strip clip + hook in a 7×7×7 box) ` +
        `and posts proof-of-ship in #shipping when the label is bought. ` +
        (shipStationFallbackReason
          ? `_ShipStation auto-create skipped: ${shipStationFallbackReason}._ `
          : "") +
        `_Queue key: \`${queuedKey}\`_`;

    // Mirror to #shipping so Ben sees the queue entry on his phone
    // alongside the auto-ship pipeline's notifications. Fail-soft —
    // the approval-thread reply remains the source-of-truth.
    let shippingChannelPosted = false;
    if (getChannel("shipping")) {
      try {
        const previewLine = approval.payloadPreview
          ? `\n${approval.payloadPreview}`
          : "";
        const shippingText = shipStationOrderId
          ? `:package: *Sample queued in ShipStation* — ${sampleLabel}` +
            previewLine +
            `\nShipStation order: \`${shipStationOrderNumber}\` · <${shipStationOrderUrl}|Open in ShipStation>` +
            `\nApproval: \`${approval.id}\` · Queue key: \`${queuedKey}\`` +
            `\nAuto-ship cron will buy label on next tick — tracking + PDF will follow here.`
          : `:package: *Sample queued for Ashford pack-out* — ${sampleLabel}` +
            previewLine +
            `\nApproval: \`${approval.id}\` · Queue key: \`${queuedKey}\`` +
            (shipStationFallbackReason
              ? `\n_ShipStation auto-create skipped: ${shipStationFallbackReason}._`
              : "") +
            `\nNo label purchased yet — buy + post proof-of-ship here when shipped.`;
        await postMessage({
          channel: slackChannelRef("shipping"),
          text: shippingText,
        });
        shippingChannelPosted = true;
      } catch {
        /* best-effort — approval thread reply still carries the signal */
      }
    }

    await appendCloseAudit(run, approval, {
      result: "ok",
      kind: "manual-handoff",
      queuedKey,
      shipStationOrderId,
      shipStationOrderNumber,
      shipStationOrderUrl,
      hubspotNoteId,
      fallbackReason: shipStationOrderId ? undefined : shipStationFallbackReason,
    });
    return {
      ok: true,
      handled: true,
      kind: "manual-handoff",
      approvalId: approval.id,
      queuedKey,
      threadMessage,
      shippingChannelPosted,
      shipStationOrderId,
      shipStationOrderNumber,
      shipStationOrderUrl,
      shipStationFallbackReason,
      hubspotNoteId,
    };
  }

  // Non-manual channels: defer to the existing auto-ship pipeline. We do
  // NOT call ShipStation from here — the dedicated cron has dedup + drift
  // audit and is the only authorized label-buyer.
  const threadMessage =
    `:white_check_mark: Approved \`shipment.create\` — ${parsed.channel}:${parsed.sourceId} ` +
    `is now eligible for the auto-ship cron / ShipStation queue. ` +
    `*Manual required for label buy* — open the order in ShipStation or wait for the next auto-ship tick. ` +
    `Audit recorded; no label purchased by this closer.`;
  await appendCloseAudit(run, approval, {
    result: "ok",
    kind: "auto-ship-pipeline-handoff",
  });
  return {
    ok: true,
    handled: true,
    kind: "auto-ship-pipeline-handoff",
    approvalId: approval.id,
    threadMessage,
  };
}
