/**
 * Phase 36.6 — Off-grid pricing visibility flag.
 *
 * Detects quotes / deals / invoices priced at anything OTHER than the
 * canonical B1-B5 grid (or the locked distributor commitments) and flags
 * them so the morning brief can surface them above the Revenue section.
 *
 * Why this exists:
 * - Off-grid pricing is the single biggest source of margin drift in the
 *   business. The Spottswood incident (4/30 AM) was an off-grid quote that
 *   leaked internal route doctrine before being caught — Class A/B agents
 *   shouldn't be able to ship off-grid pricing without a deliberate Class C
 *   `pricing.change` ratification AND a visibility surface.
 * - Phase 36.6 closes the visibility gap: the morning brief now shows every
 *   non-grid quote in the last 24h with the deviation, the customer, and
 *   the source agent — forces operator review even on Class A/B autonomous
 *   actions.
 *
 * Inputs (caller-provided):
 * - A list of recent quotes / deals / invoices with per-bag price + bag
 *   count. The caller (cron / morning-brief composer) fetches these from
 *   HubSpot, the booth-quote engine, or the sales-tour KV log.
 *
 * Pure-logic module: no I/O, no env reads, no API calls. Easy to test.
 *
 * Pairs with:
 * - `/contracts/wholesale-pricing.md` v2.4 — locked B-tier grid
 * - `/contracts/distributor-pricing-commitments.md` v1.0 — distributor commitments
 * - `/contracts/financial-mechanisms-blueprint.md` §6.7 — Phase 36.6 spec
 */

// ---------------------------------------------------------------------------
// Canonical pricing grid (LOCKED 2026-04-30 PM v2.4)
// ---------------------------------------------------------------------------

/**
 * Per-bag prices that ARE on-grid. Any quote at one of these prices is
 * considered canonical and is NOT flagged.
 *
 * Source: `/contracts/wholesale-pricing.md` v2.4 §2 + `pricing-tiers.ts`
 *         BAG_PRICE_USD constant.
 */
export const ON_GRID_BAG_PRICES_USD: ReadonlyArray<number> = [
  3.49, // B1 (local case, Ben delivers — internal only) + B2 (master carton landed)
  3.5, // B3 (master carton + buyer freight) — v2.4 +$0.25 surcharge
  3.25, // B4 (pallet landed) + B5 (pallet + buyer freight, v2.4 surcharge)
  3.0, // 3+ pallet free-freight tier (existing per /contracts/wholesale-pricing.md §3)
  // Distributor commitments per /contracts/distributor-pricing-commitments.md
  2.49, // Sell-sheet 90+ pallet delivered
  2.5, // Option A distributor
  2.1, // Option B distributor (Inderbitzin / Glacier)
  // Strategic-credential floor / pickup-only (off-grid by design but pre-approved)
  2.0, // Pickup / FOB Ashford floor (Class C — see pricing-grid-v2.3 proposal)
];

/** Tolerance for floating-point price comparison (1 cent). */
const PRICE_EPSILON_USD = 0.005;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A quote/deal/invoice the caller is asking us to evaluate. Minimal shape —
 * the caller maps from HubSpot / booth-quote / sales-tour KV into this.
 */
export interface QuoteCandidate {
  /** Stable id from the source system (HubSpot deal id, booth-quote KV key, etc.). */
  id: string;
  /** Where this quote came from. */
  source: "hubspot_deal" | "booth_quote" | "sales_tour" | "manual_invoice" | "custom_quote";
  /** Customer / company name for display. */
  customerName: string;
  /** Per-bag price in USD. Required — if you don't have it, don't pass the candidate. */
  pricePerBagUsd: number;
  /** Bag count on the deal/quote (canonical 36 / 900 / multiples — used for severity). */
  bagCount: number;
  /** ISO timestamp when the quote/deal was created or last priced. */
  createdAt: string;
  /** Free-text agent / operator who created the quote. */
  createdBy?: string;
  /** Optional HubSpot deal id for click-through in the brief. */
  hubspotDealId?: string;
  /** Optional URL for the source surface. */
  url?: string;
}

export type OffGridSeverity =
  | "below_floor" // structurally below COGS + Rene's $0.33 minimum-margin floor
  | "below_distributor_floor" // below the lowest distributor commit ($2.10)
  | "between_grid_lines" // between two on-grid prices (suspicious — partial discount?)
  | "above_grid" // above the highest grid price (high-margin one-off — probably fine but worth seeing)
  | "approved_class_c"; // off-grid but matches a known Class C-approved deviation (rarely flagged)

export interface OffGridQuote {
  candidate: QuoteCandidate;
  /** How the quote priced relative to the grid. */
  severity: OffGridSeverity;
  /** Closest on-grid price the quote deviates from. */
  nearestGridPrice: number;
  /** Per-bag deviation (positive = above grid, negative = below grid). */
  deviationPerBagUsd: number;
  /** Total dollar deviation = deviationPerBag × bagCount. */
  totalDeviationUsd: number;
  /** One-line human-readable reason the quote was flagged. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Returns true if the price is within 1¢ of any canonical grid price. */
export function isOnGridPrice(
  pricePerBagUsd: number,
  gridPrices: ReadonlyArray<number> = ON_GRID_BAG_PRICES_USD,
): boolean {
  if (!Number.isFinite(pricePerBagUsd) || pricePerBagUsd <= 0) return false;
  return gridPrices.some((g) => Math.abs(g - pricePerBagUsd) < PRICE_EPSILON_USD);
}

/** Find the closest on-grid price (regardless of direction). */
export function nearestOnGridPrice(
  pricePerBagUsd: number,
  gridPrices: ReadonlyArray<number> = ON_GRID_BAG_PRICES_USD,
): number {
  let best = gridPrices[0] ?? 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const g of gridPrices) {
    const d = Math.abs(g - pricePerBagUsd);
    if (d < bestDelta) {
      bestDelta = d;
      best = g;
    }
  }
  return best;
}

/**
 * Classify the severity of an off-grid quote.
 *
 * Heuristics (in priority order):
 * 1. Below COGS + Rene's $0.33/bag minimum-margin floor (= $2.12) → below_floor
 *    - This is the HARD STOP — a quote at $2.12 or below should never have shipped
 *      without Class C `pricing.change` ratification.
 * 2. Between $2.10 and $2.49 distributor band but not exact → below_distributor_floor
 *    - Suggests partial-discount drift on a distributor agreement.
 * 3. Below the highest on-grid price but above $2.50 → between_grid_lines
 *    - Most common case: someone offered $3.10 or $3.30 — worth surfacing.
 * 4. Above $3.50 → above_grid
 *    - Premium one-off; usually fine but worth seeing.
 */
function classifySeverity(
  pricePerBagUsd: number,
  nearest: number,
): OffGridSeverity {
  const COGS_PLUS_FLOOR = 1.79 + 0.33; // = $2.12 — branded standard floor
  const DISTRIBUTOR_LOW = 2.1;
  const DISTRIBUTOR_HIGH = 2.49;
  const GRID_TOP = Math.max(...ON_GRID_BAG_PRICES_USD);

  if (pricePerBagUsd < COGS_PLUS_FLOOR) return "below_floor";
  if (pricePerBagUsd >= DISTRIBUTOR_LOW && pricePerBagUsd <= DISTRIBUTOR_HIGH) {
    return "below_distributor_floor";
  }
  if (pricePerBagUsd > GRID_TOP) return "above_grid";
  return "between_grid_lines";
}

function buildReason(
  candidate: QuoteCandidate,
  nearest: number,
  deviation: number,
  severity: OffGridSeverity,
): string {
  const sign = deviation >= 0 ? "+" : "−";
  const dev = `${sign}$${Math.abs(deviation).toFixed(2)}/bag`;
  switch (severity) {
    case "below_floor":
      return `$${candidate.pricePerBagUsd.toFixed(2)}/bag is BELOW the $2.12 minimum-margin floor (${dev} from grid $${nearest.toFixed(2)}). Class C \`pricing.change\` required to ship.`;
    case "below_distributor_floor":
      return `$${candidate.pricePerBagUsd.toFixed(2)}/bag falls in the distributor band ($2.10–$2.49) but isn't on a known commit (Inderbitzin/Glacier $2.10 · sell-sheet $2.49). Verify against \`distributor-pricing-commitments.md\`.`;
    case "between_grid_lines":
      return `$${candidate.pricePerBagUsd.toFixed(2)}/bag is between grid lines (${dev} from nearest grid $${nearest.toFixed(2)}). Likely partial discount or custom quote — verify the quote source.`;
    case "above_grid":
      return `$${candidate.pricePerBagUsd.toFixed(2)}/bag is ABOVE the top grid price ($${nearest.toFixed(2)}). Premium one-off; verify customer accepted at this rate.`;
    case "approved_class_c":
      return `$${candidate.pricePerBagUsd.toFixed(2)}/bag matches a Class C approved deviation. Surfaced for visibility.`;
  }
}

/** Detect every off-grid quote in the candidate list. Returns flagged items with severity + reason. */
export function detectOffGridQuotes(
  candidates: ReadonlyArray<QuoteCandidate>,
  gridPrices: ReadonlyArray<number> = ON_GRID_BAG_PRICES_USD,
): OffGridQuote[] {
  const out: OffGridQuote[] = [];
  for (const c of candidates) {
    if (!Number.isFinite(c.pricePerBagUsd) || c.pricePerBagUsd <= 0) continue;
    if (isOnGridPrice(c.pricePerBagUsd, gridPrices)) continue;

    const nearest = nearestOnGridPrice(c.pricePerBagUsd, gridPrices);
    const dev = c.pricePerBagUsd - nearest;
    const severity = classifySeverity(c.pricePerBagUsd, nearest);
    const totalDev = dev * c.bagCount;
    out.push({
      candidate: c,
      severity,
      nearestGridPrice: Math.round(nearest * 100) / 100,
      deviationPerBagUsd: Math.round(dev * 100) / 100,
      totalDeviationUsd: Math.round(totalDev * 100) / 100,
      reason: buildReason(c, nearest, dev, severity),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Severity ranking (for brief sort order — most urgent first)
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<OffGridSeverity, number> = {
  below_floor: 0,
  below_distributor_floor: 1,
  between_grid_lines: 2,
  above_grid: 3,
  approved_class_c: 4,
};

/** Sort off-grid quotes most-urgent-first for brief rendering. */
export function sortOffGridQuotesBySeverity(
  quotes: ReadonlyArray<OffGridQuote>,
): OffGridQuote[] {
  return [...quotes].sort((a, b) => {
    const r = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (r !== 0) return r;
    // Within a severity bucket, sort by total dollar deviation (largest absolute first)
    return Math.abs(b.totalDeviationUsd) - Math.abs(a.totalDeviationUsd);
  });
}

// ---------------------------------------------------------------------------
// Brief slice
// ---------------------------------------------------------------------------

export interface OffGridQuotesBriefSlice {
  /** ISO timestamp the slice was generated. */
  generatedAt: string;
  /** Window of candidates the caller scanned (e.g. "last 24h"). */
  windowDescription: string;
  /** Total candidates evaluated. */
  candidatesEvaluated: number;
  /** Off-grid count by severity. */
  countsBySeverity: Record<OffGridSeverity, number>;
  /** Top-N flagged quotes (most-urgent-first), sized for the brief. */
  topQuotes: OffGridQuote[];
  /** Flag set when at least one quote is `below_floor` (forces operator action). */
  hasHardBlock: boolean;
}

const TOP_N_IN_BRIEF = 5;

/**
 * Build the brief slice from a list of candidates. Caller is responsible
 * for fetching candidates (HubSpot/KV/etc) and passing them in.
 */
export function buildOffGridQuotesBriefSlice(input: {
  candidates: ReadonlyArray<QuoteCandidate>;
  windowDescription: string;
  generatedAt?: string;
  topN?: number;
  gridPrices?: ReadonlyArray<number>;
}): OffGridQuotesBriefSlice {
  const flagged = detectOffGridQuotes(input.candidates, input.gridPrices);
  const sorted = sortOffGridQuotesBySeverity(flagged);
  const counts: Record<OffGridSeverity, number> = {
    below_floor: 0,
    below_distributor_floor: 0,
    between_grid_lines: 0,
    above_grid: 0,
    approved_class_c: 0,
  };
  for (const q of flagged) counts[q.severity]++;

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    windowDescription: input.windowDescription,
    candidatesEvaluated: input.candidates.length,
    countsBySeverity: counts,
    topQuotes: sorted.slice(0, input.topN ?? TOP_N_IN_BRIEF),
    hasHardBlock: counts.below_floor > 0,
  };
}
