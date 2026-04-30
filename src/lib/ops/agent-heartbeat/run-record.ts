import {
  HEARTBEAT_OUTPUT_STATES,
  type AgentHeartbeatContext,
  type AgentHeartbeatRunRecord,
  type HeartbeatOutputState,
} from "./types";

export interface CompleteHeartbeatRunOptions {
  context: AgentHeartbeatContext;
  finishedAt: Date;
  outputState: string;
  summary: string;
  approvalSlugsRequested?: string[];
  nextHumanAction?: string | null;
}

export function isHeartbeatOutputState(value: string): value is HeartbeatOutputState {
  return HEARTBEAT_OUTPUT_STATES.includes(value as HeartbeatOutputState);
}

export function completeHeartbeatRun(
  options: CompleteHeartbeatRunOptions,
): AgentHeartbeatRunRecord {
  if (!isHeartbeatOutputState(options.outputState)) {
    throw new Error(`heartbeat_output_state_invalid:${options.outputState}`);
  }
  const summary = options.summary.trim();
  if (!summary) throw new Error("heartbeat_summary_required");

  return {
    runId: options.context.runId,
    agentId: options.context.contract.agentId,
    division: options.context.contract.division,
    owner: options.context.contract.owner,
    startedAt: options.context.startedAt,
    finishedAt: options.finishedAt.toISOString(),
    outputState: options.outputState,
    queueItemId: options.context.claim?.queueItemId ?? null,
    idempotencyKey: options.context.claim?.idempotencyKey ?? null,
    approvalSlugsRequested: normalizeAllowedApprovalSlugs(
      options.approvalSlugsRequested ?? [],
      options.context.contract.allowedApprovalSlugs,
    ),
    summary,
    degradedSources: [...options.context.degradedSources],
    nextHumanAction: normalizeNullableString(options.nextHumanAction ?? null),
  };
}

function normalizeAllowedApprovalSlugs(
  requested: readonly string[],
  allowed: readonly string[],
): string[] {
  const allowedSet = new Set(allowed);
  const normalized = Array.from(
    new Set(requested.map((slug) => slug.trim()).filter(Boolean)),
  );
  const denied = normalized.filter((slug) => !allowedSet.has(slug));
  if (denied.length > 0) {
    throw new Error(`heartbeat_approval_slug_not_allowed:${denied.join(",")}`);
  }
  return normalized;
}

function normalizeNullableString(value: string | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}
