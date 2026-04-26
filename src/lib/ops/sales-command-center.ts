/**
 * Sales Command Center — pure aggregator helpers.
 *
 * Phase 1: read-only consolidation of the day's revenue actions across
 * the existing internal surfaces. No mutations. No fetches. No imports
 * of HTTP clients (Gmail / Faire / HubSpot / Shopify). The aggregator
 * accepts already-fetched source results and turns them into a typed
 * dashboard shape with explicit `not_wired` markers for any source
 * that doesn't have an API.
 *
 * Why this layer exists:
 *   1. The route at `GET /api/ops/sales` is the only network-touching
 *      surface; this module stays pure so it's trivially testable
 *      without mocking @vercel/kv, fetch, or the control plane.
 *   2. Each source returns a discriminated union — values when wired,
 *      `{ status: "not_wired", reason }` when there's no list API for
 *      it. The aggregator never invents counts on a not_wired source.
 *   3. Sort order and section composition are locked here so the page
 *      can't accidentally drift from the contract.
 *
 * Out of scope for Phase 1:
 *   - Action buttons. The UI links to existing workflow pages only.
 *   - Mutations of any kind. This module never writes anything.
 *   - "Smart" prioritization beyond "most-stale-first" sort within the
 *     follow-up section, which already comes pre-sorted from
 *     `reportFollowUps`.
 */

// ---------------------------------------------------------------------------
// Source discriminated unions
// ---------------------------------------------------------------------------

export type SourceState<T> =
  | { status: "wired"; value: T }
  | { status: "not_wired"; reason: string }
  | { status: "error"; reason: string };

/** Helper for callers building `SourceState` values inline. */
export const sourceWired = <T>(value: T): SourceState<T> => ({
  status: "wired",
  value,
});
export const sourceNotWired = (reason: string): SourceState<never> => ({
  status: "not_wired",
  reason,
});
export const sourceError = (reason: string): SourceState<never> => ({
  status: "error",
  reason,
});

// ---------------------------------------------------------------------------
// Per-source input shapes
// ---------------------------------------------------------------------------

export interface FaireInviteCounts {
  needs_review: number;
  approved: number;
  sent: number;
  rejected: number;
  total: number;
}

export interface FaireFollowUpCounts {
  overdue: number;
  due_soon: number;
  not_due: number;
  /** Total invites with status="sent" (denominator of the queue). */
  sent_total: number;
}

export interface FaireFollowUpRowSummary {
  id: string;
  retailerName: string;
  email: string;
  daysSinceSent: number | null;
  bucket: "overdue" | "due_soon";
}

export interface ApPacketCounts {
  total: number;
  ready_to_send: number;
  action_required: number;
  /** Slugs that have a `lastSent` row in KV. */
  sent: number;
}

export interface LocationDraftCounts {
  needs_review: number;
  accepted: number;
  rejected: number;
  total: number;
}

export interface PendingApprovalSummary {
  /** Total pending approvals across all entity types. */
  total: number;
  /** Subset bucketed by `targetEntity.type` so the dashboard can hint
   *  at which workflow surface owns each pending approval. */
  byTargetType: Record<string, number>;
  /** Up to 5 representative pending rows for the dashboard preview. */
  preview: Array<{
    id: string;
    targetType: string;
    label: string | null;
    actionSlug: string;
    createdAt: string;
  }>;
}

// ---------------------------------------------------------------------------
// Aggregator input + output
// ---------------------------------------------------------------------------

export interface SalesCommandCenterInput {
  faireInvites: SourceState<FaireInviteCounts>;
  faireFollowUps: SourceState<{
    counts: FaireFollowUpCounts;
    /** Pre-sorted (most-stale-first) actionable rows from
     *  `reportFollowUps`. Aggregator preserves order and slices the
     *  top N for display. */
    actionable: FaireFollowUpRowSummary[];
  }>;
  /** Wholesale inquiries — there is no list endpoint today. The
   *  caller passes `not_wired` and we surface that honestly. */
  wholesaleInquiries: SourceState<{ total: number; lastSubmittedAt?: string }>;
  pendingApprovals: SourceState<PendingApprovalSummary>;
  apPackets: SourceState<ApPacketCounts>;
  locationDrafts: SourceState<LocationDraftCounts>;
  /** Optional: a list of env-var names that the aggregator caller
   *  knows are missing and which would let additional sources go
   *  wired. The dashboard surfaces these as "Blockers" with a link to
   *  /ops/readiness. */
  missingEnv?: string[];
  /** Phase 3 — aging stream from the unified aging readers. The
   *  caller fetches via `readAllAgingItems(now)` and passes the
   *  result here. Optional: when omitted, the report's `aging`
   *  section is empty (no items, no missing-timestamp rows). */
  agingItems?: AgingItem[];
  agingMissing?: MissingTimestampItem[];
  /** How many actionable aging rows to surface in the dashboard's
   *  Aging section. Defaults to 10. */
  agingTopLimit?: number;
  /** Phase 4 — per-channel last-7-day revenue from
   *  `readAllChannelsLast7d(now)`. The aggregator passes these to
   *  `composeRevenueKpi` which assembles the scorecard report. */
  revenueChannels?: ChannelRevenueState[];
}

export interface SectionTodaysRevenueActions {
  // Roll-up counts for the top of the page. The numbers are exact;
  // when a source is not_wired we mark it as `null` (not zero) so the
  // UI can render "—" instead of "0".
  faireInvitesNeedsReview: number | null;
  faireFollowUpsActionable: number | null;
  pendingApprovals: number | null;
  retailDraftsNeedsReview: number | null;
  apPacketsActionRequired: number | null;
  /** True when ANY source above is non-zero/actionable. */
  anyAction: boolean;
}

export interface SectionFaireDirect {
  state: SourceState<FaireInviteCounts>;
  link: { href: string; label: string };
}

export interface SectionFollowUps {
  state: SourceState<{
    counts: FaireFollowUpCounts;
    /** Top 5 most-stale rows for at-a-glance triage. */
    topActionable: FaireFollowUpRowSummary[];
  }>;
  link: { href: string; label: string };
}

export interface SectionWholesaleOnboarding {
  inquiries: SourceState<{ total: number; lastSubmittedAt?: string }>;
  apPackets: SourceState<ApPacketCounts>;
  links: Array<{ href: string; label: string }>;
}

export interface SectionRetailProof {
  state: SourceState<LocationDraftCounts>;
  link: { href: string; label: string };
}

export interface SectionAwaitingBen {
  state: SourceState<PendingApprovalSummary>;
  /** Slack #ops-approvals link when an approvals surface exists in
   *  the env. Always rendered as informational — Phase 1 has no
   *  Slack-app deep-link helper, so the UI shows a static reminder. */
  slackChannel: string;
}

export interface SectionBlockers {
  /** ENV var names that would let additional sources go wired. */
  missingEnv: string[];
  /** Source-level errors / not_wired reasons collected for one panel. */
  notes: Array<{
    source: string;
    state: "not_wired" | "error";
    reason: string;
  }>;
  link: { href: string; label: string };
}

export interface SalesCommandCenterReport {
  generatedAt: string;
  todaysRevenueActions: SectionTodaysRevenueActions;
  faireDirect: SectionFaireDirect;
  followUps: SectionFollowUps;
  wholesaleOnboarding: SectionWholesaleOnboarding;
  retailProof: SectionRetailProof;
  awaitingBen: SectionAwaitingBen;
  aging: SectionAging;
  /** Phase 4 — Weekly Revenue KPI Scorecard (read-only). */
  kpiScorecard: RevenueKpiReport;
  blockers: SectionBlockers;
}

// ---------------------------------------------------------------------------
// Aging / SLA section (Phase 3)
// ---------------------------------------------------------------------------
//
// The aging section is a separate concern from the per-source counts
// above. It surfaces the OLDEST actionable rows across every queue
// in one place, plus a "timestamp missing" panel for sources that
// can't compute an age (today: AP packets — see sales-aging.ts).

import {
  composeAgingBriefCallouts,
  selectTopAging,
  type AgingItem,
  type AgingCallout,
  type AgingTier,
  type MissingTimestampItem,
} from "./sales-aging";
import {
  composeRevenueKpi,
  renderRevenueKpiBriefLine,
  type ChannelRevenueState,
  type RevenueKpiReport,
  type RevenueKpiSlice,
} from "./revenue-kpi";

export interface SectionAging {
  /** Top-N (default 10) actionable rows, sorted critical→overdue→watch,
   *  oldest-first within each tier. */
  topItems: AgingItem[];
  /** Counts per tier across the whole stream, NOT just topItems. */
  counts: {
    critical: number;
    overdue: number;
    watch: number;
    fresh: number;
    total: number;
  };
  /** Rows whose source had no usable anchor timestamp. */
  missingTimestamps: MissingTimestampItem[];
  /** Stable deep-link to the dashboard for full triage. */
  link: { href: string; label: string };
}

// ---------------------------------------------------------------------------
// Compact slice for the morning Slack brief
// ---------------------------------------------------------------------------
//
// Phase 2: the daily-brief composer needs a *tight* projection of the
// dashboard report — not the full SalesCommandCenterReport. The slice
// is small on purpose so the morning Slack section stays under ~10
// lines and never duplicates pre-flight or finance content.
//
// Each numeric is `number | null`:
//   - `number` when the underlying source is wired (zero is a real
//     count — "wired but quiet").
//   - `null` when the source is not_wired or errored (renders as
//     "not wired" in the Slack section, never as 0).

export interface SalesCommandSlice {
  /** Faire invites awaiting operator review (status="needs_review"). */
  faireInvitesNeedsReview: number | null;
  faireFollowUpsOverdue: number | null;
  faireFollowUpsDueSoon: number | null;
  /** Pending Slack approvals across every workflow. */
  pendingApprovals: number | null;
  apPacketsActionRequired: number | null;
  apPacketsSent: number | null;
  /** Phase 3 — up to 3 aging callouts (critical-first, then overdue,
   *  then watch). Empty array when nothing crosses the watch threshold.
   *  The renderer skips the callouts block entirely when empty so the
   *  morning brief stays quiet on quiet days. */
  agingCallouts?: AgingCallout[];
  /** Phase 4 — one-line Weekly Revenue KPI summary. NEVER fabricates
   *  a number — when no channel is wired, `revenueKpi.text` carries
   *  the explicit "Revenue pace not fully wired." copy. */
  revenueKpi?: RevenueKpiSlice;
  retailDraftsNeedsReview: number | null;
  retailDraftsAccepted: number | null;
  /** Wholesale inquiries — currently `null` because the source is
   *  not_wired. Keeping the shape uniform lets a future writer flip
   *  this on without changing the renderer. */
  wholesaleInquiries: number | null;
  /** True when at least one wired count above is positive. The
   *  composer uses this to decide between the empty-state copy and
   *  the actionable rendering. */
  anyAction: boolean;
}

/**
 * Build the compact slice from the same `SalesCommandCenterInput`
 * that the dashboard route uses. The projection is deterministic and
 * pure — feeding identical inputs produces identical slices.
 */
export function composeSalesCommandSlice(
  input: SalesCommandCenterInput,
): SalesCommandSlice {
  const faireInvitesNeedsReview = wiredOrNull(
    input.faireInvites,
    (c) => c.needs_review,
  );
  const faireFollowUpsOverdue = wiredOrNull(
    input.faireFollowUps,
    ({ counts }) => counts.overdue,
  );
  const faireFollowUpsDueSoon = wiredOrNull(
    input.faireFollowUps,
    ({ counts }) => counts.due_soon,
  );
  const pendingApprovals = wiredOrNull(
    input.pendingApprovals,
    (c) => c.total,
  );
  const apPacketsActionRequired = wiredOrNull(
    input.apPackets,
    (c) => c.action_required,
  );
  const apPacketsSent = wiredOrNull(input.apPackets, (c) => c.sent);
  const retailDraftsNeedsReview = wiredOrNull(
    input.locationDrafts,
    (c) => c.needs_review,
  );
  const retailDraftsAccepted = wiredOrNull(
    input.locationDrafts,
    (c) => c.accepted,
  );
  const wholesaleInquiries = wiredOrNull(
    input.wholesaleInquiries,
    (c) => c.total,
  );

  // Phase 3 — derive up to 3 aging callouts from the input's
  // agingItems list. The aging stream is sorted critical→overdue→
  // watch by `composeAgingBriefCallouts`; fresh rows are filtered.
  const agingItems = Array.isArray(input.agingItems) ? input.agingItems : [];
  const agingCallouts = composeAgingBriefCallouts(agingItems, {
    maxCallouts: 3,
  });

  // Phase 4 — Weekly Revenue KPI one-liner. Composes the full report
  // pure (composeRevenueKpi is deterministic); the brief renderer
  // never invents a number — when actual is null, it returns the
  // explicit "Revenue pace not fully wired." copy.
  const kpiReport = composeRevenueKpi(
    { channels: Array.isArray(input.revenueChannels) ? input.revenueChannels : [] },
  );
  const revenueKpi = renderRevenueKpiBriefLine(kpiReport);

  const anyAction =
    [
      faireInvitesNeedsReview,
      faireFollowUpsOverdue,
      faireFollowUpsDueSoon,
      pendingApprovals,
      apPacketsActionRequired,
      retailDraftsNeedsReview,
    ].some((n) => typeof n === "number" && n > 0) ||
    // An aging callout means at least one watch/overdue/critical row
    // exists — that's actionable even when the per-source counts are
    // all zero (e.g. a follow-up that's been sitting too long).
    agingCallouts.length > 0;

  return {
    faireInvitesNeedsReview,
    faireFollowUpsOverdue,
    faireFollowUpsDueSoon,
    pendingApprovals,
    apPacketsActionRequired,
    apPacketsSent,
    retailDraftsNeedsReview,
    retailDraftsAccepted,
    wholesaleInquiries,
    agingCallouts,
    revenueKpi,
    anyAction,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the inner value when a source is wired; otherwise null. Used
 *  by the top-of-page roll-ups so a not_wired source renders "—"
 *  instead of "0" (which would be a fabricated count). */
function wiredOrNull<T, R>(
  state: SourceState<T>,
  pick: (v: T) => R,
): R | null {
  return state.status === "wired" ? pick(state.value) : null;
}

const TOP_ACTIONABLE_LIMIT = 5;

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

export function buildSalesCommandCenter(
  input: SalesCommandCenterInput,
  options: { now?: Date } = {},
): SalesCommandCenterReport {
  const generatedAt = (options.now ?? new Date()).toISOString();

  // ---- Today's revenue actions roll-up ---------------------------------
  const faireInvitesNeedsReview = wiredOrNull(
    input.faireInvites,
    (c) => c.needs_review,
  );
  const faireFollowUpsActionable = wiredOrNull(
    input.faireFollowUps,
    ({ counts }) => counts.overdue + counts.due_soon,
  );
  const pendingApprovals = wiredOrNull(
    input.pendingApprovals,
    (c) => c.total,
  );
  const retailDraftsNeedsReview = wiredOrNull(
    input.locationDrafts,
    (c) => c.needs_review,
  );
  const apPacketsActionRequired = wiredOrNull(
    input.apPackets,
    (c) => c.action_required,
  );

  const anyAction = [
    faireInvitesNeedsReview,
    faireFollowUpsActionable,
    pendingApprovals,
    retailDraftsNeedsReview,
    apPacketsActionRequired,
  ].some((n) => typeof n === "number" && n > 0);

  // ---- Faire follow-ups: keep pre-sorted order, slice top N -----------
  let followUpsState: SectionFollowUps["state"];
  if (input.faireFollowUps.status === "wired") {
    const { counts, actionable } = input.faireFollowUps.value;
    // The route caller MUST already pass actionable rows pre-sorted
    // most-stale-first (matches `reportFollowUps`). We just slice. We
    // do NOT re-sort here so the contract stays "the report's source
    // is authoritative for ordering."
    followUpsState = {
      status: "wired",
      value: {
        counts,
        topActionable: actionable.slice(0, TOP_ACTIONABLE_LIMIT),
      },
    };
  } else {
    followUpsState = input.faireFollowUps;
  }

  // ---- Blockers section: collect not_wired/error notes ----------------
  const notes: SectionBlockers["notes"] = [];
  const checks: Array<[string, SourceState<unknown>]> = [
    ["faireInvites", input.faireInvites],
    ["faireFollowUps", input.faireFollowUps],
    ["wholesaleInquiries", input.wholesaleInquiries],
    ["pendingApprovals", input.pendingApprovals],
    ["apPackets", input.apPackets],
    ["locationDrafts", input.locationDrafts],
  ];
  for (const [name, state] of checks) {
    if (state.status === "not_wired" || state.status === "error") {
      notes.push({ source: name, state: state.status, reason: state.reason });
    }
  }

  return {
    generatedAt,
    todaysRevenueActions: {
      faireInvitesNeedsReview,
      faireFollowUpsActionable,
      pendingApprovals,
      retailDraftsNeedsReview,
      apPacketsActionRequired,
      anyAction,
    },
    faireDirect: {
      state: input.faireInvites,
      link: {
        href: "/ops/faire-direct",
        label: "Open Faire Direct queue",
      },
    },
    followUps: {
      state: followUpsState,
      // The follow-up panel lives on the same page as the invite
      // queue (Phase 3.2 added it as a section above the invite
      // tables). Don't fabricate a separate URL.
      link: {
        href: "/ops/faire-direct",
        label: "Open follow-up queue",
      },
    },
    wholesaleOnboarding: {
      inquiries: input.wholesaleInquiries,
      apPackets: input.apPackets,
      links: [
        { href: "/ops/ap-packets", label: "AP packet dashboard" },
        { href: "/ops/finance/review", label: "Finance review" },
      ],
    },
    retailProof: {
      state: input.locationDrafts,
      link: {
        href: "/ops/locations",
        label: "Open store locator drafts",
      },
    },
    awaitingBen: {
      state: input.pendingApprovals,
      slackChannel: "#ops-approvals",
    },
    aging: buildAgingSection(input),
    kpiScorecard: composeRevenueKpi(
      { channels: input.revenueChannels ?? [] },
      { now: options.now ?? new Date(generatedAt) },
    ),
    blockers: {
      missingEnv: Array.isArray(input.missingEnv) ? [...input.missingEnv] : [],
      notes,
      link: { href: "/ops/readiness", label: "Open readiness dashboard" },
    },
  };
}

/** Pure assembler for the aging section. Keeps the main builder lean. */
function buildAgingSection(input: SalesCommandCenterInput): SectionAging {
  const items = Array.isArray(input.agingItems) ? input.agingItems : [];
  const missing = Array.isArray(input.agingMissing) ? input.agingMissing : [];
  const limit = Math.max(0, input.agingTopLimit ?? 10);

  const counts = {
    critical: 0,
    overdue: 0,
    watch: 0,
    fresh: 0,
    total: items.length,
  };
  for (const item of items) {
    counts[item.tier as AgingTier] += 1;
  }
  // Top items: actionable only (no fresh), oldest critical first.
  const topItems = selectTopAging(items, limit);
  // Sort the missing-timestamp panel by source name for determinism.
  const missingSorted = [...missing].sort((a, b) =>
    a.source === b.source
      ? a.id.localeCompare(b.id)
      : a.source.localeCompare(b.source),
  );
  return {
    topItems,
    counts,
    missingTimestamps: missingSorted,
    link: { href: "/ops/sales", label: "Open Sales Command" },
  };
}
