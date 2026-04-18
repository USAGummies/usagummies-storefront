/**
 * Runtime pause guard.
 *
 * Every agent entrypoint must call `guardAgent(run)` (or use
 * `runWithGuard`) before doing any side-effectful work. If the agent is
 * in the PauseSink's paused set — typically because the weekly drift
 * audit auto-paused it for ≥2 violations — the guard fails closed with
 * `PausedAgentError` and writes a `runtime.blocked-paused` audit entry
 * so the refusal is itself observable.
 *
 * Insertion points (existing + planned):
 *   - src/lib/ops/control-plane/record.ts: record() + requestApproval()
 *     call the guard before any store append / approval queue.
 *   - src/app/api/slack/approvals/route.ts: guard is unnecessary — the
 *     route logs the Slack user's decision, not an agent action. The
 *     underlying agent that opened the approval already passed the
 *     guard when the approval was requested.
 *   - Any future scheduled agent runner (cron handler, QStash consumer,
 *     local /loop driver) MUST call guardAgent at the top of its tick
 *     before dispatching to the agent's prompt or tool calls. If a
 *     runner ships without the guard, CI review should reject it.
 *
 * Blueprint: /contracts/governance.md §5 (weekly drift audit auto-pause)
 * + §6 (correction protocol).
 */

import type { AuditStore } from "./audit";
import type { PauseSink } from "./enforcement";
import type { RunContext } from "./types";
import { buildAuditEntry } from "./audit";

export class PausedAgentError extends Error {
  public readonly agentId: string;
  public readonly runId: string;

  constructor(agentId: string, runId: string) {
    super(
      `Agent ${agentId} is paused. Resolve via /contracts/governance.md §5 ` +
        `(Ben reviews, unpauses with reason). run_id=${runId}`,
    );
    this.name = "PausedAgentError";
    this.agentId = agentId;
    this.runId = runId;
  }
}

export interface GuardDeps {
  /** Queried first. Required. */
  pauseSink: PauseSink;
  /**
   * Audit store — used to record the blocked-by-pause event.
   * Optional so tests can elide it, but production callers MUST pass the
   * factory-backed store so every refusal lands in #ops-audit.
   */
  auditStore?: AuditStore;
}

/**
 * Throws PausedAgentError if the agent is paused. Otherwise returns.
 * Records a `runtime.blocked-paused` audit entry on refusal — the block
 * must itself be observable in the audit trail, not silent.
 */
export async function guardAgent(run: RunContext, deps: GuardDeps): Promise<void> {
  let paused = false;
  try {
    paused = await deps.pauseSink.isPaused(run.agentId);
  } catch (err) {
    // Fail closed: if we cannot verify pause state, assume paused rather
    // than silently running an agent that might have been auto-paused
    // during a prior drift audit and missed. The error carries the
    // underlying cause so operators can see why.
    const message = err instanceof Error ? err.message : String(err);
    const wrapped = new PausedAgentError(
      run.agentId,
      run.runId,
    );
    wrapped.message = `${wrapped.message} (fail-closed: pause-sink unavailable: ${message})`;
    await tryAuditBlocked(run, deps.auditStore, {
      reason: "pause-sink-unavailable",
      detail: message,
    });
    throw wrapped;
  }

  if (paused) {
    await tryAuditBlocked(run, deps.auditStore, {
      reason: "agent-paused",
      detail: `agent ${run.agentId} is in the PauseSink`,
    });
    throw new PausedAgentError(run.agentId, run.runId);
  }
}

/**
 * Convenience wrapper: run `fn()` only if the guard passes. Propagates
 * PausedAgentError (or any error `fn` throws). Use when an agent
 * entrypoint already has a natural function boundary around its work.
 */
export async function runWithGuard<T>(
  run: RunContext,
  deps: GuardDeps,
  fn: () => Promise<T>,
): Promise<T> {
  await guardAgent(run, deps);
  return fn();
}

async function tryAuditBlocked(
  run: RunContext,
  auditStore: AuditStore | undefined,
  details: { reason: string; detail: string },
): Promise<void> {
  if (!auditStore) return;
  try {
    const entry = buildAuditEntry(run, {
      action: "runtime.blocked-paused",
      entityType: "agent",
      entityId: run.agentId,
      after: {
        reason: details.reason,
        detail: details.detail,
      },
      result: "skipped",
      sourceCitations: [{ system: "runtime-guard" }],
    });
    await auditStore.append(entry);
  } catch {
    // Audit append failing is non-fatal for the guard decision itself —
    // the caller will still get PausedAgentError — but it does mean the
    // refusal won't show up in #ops-audit for this invocation. That is
    // a degraded-mode event and is captured by the health endpoint's
    // audit-store health check, not here.
  }
}
