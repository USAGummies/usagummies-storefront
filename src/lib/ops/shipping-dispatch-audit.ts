/**
 * Audit emission for shipping-dispatch state transitions.
 *
 * Phase 28e: every `markDispatched` / `clearDispatched` writes an
 * audit envelope to `auditStore()` so the operator dashboard (and any
 * future drift audit) can reconstruct who marked what and when, with
 * `before` / `after` timestamps for re-marks.
 *
 * Action slugs:
 *   - `shipping.dispatch.mark`   — dispatchedAt stamped (first-time
 *                                  mark OR re-mark; `before` is null
 *                                  on first-time, prior ISO on re-mark)
 *   - `shipping.dispatch.clear`  — dispatchedAt nulled
 *
 * Surface tag (`source`) distinguishes the two entry points:
 *   - "slack-reaction"    — `:white_check_mark:` reaction in `#shipping`
 *   - "ops-dashboard"     — POST /api/ops/shipping/mark-dispatched
 *
 * Fail-soft: an audit-store failure NEVER propagates back to the
 * caller. The dispatch state flip is the source of truth; the audit
 * trail is downstream observability.
 */
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditStore } from "@/lib/ops/control-plane/stores";

export type DispatchAuditAction =
  | "shipping.dispatch.mark"
  | "shipping.dispatch.clear";

export type DispatchAuditSurface = "slack-reaction" | "ops-dashboard";

export interface DispatchAuditInput {
  action: DispatchAuditAction;
  surface: DispatchAuditSurface;
  /** Source channel ("amazon", "shopify", "manual", "faire"). */
  source: string;
  orderNumber: string;
  /** Operator id ("U…" Slack user id, "ops-dashboard" sentinel, etc.). */
  actorRef: string | null;
  /** ISO before-stamp; null on first-time mark or pure clears. */
  before: string | null;
  /** ISO after-stamp; null on clears. */
  after: string | null;
  /** True when this transition resulted in a Slack thread reply. */
  postedThreadReply?: boolean;
}

/**
 * Emit a dispatch audit entry. Returns ok/error result for tests, but
 * callers MUST NOT branch on it — fail-soft semantics.
 */
export async function recordDispatchAudit(
  input: DispatchAuditInput,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const run = newRunContext({
      agentId:
        input.surface === "slack-reaction"
          ? "shipping-dispatch-reaction"
          : "shipping-dispatch-dashboard",
      division: "production-supply-chain",
      source: input.surface === "slack-reaction" ? "event" : "human-invoked",
      trigger: `shipping:dispatch:${input.action}:${input.surface}`,
    });
    const entry = buildAuditEntry(run, {
      action: input.action,
      entityType: "shipping.shipment",
      entityId: `${input.source}:${input.orderNumber}`,
      before: input.before === null ? null : { dispatchedAt: input.before },
      after:
        input.after === null
          ? { dispatchedAt: null }
          : {
              dispatchedAt: input.after,
              dispatchedBy: input.actorRef,
              surface: input.surface,
              postedThreadReply: input.postedThreadReply ?? false,
            },
      result: "ok",
      sourceCitations: [{ system: input.source, id: input.orderNumber }],
      confidence: 1,
    });
    await auditStore().append(entry);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
