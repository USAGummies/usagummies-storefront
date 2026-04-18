/**
 * Canonical agent write helpers.
 *
 * Every agent goes through these functions; direct calls to `put()` on
 * the store or `postMessage()` on the Slack client are forbidden outside
 * the control plane (see /contracts/governance.md §9). Using these
 * helpers guarantees:
 *
 *   1. The audit store receives a record for every autonomous write.
 *   2. The Slack mirror is best-effort, not load-bearing.
 *   3. Class D is fail-closed.
 *   4. Class B/C requests can never skip the approval queue.
 *
 * Two entry points:
 *   - `record(run, fields)` — for Class A autonomous writes
 *   - `requestApproval(run, params)` — for Class B/C gated writes
 *
 * Blueprint §15.4 T6: "Start posting all agent writes to #ops-audit."
 */

import {
  buildApprovalRequest,
  openApproval,
  ProhibitedActionError,
} from "./approvals";
import { buildAuditEntry } from "./audit";
import { guardAgent } from "./runtime-guard";
import { classify, isProhibited, requiresApproval } from "./taxonomy";
import type {
  ApprovalRequest,
  AuditLogEntry,
  RunContext,
} from "./types";
import { auditStore, approvalStore, pauseSink } from "./stores";
import { auditSurface, approvalSurface } from "./slack";

// ---- Class A: record an autonomous write ---------------------------------

export interface RecordFields {
  actionSlug: string; // MUST be Class A. Fails if the slug is prohibited or requires approval.
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  result: AuditLogEntry["result"];
  /**
   * Citations for the claim embodied by this write. Blueprint non-negotiable
   * #2: every output carries source + timestamp + confidence.
   */
  sourceCitations?: AuditLogEntry["sourceCitations"];
  confidence?: number;
  error?: AuditLogEntry["error"];
}

/**
 * Record an autonomous agent write. Returns the persisted AuditLogEntry.
 *
 * This is the only path autonomous agents use. The audit store append is
 * authoritative; the Slack mirror is best-effort and cannot fail the call.
 */
export async function record(
  run: RunContext,
  fields: RecordFields,
): Promise<AuditLogEntry> {
  const spec = classify(fields.actionSlug);
  if (!spec) {
    throw new Error(
      `record(): action ${fields.actionSlug} is not in the taxonomy. Register it in src/lib/ops/control-plane/taxonomy.ts before the agent may call it.`,
    );
  }
  if (isProhibited(spec)) {
    throw new ProhibitedActionError(fields.actionSlug);
  }
  if (requiresApproval(spec)) {
    throw new Error(
      `record(): action ${fields.actionSlug} is class ${spec.class} (requires approval). Call requestApproval() instead.`,
    );
  }

  // Runtime pause guard. Fails closed with PausedAgentError if the agent
  // is in the PauseSink's paused set or if the sink is unreachable.
  // Writes `runtime.blocked-paused` to the audit store so refusals are
  // observable, not silent. Governance §5.
  await guardAgent(run, { pauseSink: pauseSink(), auditStore: auditStore() });

  const entry = buildAuditEntry(run, {
    action: fields.actionSlug,
    entityType: fields.entityType,
    entityId: fields.entityId,
    before: fields.before,
    after: fields.after,
    result: fields.result,
    sourceCitations: fields.sourceCitations ?? [],
    confidence: fields.confidence,
    error: fields.error,
  });

  // Authoritative: audit store append must succeed.
  await auditStore().append(entry);

  // Best-effort: Slack mirror is not load-bearing. A failure here is
  // logged but does not invalidate the persisted audit record.
  try {
    await auditSurface().mirror(entry);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      "[control-plane] audit Slack mirror failed (degraded mode acceptable):",
      err instanceof Error ? err.message : String(err),
    );
  }

  return entry;
}

// ---- Class B/C: request approval -----------------------------------------

export type RequestApprovalParams = Omit<
  Parameters<typeof buildApprovalRequest>[0],
  "runId" | "division" | "actorAgentId" | "now"
>;

/**
 * Open a Class B or Class C approval request.
 *
 * The approval store write is authoritative. The Slack surface post is
 * best-effort; surface failures are retried by the dispatcher. Class D and
 * unknown actions fail-closed via buildApprovalRequest.
 *
 * Returns the persisted ApprovalRequest (with slackThread populated if the
 * surface call succeeded). The action itself is NOT executed yet — it
 * executes after the approvers decide.
 */
export async function requestApproval(
  run: RunContext,
  params: RequestApprovalParams,
): Promise<ApprovalRequest> {
  // Guard first — a paused agent cannot open new approvals either.
  // Approvals already in flight proceed normally (they were validated
  // when opened). Only NEW requests are blocked.
  await guardAgent(run, { pauseSink: pauseSink(), auditStore: auditStore() });

  const approval = await openApproval(approvalStore(), approvalSurface(), {
    ...params,
    runId: run.runId,
    division: run.division,
    actorAgentId: run.agentId,
  });

  // Also record the approval-open event in the audit log so there is a
  // single stream of truth across autonomous actions and gated proposals.
  await auditStore().append(
    buildAuditEntry(run, {
      action: `approval.open:${params.actionSlug}`,
      entityType: "approval",
      entityId: approval.id,
      result: "ok",
      approvalId: approval.id,
      sourceCitations: approval.evidence.sources.map((s) => ({
        system: s.system,
        id: s.id,
        url: s.url,
      })),
      confidence: approval.evidence.confidence,
    }),
  );

  return approval;
}
