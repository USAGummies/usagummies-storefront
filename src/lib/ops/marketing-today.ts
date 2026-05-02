/**
 * Marketing Today — pure-logic aggregator for the daily marketing card.
 *
 * Build 7 per docs/SYSTEM_BUILD_CONTINUATION_BLUEPRINT.md §4. Brings
 * marketing up to the same daily-card pattern as `email queue` and
 * `finance today`: a single Slack-or-browser surface that answers
 * "what does paid marketing look like today?"
 *
 * Pure module — caller fetches the raw inputs (Meta/Google/TikTok
 * platform status + campaign rows + pending marketing approvals) and
 * passes them in. Easy to test.
 *
 * No fabricated zeros: `not_configured` is distinct from `error` is
 * distinct from `empty`. The route layer fail-softs each platform
 * independently → degraded[] entries → posture downgrade.
 */
import type { ApprovalRequest, DivisionId } from "./control-plane/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MarketingPlatformId = "meta" | "google" | "tiktok";

export type MarketingPlatformStatus =
  | "not_configured"
  | "configured_no_campaigns"
  | "active"
  | "error";

export interface MarketingPlatformInput {
  platform: MarketingPlatformId;
  configured: boolean;
  /** When fetched: campaign rows. Empty array when no campaigns or fetch failed. */
  campaigns: ReadonlyArray<MarketingCampaignInput>;
  /** Set when fetch threw — flag the platform as `error` not `empty`. */
  fetchError?: string | null;
}

export interface MarketingCampaignInput {
  id: string;
  name: string;
  /** Platform-native status string (active / paused / archived / etc.). */
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  /** Computed ROAS — preserved as-is from the platform fetcher. */
  roas: number;
}

export interface MarketingPlatformSummary {
  platform: MarketingPlatformId;
  status: MarketingPlatformStatus;
  configured: boolean;
  activeCampaignCount: number;
  campaignCount: number;
  spend30d: number;
  revenue30d: number;
  conversions30d: number;
  /** Spend-weighted ROAS over campaigns where spend > 0 (else 0). */
  roas30d: number;
  fetchError: string | null;
}

export interface MarketingTodaySummary {
  generatedAt: string;
  /** Per-platform roll-up. */
  platforms: MarketingPlatformSummary[];
  /** Total spend / revenue / conversions across all platforms. */
  totals: {
    spend30d: number;
    revenue30d: number;
    conversions30d: number;
    /** Spend-weighted ROAS across every platform/campaign. */
    roas30d: number;
    activeCampaigns: number;
    configuredPlatforms: number;
  };
  /** Pending marketing-class approvals (any slug). */
  pendingApprovals: number;
  /** 5 oldest pending approvals (oldest first). */
  oldestPendingApprovals: Array<{
    id: string;
    actorAgentId: string;
    action: string;
    createdAt: string;
    ageDays: number;
  }>;
  /**
   * Platforms that are configured but produced an error / zero campaigns.
   * Distinct from `not_configured` — these are the actionable blockers.
   */
  blockers: Array<{ platform: MarketingPlatformId; reason: string }>;
  /** Posture: green clean / yellow work waiting / red blockers or stale approvals. */
  posture: "green" | "yellow" | "red";
  /** Sources that failed (passed through). */
  degraded: string[];
}

export interface MarketingTodayInput {
  platforms: ReadonlyArray<MarketingPlatformInput>;
  pendingApprovals: ReadonlyArray<ApprovalRequest>;
  now?: Date;
  degraded?: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOP_N = 5;
const STALE_DAYS = 3;

const MARKETING_DIVISIONS: ReadonlySet<DivisionId> = new Set<DivisionId>([
  "marketing-brand",
  "marketing-paid",
]);

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

export function summarizeMarketingToday(
  input: MarketingTodayInput,
): MarketingTodaySummary {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();

  const platforms = input.platforms.map((p) => projectPlatform(p));
  const totals = rollUpTotals(platforms);

  const marketingPending = input.pendingApprovals.filter((a) =>
    MARKETING_DIVISIONS.has(a.division),
  );
  const oldestPendingApprovals = [...marketingPending]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(0, TOP_N)
    .map((a) => ({
      id: a.id,
      actorAgentId: a.actorAgentId,
      action: a.action,
      createdAt: a.createdAt,
      ageDays: Math.max(
        0,
        Math.round((nowMs - Date.parse(a.createdAt)) / (24 * 3600 * 1000)),
      ),
    }));

  const blockers: MarketingTodaySummary["blockers"] = [];
  for (const p of platforms) {
    if (p.status === "error") {
      blockers.push({
        platform: p.platform,
        reason: p.fetchError ?? "fetch error",
      });
    } else if (p.status === "configured_no_campaigns") {
      blockers.push({
        platform: p.platform,
        reason: "configured but no active campaigns",
      });
    }
  }

  const posture = computePosture({
    blockers,
    pendingApprovals: marketingPending.length,
    oldestPendingApprovals,
  });

  return {
    generatedAt: now.toISOString(),
    platforms,
    totals,
    pendingApprovals: marketingPending.length,
    oldestPendingApprovals,
    blockers,
    posture,
    degraded: [...(input.degraded ?? [])],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function projectPlatform(
  p: MarketingPlatformInput,
): MarketingPlatformSummary {
  if (!p.configured) {
    return {
      platform: p.platform,
      status: "not_configured",
      configured: false,
      activeCampaignCount: 0,
      campaignCount: 0,
      spend30d: 0,
      revenue30d: 0,
      conversions30d: 0,
      roas30d: 0,
      fetchError: null,
    };
  }
  if (p.fetchError) {
    return {
      platform: p.platform,
      status: "error",
      configured: true,
      activeCampaignCount: 0,
      campaignCount: 0,
      spend30d: 0,
      revenue30d: 0,
      conversions30d: 0,
      roas30d: 0,
      fetchError: p.fetchError,
    };
  }
  const campaigns = p.campaigns ?? [];
  const active = campaigns.filter((c) => isActiveStatus(c.status));
  const spend = sum(campaigns, (c) => c.spend);
  const revenue = sum(campaigns, (c) => c.revenue);
  const conversions = sum(campaigns, (c) => c.conversions);
  const roas = spend > 0 ? round2(revenue / spend) : 0;
  const status: MarketingPlatformStatus =
    active.length > 0 ? "active" : "configured_no_campaigns";
  return {
    platform: p.platform,
    status,
    configured: true,
    activeCampaignCount: active.length,
    campaignCount: campaigns.length,
    spend30d: round2(spend),
    revenue30d: round2(revenue),
    conversions30d: conversions,
    roas30d: roas,
    fetchError: null,
  };
}

function rollUpTotals(
  platforms: ReadonlyArray<MarketingPlatformSummary>,
): MarketingTodaySummary["totals"] {
  const spend30d = round2(sum(platforms, (p) => p.spend30d));
  const revenue30d = round2(sum(platforms, (p) => p.revenue30d));
  const conversions30d = sum(platforms, (p) => p.conversions30d);
  const roas30d = spend30d > 0 ? round2(revenue30d / spend30d) : 0;
  const activeCampaigns = sum(platforms, (p) => p.activeCampaignCount);
  const configuredPlatforms = platforms.filter((p) => p.configured).length;
  return {
    spend30d,
    revenue30d,
    conversions30d,
    roas30d,
    activeCampaigns,
    configuredPlatforms,
  };
}

function computePosture(args: {
  blockers: MarketingTodaySummary["blockers"];
  pendingApprovals: number;
  oldestPendingApprovals: MarketingTodaySummary["oldestPendingApprovals"];
}): "green" | "yellow" | "red" {
  const stale = args.oldestPendingApprovals.find(
    (a) => a.ageDays >= STALE_DAYS,
  );
  if (stale) return "red";
  // Errors fetching a configured platform are red — silent failure
  // hides spend issues.
  if (args.blockers.some((b) => b.reason !== "configured but no active campaigns")) {
    return "red";
  }
  if (args.blockers.length > 0 || args.pendingApprovals > 0) return "yellow";
  return "green";
}

function isActiveStatus(s: string): boolean {
  // Meta uses ACTIVE, paused = PAUSED. Google/TikTok use similar
  // upper-case strings. We accept any case-insensitive "active".
  return /^active$/i.test(s);
}

function sum<T>(arr: ReadonlyArray<T>, fn: (v: T) => number): number {
  let total = 0;
  for (const v of arr) total += Number(fn(v) || 0);
  return total;
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
