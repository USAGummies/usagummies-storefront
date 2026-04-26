/**
 * Closer for `receipt.review.promote` approvals.
 *
 * Phase 10 of the Sales Command receipt lane. The pattern mirrors
 * the AP-packet / Faire-Direct closers:
 *   Slack POSTs an approve/reject click → `/api/slack/approvals`
 *   updates the canonical `approvalStore` via `recordDecision()` →
 *   this closer fires when the request's `targetEntity` identifies
 *   a receipt review packet, and transitions the packet's status.
 *
 * Strict gating (locked by tests):
 *   - `targetEntity?.type === "receipt-review-packet"`
 *   - `targetEntity.id` parses as a stable `pkt-v1-<receiptId>`
 *     packet id
 *   - the approval is in a terminal state (`approved` / `rejected`)
 *
 * The closer's ONLY mutation is the packet's `status` field:
 *   - approval `approved` → packet `rene-approved`
 *   - approval `rejected` → packet `rejected`
 *
 * Things this closer NEVER does:
 *   - touch the receipt's canonical fields (vendor / date / amount /
 *     category / payment_method / status)
 *   - fire a QBO write
 *   - create vendors / categories / bills / expenses
 *   - send Slack messages of its own (the dispatching slack-approvals
 *     route handles thread-message posting based on the closer's
 *     return)
 *
 * On packet-not-found (e.g. KV evicted, packetId malformed) the
 * closer returns `{ ok: false, handled: true }` so the slack route
 * can surface the gap — never silently succeeds.
 */
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { auditSurface } from "@/lib/ops/control-plane/slack";
import { updateReceiptReviewPacketStatus } from "@/lib/ops/docs";
import type {
  ApprovalRequest,
  RunContext,
} from "@/lib/ops/control-plane/types";
import type { ReceiptReviewPacket } from "@/lib/ops/receipt-review-packet";

const TARGET_ENTITY_TYPE = "receipt-review-packet";
const PACKET_ID_PREFIX = "pkt-v1-";

export type ReceiptReviewCloserResult =
  | {
      ok: true;
      handled: true;
      kind: "receipt-review-promote";
      packetId: string;
      newStatus: Extract<
        ReceiptReviewPacket["status"],
        "rene-approved" | "rejected"
      >;
      threadMessage: string;
    }
  | {
      ok: false;
      handled: true;
      kind: "receipt-review-promote";
      packetId: string | null;
      error: string;
      threadMessage: string;
    }
  | { ok: true; handled: false; reason: string };

function isPacketTargetEntity(approval: ApprovalRequest): boolean {
  return approval.targetEntity?.type === TARGET_ENTITY_TYPE;
}

function packetIdFromTargetEntity(approval: ApprovalRequest): string | null {
  const id = approval.targetEntity?.id?.trim();
  if (!id || !id.startsWith(PACKET_ID_PREFIX)) return null;
  return id;
}

async function appendCloseAudit(
  run: RunContext,
  approval: ApprovalRequest,
  fields: {
    result: "ok" | "error";
    packetId: string | null;
    newStatus?: "rene-approved" | "rejected";
    error?: string;
  },
) {
  const entry = buildAuditEntry(run, {
    action: "receipt-review-promote.closer",
    entityType: TARGET_ENTITY_TYPE,
    entityId: fields.packetId ?? approval.targetEntity?.id,
    result: fields.result,
    approvalId: approval.id,
    after: { newStatus: fields.newStatus, packetId: fields.packetId },
    error: fields.error ? { message: fields.error } : undefined,
    sourceCitations: [
      { system: "control-plane:approval", id: approval.id },
      ...(fields.packetId
        ? [{ system: "kv:docs:receipt_review_packets", id: fields.packetId }]
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
 * Run the closer for one approval. Strict gating + at-most-one
 * status transition per call. The slack-approvals route should
 * call this AFTER `recordDecision` returns the updated approval
 * (so `approval.status` is the post-decision value: `approved` /
 * `rejected` / `pending`).
 */
export async function executeApprovedReceiptReviewPromote(
  approval: ApprovalRequest,
): Promise<ReceiptReviewCloserResult> {
  // ---- Strict gating ----------------------------------------------------
  if (!isPacketTargetEntity(approval)) {
    return {
      ok: true,
      handled: false,
      reason: "not a receipt-review-packet approval",
    };
  }

  // We only act on terminal states. `pending` (e.g. after `ask`)
  // should leave the packet in `draft`.
  if (approval.status !== "approved" && approval.status !== "rejected") {
    return {
      ok: true,
      handled: false,
      reason: `approval status is ${approval.status} (not terminal)`,
    };
  }

  const run: RunContext = {
    runId: approval.runId,
    agentId: "receipt-review-promote-closer",
    division: approval.division,
    startedAt: new Date().toISOString(),
    source: "event",
    trigger: `approval:${approval.id}`,
  };

  const packetId = packetIdFromTargetEntity(approval);
  if (!packetId) {
    const err = `receipt-review approval ${approval.id} missing valid targetEntity.id (expected "${PACKET_ID_PREFIX}<receiptId>")`;
    await appendCloseAudit(run, approval, {
      result: "error",
      packetId: null,
      error: err,
    });
    return {
      ok: false,
      handled: true,
      kind: "receipt-review-promote",
      packetId: null,
      error: err,
      threadMessage: `:warning: Receipt-review approval recorded, but the closer could not derive a packet id: ${err}`,
    };
  }

  const newStatus: "rene-approved" | "rejected" =
    approval.status === "approved" ? "rene-approved" : "rejected";

  let updated: ReceiptReviewPacket | null = null;
  let updateError: string | null = null;
  try {
    updated = await updateReceiptReviewPacketStatus(packetId, newStatus);
  } catch (err) {
    updateError = err instanceof Error ? err.message : String(err);
  }

  if (updateError || !updated) {
    const errMsg =
      updateError ??
      `packet ${packetId} not found in KV (was it evicted, or is the targetEntity.id stale?)`;
    await appendCloseAudit(run, approval, {
      result: "error",
      packetId,
      error: errMsg,
    });
    return {
      ok: false,
      handled: true,
      kind: "receipt-review-promote",
      packetId,
      error: errMsg,
      threadMessage: `:warning: Receipt-review approval recorded, but the packet status update failed for *${packetId}*: ${errMsg}.`,
    };
  }

  await appendCloseAudit(run, approval, {
    result: "ok",
    packetId,
    newStatus,
  });

  const verb = newStatus === "rene-approved" ? "approved" : "rejected";
  const emoji = newStatus === "rene-approved" ? ":white_check_mark:" : ":x:";
  const threadMessage =
    `${emoji} Receipt review packet *${packetId}* ${verb} by Rene. ` +
    "Canonical receipt fields and QBO state are unchanged. " +
    "A separate `qbo.bill.create` action runs later for the actual posting.";

  return {
    ok: true,
    handled: true,
    kind: "receipt-review-promote",
    packetId,
    newStatus,
    threadMessage,
  };
}
