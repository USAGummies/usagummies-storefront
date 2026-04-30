/**
 * Stale-buyer detection — Phase D1 of the B2B Revenue Operating Loop.
 *
 * Doctrine: `/contracts/session-handoff.md` "Active build directive" lane:
 *   "B2B Revenue operating loop (Phase D in original mission directive —
 *    morning-brief actions, stale-buyer detection, sample queue health,
 *    wholesale onboarding blockers, reorder follow-up, Apollo enrichment
 *    with provenance)."
 *
 * Pairs with: `src/lib/sales/prospect-playbook.ts` (Codex's 81-prospect
 * playbook — stale-buyer detection is what pulls those prospects through
 * the pipeline once they enter HubSpot as deals).
 *
 * Pure functions only. No I/O. The HubSpot fetcher lives in
 * `src/lib/ops/hubspot-client.ts`; this module classifies the data the
 * fetcher returns. Composes into the morning brief via
 * `src/lib/ops/control-plane/daily-brief.ts`.
 */
import { HUBSPOT, HUBSPOT_B2B_STAGES } from "@/lib/ops/hubspot-client";

const PIPELINE_B2B_WHOLESALE = HUBSPOT.PIPELINE_B2B_WHOLESALE;

/** Stage IDs we treat as "active" (not Closed Won/Lost, not On Hold). */
export const ACTIVE_STAGE_IDS: readonly string[] = HUBSPOT_B2B_STAGES.filter(
  (s) =>
    s.name !== "Closed Won" &&
    s.name !== "Closed Lost" &&
    s.name !== "On Hold" &&
    s.name !== "Reorder", // Reorder is its own lane (D4); excluded here.
).map((s) => s.id);

/**
 * Per-stage aging thresholds (days). A deal is "stale" when its
 * `lastActivityAt` is older than the threshold for its current stage.
 *
 * Tuned per Ben's operating cadence:
 *   - Early stages (Lead → Contacted) move fast — 5d gap = stalled
 *   - Middle stages (Sample Shipped → Quote/PO Sent) need follow-up
 *     within ~10d before the buyer's interest cools
 *   - Vendor Setup is paperwork — 14d before chase
 *   - PO Received / Shipped are post-decision — surface only at 21d to
 *     avoid noise on already-progressing deals
 */
export const STAGE_AGING_THRESHOLDS_DAYS: Readonly<Record<string, number>> = {
  Lead: 5,
  Contacted: 5,
  Responded: 7,
  "Sample Requested": 7,
  "Sample Shipped": 10,
  "Quote/PO Sent": 7,
  "Vendor Setup": 14,
  "PO Received": 21,
  Shipped: 21,
};

/**
 * Per-stage next-action templates. Surface in the brief so Ben sees not
 * just "deal X is stale" but "deal X needs Y". Action language follows the
 * canonical brand voice rules from `/CLAUDE.md` "Public-Facing Copy Rules"
 * — these are internal/audit copy, not customer-facing, so they CAN
 * mention Ben/internal-ops shorthand. They never get auto-emailed.
 */
export const STAGE_NEXT_ACTIONS: Readonly<Record<string, string>> = {
  Lead: "Send first-touch outreach via send-and-log.py",
  Contacted: "Resend with a different angle (sample offer, sell sheet, brand story)",
  Responded: "Reply with sample-offer or move to Sample Requested",
  "Sample Requested": "Ship sample (Drew if East Coast / Ben if Ashford) + log shipment",
  "Sample Shipped": "Sample-followup email — ask for taste reaction + introduce wholesale tiers",
  "Quote/PO Sent": "Call buyer to confirm receipt + walk through pricing tiers",
  "Vendor Setup": "Resend NCS-001 link + check if buyer needs help on vendor docs",
  "PO Received": "Confirm shipment status + tracking with buyer",
  Shipped: "Reorder check-in — ask if they need to reorder",
};

/** Single deal payload from HubSpot. */
export interface HubSpotDealForStaleness {
  id: string;
  dealname: string | null;
  /** Pipeline ID — used to filter out non-B2B deals defensively. */
  pipelineId: string;
  /** Current stage ID. */
  stageId: string;
  /** Most recent activity (max of last_modified, last_email, stage_changed). ISO-8601. */
  lastActivityAt: string | null;
  /** Optional contact reference for routing the next action. */
  primaryContactId: string | null;
  /** Optional company association. */
  primaryCompanyName: string | null;
}

/** Classification result for a single deal. */
export interface StaleBuyerClassification {
  dealId: string;
  dealName: string;
  stageName: string;
  daysSinceActivity: number;
  thresholdDays: number;
  isStale: boolean;
  nextAction: string;
  primaryContactId: string | null;
  primaryCompanyName: string | null;
}

/** Roll-up summary for the morning brief. */
export interface StaleBuyerSummary {
  asOf: string;
  /** Top N stalest deals across stages. */
  stalest: StaleBuyerClassification[];
  /** Count of stale deals per stage. */
  staleByStage: Array<{ stageName: string; count: number; thresholdDays: number }>;
  /** Total active deals scanned (denominator). */
  activeDealsScanned: number;
  /** Source citation per `/contracts/governance.md` §1 #2. */
  source: { system: "hubspot"; retrievedAt: string };
}

/** Map a stage ID back to its human-readable name. Returns null on unknown. */
export function stageNameForId(stageId: string): string | null {
  const match = HUBSPOT_B2B_STAGES.find((s) => s.id === stageId);
  return match?.name ?? null;
}

/** Days between two timestamps. Returns Infinity when `lastActivityAt` is null. */
export function daysBetween(now: Date, lastActivityIso: string | null): number {
  if (!lastActivityIso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(lastActivityIso);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - t) / 86_400_000);
}

/**
 * Classify a single deal. Returns `null` when:
 *   - the deal is not in the B2B wholesale pipeline (defensive),
 *   - the deal's stage is not one of the active aging-tracked stages
 *     (Closed Won/Lost, On Hold, Reorder are out of scope here),
 *   - the stage doesn't have an aging threshold defined.
 */
export function classifyStaleBuyer(
  deal: HubSpotDealForStaleness,
  now: Date,
): StaleBuyerClassification | null {
  if (deal.pipelineId !== PIPELINE_B2B_WHOLESALE) return null;
  if (!ACTIVE_STAGE_IDS.includes(deal.stageId)) return null;
  const stageName = stageNameForId(deal.stageId);
  if (!stageName) return null;
  const threshold = STAGE_AGING_THRESHOLDS_DAYS[stageName];
  if (!threshold) return null;

  const days = daysBetween(now, deal.lastActivityAt);
  // Deals with no activity timestamp at all are reported as "stale" with
  // Infinity days — they're a data hygiene issue Ben should see.
  const daysRounded = Number.isFinite(days) ? Math.floor(days) : Infinity;
  return {
    dealId: deal.id,
    dealName: deal.dealname ?? "(unnamed deal)",
    stageName,
    daysSinceActivity: daysRounded,
    thresholdDays: threshold,
    isStale: days >= threshold,
    nextAction: STAGE_NEXT_ACTIONS[stageName] ?? "Review this deal manually",
    primaryContactId: deal.primaryContactId,
    primaryCompanyName: deal.primaryCompanyName,
  };
}

/**
 * Compute the morning-brief summary from a list of HubSpot deals + a
 * source citation. Returns the top-N stalest plus per-stage counts.
 *
 * Invariants:
 *   - `stalest` is sorted by `daysSinceActivity` desc, then by stage
 *     priority (earlier-stage deals get bumped up so we don't drown in
 *     21-day-old "Shipped" reorder pings).
 *   - `staleByStage` only includes stages that have at least one stale
 *     deal; stages with zero stale deals are omitted.
 *   - `source.retrievedAt` is the caller-provided ISO timestamp from
 *     when HubSpot was queried, NOT `now`.
 */
export function summarizeStaleBuyers(
  deals: HubSpotDealForStaleness[],
  now: Date,
  retrievedAt: string,
  topN = 8,
): StaleBuyerSummary {
  const classified: StaleBuyerClassification[] = [];
  for (const d of deals) {
    const c = classifyStaleBuyer(d, now);
    if (c) classified.push(c);
  }
  const stale = classified.filter((c) => c.isStale);

  // Stage priority — earlier stages first (so a 6-day-old Lead bumps a
  // 21-day-old Shipped). Reverse-index in HUBSPOT_B2B_STAGES gives us
  // ordering for free.
  const stagePriority: Record<string, number> = {};
  HUBSPOT_B2B_STAGES.forEach((s, i) => {
    stagePriority[s.name] = HUBSPOT_B2B_STAGES.length - i;
  });
  const stalestSorted = [...stale].sort((a, b) => {
    const stageDiff =
      (stagePriority[b.stageName] ?? 0) - (stagePriority[a.stageName] ?? 0);
    if (stageDiff !== 0) return stageDiff;
    return b.daysSinceActivity - a.daysSinceActivity;
  });

  const byStageMap = new Map<string, number>();
  for (const c of stale) {
    byStageMap.set(c.stageName, (byStageMap.get(c.stageName) ?? 0) + 1);
  }
  const staleByStage = Array.from(byStageMap.entries())
    .map(([stageName, count]) => ({
      stageName,
      count,
      thresholdDays: STAGE_AGING_THRESHOLDS_DAYS[stageName] ?? 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    asOf: now.toISOString(),
    stalest: stalestSorted.slice(0, topN),
    staleByStage,
    activeDealsScanned: classified.length,
    source: { system: "hubspot", retrievedAt },
  };
}
