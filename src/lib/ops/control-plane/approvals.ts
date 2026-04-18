/**
 * Approval state machine — §15.3 and §5.2 of the canonical blueprint.
 *
 *   draft → pending → approved | rejected | stood-down | expired
 *
 *   Escalation: if `pending` and escalateAt has passed without a decision,
 *   the runtime re-pings the approver and tags Ben. If expiresAt passes,
 *   the request auto-expires and the agent must re-initiate.
 *
 * This module defines pure state transitions and a storage adapter
 * interface. The persistence and Slack-surfacing layers plug in via
 * ApprovalStore. Nothing here talks to Slack, KV, or Postgres directly.
 */

import { randomUUID } from "node:crypto";

import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalStatus,
  ChannelId,
  Division,
  DivisionId,
  HumanOwner,
} from "./types";
import { classify, isProhibited, requiresApproval, type ActionSpec } from "./taxonomy";

// ----- Errors ----------------------------------------------------------

export class ProhibitedActionError extends Error {
  constructor(action: string) {
    super(`Action ${action} is class D (Red-Line). Agents may not request or execute it.`);
    this.name = "ProhibitedActionError";
  }
}

export class UnknownActionError extends Error {
  constructor(action: string) {
    super(`Action ${action} is not registered in the taxonomy. Fail-closed: register it in taxonomy.ts before the agent may use it.`);
    this.name = "UnknownActionError";
  }
}

export class InvalidTransitionError extends Error {
  constructor(from: ApprovalStatus, to: ApprovalStatus) {
    super(`Invalid approval state transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

// ----- Windows (blueprint §5.2) ----------------------------------------

const ESCALATE_AFTER_HOURS = 24;
const EXPIRE_AFTER_HOURS = 72;

function hoursFromNow(h: number, ref: Date = new Date()): string {
  const t = new Date(ref.getTime() + h * 3_600_000);
  return t.toISOString();
}

// ----- Storage adapter -------------------------------------------------

/**
 * The control plane is storage-agnostic. The real adapter will be backed by
 * Postgres (or Vercel KV until Postgres is wired). See README.md TODO.
 */
export interface ApprovalStore {
  put(request: ApprovalRequest): Promise<void>;
  get(id: string): Promise<ApprovalRequest | null>;
  listPending(): Promise<ApprovalRequest[]>;
  listByAgent(agentId: string, limit?: number): Promise<ApprovalRequest[]>;
}

/**
 * Slack surface adapter. When an approval is created, the control plane
 * calls this to post to #ops-approvals and record the thread ts.
 *
 * TODO: wire to real Slack client — see src/lib/ops/control-plane/README.md
 */
export interface ApprovalSlackSurface {
  surfaceApproval(request: ApprovalRequest): Promise<{ channel: ChannelId; ts: string }>;
  updateApproval(request: ApprovalRequest): Promise<void>;
}

// ----- Pure transitions ------------------------------------------------

/**
 * Build a fresh ApprovalRequest. Validates the action against the taxonomy
 * before the request ever enters the queue.
 */
export function buildApprovalRequest(params: {
  actionSlug: string;
  runId: string;
  division: DivisionId;
  actorAgentId: string;
  targetSystem: string;
  targetEntity?: ApprovalRequest["targetEntity"];
  payloadPreview: string;
  payloadRef?: string;
  evidence: ApprovalRequest["evidence"];
  rollbackPlan: string;
  /** Override the taxonomy's default approver list (only for Class B/C). */
  requiredApprovers?: HumanOwner[];
  now?: Date;
}): ApprovalRequest {
  const spec = classify(params.actionSlug);
  if (!spec) throw new UnknownActionError(params.actionSlug);
  if (isProhibited(spec)) throw new ProhibitedActionError(params.actionSlug);
  if (!requiresApproval(spec)) {
    throw new Error(
      `Action ${params.actionSlug} is class ${spec.class} (autonomous). Do not create an approval request; execute directly and log to #ops-audit.`,
    );
  }

  const now = params.now ?? new Date();
  const approvers = params.requiredApprovers ?? spec.requiredApprovers;
  if (!approvers || approvers.length === 0) {
    throw new Error(
      `Action ${params.actionSlug} requires approvers but none were resolved from taxonomy or override.`,
    );
  }
  if (spec.class === "C" && approvers.length < 2) {
    throw new Error(
      `Action ${params.actionSlug} is class C (dual approval) but only ${approvers.length} approver(s) supplied.`,
    );
  }

  return {
    id: randomUUID(),
    runId: params.runId,
    division: params.division,
    actorAgentId: params.actorAgentId,
    class: spec.class as "B" | "C",
    action: spec.name,
    targetSystem: params.targetSystem,
    targetEntity: params.targetEntity,
    payloadPreview: params.payloadPreview,
    payloadRef: params.payloadRef,
    evidence: params.evidence,
    rollbackPlan: params.rollbackPlan,
    requiredApprovers: approvers,
    status: "pending",
    createdAt: now.toISOString(),
    decisions: [],
    escalateAt: hoursFromNow(ESCALATE_AFTER_HOURS, now),
    expiresAt: hoursFromNow(EXPIRE_AFTER_HOURS, now),
  };
}

/**
 * Apply a decision from one approver. Returns the updated request.
 *
 * Class B: first `approve` → status=approved; first `reject` → status=rejected.
 * Class C: both approvers must approve; one reject → status=rejected.
 */
export function applyDecision(
  request: ApprovalRequest,
  decision: Omit<ApprovalDecision, "decidedAt">,
  now: Date = new Date(),
): ApprovalRequest {
  if (request.status !== "pending") {
    throw new InvalidTransitionError(request.status, "approved");
  }
  if (!request.requiredApprovers.includes(decision.approver)) {
    throw new Error(
      `${decision.approver} is not in requiredApprovers for approval ${request.id}: [${request.requiredApprovers.join(", ")}]`,
    );
  }
  // `ask` is a non-terminal clarification state — an approver may ask any number
  // of times, then later submit a real approve/reject. Only duplicate terminal
  // decisions (approve/reject) from the same approver are blocked.
  const existingTerminal = request.decisions.find(
    (d) => d.approver === decision.approver && d.decision !== "ask",
  );
  if (existingTerminal) {
    throw new Error(
      `${decision.approver} has already recorded a ${existingTerminal.decision} on ${request.id}.`,
    );
  }

  const decisions: ApprovalDecision[] = [
    ...request.decisions,
    { ...decision, decidedAt: now.toISOString() },
  ];

  let status: ApprovalStatus = request.status;
  if (decision.decision === "reject") {
    status = "rejected";
  } else if (decision.decision === "approve") {
    const approvals = decisions.filter((d) => d.decision === "approve").length;
    const needed = request.class === "C" ? 2 : 1;
    if (approvals >= needed) status = "approved";
  }
  // "ask" leaves status pending; agent draft or approver clarifies in thread.

  return { ...request, decisions, status };
}

/**
 * Agent/system withdraws the request (e.g. upstream conditions changed).
 *
 * Recorded as a stand-down event on the request itself, NOT as a human
 * rejection. The audit trail must remain truthful: forging a human
 * "reject" from "Ben" for a decision Ben did not make corrupts both the
 * audit trail and the graduation metrics that count human corrections.
 *
 * Downstream consumers distinguish `status: "stood-down"` + `standDown`
 * metadata from `status: "rejected"` + a real decision in `decisions[]`.
 */
export function standDown(
  request: ApprovalRequest,
  reason: string,
  now: Date = new Date(),
  byAgentId: string = request.actorAgentId,
): ApprovalRequest {
  if (request.status !== "pending") throw new InvalidTransitionError(request.status, "stood-down");
  return {
    ...request,
    status: "stood-down",
    standDown: {
      reason,
      byAgentId,
      at: now.toISOString(),
    },
  };
}

/** Check-expire: called by the dispatcher on every sweep. */
export function checkExpiry(request: ApprovalRequest, now: Date = new Date()): ApprovalRequest {
  if (request.status !== "pending") return request;
  if (new Date(request.expiresAt).getTime() <= now.getTime()) {
    return { ...request, status: "expired" };
  }
  return request;
}

/** Should the dispatcher escalate to Ben now? */
export function shouldEscalate(request: ApprovalRequest, now: Date = new Date()): boolean {
  if (request.status !== "pending") return false;
  return new Date(request.escalateAt).getTime() <= now.getTime();
}

// ----- High-level orchestration (light, stateless) ---------------------

/**
 * Create + surface a new approval in one call. The store is updated
 * before the Slack post so the canonical record exists even if Slack fails.
 */
export async function openApproval(
  store: ApprovalStore,
  surface: ApprovalSlackSurface,
  params: Parameters<typeof buildApprovalRequest>[0],
): Promise<ApprovalRequest> {
  const request = buildApprovalRequest(params);
  await store.put(request);
  try {
    const slackThread = await surface.surfaceApproval(request);
    const withThread = { ...request, slackThread };
    await store.put(withThread);
    return withThread;
  } catch (err) {
    // Surface failure does NOT invalidate the request; the dispatcher will retry.
    return request;
  }
}

/** Record a decision and persist. Returns the updated request. */
export async function recordDecision(
  store: ApprovalStore,
  surface: ApprovalSlackSurface,
  id: string,
  decision: Omit<ApprovalDecision, "decidedAt">,
): Promise<ApprovalRequest> {
  const current = await store.get(id);
  if (!current) throw new Error(`Approval ${id} not found.`);
  const next = applyDecision(current, decision);
  await store.put(next);
  await surface.updateApproval(next).catch(() => {
    // Slack update failure is non-fatal; persisted state is canonical.
  });
  return next;
}

/** Export for tests and fixtures. */
export const __internal = { hoursFromNow, ESCALATE_AFTER_HOURS, EXPIRE_AFTER_HOURS };

/** Re-export ActionSpec so consumers don't have to import taxonomy directly for types. */
export type { ActionSpec };
