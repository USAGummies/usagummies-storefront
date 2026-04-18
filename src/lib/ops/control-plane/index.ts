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
