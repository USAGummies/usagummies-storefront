/**
 * Pricing-grid classifier — Phase 36.6 (Off-grid pricing visibility flag).
 *
 * Classifies a per-bag price point as "on-grid" (matches one of our
 * canonical pricing tiers) vs "off-grid" (a custom or negotiated price
 * that requires operator review).
 *
 * Used by:
 *   - Morning brief "off-grid quotes" surface (planned wire-up): pulls
 *     recent quotes/orders, classifies each, surfaces off-grid ones so
 *     operator reviews even Class A/B autonomous actions.
 *   - Booth-quote engine: a custom price emitted via quote.py is
 *     classified here so it can be tagged off-grid in HubSpot deal
 *     properties + audit envelopes.
 *   - Per-vendor margin ledger ingest: when a committed-vendor row's
 *     price is recorded, this classifier tells the parser whether it's
 *     a standard (on-grid) commitment or a special (off-grid).
 *
 * Source of truth for the grid:
 *   /contracts/wholesale-pricing.md §2 v2.4   (B1–B5)
 *   /contracts/distributor-pricing-commitments.md §1, §2  (sell-sheet,
 *                                                          Option A/B)
 *   /contracts/pricing-route-governance.md §1   (proposed C-ANCH)
 *
 * Tolerance: ±$0.01/bag (one cent). A quote at $3.49 is on-grid;
 * $3.495 rounds to on-grid; $3.50 is its own tier (B3); $3.45 is
 * off-grid (more than a cent off any tier). Tolerance is intentionally
 * tight — the grid was designed in $0.05+ increments specifically so
 * cent-level deviations would surface as deliberate negotiations.
 */

export interface GridTier {
  /** Stable identifier (e.g. "B2", "B3", "Option-B", "C-ANCH"). */
  id: string;
  /** Per-bag price in USD. */
  pricePerBag: number;
  /** Human-readable label for surfaces. */
  label: string;
  /** Doctrine doc + section that defines this tier. */
  source: string;
  /**
   * "ratified" — fully canonical (B1–B5, sell-sheet $2.49, Option A/B).
   * "proposed" — awaits Class C approval (C-ANCH, future tiers).
   * "show-special" — one-off event price, expires after the event.
   */
  status: "ratified" | "proposed" | "show-special";
}

/**
 * Canonical price grid as of 2026-04-30 PM (post-v2.4 Q3 surcharge
 * ratification + Reunion 2026 show-special active).
 *
 * Order matters: classifier prefers the earliest match in the array
 * when two tiers happen to share a price (e.g. v2.4 made B4 and B5
 * both $3.25 — for $3.25 input we prefer B4 which is the standard
 * landed pallet, not the buyer-pays variant).
 */
export const PRICING_GRID: ReadonlyArray<GridTier> = [
  // Wholesale tiers — /contracts/wholesale-pricing.md §2 v2.4 + v2.3 lock
  { id: "B1", pricePerBag: 3.49, label: "B1 — Local case (internal only, Ben delivers)", source: "/contracts/wholesale-pricing.md §2", status: "ratified" },
  { id: "B2", pricePerBag: 3.49, label: "B2 — Master carton, landed", source: "/contracts/wholesale-pricing.md §2", status: "ratified" },
  { id: "B3", pricePerBag: 3.50, label: "B3 — Master carton, buyer-pays (v2.4 +$0.25 Q3 surcharge)", source: "/contracts/wholesale-pricing.md §2 v2.4", status: "ratified" },
  { id: "B4", pricePerBag: 3.25, label: "B4 — Pallet, landed", source: "/contracts/wholesale-pricing.md §2", status: "ratified" },
  { id: "B5", pricePerBag: 3.25, label: "B5 — Pallet, buyer-pays (v2.4 +$0.25 Q3 surcharge)", source: "/contracts/wholesale-pricing.md §2 v2.4", status: "ratified" },

  // Distributor — /contracts/distributor-pricing-commitments.md §1, §2
  { id: "Sell-Sheet-A", pricePerBag: 2.50, label: "Distributor Option A (with counter display, delivered)", source: "/contracts/distributor-pricing-commitments.md §2", status: "ratified" },
  { id: "Sell-Sheet", pricePerBag: 2.49, label: "Distributor sell-sheet (delivered)", source: "/contracts/distributor-pricing-commitments.md §1", status: "ratified" },
  { id: "Option-B", pricePerBag: 2.10, label: "Distributor Option B (loose, delivered) — Inderbitzin / Glacier", source: "/contracts/distributor-pricing-commitments.md §2", status: "ratified" },

  // Trade-show specials — /contracts/distributor-pricing-commitments.md §3
  { id: "Reunion-2026", pricePerBag: 3.25, label: "Reunion 2026 trade-show special (free freight, MC MOQ)", source: "/contracts/distributor-pricing-commitments.md §3", status: "show-special" },

  // PROPOSED — /contracts/pricing-route-governance.md §1 + proposals/pricing-grid-v2.3-route-reconciliation.md
  { id: "C-ANCH", pricePerBag: 3.00, label: "C-ANCH — Route-anchor (3-pallet min, landed) — PROPOSED awaits Class C", source: "/contracts/pricing-route-governance.md §1", status: "proposed" },
  { id: "C-PU", pricePerBag: 2.00, label: "C-PU — Pickup floor — PROPOSED awaits Class C", source: "/contracts/pricing-route-governance.md §1", status: "proposed" },

  // DTC — /contracts/distributor-pricing-commitments.md §4 + outreach-pitch-spec.md
  { id: "DTC-Single", pricePerBag: 5.99, label: "DTC single-bag MSRP (Shopify + Amazon retail)", source: "/contracts/distributor-pricing-commitments.md §4", status: "ratified" },
];

/** Default per-bag tolerance for "matches a grid tier." One cent. */
export const DEFAULT_GRID_TOLERANCE_USD = 0.01;

export interface GridClassification {
  /** True iff `pricePerBag` matches a grid tier within tolerance. */
  onGrid: boolean;
  /** The matched tier (when onGrid=true), nearest tier (when onGrid=false). */
  nearestTier: GridTier;
  /** `pricePerBag − nearestTier.pricePerBag` — signed, rounded to cents. */
  deviationUsd: number;
  /** Absolute deviation as a percent of the grid tier price. */
  deviationPct: number;
  /**
   * When off-grid, a one-line human reason summarizing the gap.
   * When on-grid, mirrors the matched tier's label.
   */
  reason: string;
  /**
   * When status === "proposed" — surface a flag so the operator knows
   * the on-grid match is a proposed-but-not-yet-ratified tier.
   * Distinct from `onGrid` because on-grid against a proposed tier
   * still isn't a fully ratified position.
   */
  matchesProposedTier: boolean;
}

export interface ClassifyOptions {
  /**
   * Optional per-bag tolerance override. Default ±$0.01.
   * Use a tighter tolerance (e.g. 0.005) when classifying machine-quoted
   * prices that should be exact; use a looser one (e.g. 0.05) when
   * classifying historical invoices with minor rounding drift.
   */
  toleranceUsd?: number;
  /**
   * When true, only "ratified" tiers count as on-grid. A price matching
   * a "proposed" tier (e.g. $3.00 = C-ANCH, awaiting Class C) is
   * classified off-grid until the proposal ratifies. Default `false`
   * (proposed counts).
   */
  ratifiedOnly?: boolean;
}

/**
 * Classify a per-bag price against the canonical grid.
 *
 * Returns the best-match tier + whether the price matches it within
 * tolerance + the deviation (signed) for off-grid cases.
 */
export function classifyPricePerBag(
  pricePerBag: number,
  opts: ClassifyOptions = {},
): GridClassification {
  if (!Number.isFinite(pricePerBag)) {
    throw new Error("classifyPricePerBag: pricePerBag must be a finite number");
  }
  const tolerance = opts.toleranceUsd ?? DEFAULT_GRID_TOLERANCE_USD;
  const eligible = opts.ratifiedOnly
    ? PRICING_GRID.filter((t) => t.status === "ratified")
    : PRICING_GRID;
  if (eligible.length === 0) {
    // Defensive — shouldn't happen since we ship a populated grid.
    throw new Error("classifyPricePerBag: pricing grid is empty");
  }

  // Find the tier with the smallest absolute deviation, preferring
  // earlier-listed tiers on ties (mirrors the ordering doctrine in
  // PRICING_GRID — landed before buyer-pays at the same price).
  let bestIdx = 0;
  let bestAbs = Math.abs(pricePerBag - eligible[0].pricePerBag);
  for (let i = 1; i < eligible.length; i++) {
    const abs = Math.abs(pricePerBag - eligible[i].pricePerBag);
    if (abs < bestAbs) {
      bestIdx = i;
      bestAbs = abs;
    }
  }
  const nearestTier = eligible[bestIdx];
  const deviationUsd = round2(pricePerBag - nearestTier.pricePerBag);
  const deviationPct =
    nearestTier.pricePerBag > 0
      ? round2((Math.abs(deviationUsd) / nearestTier.pricePerBag) * 100)
      : 0;
  const onGrid = bestAbs <= tolerance + 1e-9; // float epsilon
  const matchesProposedTier = onGrid && nearestTier.status === "proposed";

  let reason: string;
  if (onGrid) {
    if (matchesProposedTier) {
      reason = `Matches ${nearestTier.id} ($${nearestTier.pricePerBag.toFixed(2)}) — PROPOSED tier, awaits Class C ratification`;
    } else if (nearestTier.status === "show-special") {
      reason = `Matches ${nearestTier.id} ($${nearestTier.pricePerBag.toFixed(2)}) — show-special; verify event still active`;
    } else {
      reason = `Matches ${nearestTier.id} ($${nearestTier.pricePerBag.toFixed(2)})`;
    }
  } else {
    const direction = deviationUsd >= 0 ? "above" : "below";
    reason = `Off-grid by $${Math.abs(deviationUsd).toFixed(2)} (${deviationPct.toFixed(1)}%) ${direction} ${nearestTier.id} at $${nearestTier.pricePerBag.toFixed(2)}`;
  }

  return {
    onGrid,
    nearestTier,
    deviationUsd,
    deviationPct,
    reason,
    matchesProposedTier,
  };
}

/**
 * Convenience: returns true iff the price is on-grid AND ratified
 * (no proposed-tier ambiguity, no show-special). Use as the strict
 * check for "is this a fully canonical price?".
 */
export function isFullyRatifiedPrice(
  pricePerBag: number,
  opts: Pick<ClassifyOptions, "toleranceUsd"> = {},
): boolean {
  const r = classifyPricePerBag(pricePerBag, {
    ...opts,
    ratifiedOnly: true,
  });
  return r.onGrid && r.nearestTier.status === "ratified";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
