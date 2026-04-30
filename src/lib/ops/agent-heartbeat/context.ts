import type {
  AgentHeartbeatContext,
  AgentHeartbeatContract,
  HeartbeatQueueClaim,
} from "./types";

export interface BuildHeartbeatContextOptions {
  now: Date;
  runId: string;
  contract: AgentHeartbeatContract;
  claim?: HeartbeatQueueClaim | null;
  doctrineRefs?: string[];
  degradedSources?: string[];
}

export function buildHeartbeatContext(
  options: BuildHeartbeatContextOptions,
): AgentHeartbeatContext {
  return {
    runId: requireNonBlank(options.runId, "runId"),
    startedAt: options.now.toISOString(),
    contract: normalizeContract(options.contract),
    claim: normalizeClaim(options.claim ?? null),
    doctrineRefs: normalizeStringList(options.doctrineRefs ?? []),
    degradedSources: normalizeStringList(options.degradedSources ?? []),
  };
}

export function heartbeatIdempotencyKey(input: {
  agentId: string;
  queueSource: string;
  queueItemId: string;
}): string {
  const agentId = slugPart(input.agentId);
  const queueSource = slugPart(input.queueSource);
  const queueItemId = slugPart(input.queueItemId);
  return `${agentId}:${queueSource}:${queueItemId}`;
}

function normalizeContract(contract: AgentHeartbeatContract): AgentHeartbeatContract {
  return {
    ...contract,
    agentId: requireNonBlank(contract.agentId, "agentId"),
    division: requireNonBlank(contract.division, "division"),
    owner: requireNonBlank(contract.owner, "owner"),
    queue: {
      source: requireNonBlank(contract.queue?.source, "queue.source"),
      description: requireNonBlank(contract.queue?.description, "queue.description"),
    },
    allowedApprovalSlugs: normalizeStringList(contract.allowedApprovalSlugs),
    prohibitedActions: normalizeStringList(contract.prohibitedActions),
    memoryReads: normalizeStringList(contract.memoryReads),
    memoryWrites: normalizeStringList(contract.memoryWrites),
    escalation: requireNonBlank(contract.escalation, "escalation"),
    budget: {
      monthlyUsdLimit: normalizeNullableNonNegative(contract.budget.monthlyUsdLimit),
      maxRunsPerDay: normalizeNullableNonNegative(contract.budget.maxRunsPerDay),
    },
  };
}

function normalizeClaim(
  claim: HeartbeatQueueClaim | null,
): HeartbeatQueueClaim | null {
  if (!claim) return null;
  return {
    queueItemId: requireNonBlank(claim.queueItemId, "queueItemId"),
    idempotencyKey: requireNonBlank(claim.idempotencyKey, "idempotencyKey"),
  };
}

function normalizeStringList(values: readonly string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  );
}

function normalizeNullableNonNegative(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function requireNonBlank(value: string | undefined, field: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) throw new Error(`heartbeat_contract_invalid:${field}`);
  return trimmed;
}

function slugPart(value: string): string {
  return requireNonBlank(value, "idempotency-part")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
