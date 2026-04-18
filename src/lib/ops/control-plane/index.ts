/**
 * USA Gummies 3.0 — Control Plane
 *
 * Entry point. Import from `@/lib/ops/control-plane` only; do not reach
 * into submodules outside of tests.
 *
 * Canonical spec: Notion page "USA GUMMIES 3.0 — RESEARCH BLUEPRINT" §15.
 */

export type {
  ApprovalClass,
  ApprovalDecision,
  ApprovalEvidence,
  ApprovalRequest,
  ApprovalStatus,
  AgentHealth,
  AgentHealthReport,
  AuditLogEntry,
  Channel,
  ChannelId,
  ChannelState,
  Division,
  DivisionId,
  DivisionState,
  HumanOwner,
  PolicyViolation,
  RunContext,
  ViolationKind,
} from "./types";

export {
  APPROVAL_CLASS_NAMES,
  APPROVAL_SHORTHAND,
} from "./types";

export {
  ACTION_REGISTRY,
  AUTONOMOUS_ACTIONS,
  SINGLE_APPROVAL_ACTIONS,
  DUAL_APPROVAL_ACTIONS,
  RED_LINE_ACTIONS,
  classify,
  requiresApproval,
  isProhibited,
  type ActionSpec,
} from "./taxonomy";

export {
  buildApprovalRequest,
  applyDecision,
  standDown,
  checkExpiry,
  shouldEscalate,
  openApproval,
  recordDecision,
  ProhibitedActionError,
  UnknownActionError,
  InvalidTransitionError,
  type ApprovalStore,
  type ApprovalSlackSurface,
} from "./approvals";

export {
  buildAuditEntry,
  buildHumanAuditEntry,
  logWrite,
  logHumanWrite,
  type AuditStore,
  type AuditSlackSurface,
  type AuditFields,
} from "./audit";

export { newRunId, newRunContext } from "./run-id";
export { listDivisions, getDivision, isActive } from "./divisions";
export { listChannels, getChannel } from "./channels";

// Canonical agent write helpers. Agents import these — not the stores or
// surfaces directly. See record.ts and /contracts/governance.md §9.
export { record, requestApproval, type RecordFields, type RequestApprovalParams } from "./record";
export { approvalStore, auditStore } from "./stores";
export { approvalSurface, auditSurface } from "./slack";

// Drift audit (weekly, Sunday 8 PM PT). /contracts/governance.md §5.
export {
  runDriftAudit,
  type DriftAuditInput,
  type DriftAuditScorecard,
  type DriftAuditSample,
  type DriftAssessment,
  type Validator as DriftValidator,
} from "./drift-audit";

// Enforcement primitives — PauseSink, ViolationStore, CorrectionStore.
// Factory exports (`pauseSink()`, `violationStore()`, `correctionStore()`)
// live on the stores barrel. See /contracts/governance.md §5 + §6.
export {
  type PauseSink,
  type PausedAgentRecord,
  type ViolationStore,
  type CorrectionStore,
  type CorrectionEvent,
  InMemoryPauseSink,
  InMemoryViolationStore,
  InMemoryCorrectionStore,
} from "./enforcement";
export { pauseSink, violationStore, correctionStore } from "./stores";

// Daily brief composer (blueprint §15.4 W3a).
export {
  composeDailyBrief,
  type BriefInput,
  type BriefOutput,
  type BriefKind,
  type RevenueLine,
} from "./daily-brief";

// Runtime pause guard. Every agent entrypoint must call guardAgent()
// before side-effects. Governance §5.
export {
  guardAgent,
  runWithGuard,
  PausedAgentError,
  type GuardDeps,
} from "./runtime-guard";
