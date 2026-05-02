/**
 * What Needs Ben — pure aggregator for the master daily card.
 *
 * Caps Build 2 per docs/SYSTEM_BUILD_CONTINUATION_BLUEPRINT.md §4.
 * Roll-up across the six lane summaries (email queue, finance,
 * marketing, shipping, proposals, sales) into one card that answers
 * "what does Ben need to look at first?"
 *
 * Pure module: caller fetches each lane summary fail-soft and feeds
 * them in. The aggregator picks the highest-priority red/yellow lane
 * and surfaces a single recommendation. No I/O, no env reads.
 */
import type { EmailAgentQueueSummary } from "./email-agent-queue";
import type { FinanceTodaySummary } from "./finance-today";
import type { MarketingTodaySummary } from "./marketing-today";
import type { ShippingTodaySummary } from "./shipping-today";
import type { ExternalProposalsSummary } from "./external-proposals";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LaneId =
  | "email"
  | "finance"
  | "marketing"
  | "shipping"
  | "proposals"
  | "sales";

export type LanePosture = "green" | "yellow" | "red" | "unknown";

export interface LaneStatus {
  id: LaneId;
  label: string;
  posture: LanePosture;
  /** One-line summary (e.g. "3 pending · 1 stale"). */
  summary: string;
  /** Slack command that opens the dedicated lane card. */
  slashCommand: string;
  /** True iff the lane fetch failed (lane appears with posture="unknown"). */
  degraded: boolean;
}

export interface SalesLaneInput {
  /** Pending non-finance / non-shipping approvals across the system. */
  pendingApprovals: number;
  /** Open Class B/C approvals stale ≥3 days old. */
  staleApprovals: number;
  /** Optional posture override for callers that have a richer signal. */
  posture?: LanePosture;
  /** Optional summary override. */
  summary?: string;
  degraded?: boolean;
}

export interface WhatNeedsBenInput {
  email: EmailAgentQueueSummary | null;
  finance: FinanceTodaySummary | null;
  marketing: MarketingTodaySummary | null;
  shipping: ShippingTodaySummary | null;
  proposals: ExternalProposalsSummary | null;
  sales: SalesLaneInput | null;
  /** "now" override for tests. */
  now?: Date;
  /** Source-level degraded list (e.g. "email-queue: kv-down"). */
  degraded?: ReadonlyArray<string>;
}

export interface WhatNeedsBenSummary {
  generatedAt: string;
  /** Overall posture — worst of the 6 lanes (red > yellow > green > unknown). */
  posture: LanePosture;
  /** Per-lane status for the card. */
  lanes: LaneStatus[];
  /** Top recommendation: the highest-priority lane + a one-line CTA. */
  recommendation: {
    laneId: LaneId | null;
    text: string;
  };
  /** Counts at a glance. */
  counts: {
    red: number;
    yellow: number;
    green: number;
    unknown: number;
  };
  degraded: string[];
}

// ---------------------------------------------------------------------------
// Lane projections
// ---------------------------------------------------------------------------

const LANE_LABELS: Record<LaneId, string> = {
  sales: "Sales",
  email: "Email",
  finance: "Finance",
  marketing: "Marketing",
  shipping: "Shipping",
  proposals: "Proposals",
};

const LANE_COMMANDS: Record<LaneId, string> = {
  sales: "ops today",
  email: "email queue",
  finance: "finance today",
  marketing: "marketing today",
  shipping: "shipping today",
  proposals: "proposals",
};

function projectEmailLane(s: EmailAgentQueueSummary | null): LaneStatus {
  if (!s) {
    return unknown("email");
  }
  // Email lane posture rules:
  //   - red: any whale-class record in queue
  //   - yellow: any classified record OR backlog > 0
  //   - green: empty / only noise
  let posture: LanePosture = "green";
  if (s.whaleCount > 0) posture = "red";
  else if (s.byStatus.classified > 0 || s.backlogReceived > 0) {
    posture = "yellow";
  }
  const summary =
    s.total === 0
      ? "queue empty"
      : `${s.byStatus.classified} classified · ${s.backlogReceived} backlog · ${s.whaleCount} whale`;
  return baseLane("email", posture, summary);
}

function projectFinanceLane(s: FinanceTodaySummary | null): LaneStatus {
  if (!s) return unknown("finance");
  const summary =
    s.pendingFinanceApprovals === 0 && s.draftEligiblePackets === 0
      ? "clean"
      : `${s.pendingFinanceApprovals} pending · ${s.draftEligiblePackets} eligible drafts`;
  return baseLane("finance", s.posture, summary);
}

function projectMarketingLane(s: MarketingTodaySummary | null): LaneStatus {
  if (!s) return unknown("marketing");
  const summary =
    s.totals.configuredPlatforms === 0
      ? "no platforms configured"
      : s.totals.activeCampaigns === 0
        ? "0 active campaigns"
        : `$${s.totals.spend30d.toFixed(0)} 30d · ${s.totals.roas30d.toFixed(2)}x ROAS · ${s.totals.activeCampaigns} active`;
  return baseLane("marketing", s.posture, summary);
}

function projectShippingLane(s: ShippingTodaySummary | null): LaneStatus {
  if (!s) return unknown("shipping");
  const parts: string[] = [];
  if (s.retryQueue.exhausted > 0) {
    parts.push(`${s.retryQueue.exhausted} exhausted`);
  }
  if (s.retryQueue.pending > 0) {
    parts.push(`${s.retryQueue.pending} pending`);
  }
  if (s.walletAlerts.length > 0) parts.push("wallet alert");
  if (s.pendingApprovals > 0) parts.push(`${s.pendingApprovals} approvals`);
  const summary = parts.length === 0 ? "clean" : parts.join(" · ");
  return baseLane("shipping", s.posture, summary);
}

function projectProposalsLane(
  s: ExternalProposalsSummary | null,
): LaneStatus {
  if (!s) return unknown("proposals");
  // Proposals posture:
  //   - red: any flagged direct-mutation in queued (Ben should review now)
  //   - yellow: queued > 0
  //   - green: 0 queued
  let posture: LanePosture = "green";
  if (s.queued > 0) posture = "yellow";
  if (
    s.flaggedDirectMutation > 0 &&
    s.queued > 0
  ) {
    // Surface flagged-mutation queued as red — those are the highest-stakes.
    posture = "red";
  }
  const summary =
    s.queued === 0
      ? "0 queued"
      : `${s.queued} queued · ${s.flaggedDirectMutation} flagged`;
  return baseLane("proposals", posture, summary);
}

function projectSalesLane(s: SalesLaneInput | null): LaneStatus {
  if (!s) return unknown("sales");
  const posture: LanePosture =
    s.posture ??
    (s.staleApprovals > 0
      ? "red"
      : s.pendingApprovals > 0
        ? "yellow"
        : "green");
  const summary =
    s.summary ??
    (s.pendingApprovals === 0
      ? "clean"
      : `${s.pendingApprovals} pending · ${s.staleApprovals} stale`);
  return {
    id: "sales",
    label: LANE_LABELS.sales,
    posture,
    summary,
    slashCommand: LANE_COMMANDS.sales,
    degraded: s.degraded ?? false,
  };
}

function unknown(id: LaneId): LaneStatus {
  return {
    id,
    label: LANE_LABELS[id],
    posture: "unknown",
    summary: "unavailable",
    slashCommand: LANE_COMMANDS[id],
    degraded: true,
  };
}

function baseLane(
  id: LaneId,
  posture: LanePosture,
  summary: string,
): LaneStatus {
  return {
    id,
    label: LANE_LABELS[id],
    posture,
    summary,
    slashCommand: LANE_COMMANDS[id],
    degraded: false,
  };
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

/**
 * Lane priority order for picking the recommendation.
 * Highest priority lanes appear first — when two lanes have the same
 * posture severity, the higher-priority lane wins.
 *
 * Rationale:
 *   shipping  — exhausted retries / wallet alerts block paying customers TODAY
 *   finance   — stale approvals risk dropping decisions Rene is waiting on
 *   email     — whale-class records gate everything downstream
 *   sales     — pending sales approvals delay revenue
 *   proposals — flagged mutations queue but don't ship without operator promotion
 *   marketing — ad spend issues hurt unit economics over days, not minutes
 */
const LANE_PRIORITY: ReadonlyArray<LaneId> = [
  "shipping",
  "finance",
  "email",
  "sales",
  "proposals",
  "marketing",
];

const POSTURE_RANK: Record<LanePosture, number> = {
  red: 0,
  yellow: 1,
  unknown: 2,
  green: 3,
};

export function summarizeWhatNeedsBen(
  input: WhatNeedsBenInput,
): WhatNeedsBenSummary {
  const now = input.now ?? new Date();
  const lanes: LaneStatus[] = [
    projectShippingLane(input.shipping),
    projectFinanceLane(input.finance),
    projectEmailLane(input.email),
    projectSalesLane(input.sales),
    projectProposalsLane(input.proposals),
    projectMarketingLane(input.marketing),
  ];

  const counts = { red: 0, yellow: 0, green: 0, unknown: 0 };
  for (const l of lanes) counts[l.posture] += 1;

  // Overall posture is the worst lane (red > yellow > unknown > green).
  // Note: we treat `unknown` as worse than green but better than yellow —
  // a degraded fetch could be hiding a yellow, but we don't escalate
  // unknown to red without evidence.
  let overall: LanePosture = "green";
  if (counts.red > 0) overall = "red";
  else if (counts.yellow > 0) overall = "yellow";
  else if (counts.unknown > 0) overall = "unknown";

  // Recommendation: pick the lane with worst posture, tie-broken by
  // LANE_PRIORITY order.
  const candidates = [...lanes].sort((a, b) => {
    const r = POSTURE_RANK[a.posture] - POSTURE_RANK[b.posture];
    if (r !== 0) return r;
    return LANE_PRIORITY.indexOf(a.id) - LANE_PRIORITY.indexOf(b.id);
  });
  const top = candidates[0];

  let recommendation: WhatNeedsBenSummary["recommendation"];
  if (top.posture === "green") {
    recommendation = {
      laneId: null,
      text: "Clean across all lanes — no action needed.",
    };
  } else if (top.posture === "unknown") {
    recommendation = {
      laneId: null,
      text:
        "All lanes returned green or unavailable. Investigate the unavailable ones in the morning brief.",
    };
  } else {
    const verb = top.posture === "red" ? "🚨 Start with" : "Start with";
    recommendation = {
      laneId: top.id,
      text: `${verb} *${top.label}* — ${top.summary}. Run \`${top.slashCommand}\` for the details.`,
    };
  }

  return {
    generatedAt: now.toISOString(),
    posture: overall,
    lanes,
    recommendation,
    counts,
    degraded: [...(input.degraded ?? [])],
  };
}
