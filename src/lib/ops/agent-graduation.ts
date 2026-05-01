/**
 * Agent graduation gauge — Phase 6.10 follow-up.
 *
 * Codex shipped the heartbeat primitives + last-run-handoff context in
 * Phase 6.10. The missing display piece was a gauge that, for every
 * agent in the manifest, answers:
 *
 *   "Has this agent earned its next lifecycle stage?"
 *
 * Lifecycle ladder (`agent-health.ts`):
 *   proposed → active → graduated → (retired / parked are terminals)
 *
 * For each transition we evaluate concrete pass/fail criteria from
 * what we already know:
 *   - The hand-curated manifest (owner, approver, contract path, classification)
 *   - The doctrine flags from `evaluateAgentDoctrine`
 *   - The audit log (was it run? did it close loops? error rate?)
 *
 * The gauge is read-only — it never advances an agent's lifecycle on
 * its own. Operators look at it, see "5/6 criteria pass", and either
 * fix the missing one or flip the manifest entry by hand.
 *
 * Pure-logic module: no I/O, no env reads. Caller (the API route)
 * fetches recent audit entries and passes them in. Easy to test.
 */

import type {
  AgentHealthRow,
  AgentLifecycle,
  AgentManifestEntry,
} from "./agent-health";
import type { AuditLogEntry } from "./control-plane/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GraduationCriterionId =
  | "has-contract"
  | "has-named-owner"
  | "has-approver-when-required"
  | "no-doctrine-flags"
  | "has-recent-runs"
  | "low-error-rate"
  | "closes-loops"
  | "task-justification";

export interface GraduationCriterion {
  id: GraduationCriterionId;
  /** Human-readable label for the gauge UI. */
  label: string;
  /** Pass/fail. */
  passed: boolean;
  /** When failed, a one-line reason; when passed, a confirmation. */
  detail: string;
}

export interface AgentGraduationGauge {
  agentId: string;
  agentName: string;
  currentStage: AgentLifecycle;
  /** Where the agent would graduate to next (null at terminals). */
  nextStage: AgentLifecycle | null;
  criteria: GraduationCriterion[];
  /** Count of passed criteria + total. */
  passed: number;
  total: number;
  /**
   * 0..1 readiness ratio = passed / total. UI renders as a percent bar.
   * 1.0 = ready to graduate; <1.0 = blocked.
   */
  readiness: number;
  /**
   * True iff every criterion passed AND the agent is not at a terminal
   * stage. The operator surface uses this to highlight the row.
   */
  readyToGraduate: boolean;
  /**
   * One-line summary suitable for a CLI / Slack post.
   * E.g. "5/6 criteria — needs `closes-loops` (no approval requests in 30d)"
   */
  summary: string;
}

export interface GraduationSummary {
  total: number;
  readyToGraduate: number;
  byStage: Record<AgentLifecycle, number>;
  /** Count of agents at terminal stages (graduated / retired / parked). */
  atTerminal: number;
}

// ---------------------------------------------------------------------------
// Stage progression
// ---------------------------------------------------------------------------

/**
 * Return the stage an agent would advance to next, or `null` when it's
 * at a terminal (graduated / retired / parked).
 *
 * Note: graduated is a terminal in this gauge — once an agent has
 * earned graduated status, demotions back to active are an explicit
 * operator action, not something the gauge proposes.
 */
export function getNextStage(stage: AgentLifecycle): AgentLifecycle | null {
  switch (stage) {
    case "proposed":
      return "active";
    case "active":
      return "graduated";
    case "graduated":
    case "retired":
    case "parked":
      return null;
  }
}

/** True iff the stage admits a "next" stage (not terminal). */
export function isAdvanceable(stage: AgentLifecycle): boolean {
  return getNextStage(stage) !== null;
}

// ---------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------

/** Window for "recent" audit checks. 30 days = ~one ops cadence. */
export const GRADUATION_WINDOW_DAYS = 30;

export interface GraduationEvalInput {
  /** Health row (manifest + doctrine flags), per `buildAgentHealthRows`. */
  row: AgentHealthRow;
  /**
   * Audit log entries for this specific agent (caller pre-filters by
   * `actorId === row.id`). Newest-first or any order — we don't rely
   * on order, only on the timestamps.
   */
  audit: ReadonlyArray<AuditLogEntry>;
  /** Override "now" for deterministic tests. */
  now?: Date;
}

/**
 * Build the per-agent gauge: evaluate each criterion, roll up to a
 * readiness ratio + a one-line summary.
 */
export function evaluateAgentGraduation(
  input: GraduationEvalInput,
): AgentGraduationGauge {
  const { row, audit } = input;
  const now = input.now ?? new Date();
  const windowStart = new Date(
    now.getTime() - GRADUATION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  // Filter audit to the window. Defensive on bad timestamps.
  const inWindow = audit.filter((e) => {
    const t = Date.parse(e.createdAt);
    return Number.isFinite(t) && t >= windowStart.getTime();
  });
  const errorEntries = inWindow.filter((e) => e.result === "error");
  const okEntries = inWindow.filter((e) => e.result === "ok");
  const errorRate =
    inWindow.length === 0 ? 0 : errorEntries.length / inWindow.length;

  // The set of "loop-closing" actions varies by agent. We approximate
  // by counting any audit entry whose action contains 'approval', 'send',
  // 'create', 'update', 'post' — these are state-moving verbs. This is
  // good enough for the readiness signal; operators can overrule.
  const LOOP_VERB_REGEX = /\b(approval|send|create|update|post|close|dispatch)\b/i;
  const loopClosing = inWindow.filter(
    (e) => LOOP_VERB_REGEX.test(e.action) && e.result === "ok",
  );

  const criteria: GraduationCriterion[] = [];

  // ----- 1. Has contract --------------------------------------------------
  // Required for active+. Missing contract is fine for proposed.
  criteria.push({
    id: "has-contract",
    label: "Contract registered",
    passed: row.contract.length > 0,
    detail:
      row.contract.length > 0
        ? `Contract: ${row.contract}`
        : "No contract pointer in manifest — register one under /contracts/agents/.",
  });

  // ----- 2. Has named owner ----------------------------------------------
  const ownerOk = row.owner !== "drew" && row.owner !== "unowned";
  criteria.push({
    id: "has-named-owner",
    label: "Has a named owner",
    passed: ownerOk,
    detail: ownerOk
      ? `Owner: ${row.owner}`
      : `Owner is "${row.owner}" — must reassign (Ben 2026-04-27 doctrinal correction).`,
  });

  // ----- 3. Approver when required ---------------------------------------
  const needsApprover =
    row.classification === "job" && row.approvalClass !== "A";
  const approverOk = !needsApprover || Boolean(row.approver);
  criteria.push({
    id: "has-approver-when-required",
    label: "Approver named (Class B/C/D jobs)",
    passed: approverOk,
    detail: !needsApprover
      ? "Not required (Class A or task)."
      : approverOk
        ? `Approver: ${row.approver}`
        : `Class ${row.approvalClass} job needs a named approver — closer is unsafe without one.`,
  });

  // ----- 4. No doctrine flags --------------------------------------------
  const flagCount = row.doctrineFlags.length;
  criteria.push({
    id: "no-doctrine-flags",
    label: "No doctrine flags",
    passed: flagCount === 0,
    detail:
      flagCount === 0
        ? "Clean."
        : `${flagCount} flag${flagCount === 1 ? "" : "s"}: ${row.doctrineFlags
            .map((f) => f.flag)
            .join(", ")}`,
  });

  // ----- 5. Recent runs in window ----------------------------------------
  const runsOk = inWindow.length > 0;
  criteria.push({
    id: "has-recent-runs",
    label: `Has runs in last ${GRADUATION_WINDOW_DAYS}d`,
    passed: runsOk,
    detail: runsOk
      ? `${inWindow.length} runs (${okEntries.length} ok, ${errorEntries.length} err) in last ${GRADUATION_WINDOW_DAYS}d.`
      : `No audit entries in last ${GRADUATION_WINDOW_DAYS}d — agent may be dormant.`,
  });

  // ----- 6. Low error rate -----------------------------------------------
  // Threshold: ≤ 20% error rate over the window. With < 5 runs we
  // skip the strict pass and require at least one OK to pass.
  const errorOk =
    inWindow.length === 0
      ? false // no data = can't claim low error rate
      : inWindow.length < 5
        ? okEntries.length > 0
        : errorRate <= 0.2;
  criteria.push({
    id: "low-error-rate",
    label: "Error rate ≤ 20%",
    passed: errorOk,
    detail:
      inWindow.length === 0
        ? "No runs in window — can't measure."
        : `${(errorRate * 100).toFixed(0)}% error rate (${errorEntries.length}/${inWindow.length}).`,
  });

  // ----- 7. Closes loops (jobs only) -------------------------------------
  // For jobs, expect ≥ 1 loop-closing audit entry in the window.
  // Tasks pass automatically (they don't close loops by definition).
  const closesLoopsOk =
    row.classification === "task" ? true : loopClosing.length > 0;
  criteria.push({
    id: "closes-loops",
    label:
      row.classification === "task"
        ? "Closes loops (n/a for tasks)"
        : "Closes loops (job)",
    passed: closesLoopsOk,
    detail:
      row.classification === "task"
        ? "Tasks don't close loops — auto-pass."
        : closesLoopsOk
          ? `${loopClosing.length} loop-closing actions in last ${GRADUATION_WINDOW_DAYS}d.`
          : "No loop-closing audit entries in window — job classification may be wrong, or agent isn't actually running.",
  });

  // ----- 8. Task justification (tasks only) ------------------------------
  // For tasks, require notes explaining why it's intentionally a task.
  // Jobs auto-pass.
  const taskJustOk =
    row.classification === "job" || Boolean(row.notes && row.notes.trim().length > 0);
  criteria.push({
    id: "task-justification",
    label:
      row.classification === "job"
        ? "Task justification (n/a for jobs)"
        : "Task justification documented",
    passed: taskJustOk,
    detail:
      row.classification === "job"
        ? "Jobs don't need task justification — auto-pass."
        : taskJustOk
          ? "Notes documented."
          : "Active task without notes — explain why it stays a task or convert/retire.",
  });

  const passed = criteria.filter((c) => c.passed).length;
  const total = criteria.length;
  const readiness = total === 0 ? 0 : passed / total;
  const nextStage = getNextStage(row.lifecycle);
  const readyToGraduate = nextStage !== null && passed === total;

  let summary: string;
  if (nextStage === null) {
    summary = `Terminal stage: ${row.lifecycle}.`;
  } else if (readyToGraduate) {
    summary = `Ready to graduate ${row.lifecycle} → ${nextStage} (${passed}/${total}).`;
  } else {
    const failing = criteria.filter((c) => !c.passed);
    const blockers = failing.map((c) => c.id).join(", ");
    summary = `${passed}/${total} — blocked on: ${blockers}`;
  }

  return {
    agentId: row.id,
    agentName: row.name,
    currentStage: row.lifecycle,
    nextStage,
    criteria,
    passed,
    total,
    readiness,
    readyToGraduate,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Batch
// ---------------------------------------------------------------------------

export interface BatchEvalInput {
  rows: ReadonlyArray<AgentHealthRow>;
  /**
   * Audit log keyed by actorId (agent id). Caller fetches once and
   * groups in memory; we don't re-fetch per agent.
   */
  auditByAgent: Record<string, ReadonlyArray<AuditLogEntry>>;
  /** Override "now" for deterministic tests. */
  now?: Date;
}

/** Build a gauge for every agent. Pure. */
export function evaluateAllGraduations(
  input: BatchEvalInput,
): AgentGraduationGauge[] {
  return input.rows.map((row) =>
    evaluateAgentGraduation({
      row,
      audit: input.auditByAgent[row.id] ?? [],
      now: input.now,
    }),
  );
}

/** Roll-up summary for a header strip. */
export function summarizeGraduations(
  gauges: ReadonlyArray<AgentGraduationGauge>,
): GraduationSummary {
  const byStage: Record<AgentLifecycle, number> = {
    proposed: 0,
    active: 0,
    graduated: 0,
    retired: 0,
    parked: 0,
  };
  let readyToGraduate = 0;
  let atTerminal = 0;
  for (const g of gauges) {
    byStage[g.currentStage] += 1;
    if (g.readyToGraduate) readyToGraduate += 1;
    if (g.nextStage === null) atTerminal += 1;
  }
  return {
    total: gauges.length,
    readyToGraduate,
    byStage,
    atTerminal,
  };
}

// ---------------------------------------------------------------------------
// Audit-by-agent helper
// ---------------------------------------------------------------------------

/**
 * Group a flat audit array by agent (`actorId`). The route fetches a
 * window of audit entries once via `auditStore().recent(N)` and passes
 * the result here; the gauge needs per-agent slices.
 *
 * Pure, deterministic.
 */
export function groupAuditByAgent(
  audit: ReadonlyArray<AuditLogEntry>,
  manifest: ReadonlyArray<AgentManifestEntry>,
): Record<string, AuditLogEntry[]> {
  const known = new Set(manifest.map((m) => m.id));
  const out: Record<string, AuditLogEntry[]> = {};
  for (const m of manifest) out[m.id] = [];
  for (const e of audit) {
    if (e.actorType !== "agent") continue;
    if (!known.has(e.actorId)) continue;
    out[e.actorId]!.push(e);
  }
  return out;
}
