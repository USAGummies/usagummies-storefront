/**
 * Closer for approved Class B `shipment.create` approvals.
 *
 * When Ben clicks Approve on a shipment.create card, the Slack interactive
 * route flips the approval status to "approved" and then calls this
 * function. The closer's job is the MINIMUM next step — never the full
 * label purchase by default — so we never auto-buy without the operator
 * having a hand on the wheel.
 *
 * Today's behavior:
 *   - For channel="manual" (free-form email samples → Ben in Ashford,
 *     per /contracts/integrations/shipstation.md §3.5 REVISED 2026-04-30):
 *     post a thread reply confirming the hand-off; record an audit entry;
 *     queue the intent in KV for the operator to drain. No label buy.
 *   - For channel ∈ {shopify, amazon, faire, hubspot}: post a "manual
 *     required" thread reply pointing the operator to the existing
 *     auto-ship pipeline / ShipStation queue. We deliberately do NOT
 *     reach into ShipStation here — the dedicated auto-ship cron (with
 *     its own validation + dedup + drift audit) is the only path that
 *     buys labels.
 *
 * "If label buying needs missing data, do not guess" — Ben, 2026-04-24.
 *
 * Returns a structured result so the caller (slack-approvals route) can
 * post a single thread message that mirrors what was actually executed.
 */
import { kv } from "@vercel/kv";

import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { auditSurface } from "@/lib/ops/control-plane/slack";
import type {
  ApprovalRequest,
  RunContext,
} from "@/lib/ops/control-plane/types";

const QUEUE_KEY_PREFIX = "sample-dispatch:approved:";
const QUEUE_TTL_SECONDS = 30 * 24 * 3600; // 30 days

export type ShipmentApprovalExecutionResult =
  | {
      ok: true;
      handled: true;
      kind: "manual-handoff";
      approvalId: string;
      queuedKey: string;
      threadMessage: string;
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

function parsePayloadRef(ref: string | undefined): ParsedPayloadRef | null {
  if (!ref) return null;
  // Format: "dispatch:<channel>:<sourceId>"
  const m = /^dispatch:([^:]+):(.+)$/.exec(ref);
  if (!m) return null;
  return { channel: m[1], sourceId: m[2] };
}

async function appendCloseAudit(
  run: RunContext,
  approval: ApprovalRequest,
  fields: {
    result: "ok" | "error";
    kind?: string;
    queuedKey?: string;
    error?: string;
  },
) {
  const entry = buildAuditEntry(run, {
    action: "shipment.approved.handoff",
    entityType: "shipment",
    entityId: approval.targetEntity?.id,
    result: fields.result,
    approvalId: approval.id,
    after: { kind: fields.kind, queuedKey: fields.queuedKey },
    error: fields.error ? { message: fields.error } : undefined,
    sourceCitations: [
      { system: "control-plane:approval", id: approval.id },
      ...(approval.payloadRef
        ? [{ system: "dispatch:payloadRef", id: approval.payloadRef }]
        : []),
    ],
    confidence: approval.evidence.confidence,
  });
  await auditStore().append(entry);
  await auditSurface()
    .mirror(entry)
    .catch(() => void 0);
}

/**
 * Execute the closer for an approved shipment.create approval.
 *
 * Idempotency: writes a single KV key per approval id. Calling twice
 * with the same approval just re-asserts the queue entry — never buys a
 * label, so even repeat fires are safe.
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
    const err = `shipment.create approval ${approval.id} missing dispatch:<channel>:<sourceId> payloadRef`;
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

  // Manual channel = free-form email sample → Ben in Ashford
  // (per /contracts/integrations/shipstation.md §3.5 REVISED 2026-04-30).
  // Queue the intent for the operator and post the hand-off message.
  // No label buy.
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
    const threadMessage =
      `:package: Approved \`shipment.create\` — handed to Ben for manual sample fulfillment ` +
      `(${approval.targetEntity?.label ?? parsed.sourceId}). ` +
      `*No label purchased.* Ben packs from Ashford and confirms in #shipping when shipped. ` +
      `_Queue key: \`${queuedKey}\`_`;
    await appendCloseAudit(run, approval, {
      result: "ok",
      kind: "manual-handoff",
      queuedKey,
    });
    return {
      ok: true,
      handled: true,
      kind: "manual-handoff",
      approvalId: approval.id,
      queuedKey,
      threadMessage,
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
