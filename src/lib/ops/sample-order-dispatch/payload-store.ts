/**
 * Dispatch payload store — persists the structured `OrderIntent` +
 * classification at approval-create time so the approval-closer can
 * recover the ship-to / packaging / carrier metadata when Ben hits
 * Approve hours later in Slack.
 *
 * Why this exists: a control-plane `ApprovalRequest` only carries
 * `payloadRef` + `payloadPreview` (markdown for the Slack card). When
 * the closer fires, it has no structured ship-to / classification data
 * to hand to ShipStation — so the manual-channel branch couldn't
 * actually create an order before this. The 2026-05-02 CNHA repro
 * (approval `12ebec77-…`) is exactly the gap: Ben approved the card,
 * the closer fired the queue + Slack message, but no ShipStation order
 * was created.
 *
 * Contract:
 *   - Persist at the routes that open `shipment.create` approvals
 *     (`/api/ops/agents/sample-dispatch/dispatch` +
 *     `/api/ops/sample/queue`) RIGHT AFTER `requestApproval()` returns.
 *   - Recall in the closer's manual-channel branch.
 *   - Fail-soft: KV write or read failure must not break the approval
 *     flow. Closer falls through to the manual-handoff path if the
 *     payload isn't found (preserves pre-2026-05-02 behavior).
 *   - TTL: 30 days (matches the existing `sample-dispatch:approved:`
 *     queue TTL). Approvals that aren't acted on inside 30 days have
 *     already escalated to a different surface.
 */
import { kv } from "@vercel/kv";

import type {
  DispatchClassification,
  OrderIntent,
} from "@/lib/ops/sample-order-dispatch";

const PAYLOAD_KEY_PREFIX = "sample-dispatch:payload:";
const PAYLOAD_TTL_SECONDS = 30 * 24 * 3600;

export interface DispatchPayload {
  approvalId: string;
  orderIntent: OrderIntent;
  classification: DispatchClassification;
  /** Stable key reference so the closer can correlate to other queues. */
  payloadRef: string;
  persistedAt: string;
}

function payloadKey(approvalId: string): string {
  return `${PAYLOAD_KEY_PREFIX}${approvalId}`;
}

/**
 * Persist the structured dispatch payload under the approval id so the
 * closer can recover it. Returns `{ ok: false, error }` on KV failure
 * — caller should log + degrade, never throw, since the approval card
 * still posts and the manual-handoff fallback still works.
 */
export async function persistDispatchPayload(
  payload: Omit<DispatchPayload, "persistedAt">,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await kv.set(
      payloadKey(payload.approvalId),
      JSON.stringify({ ...payload, persistedAt: new Date().toISOString() }),
      { ex: PAYLOAD_TTL_SECONDS },
    );
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Recall the persisted dispatch payload for an approval. Returns null
 * when the payload is missing (legacy approvals that pre-date this
 * write OR cleared TTL); returns null on KV error too — caller treats
 * a null exactly the same way (fall through to manual-handoff message).
 */
export async function loadDispatchPayload(
  approvalId: string,
): Promise<DispatchPayload | null> {
  let raw: unknown;
  try {
    raw = await kv.get(payloadKey(approvalId));
  } catch {
    return null;
  }
  if (raw == null) return null;
  // @vercel/kv returns the parsed object directly when the value was
  // JSON-encoded by SET. Defensive: handle both string + object.
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as DispatchPayload;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as DispatchPayload;
  return null;
}
