/**
 * Reorder follow-up — Phase D4 of the B2B Revenue Operating Loop.
 *
 * Doctrine: `/contracts/session-handoff.md` "Active build directive"
 * Phase D, sub-lane D4 — channel-aware reorder windows:
 *   • Amazon FBM     : 60 days
 *   • Shopify DTC    : 90 days  (D4 v0.2 — needs admin Customer query)
 *   • Wholesale (B2B): 90 days
 *
 * v0.1 ships Amazon + wholesale. Shopify DTC slot is reserved in the
 * `ReorderCandidate.channel` enum but not populated until v0.2 wires
 * the Shopify admin Customer query.
 *
 * Pure functions only. No I/O. The fetchers feed in via the daily-brief
 * route; this module classifies + summarizes.
 */
import { HUBSPOT } from "@/lib/ops/hubspot-client";

import type { HubSpotDealForStaleness } from "./stale-buyer";
import { daysBetween } from "./stale-buyer";

/** Per-channel reorder windows (days). Locked per session-handoff Phase D. */
export const REORDER_WINDOW_DAYS = {
  "amazon-fbm": 60,
  "shopify-dtc": 90,
  wholesale: 90,
} as const;

export type ReorderChannel = keyof typeof REORDER_WINDOW_DAYS;

/** A single reorder candidate — buyer N+ days past their channel's window. */
export interface ReorderCandidate {
  channel: ReorderChannel;
  /** Stable identifier. For Amazon: `amazon:{fingerprint}`. For wholesale: `hubspot-deal:{dealId}`. */
  id: string;
  /** Display name (Amazon: shipToName, wholesale: deal name / company). */
  displayName: string;
  /** Days since last order. */
  daysSinceLastOrder: number;
  /** Days threshold that was crossed. */
  windowDays: number;
  /** Channel-specific suggested next-action. */
  nextAction: string;
  /** Optional metadata for the brief / dashboards. */
  meta: {
    /** Total prior order count (Amazon `orderCount`, wholesale: 1 if Shipped, more if Reorder stage). */
    priorOrders?: number;
    /** Last-order ISO timestamp. */
    lastOrderAt?: string;
    /** Channel-specific extra (e.g. Amazon ZIP, wholesale stage). */
    extra?: string;
  };
}

/** Roll-up summary for the morning-brief slice. */
export interface ReorderFollowUpSummary {
  asOf: string;
  /** Top-N candidates across channels, prioritized by channel weight then days desc. */
  topCandidates: ReorderCandidate[];
  /** Counts per channel (only channels with at least one candidate). */
  byChannel: Array<{ channel: ReorderChannel; count: number; windowDays: number }>;
  /** Total candidates surfaced (all channels). */
  total: number;
  /** Source citations per `/contracts/governance.md` §1 #2. */
  sources: Array<{ system: "amazon-fbm-registry" | "hubspot" | "shopify-admin"; retrievedAt: string }>;
}

/** Channel priority for sort tie-breaking. Wholesale first because $/order is highest. */
const CHANNEL_PRIORITY: Record<ReorderChannel, number> = {
  wholesale: 3,
  "amazon-fbm": 2,
  "shopify-dtc": 1,
};

/**
 * Pure helper input — Amazon FBM customer record (subset of the
 * full AmazonCustomerRecord schema; only fields we need).
 */
export interface AmazonReorderInput {
  fingerprint: string;
  shipToName: string;
  shipToCity: string | null;
  shipToState: string | null;
  lastSeenAt: string;
  orderCount: number;
}

/**
 * Identify Amazon FBM reorder candidates. A candidate = repeat buyer
 * (orderCount ≥ 1) whose lastSeenAt is older than the 60-day window.
 *
 * Note on `orderCount = 1`: even a one-time Amazon buyer is a reorder
 * candidate at 60 days — the registry exists specifically to convert
 * one-and-dones. Don't filter to repeat-buyers-only.
 */
export function classifyAmazonReorderCandidates(
  amazonCustomers: AmazonReorderInput[],
  now: Date,
): ReorderCandidate[] {
  const window = REORDER_WINDOW_DAYS["amazon-fbm"];
  const out: ReorderCandidate[] = [];
  for (const c of amazonCustomers) {
    const days = daysBetween(now, c.lastSeenAt);
    if (!Number.isFinite(days)) continue; // null/invalid lastSeenAt → skip
    if (days < window) continue;
    const cityState =
      [c.shipToCity, c.shipToState].filter(Boolean).join(", ") || "(unknown loc)";
    out.push({
      channel: "amazon-fbm",
      id: `amazon:${c.fingerprint}`,
      displayName: c.shipToName,
      daysSinceLastOrder: Math.floor(days),
      windowDays: window,
      nextAction:
        c.orderCount > 1
          ? `Send Amazon FBM repeat-buyer thank-you + sample drop email (orderCount=${c.orderCount})`
          : "Send Amazon FBM first-time-buyer reorder offer",
      meta: {
        priorOrders: c.orderCount,
        lastOrderAt: c.lastSeenAt,
        extra: cityState,
      },
    });
  }
  return out;
}

/**
 * Identify wholesale (HubSpot B2B) reorder candidates. A candidate =
 * deal in STAGE_SHIPPED whose lastActivityAt is older than the 90-day
 * window. Deals already in STAGE_REORDER are EXCLUDED — they're
 * already in the reorder funnel; D4 surfaces the ones that should
 * graduate INTO it.
 */
export function classifyWholesaleReorderCandidates(
  hubspotDeals: HubSpotDealForStaleness[],
  now: Date,
): ReorderCandidate[] {
  const window = REORDER_WINDOW_DAYS.wholesale;
  const out: ReorderCandidate[] = [];
  for (const d of hubspotDeals) {
    if (d.pipelineId !== HUBSPOT.PIPELINE_B2B_WHOLESALE) continue;
    if (d.stageId !== HUBSPOT.STAGE_SHIPPED) continue;
    const days = daysBetween(now, d.lastActivityAt);
    if (!Number.isFinite(days)) continue;
    if (days < window) continue;
    const display = d.primaryCompanyName ?? d.dealname ?? `(deal ${d.id})`;
    out.push({
      channel: "wholesale",
      id: `hubspot-deal:${d.id}`,
      displayName: display,
      daysSinceLastOrder: Math.floor(days),
      windowDays: window,
      nextAction:
        "Move to Reorder stage + send reorder check-in email (or call buyer for in-person trip)",
      meta: {
        priorOrders: 1,
        lastOrderAt: d.lastActivityAt ?? undefined,
        extra: "Shipped → reorder window",
      },
    });
  }
  return out;
}

/** Combine + sort + summarize per-channel candidates. */
export function summarizeReorderFollowUps(
  args: {
    amazonCandidates: ReorderCandidate[];
    wholesaleCandidates: ReorderCandidate[];
    /** v0.2 slot — empty in v0.1. */
    shopifyCandidates?: ReorderCandidate[];
    now: Date;
    sources: Array<{ system: "amazon-fbm-registry" | "hubspot" | "shopify-admin"; retrievedAt: string }>;
    topN?: number;
  },
): ReorderFollowUpSummary {
  const { now, sources } = args;
  const topN = args.topN ?? 10;
  const all = [
    ...args.amazonCandidates,
    ...args.wholesaleCandidates,
    ...(args.shopifyCandidates ?? []),
  ];

  // Sort: channel priority desc → daysSinceLastOrder desc.
  const sorted = [...all].sort((a, b) => {
    const pri =
      (CHANNEL_PRIORITY[b.channel] ?? 0) - (CHANNEL_PRIORITY[a.channel] ?? 0);
    if (pri !== 0) return pri;
    return b.daysSinceLastOrder - a.daysSinceLastOrder;
  });

  const byChannelMap = new Map<ReorderChannel, number>();
  for (const c of all) {
    byChannelMap.set(c.channel, (byChannelMap.get(c.channel) ?? 0) + 1);
  }
  const byChannel = Array.from(byChannelMap.entries())
    .map(([channel, count]) => ({
      channel,
      count,
      windowDays: REORDER_WINDOW_DAYS[channel],
    }))
    .sort((a, b) => b.count - a.count);

  return {
    asOf: now.toISOString(),
    topCandidates: sorted.slice(0, topN),
    byChannel,
    total: all.length,
    sources,
  };
}
