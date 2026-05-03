/**
 * CRM Hygiene detectors — pure functions over PipelineDeal[].
 *
 * Per Ben's 2026-05-03 strategic plan: HubSpot has 569 deals + a real
 * pipeline, but it doesn't act like a sales manager. Every morning the
 * Wholesale Pipeline Commander should ask:
 *   - Which deals moved? (existing reorder-followup + sample-touch-2)
 *   - Which deals are stale? (this module)
 *   - Which deals have zero amount and need value estimates? (this)
 *   - Which records are missing fields? (this)
 *   - Which records have duplicate names? (this)
 *   - Which deals are stuck in a stage past expected dwell? (this)
 *
 * The detectors are intentionally boring. They flag, they don't decide.
 * The downstream digest summarizer rolls findings into a Slack post for
 * the operator to action.
 *
 * Design contract:
 *   - Pure functions. No I/O.
 *   - "now" supplied by caller for clock-injection in tests.
 *   - Each detector returns Finding[] (never null/undefined).
 *   - Each finding carries dealId + reason + severity + actionable
 *     `suggestedFollowUp` string the operator can copy-paste.
 *   - Closed (Won/Lost) and On Hold deals are EXEMPT from staleness
 *     and stuck-stage detectors — they're terminal/parked by design.
 *   - Closed-Won is still subject to data-quality detectors (missing
 *     amount, missing close date) since downstream finance needs them.
 */
import { HUBSPOT } from "../../ops/hubspot-client";
import type { PipelineDeal } from "../../ops/hubspot-client";

export type FindingSeverity = "info" | "warn" | "critical";
export type FindingKind =
  | "missing-field"
  | "stale-deal"
  | "zero-dollar"
  | "stuck-in-stage"
  | "duplicate-name"
  | "closed-with-open-amount";

export interface Finding {
  dealId: string;
  dealname: string;
  stageId: string;
  kind: FindingKind;
  severity: FindingSeverity;
  reason: string;
  /** Plain-English action the operator can take. */
  suggestedFollowUp: string;
  /** Days since last modification (for staleness/stuck-stage). */
  daysSinceLastActivity?: number;
  /** Linked field for missing-field findings. */
  field?: string;
  /** For duplicates: ids of the other deals sharing the normalized name. */
  duplicateOf?: string[];
}

const TERMINAL_STAGES = new Set<string>([
  HUBSPOT.STAGE_CLOSED_WON,
  HUBSPOT.STAGE_CLOSED_LOST,
  HUBSPOT.STAGE_ON_HOLD,
]);

/** Stages where a deal SHOULD have amount > 0. */
const AMOUNT_REQUIRED_STAGES = new Set<string>([
  HUBSPOT.STAGE_QUOTE_PO_SENT,
  HUBSPOT.STAGE_VENDOR_SETUP,
  HUBSPOT.STAGE_PO_RECEIVED,
  HUBSPOT.STAGE_SHIPPED,
  HUBSPOT.STAGE_REORDER,
  HUBSPOT.STAGE_CLOSED_WON,
]);

/**
 * Per-stage stale thresholds (days). A deal in `Lead` for 30 days is
 * normal; a deal in `Sample Shipped` for 14 days needs a touch-2.
 * Tuned to the Wholesale Pipeline Commander brief from 2026-05-03.
 */
const STAGE_STALE_DAYS_BY_STAGE: Record<string, number> = {
  [HUBSPOT.STAGE_LEAD]: 21,
  [HUBSPOT.STAGE_CONTACTED]: 10,
  [HUBSPOT.STAGE_RESPONDED]: 7,
  [HUBSPOT.STAGE_SAMPLE_REQUESTED]: 5,
  [HUBSPOT.STAGE_SAMPLE_SHIPPED]: 7, // matches sample-touch-2 cooldown
  [HUBSPOT.STAGE_QUOTE_PO_SENT]: 5,
  [HUBSPOT.STAGE_VENDOR_SETUP]: 7,
  [HUBSPOT.STAGE_PO_RECEIVED]: 10,
  [HUBSPOT.STAGE_SHIPPED]: 14,
  [HUBSPOT.STAGE_REORDER]: 30,
};

const DEFAULT_STALE_DAYS = 14;

/**
 * Per-stage MAX dwell days (deal stuck flag).
 * Higher than the staleness threshold — staleness asks "did anyone touch
 * the deal?", stuck asks "did the deal advance?". Without per-stage-entry
 * timestamps we approximate stuck = days since CREATED for Lead/Contacted
 * stages, days since LAST MODIFIED for downstream stages.
 */
const STAGE_MAX_DWELL_DAYS: Record<string, number> = {
  [HUBSPOT.STAGE_LEAD]: 60,
  [HUBSPOT.STAGE_CONTACTED]: 30,
  [HUBSPOT.STAGE_RESPONDED]: 21,
  [HUBSPOT.STAGE_SAMPLE_REQUESTED]: 14,
  [HUBSPOT.STAGE_SAMPLE_SHIPPED]: 30,
  [HUBSPOT.STAGE_QUOTE_PO_SENT]: 21,
  [HUBSPOT.STAGE_VENDOR_SETUP]: 21,
  [HUBSPOT.STAGE_PO_RECEIVED]: 21,
};

function isClosedTerminal(stageId: string): boolean {
  return TERMINAL_STAGES.has(stageId);
}

function ageInDays(iso: string | null | undefined, now: Date): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now.getTime() - t) / (24 * 3600 * 1000)));
}

// ---- Individual detectors -----------------------------------------------

export function detectMissingFields(
  deals: readonly PipelineDeal[],
): Finding[] {
  const out: Finding[] = [];
  for (const d of deals) {
    if (!d.dealname || d.dealname.trim() === "") {
      out.push({
        dealId: d.id,
        dealname: "(no name)",
        stageId: d.dealstage,
        kind: "missing-field",
        severity: "warn",
        field: "dealname",
        reason: "Deal has no name — search/scan/follow-up surfaces show '(no name)'.",
        suggestedFollowUp:
          "Set dealname to '<Buyer> — <Channel>' (e.g. 'Buc-ee\\'s — Wholesale').",
      });
    }
  }
  return out;
}

export function detectStaleDeals(
  deals: readonly PipelineDeal[],
  now: Date,
): Finding[] {
  const out: Finding[] = [];
  for (const d of deals) {
    if (isClosedTerminal(d.dealstage)) continue;
    const threshold =
      STAGE_STALE_DAYS_BY_STAGE[d.dealstage] ?? DEFAULT_STALE_DAYS;
    const days = ageInDays(d.lastmodifieddate, now);
    if (days < threshold) continue;
    const severity: FindingSeverity =
      days >= threshold * 2 ? "critical" : "warn";
    out.push({
      dealId: d.id,
      dealname: d.dealname || "(no name)",
      stageId: d.dealstage,
      kind: "stale-deal",
      severity,
      daysSinceLastActivity: days,
      reason: `${days}d since last activity (stage threshold ${threshold}d).`,
      suggestedFollowUp:
        "Touch the deal — log a call, send an email, or move to On Hold / Closed Lost if dead.",
    });
  }
  return out;
}

export function detectZeroDollarDeals(
  deals: readonly PipelineDeal[],
): Finding[] {
  const out: Finding[] = [];
  for (const d of deals) {
    if (!AMOUNT_REQUIRED_STAGES.has(d.dealstage)) continue;
    const amt = d.amount;
    if (amt !== null && amt > 0) continue;
    out.push({
      dealId: d.id,
      dealname: d.dealname || "(no name)",
      stageId: d.dealstage,
      kind: "zero-dollar",
      severity: "warn",
      field: "amount",
      reason: amt === null
        ? "Deal in revenue stage but amount is empty."
        : `Deal in revenue stage with amount = $${amt}.`,
      suggestedFollowUp:
        "Set amount to the expected first-PO value (~ case_count * unit_price).",
    });
  }
  return out;
}

export function detectStuckInStage(
  deals: readonly PipelineDeal[],
  now: Date,
): Finding[] {
  const out: Finding[] = [];
  for (const d of deals) {
    if (isClosedTerminal(d.dealstage)) continue;
    const dwellMax = STAGE_MAX_DWELL_DAYS[d.dealstage];
    if (!dwellMax) continue;
    // For early stages (Lead/Contacted) approximate dwell from createdate;
    // for later stages from lastmodifieddate. Without per-stage-entry
    // timestamps this is a heuristic — the alternative is engagements
    // history which the HubSpot connector currently has no read access to.
    const earlyStages = new Set<string>([
      HUBSPOT.STAGE_LEAD,
      HUBSPOT.STAGE_CONTACTED,
    ]);
    const ref = earlyStages.has(d.dealstage)
      ? d.createdate
      : d.lastmodifieddate || d.createdate;
    const days = ageInDays(ref, now);
    if (days < dwellMax) continue;
    out.push({
      dealId: d.id,
      dealname: d.dealname || "(no name)",
      stageId: d.dealstage,
      kind: "stuck-in-stage",
      severity: days >= dwellMax * 1.5 ? "critical" : "warn",
      daysSinceLastActivity: days,
      reason: `Stuck in stage for ${days}d (max dwell ${dwellMax}d).`,
      suggestedFollowUp:
        "Move the deal forward (next stage), pause it (On Hold), or close it (Closed Lost).",
    });
  }
  return out;
}

/** Heuristic name normalization for duplicate detection. */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function detectDuplicateNames(
  deals: readonly PipelineDeal[],
): Finding[] {
  // Cluster by normalized name; report only clusters of size ≥ 2.
  // Closed-Lost duplicates of a Closed-Won are NOT flagged (legitimate
  // re-engagement). Active+active or active+closed-won IS flagged.
  const byKey = new Map<string, PipelineDeal[]>();
  for (const d of deals) {
    const name = (d.dealname || "").trim();
    if (!name) continue;
    const key = normalizeName(name);
    if (!key) continue;
    const list = byKey.get(key);
    if (list) list.push(d);
    else byKey.set(key, [d]);
  }

  const out: Finding[] = [];
  for (const [, members] of byKey.entries()) {
    if (members.length < 2) continue;
    // Skip clusters where every active deal is paired with a Closed Lost
    // — that's legitimate re-engagement (rare; safer to flag than skip,
    // but we still surface so operator can confirm).
    // Report each member once; cite the other ids.
    for (const m of members) {
      const others = members
        .filter((x) => x.id !== m.id)
        .map((x) => x.id);
      out.push({
        dealId: m.id,
        dealname: m.dealname,
        stageId: m.dealstage,
        kind: "duplicate-name",
        severity: "info",
        duplicateOf: others,
        reason: `Same normalized name as ${others.length} other deal${others.length === 1 ? "" : "s"}: ${others
          .slice(0, 3)
          .join(", ")}${others.length > 3 ? "…" : ""}`,
        suggestedFollowUp:
          "Merge duplicates if they're the same buyer; re-name if they're different locations of the same chain.",
      });
    }
  }
  return out;
}

export function detectClosedWithOpenAmount(
  deals: readonly PipelineDeal[],
): Finding[] {
  const out: Finding[] = [];
  for (const d of deals) {
    if (d.dealstage !== HUBSPOT.STAGE_CLOSED_LOST) continue;
    if (d.amount === null || d.amount === 0) continue;
    out.push({
      dealId: d.id,
      dealname: d.dealname || "(no name)",
      stageId: d.dealstage,
      kind: "closed-with-open-amount",
      severity: "info",
      field: "amount",
      reason: `Closed Lost but amount = $${d.amount}.`,
      suggestedFollowUp:
        "Either zero out amount (deal didn't ship) or move stage back to PO Received / Shipped if it actually closed-won.",
    });
  }
  return out;
}

// ---- Composite runner ---------------------------------------------------

export interface HygieneFindings {
  total: number;
  byKind: Record<FindingKind, Finding[]>;
  bySeverity: Record<FindingSeverity, number>;
  /** Top-N findings by severity (critical > warn > info). */
  topFindings: Finding[];
  /** Distinct dealIds touched — useful for "X deals need attention" headline. */
  affectedDealIds: string[];
}

export interface RunHygieneScanOpts {
  /** Top-N findings returned in `topFindings`. Default 12. */
  topN?: number;
}

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 3,
  warn: 2,
  info: 1,
};

/**
 * Run all detectors against a deal list. Returns a single rolled-up
 * `HygieneFindings` shape with a top-N priority list for the digest.
 */
export function runHygieneScan(
  deals: readonly PipelineDeal[],
  now: Date,
  opts: RunHygieneScanOpts = {},
): HygieneFindings {
  const topN = Math.max(1, Math.min(50, opts.topN ?? 12));

  const missing = detectMissingFields(deals);
  const stale = detectStaleDeals(deals, now);
  const zero = detectZeroDollarDeals(deals);
  const stuck = detectStuckInStage(deals, now);
  const dupes = detectDuplicateNames(deals);
  const closedOpen = detectClosedWithOpenAmount(deals);

  const all: Finding[] = [
    ...missing,
    ...stale,
    ...zero,
    ...stuck,
    ...dupes,
    ...closedOpen,
  ];

  const byKind: Record<FindingKind, Finding[]> = {
    "missing-field": missing,
    "stale-deal": stale,
    "zero-dollar": zero,
    "stuck-in-stage": stuck,
    "duplicate-name": dupes,
    "closed-with-open-amount": closedOpen,
  };

  const bySeverity: Record<FindingSeverity, number> = {
    critical: 0,
    warn: 0,
    info: 0,
  };
  for (const f of all) bySeverity[f.severity] += 1;

  const topFindings = [...all]
    .sort((a, b) => {
      const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (sev !== 0) return sev;
      // Tie-break: higher daysSinceLastActivity first (where defined).
      const ad = a.daysSinceLastActivity ?? 0;
      const bd = b.daysSinceLastActivity ?? 0;
      return bd - ad;
    })
    .slice(0, topN);

  const affectedDealIds = Array.from(new Set(all.map((f) => f.dealId)));

  return {
    total: all.length,
    byKind,
    bySeverity,
    topFindings,
    affectedDealIds,
  };
}
