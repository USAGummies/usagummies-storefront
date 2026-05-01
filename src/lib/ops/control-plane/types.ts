/**
 * USA Gummies 3.0 — Control Plane types
 * ==========================================================================
 * Canonical blueprint: USA GUMMIES 3.0 — RESEARCH BLUEPRINT §15.
 * This module defines the runtime-agnostic type system for approvals,
 * audit logging, run identity, and the 6-division / 9-channel registry.
 *
 * No I/O lives here. Persistence and Slack integration are layered on
 * top via the adapters defined in approvals.ts, audit.ts, etc.
 *
 * Deprecation policy: any file under src/lib/ops/ named abra-*, or the
 * engine-schedule / notify stubs, is being retired. New code goes here.
 * ========================================================================== */

// ----- Divisions --------------------------------------------------------

export type DivisionState = "active" | "latent";

export type DivisionId =
  | "executive-control"
  | "sales"
  | "financials"
  | "production-supply-chain"
  | "research-intelligence"
  | "platform-data-automation"
  // latent (contracts exist, surfaces dormant)
  | "marketing-brand"
  | "marketing-paid"
  | "trade-shows-field"
  | "outreach-partnerships-press"
  | "customer-experience"
  | "product-packaging-rd";

export type HumanOwner = "Ben" | "Rene" | "Drew";

export interface Division {
  id: DivisionId;
  name: string;
  state: DivisionState;
  humanOwner: HumanOwner;
  primaryAiLayer: string;
  primarySystems: string[];
  visibleSlackChannels: ChannelId[];
  /** For latent divisions: criterion that graduates the division to `active`. */
  activationTrigger?: string;
  notes?: string;
}

// ----- Slack channels ---------------------------------------------------

export type ChannelState = "active" | "latent";

export type ChannelId =
  | "ops-daily"
  | "ops-approvals"
  | "ops-audit"
  | "ops-alerts"
  | "sales"
  | "finance"
  | "operations"
  | "research"
  | "receipts-capture"
  // Phase 27 — shipping/labels live channel. Distinct from
  // "operations" (which is a workflow registry concept) because the
  // workspace has a real `#shipping` channel where every label PDF
  // + packing slip lands per the v1.0 shipping protocol Ben pinned
  // on 2026-04-10.
  | "shipping"
  // latent channels — created only on division activation
  | "marketing"
  | "trade-shows"
  | "outreach-pr"
  | "cx"
  | "product-rd";

export interface Channel {
  id: ChannelId;
  name: string; // e.g. "#ops-daily"
  state: ChannelState;
  purpose: string;
  allowedContent: string[];
  notAllowed: string[];
  divisions: DivisionId[];
  /** Division that owns this channel (sets rules, resolves routing disputes). */
  owningDivision: DivisionId;
  /**
   * Actual Slack channel ID (`Cxxx`) for routes that need canonical
   * routing rather than the human name. Required for file uploads and
   * safer for private-channel chat posts because archived/recreated
   * names drift. Optional only for latent channels that do not exist yet.
   */
  slackChannelId?: string;
}

// ----- Approval taxonomy (§15.3) ----------------------------------------

/** Approval class as defined in blueprint §15.3. */
export type ApprovalClass = "A" | "B" | "C" | "D";

export const APPROVAL_CLASS_NAMES: Record<ApprovalClass, string> = {
  A: "Autonomous",
  B: "Single approval",
  C: "Dual approval",
  D: "Red-Line / prohibited",
};

export const APPROVAL_SHORTHAND: Record<"Observe" | "Prepare" | "Commit" | "Red-Line", ApprovalClass[]> = {
  // Blueprint §15.3: Observe and Prepare → A; Commit → B or C; Red-Line → D.
  Observe: ["A"],
  Prepare: ["A"],
  Commit: ["B", "C"],
  "Red-Line": ["D"],
};

// ----- Run identity -----------------------------------------------------

/**
 * Every agent invocation carries a run_id. Every action in a single run
 * shares the same run_id so the audit trail can be reconstructed.
 */
export interface RunContext {
  runId: string;
  agentId: string;
  division: DivisionId;
  startedAt: string; // ISO 8601
  source: "scheduled" | "event" | "on-demand" | "human-invoked";
  trigger?: string; // e.g. cron expression, webhook name, slash command
}

// ----- Approvals (§15.3) ------------------------------------------------

/** Lifecycle of a gated action. Draft → pending → terminal state. */
export type ApprovalStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "stood-down"; // agent withdrew the request before decision

export interface ApprovalEvidence {
  /** Short, machine-readable claim the agent is making. */
  claim: string;
  /** Sources consulted, each with a system name + optional id + optional URL. */
  sources: Array<{ system: string; id?: string; url?: string; retrievedAt: string }>;
  /** Self-reported confidence 0.0–1.0. Nate B Jones principle: every output carries confidence. */
  confidence: number;
}

export interface ApprovalRequest {
  /** Globally unique id for this approval, e.g. nanoid. */
  id: string;
  runId: string;
  division: DivisionId;
  actorAgentId: string;
  class: Exclude<ApprovalClass, "A" | "D">; // only B and C enter the queue; A is autonomous, D is prohibited
  action: string; // human-readable description, e.g. "Send email to Jungle Jim's"
  targetSystem: string; // e.g. "gmail", "hubspot", "qbo", "shipstation"
  targetEntity?: { type: string; id?: string; label?: string };
  payloadPreview: string; // short summary; full payload lives in storage
  payloadRef?: string; // pointer to full payload (e.g. KV key or object path)
  evidence: ApprovalEvidence;
  rollbackPlan: string; // how to undo if approved and it turns out wrong
  requiredApprovers: HumanOwner[]; // length 1 for Class B, length 2 for Class C
  status: ApprovalStatus;
  createdAt: string;
  decisions: ApprovalDecision[];
  /** Blueprint §5.2: 24h → escalate; 72h → expire. */
  escalateAt: string;
  expiresAt: string;
  /** Slack coordinates, if the request has been surfaced. */
  slackThread?: { channel: ChannelId; ts: string };
  /**
   * Recorded when the request terminates via agent/system withdrawal
   * (distinct from a human rejection). Set by `standDown()`.
   * Never set for human decisions — use `decisions[]` for those.
   */
  standDown?: {
    reason: string;
    byAgentId: string;
    at: string;
  };
}

export interface ApprovalDecision {
  approver: HumanOwner;
  decision: "approve" | "reject" | "ask";
  reason?: string;
  decidedAt: string;
}

// ----- Audit log --------------------------------------------------------

/**
 * Every autonomous write goes through this record. Blueprint §6.1:
 * every post carries source + run_id + timestamp.
 */
export interface AuditLogEntry {
  id: string;
  runId: string;
  division: DivisionId;
  actorType: "agent" | "human";
  actorId: string;
  action: string; // short verb phrase, e.g. "hubspot.deal.update"
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  result: "ok" | "error" | "skipped" | "stood-down";
  /** If class B/C, the approval id that authorized this write. */
  approvalId?: string;
  error?: { message: string; code?: string };
  sourceCitations: Array<{ system: string; id?: string; url?: string }>;
  confidence?: number;
  createdAt: string;
}

// ----- Health states (Nate B Jones principle 5) -------------------------

export type AgentHealth = "green" | "yellow" | "red";

export interface AgentHealthReport {
  agentId: string;
  division: DivisionId;
  state: AgentHealth;
  reason?: string;
  // Rolling counters (24h window).
  violations24h: number;
  corrections24h: number;
  updatedAt: string;
}

// ----- Policy violations (for the weekly drift audit) -------------------

export type ViolationKind =
  | "fabricated_data" // agent presented data it did not retrieve
  | "unapproved_write" // agent executed a class-B/C action without approval
  | "prohibited_action" // class-D attempted
  | "stale_data" // source older than freshness SLA
  | "missing_citation" // output lacked required source+timestamp+confidence
  | "duplicate_output" // same message posted twice
  | "wrong_channel"; // output routed to the wrong division surface

export interface PolicyViolation {
  id: string;
  runId: string;
  agentId: string;
  division: DivisionId;
  kind: ViolationKind;
  detail: string;
  detectedBy: "self-check" | "drift-audit" | "human-correction";
  detectedAt: string;
  remediation?: string;
}
