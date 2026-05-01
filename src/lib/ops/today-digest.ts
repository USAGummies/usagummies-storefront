/**
 * Today Digest — pure-logic aggregator for the "Ben checks in once" surface.
 *
 * Roll-up of the operator state Ben needs to glance at to know what's
 * waiting on him: pending approvals, off-grid quotes, agent health,
 * graduation readiness. The /api/ops/today route fetches the raw
 * sources fail-soft and feeds them here.
 *
 * Pure module: no I/O, no env reads, no API calls. Caller passes in
 * the already-fetched data; this module slices, rolls up, and emits a
 * stable digest shape. Easy to test.
 */

import type { ApprovalRequest } from "./control-plane/types";
import type { AgentHealthSummary } from "./agent-health";
import type {
  AgentGraduationGauge,
  GraduationSummary,
} from "./agent-graduation";
import type { OffGridQuote } from "@/lib/finance/off-grid-quotes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TodayApprovalsBlock {
  total: number;
  byClass: { B: number; C: number };
  /**
   * Approvals whose `escalateAt` has passed (24h doctrine threshold)
   * but `expiresAt` hasn't — these are at risk of expiry and need
   * operator attention TODAY.
   */
  escalating: number;
  /** Approvals whose `expiresAt` has passed — terminal-pending. */
  expiring: number;
  /** The 5 oldest pending approvals (oldest createdAt first). */
  oldest: Array<Pick<
    ApprovalRequest,
    "id" | "actorAgentId" | "action" | "class" | "createdAt" | "escalateAt"
  >>;
}

export interface TodayOffGridBlock {
  /** Total off-grid quotes detected in the window. */
  total: number;
  /** Count by severity. */
  bySeverity: Record<OffGridQuote["severity"], number>;
  /** True iff at least one below_floor quote — forces operator action. */
  hasHardBlock: boolean;
  /** Top 3 by absolute total dollar deviation (most-urgent-first). */
  top: OffGridQuote[];
}

export interface TodayAgentsBlock {
  health: AgentHealthSummary;
  graduation: GraduationSummary;
  /** Agents that are red-light (doctrine flag) — name + reason. */
  redLight: Array<{ id: string; name: string; reason: string }>;
  /**
   * Agents whose graduation gauge shows ready-to-graduate (passed=total
   * and non-terminal). The operator can flip the manifest to advance.
   */
  readyToGraduate: Array<{
    id: string;
    name: string;
    currentStage: string;
    nextStage: string;
  }>;
}

export interface TodaySamplesBlock {
  /** Open sample-related approvals (subset of approvals with sample tag). */
  pendingApprovals: number;
  /** Whales among pending sample approvals (string match on payloadPreview). */
  whaleApprovals: number;
}

export interface TodayDigest {
  generatedAt: string;
  /** Rough overall posture: green = nothing waiting; yellow = stuff but routine; red = at-risk approvals or below-floor pricing. */
  posture: "green" | "yellow" | "red";
  approvals: TodayApprovalsBlock;
  offGrid: TodayOffGridBlock;
  agents: TodayAgentsBlock;
  samples: TodaySamplesBlock;
  /**
   * Sources that failed to load — caller surfaces this so Ben knows
   * the digest may be incomplete. Never fail the whole digest on one
   * degraded source; keep the rest.
   */
  degraded: string[];
}

// ---------------------------------------------------------------------------
// Approval roll-up
// ---------------------------------------------------------------------------

const WHALE_REGEX = /\b(buc-?ee|kehe|mclane|eastern national|xanterra|delaware north|aramark|compass group|sodexo)\b/i;
const SAMPLE_REGEX = /\b(sample|sample-queue|tag:sample)\b/i;

export function rollUpApprovals(
  pending: ReadonlyArray<ApprovalRequest>,
  now: Date,
): TodayApprovalsBlock {
  const byClass: TodayApprovalsBlock["byClass"] = { B: 0, C: 0 };
  let escalating = 0;
  let expiring = 0;
  for (const a of pending) {
    if (a.class === "B") byClass.B += 1;
    else if (a.class === "C") byClass.C += 1;
    const escAt = Date.parse(a.escalateAt);
    const expAt = Date.parse(a.expiresAt);
    if (Number.isFinite(expAt) && expAt <= now.getTime()) expiring += 1;
    else if (Number.isFinite(escAt) && escAt <= now.getTime()) escalating += 1;
  }
  const sorted = [...pending].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  const oldest = sorted.slice(0, 5).map((a) => ({
    id: a.id,
    actorAgentId: a.actorAgentId,
    action: a.action,
    class: a.class,
    createdAt: a.createdAt,
    escalateAt: a.escalateAt,
  }));
  return { total: pending.length, byClass, escalating, expiring, oldest };
}

export function countSampleApprovals(
  pending: ReadonlyArray<ApprovalRequest>,
): TodaySamplesBlock {
  let pendingApprovals = 0;
  let whaleApprovals = 0;
  for (const a of pending) {
    const haystack = `${a.action} ${a.payloadPreview} ${a.targetEntity?.label ?? ""}`;
    if (SAMPLE_REGEX.test(haystack)) {
      pendingApprovals += 1;
      if (WHALE_REGEX.test(haystack)) whaleApprovals += 1;
    }
  }
  return { pendingApprovals, whaleApprovals };
}

// ---------------------------------------------------------------------------
// Off-grid roll-up
// ---------------------------------------------------------------------------

const OFFGRID_TOP_N = 3;

export function rollUpOffGrid(
  flagged: ReadonlyArray<OffGridQuote>,
): TodayOffGridBlock {
  const bySeverity: TodayOffGridBlock["bySeverity"] = {
    below_floor: 0,
    below_distributor_floor: 0,
    between_grid_lines: 0,
    above_grid: 0,
    approved_class_c: 0,
  };
  for (const q of flagged) bySeverity[q.severity] += 1;

  const SEVERITY_RANK: Record<OffGridQuote["severity"], number> = {
    below_floor: 0,
    below_distributor_floor: 1,
    between_grid_lines: 2,
    above_grid: 3,
    approved_class_c: 4,
  };
  const sorted = [...flagged].sort((a, b) => {
    const r = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (r !== 0) return r;
    return Math.abs(b.totalDeviationUsd) - Math.abs(a.totalDeviationUsd);
  });

  return {
    total: flagged.length,
    bySeverity,
    hasHardBlock: bySeverity.below_floor > 0,
    top: sorted.slice(0, OFFGRID_TOP_N),
  };
}

// ---------------------------------------------------------------------------
// Agent roll-up
// ---------------------------------------------------------------------------

export function rollUpAgents(
  health: AgentHealthSummary,
  gauges: ReadonlyArray<AgentGraduationGauge>,
  rows: ReadonlyArray<{
    id: string;
    name: string;
    health: "green" | "yellow" | "red";
    doctrineFlags: ReadonlyArray<{ flag: string; message: string }>;
  }>,
): TodayAgentsBlock {
  const graduation: GraduationSummary = {
    total: gauges.length,
    readyToGraduate: gauges.filter((g) => g.readyToGraduate).length,
    byStage: { proposed: 0, active: 0, graduated: 0, retired: 0, parked: 0 },
    atTerminal: 0,
  };
  for (const g of gauges) {
    graduation.byStage[g.currentStage] += 1;
    if (g.nextStage === null) graduation.atTerminal += 1;
  }

  const redLight = rows
    .filter((r) => r.health === "red")
    .map((r) => ({
      id: r.id,
      name: r.name,
      reason: r.doctrineFlags.length > 0
        ? r.doctrineFlags.map((f) => f.flag).join(", ")
        : "marked red",
    }));

  const readyToGraduate = gauges
    .filter((g) => g.readyToGraduate && g.nextStage !== null)
    .map((g) => ({
      id: g.agentId,
      name: g.agentName,
      currentStage: g.currentStage,
      nextStage: g.nextStage as string,
    }));

  return { health, graduation, redLight, readyToGraduate };
}

// ---------------------------------------------------------------------------
// Posture
// ---------------------------------------------------------------------------

/**
 * Roll up the four blocks into a single green/yellow/red posture.
 *
 * RED: any below-floor off-grid OR any expiring approval OR any
 *      red-light agent.
 * YELLOW: pending approvals exist OR off-grid quotes exist OR agents
 *      are escalating.
 * GREEN: zero of the above — clean morning.
 */
export function computePosture(
  approvals: TodayApprovalsBlock,
  offGrid: TodayOffGridBlock,
  agents: TodayAgentsBlock,
): "green" | "yellow" | "red" {
  if (offGrid.hasHardBlock) return "red";
  if (approvals.expiring > 0) return "red";
  if (agents.redLight.length > 0) return "red";
  if (approvals.total > 0) return "yellow";
  if (offGrid.total > 0) return "yellow";
  if (approvals.escalating > 0) return "yellow";
  return "green";
}

// ---------------------------------------------------------------------------
// Top-level builder
// ---------------------------------------------------------------------------

export interface BuildTodayDigestInput {
  pendingApprovals: ReadonlyArray<ApprovalRequest>;
  offGridQuotes: ReadonlyArray<OffGridQuote>;
  health: AgentHealthSummary;
  gauges: ReadonlyArray<AgentGraduationGauge>;
  rows: ReadonlyArray<{
    id: string;
    name: string;
    health: "green" | "yellow" | "red";
    doctrineFlags: ReadonlyArray<{ flag: string; message: string }>;
  }>;
  degraded: ReadonlyArray<string>;
  now?: Date;
}

export function buildTodayDigest(input: BuildTodayDigestInput): TodayDigest {
  const now = input.now ?? new Date();
  const approvals = rollUpApprovals(input.pendingApprovals, now);
  const offGrid = rollUpOffGrid(input.offGridQuotes);
  const samples = countSampleApprovals(input.pendingApprovals);
  const agents = rollUpAgents(input.health, input.gauges, input.rows);
  const posture = computePosture(approvals, offGrid, agents);
  return {
    generatedAt: now.toISOString(),
    posture,
    approvals,
    offGrid,
    agents,
    samples,
    degraded: [...input.degraded],
  };
}
