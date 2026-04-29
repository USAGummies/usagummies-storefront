/**
 * Approval-Expiry Sweeper — P0-5 from `/contracts/agent-architecture-audit.md`.
 *
 * Implements the §15.3 Rule #2 in `/contracts/approval-taxonomy.md`:
 *
 *   "Escalation: pending → auto-tag Ben at 24h → auto-expire at 72h."
 *
 * The pure transitions live in `approvals.ts` (`shouldEscalate()`,
 * `checkExpiry()`). This module is the SWEEPER that runs them across
 * the live pending queue on a schedule and persists state changes.
 *
 * **Class A only.** The sweeper:
 *   - reads pending approvals,
 *   - marks 72h+ approvals as `expired` (already-allowed terminal
 *     state per `ApprovalStatus`),
 *   - records 24h+ pending approvals as escalation candidates (no
 *     state change — escalation is a notification, not a transition),
 *   - emits audit envelopes for each action,
 *   - returns a structured `SweepReport`.
 *
 * The sweeper NEVER:
 *   - executes the underlying Class B/C action (the agent re-initiates
 *     the request after expiry per blueprint §5.2),
 *   - sends a customer-facing email,
 *   - moves a HubSpot deal stage,
 *   - writes to QBO / Shopify / Plaid / inventory,
 *   - modifies permissions, secrets, or settings.
 *
 * Drew-owns-nothing: the sweeper inspects `requiredApprovers[]` and
 * surfaces it as-is in audit envelopes; tests assert no synthetic
 * approval is created with Drew as approver and the sweeper itself
 * never selects Drew as a tag/escalation target.
 *
 * Fail-closed on unknown action slugs: each pending approval's
 * `action` resolves to a registered taxonomy slug via `classify()`;
 * an approval whose slug fails to resolve is left untouched and
 * surfaced in `failClosed[]` for human review (the sweeper does NOT
 * silently expire it — that would lose information).
 */

import type {
  ApprovalRequest,
  RunContext,
} from "@/lib/ops/control-plane/types";
import type { AuditStore, AuditSlackSurface } from "@/lib/ops/control-plane/audit";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import {
  type ApprovalStore,
  __internal as approvalsInternal,
  checkExpiry,
  shouldEscalate,
} from "@/lib/ops/control-plane/approvals";
import { ACTION_REGISTRY, classify } from "@/lib/ops/control-plane/taxonomy";
import { newRunContext } from "@/lib/ops/control-plane/run-id";

const AGENT_ID = "approval-expiry-sweeper";

/**
 * Per-finding payload. Same fingerprint shape (id) makes downstream
 * dedupe straightforward — repeated runs over the same pending
 * approval produce the same finding id within a 1h sweep cadence.
 */
export interface ExpiredFinding {
  approvalId: string;
  runId: string;
  action: string;
  actorAgentId: string;
  division: ApprovalRequest["division"];
  class: ApprovalRequest["class"];
  requiredApprovers: ApprovalRequest["requiredApprovers"];
  createdAt: string;
  expiresAt: string;
}

export interface EscalatedFinding {
  approvalId: string;
  runId: string;
  action: string;
  actorAgentId: string;
  division: ApprovalRequest["division"];
  class: ApprovalRequest["class"];
  requiredApprovers: ApprovalRequest["requiredApprovers"];
  createdAt: string;
  escalateAt: string;
  hoursPending: number;
}

export interface FailClosedFinding {
  approvalId: string;
  action: string;
  reason: string;
}

export interface SweepReport {
  ok: true;
  generatedAt: string;
  scanned: number;
  expired: ExpiredFinding[];
  escalated: EscalatedFinding[];
  failClosed: FailClosedFinding[];
  /** Pending requests that are still within both windows (not yet 24h). */
  untouched: number;
  /** Stable run id for the sweep itself — every finding's `runId` (the
   * approval's parent run) is preserved for cross-reference. */
  sweepRunId: string;
}

export interface RunSweepDeps {
  /** Approval store. Defaults to factory-backed singleton in production. */
  approvalStore: ApprovalStore;
  /**
   * Audit store. Optional — when omitted, the sweeper still runs but
   * emits no envelopes. Production callers MUST pass the factory-backed
   * store so every state change is observable per the no-silent-action
   * rule (`/contracts/operating-memory.md` §"Hard rules" #5).
   */
  auditStore?: AuditStore;
  /**
   * Best-effort Slack mirror. Audit-store write is authoritative; a
   * Slack failure is swallowed.
   */
  auditSurface?: AuditSlackSurface | null;
  /** Clock injection for deterministic tests. */
  now?: () => Date;
  /** Optional run-context override. */
  run?: RunContext;
}

/**
 * Run one sweep over the pending-approval queue.
 *
 * Behavior:
 *   1. Read all pending approvals from the store.
 *   2. For each:
 *      a. Resolve the action slug against `taxonomy.classify()`. If
 *         unknown → fail-closed: leave status pending, record in
 *         `failClosed[]`, emit a `approval.sweep.fail-closed` audit
 *         envelope, MOVE ON.
 *      b. If `checkExpiry()` returns the request mutated to
 *         `expired`, persist via `store.put()` AND emit
 *         `approval.sweep.expire` audit envelope.
 *      c. Else if `shouldEscalate()` returns true, record an
 *         escalation finding AND emit `approval.sweep.escalate`
 *         audit envelope. State stays `pending` — escalation is a
 *         notification, not a transition.
 *      d. Else: still within 24h window → untouched.
 *   3. Return the structured report.
 *
 * The function is idempotent: running it twice over the same store
 * state on the same clock produces:
 *   - same `expired[]` (the second run sees the requests are already
 *     `expired`, not `pending`, and `listPending()` won't return them).
 *   - same `escalated[]` (still `pending`, still past `escalateAt`).
 *   - same `failClosed[]`.
 *
 * Repeated escalations across sweeps are by design — the audit envelope
 * carries `hoursPending`, so downstream consumers can dedupe at their
 * own cadence.
 */
export async function runApprovalExpirySweep(
  deps: RunSweepDeps,
): Promise<SweepReport> {
  const now = (deps.now ?? (() => new Date()))();
  const generatedAt = now.toISOString();
  const run =
    deps.run ??
    newRunContext({
      agentId: AGENT_ID,
      division: "executive-control",
      source: "scheduled",
      trigger: "approval-expiry-sweep",
    });

  const pending = await deps.approvalStore.listPending();

  const expired: ExpiredFinding[] = [];
  const escalated: EscalatedFinding[] = [];
  const failClosed: FailClosedFinding[] = [];
  let untouched = 0;

  for (const req of pending) {
    // ---- Fail-closed on unknown action slug -----------------------
    const spec = classify(req.action) ??
      // Approval requests store `action` as the action's NAME (per
      // buildApprovalRequest), not the slug. The taxonomy doesn't
      // index by name; instead we fall back to inferring the slug
      // from the targetSystem. This is best-effort: if we can't
      // resolve, fail closed.
      classifyByGuessedSlug(req);
    if (!spec) {
      failClosed.push({
        approvalId: req.id,
        action: req.action,
        reason:
          `Could not resolve approval.action="${req.action}" to a registered taxonomy slug. ` +
          `Fail-closed: leaving request pending. Register the slug or rewrite the request.`,
      });
      await emit(deps, run, now, {
        action: "approval.sweep.fail-closed",
        entityType: "approval",
        entityId: req.id,
        result: "skipped",
        after: {
          actorAgentId: req.actorAgentId,
          requiredApprovers: req.requiredApprovers,
          reason: "unknown-action-slug",
        },
      });
      continue;
    }

    // ---- Expire ---------------------------------------------------
    const maybeExpired = checkExpiry(req, now);
    if (maybeExpired.status === "expired" && req.status === "pending") {
      // Persist the new terminal state. NEVER triggers the underlying
      // Class B/C action — `expired` is a no-action terminal state.
      await deps.approvalStore.put(maybeExpired);
      expired.push({
        approvalId: req.id,
        runId: req.runId,
        action: req.action,
        actorAgentId: req.actorAgentId,
        division: req.division,
        class: req.class,
        requiredApprovers: req.requiredApprovers,
        createdAt: req.createdAt,
        expiresAt: req.expiresAt,
      });
      await emit(deps, run, now, {
        action: "approval.sweep.expire",
        entityType: "approval",
        entityId: req.id,
        before: { status: "pending" },
        after: { status: "expired" },
        result: "ok",
        sourceCitations: [{ system: "approval-store", id: req.id }],
      });
      continue;
    }

    // ---- Escalate -------------------------------------------------
    if (shouldEscalate(req, now)) {
      const hoursPending =
        (now.getTime() - new Date(req.createdAt).getTime()) / 3_600_000;
      escalated.push({
        approvalId: req.id,
        runId: req.runId,
        action: req.action,
        actorAgentId: req.actorAgentId,
        division: req.division,
        class: req.class,
        requiredApprovers: req.requiredApprovers,
        createdAt: req.createdAt,
        escalateAt: req.escalateAt,
        hoursPending: Math.round(hoursPending * 10) / 10,
      });
      await emit(deps, run, now, {
        action: "approval.sweep.escalate",
        entityType: "approval",
        entityId: req.id,
        result: "ok",
        after: {
          status: "pending",
          requiredApprovers: req.requiredApprovers,
          hoursPending: Math.round(hoursPending * 10) / 10,
          // Drew-owns-nothing: the escalation surface tag is always
          // Ben (the canonical escalation per blueprint §5.2),
          // regardless of who the original approver(s) were.
          escalationTag: "Ben",
        },
        sourceCitations: [{ system: "approval-store", id: req.id }],
      });
      continue;
    }

    // ---- Untouched (still within 24h) -----------------------------
    untouched += 1;
  }

  return {
    ok: true,
    generatedAt,
    scanned: pending.length,
    expired,
    escalated,
    failClosed,
    untouched,
    sweepRunId: run.runId,
  };
}

/**
 * Emit an audit envelope. Pure-best-effort Slack mirror — failures
 * never abort the sweep.
 */
async function emit(
  deps: RunSweepDeps,
  run: RunContext,
  now: Date,
  fields: Parameters<typeof buildAuditEntry>[1],
): Promise<void> {
  if (!deps.auditStore) return;
  const entry = buildAuditEntry(run, fields, now);
  await deps.auditStore.append(entry);
  if (deps.auditSurface) {
    try {
      await deps.auditSurface.mirror(entry);
    } catch {
      // best-effort mirror
    }
  }
}

/**
 * Approval requests store `action` as the action NAME (e.g. "Send outreach
 * email") rather than the slug (e.g. "gmail.send"). The taxonomy is
 * indexed by slug. To fail-closed correctly, try common slug shapes
 * derived from `targetSystem` + a few canonical verb combos. If nothing
 * matches, return undefined and let the caller mark the request
 * fail-closed.
 */
function classifyByGuessedSlug(req: ApprovalRequest):
  | ReturnType<typeof classify>
  | undefined {
  // The taxonomy lists each slug's `name`; build a one-shot index from
  // name → spec on first call.
  const byName = nameIndex();
  return byName.get(req.action.trim());
}

let _nameIndex: Map<string, ReturnType<typeof classify>> | null = null;
function nameIndex(): Map<string, ReturnType<typeof classify>> {
  if (_nameIndex) return _nameIndex;
  const map = new Map<string, ReturnType<typeof classify>>();
  for (const spec of ACTION_REGISTRY) {
    map.set(spec.name, spec);
  }
  _nameIndex = map;
  return _nameIndex;
}

/** Exposed for tests. */
export const __INTERNAL = {
  AGENT_ID,
  ESCALATE_AFTER_HOURS: approvalsInternal.ESCALATE_AFTER_HOURS,
  EXPIRE_AFTER_HOURS: approvalsInternal.EXPIRE_AFTER_HOURS,
  classifyByGuessedSlug,
  resetNameIndexForTest: () => {
    _nameIndex = null;
  },
};

/** Default export kept as `{}` for any legacy import compatibility. */
export default {};
