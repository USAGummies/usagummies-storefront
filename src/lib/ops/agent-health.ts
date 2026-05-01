/**
 * Agent-health manifest — Phase 28L.4.
 *
 * Inspired by Nate B. Jones, "Why 97.5% of Agents Fail" (Apr 23, 2026):
 * the dominant failure mode is shipping *tasks* (runs once and
 * reports) when you needed *jobs* (closes a loop and moves state to a
 * terminal). The fix is a registry that classifies every agent on:
 *
 *   1. Job vs task — does the agent move state to a terminal, or just
 *      report?
 *   2. Class A/B/C/D approval taxonomy — which approver lane?
 *   3. Owner — exactly one named human on the hook.
 *   4. Lifecycle stage — proposed / active / graduated / retired / parked.
 *
 * Doctrine checks on top of the registry:
 *
 *   - **drew-owns-nothing** (Ben 2026-04-27): any agent with
 *     `owner: "drew"` is a doctrine violation that needs reassignment.
 *   - **task-without-graduation**: tasks that are also `lifecycle:
 *     active` should have a justification, since the long-run
 *     direction is to convert them to jobs or retire them.
 *   - **job-without-approver**: jobs that move state to a terminal in
 *     Class B/C/D MUST have a named approver — otherwise the closer
 *     is unsafe.
 *   - **broken-runtime**: agents flagged as `runtimeBroken: true`
 *     surface as red regardless of other fields.
 *
 * Why this is a sibling to `/ops/agents/status` instead of replacing
 * it: status is the *runtime* view (was the cron fired? did the audit
 * write?). Health is the *doctrinal* view (does this agent satisfy
 * our discipline?). Different signals, different audiences (runtime
 * for ops; doctrine for the operating contract).
 *
 * This manifest is hand-curated. Adding an agent here is the
 * registration step, not a side effect of writing a contract file —
 * forcing the operator to think about classification at registration
 * time is the whole point.
 */
export type AgentClassification = "task" | "job";
export type AgentApprovalClass = "A" | "B" | "C" | "D";
export type AgentLifecycle =
  | "proposed"
  | "active"
  | "graduated"
  | "retired"
  | "parked";
export type AgentOwner =
  | "ben"
  | "rene"
  | "claude"
  | "drew" // doctrine violation surface
  | "unowned"; // doctrine violation surface

export interface AgentManifestEntry {
  /** kebab-case stable id; corresponds to actorId in audit log. */
  id: string;
  name: string;
  /** Pointer to the contract markdown. Empty for agents w/o a contract. */
  contract: string;
  /**
   * Job: closes a loop (e.g. "approval → state-change in
   * QBO/HubSpot/KV"). Task: runs and reports.
   */
  classification: AgentClassification;
  /**
   * A: autonomous (any time, no approval).
   * B: human-gated (single approver).
   * C: dual-approver (two humans).
   * D: emergency only (high stakes; off by default).
   */
  approvalClass: AgentApprovalClass;
  /** The single named owner on the hook. */
  owner: AgentOwner;
  /** Named approver (required for B/C/D jobs; null otherwise). */
  approver: AgentOwner | null;
  /** Where the agent is in its lifecycle. */
  lifecycle: AgentLifecycle;
  /**
   * If set, surfaces a hard red regardless of other doctrinal checks.
   * Examples: depends on a service that's currently broken.
   */
  runtimeBroken?: boolean;
  /** One-line description of WHY this agent exists. */
  purpose: string;
  /** Optional doctrine note (e.g. why a task is intentionally a task). */
  notes?: string;
}

export type AgentDoctrineFlag =
  | "drew-owns"
  | "unowned"
  | "task-without-justification"
  | "job-without-approver"
  | "runtime-broken";

export interface AgentDoctrineCheck {
  flag: AgentDoctrineFlag;
  message: string;
}

export interface AgentHealthRow extends AgentManifestEntry {
  /** Computed doctrine flags — empty array means clean. */
  doctrineFlags: readonly AgentDoctrineCheck[];
  /**
   * Roll-up health: green when no flags; yellow when only
   * task-without-justification (soft); red when any other flag fires.
   */
  health: "green" | "yellow" | "red";
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/**
 * Hand-curated registry. Order is doctrinal: jobs first (the ones
 * that actually close loops), then tasks, then proposed/parked.
 *
 * When a new agent is invented:
 *   1. Decide job vs task.
 *   2. Decide approval class — if B/C/D, name the approver.
 *   3. Name an owner (cannot be "drew" or "unowned").
 *   4. Set lifecycle = "proposed" until graduation criteria pass.
 *   5. Add it here.
 *   6. Add the contract under /contracts/agents/.
 */
export const AGENT_MANIFEST: readonly AgentManifestEntry[] = [
  {
    id: "executive-brief",
    name: "Executive Brief",
    contract: "/contracts/agents/executive-brief.md",
    classification: "job",
    approvalClass: "A",
    owner: "ben",
    approver: null,
    lifecycle: "graduated",
    purpose:
      "Composes morning + EOD operating briefs from canonical sources, posts to #ops-daily.",
  },
  {
    id: "finance-exception",
    name: "Finance Exception Agent",
    contract: "/contracts/agents/finance-exception.md",
    classification: "job",
    approvalClass: "B",
    owner: "rene",
    approver: "rene",
    lifecycle: "active",
    purpose:
      "Surfaces uncategorized transactions, duplicate vendors, and Plaid drift in #financials each morning.",
  },
  {
    id: "ops",
    name: "Ops Agent",
    contract: "/contracts/agents/ops.md",
    classification: "job",
    approvalClass: "B",
    owner: "ben",
    approver: "ben",
    lifecycle: "active",
    purpose:
      "Surfaces unshipped queues, label-buy retries, and dispatch gaps in #operations.",
  },
  {
    id: "compliance-specialist",
    name: "Compliance Specialist",
    contract: "/contracts/agents/compliance-specialist.md",
    classification: "task",
    approvalClass: "A",
    owner: "ben",
    approver: null,
    lifecycle: "active",
    notes:
      "Intentionally a task — surfaces compliance calendar items for human action; no autonomous filings.",
    purpose:
      "Reads /Legal/Compliance Calendar Notion DB and pings #operations on upcoming deadlines.",
  },
  {
    id: "faire-specialist",
    name: "Faire Specialist",
    contract: "/contracts/agents/faire-specialist.md",
    classification: "job",
    approvalClass: "B",
    owner: "ben",
    approver: "ben",
    lifecycle: "active",
    purpose:
      "Send-on-approve closer for Faire Direct invites + follow-ups. Closes the invite loop end-to-end.",
  },
  {
    id: "b2b-revenue-watcher",
    name: "B2B Revenue Watcher",
    contract: "/contracts/agents/b2b-revenue-watcher.md",
    classification: "task",
    approvalClass: "A",
    owner: "ben",
    approver: null,
    lifecycle: "active",
    purpose:
      "Reads stale buyers, Faire follow-ups, pending approvals, and wholesale inquiries to recommend Ben's next B2B revenue action.",
    notes:
      "Task by design in v1 — dry-run only; no cron, Slack post, Gmail send, HubSpot mutation, or approval opening.",
  },
  {
    id: "reconciliation-specialist",
    name: "Reconciliation Specialist",
    contract: "/contracts/agents/reconciliation-specialist.md",
    classification: "job",
    approvalClass: "B",
    owner: "rene",
    approver: "rene",
    lifecycle: "active",
    purpose:
      "Reconciles Plaid feed against QBO weekly, surfaces deltas + duplicates in #financials.",
  },
  {
    id: "amazon-settlement",
    name: "Amazon Settlement Recon",
    contract: "",
    classification: "task",
    approvalClass: "A",
    owner: "rene",
    approver: null,
    lifecycle: "active",
    purpose:
      "Reads Amazon settlement reports + posts a weekly summary to #financials. No write path yet.",
    notes:
      "Task today — graduates to job once Amazon → QBO journal-entry slug is registered.",
  },
  {
    id: "research-librarian",
    name: "Research Librarian",
    contract: "/contracts/agents/research-librarian.md",
    classification: "task",
    approvalClass: "A",
    owner: "ben",
    approver: null,
    lifecycle: "active",
    purpose:
      "Crawls + summarizes weekly research notes into Notion. No autonomous publishing.",
    notes: "Task by design — research curation is intentionally human-led.",
  },
  {
    id: "drift-audit-runner",
    name: "Drift Audit Runner",
    contract: "/contracts/agents/drift-audit-runner.md",
    classification: "job",
    approvalClass: "A",
    owner: "claude",
    approver: null,
    lifecycle: "active",
    purpose:
      "Weekly audit of contract drift, surfaces violations + auto-files corrections in #ops-audit.",
  },
  {
    id: "fulfillment-drift-audit",
    name: "Fulfillment Drift Audit",
    contract: "/contracts/integrations/shipstation.md §11-§12",
    classification: "job",
    approvalClass: "A",
    owner: "claude",
    approver: null,
    lifecycle: "active",
    purpose:
      "Catches ShipStation labels missing from #shipping or audit log; reposts the missing artifact.",
  },
  {
    id: "shipstation-health",
    name: "ShipStation Health (wallet + voids)",
    contract: "/contracts/integrations/shipstation.md",
    classification: "job",
    approvalClass: "A",
    owner: "ben",
    approver: null,
    lifecycle: "active",
    purpose:
      "Daily wallet balance + voided-label drift check; alerts on low balance or unauthorized voids.",
  },
  {
    id: "sample-order-dispatch",
    name: "Sample/Order Dispatch (S-08)",
    contract: "/contracts/agents/sample-order-dispatch.md",
    classification: "job",
    approvalClass: "B",
    owner: "ben",
    approver: "ben",
    lifecycle: "active",
    purpose:
      "Classifies Shopify + HubSpot fulfillment events into Class B proposals in #ops-approvals.",
  },
  {
    id: "viktor-rene-capture",
    name: "Viktor Rene-Capture",
    contract: "/contracts/agents/viktor-rene-capture.md",
    classification: "task",
    approvalClass: "A",
    owner: "rene",
    approver: null,
    lifecycle: "active",
    purpose:
      "W-9 / vendor-onboarding capture in Slack DMs. Read-only on QBO; emits review-packet only.",
    notes: "Task by design — Rene approves the QBO write through a separate slug.",
  },
  {
    id: "interviewer",
    name: "Interviewer",
    contract: "/contracts/agents/interviewer.md",
    classification: "task",
    approvalClass: "A",
    owner: "ben",
    approver: null,
    lifecycle: "proposed",
    purpose:
      "Pre-build spec disambiguation. 3-5 questions before any non-trivial build. Phase 28L.1.",
    notes:
      "Task by design — only emits questions + named defaults; never produces code itself.",
  },
  {
    id: "qbo-bill-create-from-receipt",
    name: "QBO Bill Create (from receipt)",
    contract: "/contracts/approval-taxonomy.md",
    classification: "job",
    approvalClass: "C",
    owner: "rene",
    approver: "rene",
    lifecycle: "parked",
    purpose:
      "Promote a Rene-approved review packet → QBO bill. Closes the receipt → ledger loop.",
    notes:
      "PARKED awaiting Rene's chart-of-accounts mapping (post-2026-03-29 QBO reset).",
  },
  {
    id: "email-agents-readiness",
    name: "Email Agents Readiness",
    contract: "/contracts/email-agents-system.md",
    classification: "task",
    approvalClass: "A",
    owner: "ben",
    approver: null,
    lifecycle: "proposed",
    purpose:
      "Read-only readiness heartbeat for the email-agents subsystem. Surfaces gates (incident fix, schema ready, kill-switch off) without scanning Gmail or opening approvals.",
    notes:
      "Task by design — Phase 37 capabilities ship inside Viktor + S-08 + Finance Exception. This heartbeat exists only to surface readiness, never to send.",
  },
  {
    id: "sample-queue",
    name: "Sample Queue (operator drop)",
    contract: "/contracts/agents/sample-order-dispatch.md",
    classification: "job",
    approvalClass: "B",
    owner: "ben",
    approver: "ben",
    lifecycle: "active",
    purpose:
      "Lean operator-facing wrapper around sample-dispatch. Ben at his desk drops a sample → Class B shipment.create approval in #ops-approvals. Whale detection (Buc-ee's, KeHE, McLane, Eastern National, Xanterra, Delaware North, Aramark, Compass, Sodexo) flags high-stakes drops.",
  },
] as const;

// ---------------------------------------------------------------------------
// Doctrine evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a single agent against the doctrine rules. Pure — no I/O.
 *
 * Returns an array of flags (empty when clean). Health roll-up:
 *   - empty                                 → green
 *   - only task-without-justification       → yellow (soft)
 *   - any other flag                        → red
 */
export function evaluateAgentDoctrine(
  entry: AgentManifestEntry,
): { flags: AgentDoctrineCheck[]; health: "green" | "yellow" | "red" } {
  const flags: AgentDoctrineCheck[] = [];

  if (entry.owner === "drew") {
    flags.push({
      flag: "drew-owns",
      message:
        'Owner is "drew" — Ben 2026-04-27 doctrinal correction: "drew owns nothing." Reassign.',
    });
  }

  if (entry.owner === "unowned") {
    flags.push({
      flag: "unowned",
      message:
        "Owner is unowned — every agent must have exactly one named human on the hook.",
    });
  }

  // Jobs in B/C/D MUST name an approver.
  if (
    entry.classification === "job" &&
    entry.approvalClass !== "A" &&
    !entry.approver
  ) {
    flags.push({
      flag: "job-without-approver",
      message: `Class ${entry.approvalClass} job needs a named approver. Closer is unsafe without one.`,
    });
  }

  // Tasks that are active need a justification note. The "long-run
  // direction is to convert tasks to jobs or retire them."
  if (
    entry.classification === "task" &&
    entry.lifecycle === "active" &&
    !entry.notes
  ) {
    flags.push({
      flag: "task-without-justification",
      message:
        "Active task without a justification note. Either add notes explaining why it stays a task, or convert/retire.",
    });
  }

  if (entry.runtimeBroken) {
    flags.push({
      flag: "runtime-broken",
      message: "Marked runtimeBroken=true — fix or retire.",
    });
  }

  let health: "green" | "yellow" | "red" = "green";
  if (flags.length > 0) {
    health = flags.every((f) => f.flag === "task-without-justification")
      ? "yellow"
      : "red";
  }
  return { flags, health };
}

/** Build the per-row health view of every agent. Pure. */
export function buildAgentHealthRows(
  manifest: readonly AgentManifestEntry[] = AGENT_MANIFEST,
): AgentHealthRow[] {
  return manifest.map((entry) => {
    const { flags, health } = evaluateAgentDoctrine(entry);
    return { ...entry, doctrineFlags: flags, health };
  });
}

export interface AgentHealthSummary {
  total: number;
  green: number;
  yellow: number;
  red: number;
  jobs: number;
  tasks: number;
  byLifecycle: Record<AgentLifecycle, number>;
  byApprovalClass: Record<AgentApprovalClass, number>;
  /** Count of agents flagged as drew-owns (doctrine violation surface). */
  drewOwnedCount: number;
}

/** Pure summarizer over health rows. */
export function summarizeAgentHealth(
  rows: readonly AgentHealthRow[],
): AgentHealthSummary {
  const byLifecycle: Record<AgentLifecycle, number> = {
    proposed: 0,
    active: 0,
    graduated: 0,
    retired: 0,
    parked: 0,
  };
  const byApprovalClass: Record<AgentApprovalClass, number> = {
    A: 0,
    B: 0,
    C: 0,
    D: 0,
  };
  let green = 0,
    yellow = 0,
    red = 0,
    jobs = 0,
    tasks = 0,
    drewOwnedCount = 0;
  for (const r of rows) {
    if (r.health === "green") green += 1;
    else if (r.health === "yellow") yellow += 1;
    else red += 1;
    if (r.classification === "job") jobs += 1;
    else tasks += 1;
    byLifecycle[r.lifecycle] += 1;
    byApprovalClass[r.approvalClass] += 1;
    if (r.owner === "drew") drewOwnedCount += 1;
  }
  return {
    total: rows.length,
    green,
    yellow,
    red,
    jobs,
    tasks,
    byLifecycle,
    byApprovalClass,
    drewOwnedCount,
  };
}
