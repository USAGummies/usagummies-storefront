export const HEARTBEAT_OUTPUT_STATES = Object.freeze([
  "no_action",
  "drafted",
  "task_created",
  "approval_requested",
  "blocked_missing_data",
  "failed_degraded",
  "expired",
  "escalated",
] as const);

export type HeartbeatOutputState = (typeof HEARTBEAT_OUTPUT_STATES)[number];

export type HeartbeatCadence =
  | { type: "manual" }
  | { type: "cron"; rrule: string }
  | { type: "event"; eventName: string };

export interface HeartbeatBudget {
  monthlyUsdLimit: number | null;
  maxRunsPerDay: number | null;
}

export interface AgentHeartbeatContract {
  agentId: string;
  division: string;
  owner: string;
  queue: {
    source: string;
    description: string;
  };
  cadence: HeartbeatCadence;
  allowedApprovalSlugs: string[];
  prohibitedActions: string[];
  memoryReads: string[];
  memoryWrites: string[];
  budget: HeartbeatBudget;
  escalation: string;
}

export interface HeartbeatQueueClaim {
  queueItemId: string;
  idempotencyKey: string;
}

export interface AgentHeartbeatContext {
  runId: string;
  startedAt: string;
  contract: AgentHeartbeatContract;
  claim: HeartbeatQueueClaim | null;
  doctrineRefs: string[];
  degradedSources: string[];
}

export interface AgentHeartbeatRunRecord {
  runId: string;
  agentId: string;
  division: string;
  owner: string;
  startedAt: string;
  finishedAt: string;
  outputState: HeartbeatOutputState;
  queueItemId: string | null;
  idempotencyKey: string | null;
  approvalSlugsRequested: string[];
  summary: string;
  degradedSources: string[];
  nextHumanAction: string | null;
}
