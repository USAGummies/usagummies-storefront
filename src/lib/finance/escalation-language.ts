/**
 * Canonical escalation language — Phase 36.5.
 *
 * Single source of truth for the "future-reorder-pricing-may-change"
 * clause that Rene flagged as missing from outbound quotes / invoices /
 * AP packets in the 2026-04-29 PM `#financials` thread:
 *
 *   "Going forward, the language should be more like: Launch pricing is
 *    locked for the opening order and current replenishment window.
 *    Future reorder pricing remains subject to material changes in
 *    ingredient, packaging, production, freight, or fuel costs, with
 *    notice before adjustment."   — Ben → Rene 2026-04-29 13:51 PT
 *
 * Why this module exists:
 *   The escalation language was previously baked only into the
 *   booth-quote engine (`src/lib/sales-tour/escalation-clause.ts`),
 *   leaving QBO invoices + AP packet templates uncovered. A
 *   first-customer commitment without an escalation clause exposes us
 *   to forever-locked launch pricing — exactly what Rene was guarding
 *   against. Phase 36.5 (per `/contracts/financial-mechanisms-blueprint.md`
 *   §6.6) bakes this language into all three surfaces.
 *
 * Surfaces consuming this module:
 *   1. Booth-quote engine — `escalation-clause.ts` re-exports
 *      `pickEscalationClause` so the booth flow stays one import.
 *   2. AP-packet reply template — `templates.ts` inserts
 *      `STANDARD_ESCALATION_CLAUSE` into the reply body so every AP
 *      response carries it.
 *   3. QBO invoice POST — callers pass the matching variant into the
 *      `customerMemo` field per quote shape.
 *
 * Tests pin every variant + the dispatch logic so a future-Codex tweak
 * to one variant can't silently change what the other surfaces emit.
 *
 * Source doctrine: `/contracts/pricing-route-governance.md` §6 +
 * `/contracts/financial-mechanisms-blueprint.md` §6.6.
 */

/**
 * The canonical "default" escalation clause. Drop into any outbound
 * quote / invoice / packet that doesn't have a more specific variant.
 *
 * Worded to satisfy three constraints:
 *   - Locks the launch order's price (no rugpull on the buyer).
 *   - Names the cost categories that can move (gelatin, sugar,
 *     packaging, freight, fuel) so a price bump isn't a surprise.
 *   - Promises notice before any adjustment so the buyer can plan.
 */
export const STANDARD_ESCALATION_CLAUSE =
  "Launch pricing is locked for the opening order and current replenishment window. Future reorder pricing remains subject to material changes in ingredient, packaging, production, freight, or fuel costs, with notice before adjustment.";

/**
 * Stable variant id. Each maps to a string in `ESCALATION_CLAUSES`.
 *
 *   - "anchor"       Route anchor (3 pallets / 90 days) — longest window.
 *   - "fill"         Route fill (anchor's window governs).
 *   - "landed-standard"  B2/B4 master carton or pallet, freight on us.
 *   - "sub-mc"       Sub-master-carton (one bag, one case).
 *   - "pickup-floor" Pickup-only (C-PU) — 3 MC / 90 days.
 *   - "sample"       Free sample drop ≤ 6 bags.
 *   - "strategic-exception"  C-EXC one-off — "this order only".
 *   - "default"      Standard fallback when no variant fits.
 */
export type EscalationClauseVariant =
  | "anchor"
  | "fill"
  | "landed-standard"
  | "sub-mc"
  | "pickup-floor"
  | "sample"
  | "strategic-exception"
  | "default";

/** All canonical escalation strings, keyed by variant. */
export const ESCALATION_CLAUSES: Readonly<
  Record<EscalationClauseVariant, string>
> = {
  // Default — Rene's verbatim 2026-04-29 PM language. All other variants
  // build on this same intent (lock-then-window-then-cost-categories).
  default: STANDARD_ESCALATION_CLAUSE,

  // Anchor — longest exposure (3 pallets, 90 days), longest protection.
  anchor:
    "Pricing held for the next 3 pallets / 90 days, whichever comes first. Reorders beyond that window are subject to repricing based on (a) input cost movement (gelatin, sugar, packaging, freight), (b) route density at the time of reorder, and (c) any updates to USA Gummies' standard wholesale pricing schedule.",

  // Pickup floor — same 3 MC / 90-day window as anchor.
  "pickup-floor":
    "Pickup pricing held for the next 3 master cartons / 90 days, whichever comes first. Reorders beyond that window are subject to repricing per USA Gummies' standard pickup terms.",

  // Fill — anchor governs the route, fill stops re-quote per route.
  fill:
    "Pricing held for this delivery and the next planned trip to the region. Reorders outside the anchor's window may reprice based on route density and standard wholesale pricing.",

  // Landed standard — tighter window since freight is market-exposed.
  "landed-standard":
    "Pricing held for the current order and the next 1 pallet / 30 days, whichever comes first. Reorders beyond that window are subject to repricing based on input cost movement, freight market, and any updates to USA Gummies' standard wholesale pricing schedule.",

  // Sub-master-carton — minimal protection.
  "sub-mc":
    "Pricing held for the current order. Reorders are subject to USA Gummies' standard wholesale pricing schedule at time of order.",

  // Sample drop — no protection, document in audit.
  sample:
    "Sample drop — this order only. No reorder protection; future orders priced at the published wholesale tier when buyer is ready.",

  // Strategic exception — explicit "this order only" with deal memo.
  "strategic-exception":
    "Strategic / one-off pricing — this order only. Reorders require fresh deal-check and may quote at the published wholesale tier.",
};

/**
 * Inputs for `pickEscalationClause`. Caller provides the pricing
 * class + approval + bag count; the helper returns the matching
 * variant. Booth-quote engine and AP-packet flow share this dispatch.
 */
export interface PickEscalationOpts {
  /**
   * The classified pricing class — see /contracts/pricing-route-governance.md
   * §1 for the 6-class taxonomy. Strings are loose-typed so a caller
   * outside the sales-tour module (which owns the union) can still hit
   * this without importing the booth-visit types.
   */
  pricingClass: string;
  /**
   * Approval requirement: "none" / "class-b" / "class-c". Currently
   * informational — picks may diverge later when class-c gets a
   * stronger reorder lock.
   */
  approval?: string;
  /** Total bag count on the order. Drives sample/sub-MC tiers. */
  totalBags: number;
}

/**
 * Pick the canonical escalation variant for a quote shape.
 *
 * Mirrors the dispatch in `src/lib/sales-tour/escalation-clause.ts`
 * but with the canonical strings centralized here. The booth-quote
 * engine re-exports a thin wrapper that delegates to this function so
 * every surface (booth, AP packet, invoice) uses the same dispatch.
 */
export function pickEscalationClause(opts: PickEscalationOpts): {
  variant: EscalationClauseVariant;
  text: string;
} {
  const { pricingClass, totalBags } = opts;

  // Sample drop — free / micro quantity.
  if (pricingClass === "C-EXC" && totalBags <= 6) {
    return { variant: "sample", text: ESCALATION_CLAUSES.sample };
  }
  // Strategic exception — non-sample C-EXC.
  if (pricingClass === "C-EXC") {
    return {
      variant: "strategic-exception",
      text: ESCALATION_CLAUSES["strategic-exception"],
    };
  }
  // Route anchor — longest exposure.
  if (pricingClass === "C-ANCH") {
    return { variant: "anchor", text: ESCALATION_CLAUSES.anchor };
  }
  // Pickup floor.
  if (pricingClass === "C-PU") {
    return {
      variant: "pickup-floor",
      text: ESCALATION_CLAUSES["pickup-floor"],
    };
  }
  // Route fill.
  if (pricingClass === "C-FILL") {
    return { variant: "fill", text: ESCALATION_CLAUSES.fill };
  }
  // Landed standard — master carton or pallet at canonical pricing.
  if (totalBags >= 36) {
    return {
      variant: "landed-standard",
      text: ESCALATION_CLAUSES["landed-standard"],
    };
  }
  // Sub-master-carton.
  return { variant: "sub-mc", text: ESCALATION_CLAUSES["sub-mc"] };
}

/**
 * Convenience for AP-packet + invoice-template flows that don't
 * carry the full pricing-class context — they just want the
 * default canonical clause to drop into the reply body / invoice
 * customerMemo. Equivalent to `STANDARD_ESCALATION_CLAUSE`.
 */
export function defaultEscalationClause(): string {
  return STANDARD_ESCALATION_CLAUSE;
}

/**
 * Render the escalation clause for an AP-packet reply or QBO invoice
 * `customerMemo` with a leading marker so it's visually distinct
 * from order/contact details. Returns a multi-line block ready to
 * append to the body.
 *
 * Format:
 *   --
 *   Pricing terms:
 *   <clause text>
 */
export function renderEscalationBlock(
  clauseTextOrVariant?: string | EscalationClauseVariant,
): string {
  const text =
    !clauseTextOrVariant
      ? STANDARD_ESCALATION_CLAUSE
      : (clauseTextOrVariant as EscalationClauseVariant) in
          ESCALATION_CLAUSES
        ? ESCALATION_CLAUSES[clauseTextOrVariant as EscalationClauseVariant]
        : (clauseTextOrVariant as string);
  return ["--", "Pricing terms:", text].join("\n");
}
