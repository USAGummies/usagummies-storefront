/**
 * Wholesale pricing tiers — Phase 35.a.
 *
 * Code-side mirror of `/contracts/wholesale-pricing.md` v1.0
 * (LOCKED 2026-04-27 by Ben + Rene). Provides:
 *
 *   - The 5 stable designators (B1-B5) as TypeScript constants.
 *   - Helpers to compute order-line totals (bag count → bags-shipped
 *     + price-per-bag → line subtotal).
 *   - Online-vs-internal exposure predicates (B1 is internal-only).
 *   - Freight-mode classification (landed / buyer-paid /
 *     custom-3-plus-pallets).
 *   - Validation: a tier id must be in the closed enum, never
 *     fabricated.
 *
 * **Doctrinal hard rules** (tested):
 *   1. **B1 is internal-only.** `availableInOnlineFlow(B1) === false`.
 *   2. **Designators are stable.** Renaming a retired tier (B6 etc.)
 *      is the only safe way to evolve. Mutating B1-B5's meaning is
 *      a contract violation.
 *   3. **Custom freight only at 3+ pallets.** Sub-pallet quantities
 *      are always B2/B3 (master) or B4/B5 (1-2 pallet). Custom
 *      quote requires `palletCount >= 3`.
 *   4. **Atomic bag inventory.** Order types decrement bag inventory
 *      via `bagsForOrderLine()` — no case/carton/pallet SKUs ever.
 *      A "1 master carton" order is a bag-count of 36.
 *
 * Where this is consumed:
 *   - `/api/leads` already references B-tier numbers in copy + Slack
 *     notifications (Phase 30+).
 *   - The wholesale onboarding flow rebuild (Phase 35.b state
 *     machine) drives tier selection + line totals from these
 *     constants.
 *   - QBO invoice line text (future Phase 35.x) embeds the
 *     designator (`B2`, `B3`, etc.) so audit trails trace the
 *     price tier without ambiguity.
 *
 * **TODO (governance overlay):** This file is the SKU/tier mirror.
 * The route-economics governance layer that determines WHEN to
 * deviate from the published B-grid — pickup floor ($2.00/bag),
 * route-anchor ($3.00/bag landed, 3-pallet min), route-fill
 * ($3.25–$3.49+/bag), escalation clauses, deal-check process — is
 * canonical at [`/contracts/pricing-route-governance.md`](../../../contracts/pricing-route-governance.md).
 * Future calculator work that surfaces non-standard offers MUST emit
 * a deal-check trigger per §7.1 of that doctrine before quoting.
 * Open reconciliation between the B5 ($3.00 buyer-pays) and the
 * route-anchor ($3.00 landed) is tracked in the doctrine's §11.
 */

/** Closed enum — these five strings are the only valid tier ids. */
export type PricingTier = "B1" | "B2" | "B3" | "B4" | "B5";

/** All five tier ids in canonical order (B1 → B5). */
export const PRICING_TIERS: readonly PricingTier[] = [
  "B1",
  "B2",
  "B3",
  "B4",
  "B5",
] as const;

/**
 * Per-bag prices in USD.
 *
 * v1.0 (2026-04-27): B1/B2 $3.49, B3 $3.25, B4 $3.25, B5 $3.00.
 * v2.4 (2026-04-30 PM Class C `pricing.change` ratified): Rene's
 * across-the-board +$0.25/bag surcharge on buyer-pays freight tiers.
 *   - B3: $3.25 → $3.50  (now $0.01 above B2 landed → buyers pick landed)
 *   - B5: $3.00 → $3.25  (now matches B4 landed parity → buyers pick landed)
 *   - B1/B2/B4: unchanged
 * Rationale: we still pick + pack on buyer-pays, so we should get something
 * for it; the price-gap collapse nudges buyers toward letting us ship
 * (less coordination, more revenue, easier ops). Source:
 * `/contracts/wholesale-pricing.md` §2 + version-history v2.4.
 */
export const BAG_PRICE_USD: Readonly<Record<PricingTier, number>> = {
  B1: 3.49, // local case, Ben delivers — internal only
  B2: 3.49, // master carton, landed
  B3: 3.5, // master carton, buyer pays freight (v2.4: was 3.25)
  B4: 3.25, // pallet, landed
  B5: 3.25, // pallet, buyer pays freight (v2.4: was 3.00)
};

/**
 * Bag count per order unit. Master carton = 36 bags
 * (per `/CLAUDE.md` Packaging spec — 6 cases × 6 bags). Pallet =
 * 900 bags (25 master cartons × 36 bags) per the outbound shipping
 * skid build at our warehouse (Ti×Hi 6×4 + 1 cap, ~530 lb packed,
 * 48×40×~52 in). Source: `/contracts/wholesale-pricing.md` v2.1 §2 +
 * `/contracts/outreach-pitch-spec.md` §5. Local case (B1) = 6 bags
 * (one inner case).
 *
 * **Drift note (corrected 2026-04-28 PM):** v1.0/v2.0 of the
 * wholesale-pricing contract used 432 bags/pallet, which incorrectly
 * applied the Uline *inbound* reorder pack-out (12 MC = 432 bags of
 * packaging-supply for finished-goods production) as the outbound
 * pallet build. Reconciled to 25 MC / 900 bags in v2.1.
 */
export const BAGS_PER_UNIT: Readonly<Record<PricingTier, number>> = {
  B1: 6, // 1 inner case
  B2: 36, // 1 master carton
  B3: 36, // 1 master carton
  B4: 900, // 1 pallet (25 master cartons × 36 bags)
  B5: 900, // 1 pallet (25 master cartons × 36 bags)
};

export type FreightMode = "landed" | "buyer-paid" | "custom";

/** Freight-mode classification per tier. */
export const FREIGHT_MODE: Readonly<Record<PricingTier, FreightMode>> = {
  B1: "custom", // Ben delivers locally — informal "custom" mode
  B2: "landed",
  B3: "buyer-paid",
  B4: "landed",
  B5: "buyer-paid",
};

/** Whether a tier is selectable in the online wholesale flow. */
export const ONLINE_AVAILABLE: Readonly<Record<PricingTier, boolean>> = {
  B1: false, // Local case — INTERNAL ONLY (manual PO + Ben delivery)
  B2: true,
  B3: true,
  B4: true,
  B5: true,
};

/** Human-readable display label per tier. */
export const TIER_DISPLAY: Readonly<Record<PricingTier, string>> = {
  B1: "Local case (internal — Ben delivers)",
  B2: "Master carton (landed)",
  B3: "Master carton + buyer freight",
  B4: "Pallet (landed)",
  B5: "Pallet + buyer freight",
};

/**
 * Customer-facing QBO invoice line description.
 *
 * Per Rene's 2026-04-28 lock (Slack `#financials` thread):
 * descriptions are clean wholesale prose. NO tier-code prefix
 * ("B3 —" was the legacy form; removed). The fulfillment-type code
 * lives in the SKU column on the invoice via the batch-SKU format
 * `UG-B[NNNN]-[YYMMDD]-[FT]` — see `src/lib/wholesale/batch-skus.ts`.
 *
 * Doctrinal rule: tier code in code (audit/internal) → SKU column;
 * description text stays customer-facing.
 */
export const TIER_INVOICE_LABEL: Readonly<Record<PricingTier, string>> = {
  B1: "All American Gummy Bears — 7.5 oz, 6-Bag Case, Local Delivery",
  B2: "All American Gummy Bears — 7.5 oz, 36-Bag Master Carton, Freight Included",
  B3: "All American Gummy Bears — 7.5 oz, 36-Bag Master Carton, Buyer Freight",
  B4: "All American Gummy Bears — 7.5 oz, ~900-Bag Pallet, Freight Included",
  B5: "All American Gummy Bears — 7.5 oz, ~900-Bag Pallet, Buyer Freight",
};

/**
 * Fulfillment-type code per tier — the 2-4 char code that becomes
 * the `[FT]` segment of the batch SKU `UG-B[NNNN]-[YYMMDD]-[FT]`.
 *
 * Locked 2026-04-28 (Rene + Viktor batch-SKU session, ratified by
 * Ben). Naming convention: each code = `{Unit}{FreightMode}`:
 *   LCD  = Local Case, Delivered (Ben delivers locally)
 *   MCL  = Master Carton, Landed
 *   MCBF = Master Carton, Buyer Freight
 *   PL   = Pallet, Landed
 *   PBF  = Pallet, Buyer Freight
 *
 * The B1-B5 internal identifiers stay stable in code (audit
 * envelopes, tests, KV records) — fulfillment-type is the customer-
 * + finance-facing view, derived from tier. Both coexist: B-tier =
 * stable internal ID, FT = readable surface.
 */
export type FulfillmentType = "LCD" | "MCL" | "MCBF" | "PL" | "PBF";

export const FULFILLMENT_TYPE: Readonly<Record<PricingTier, FulfillmentType>> = {
  B1: "LCD",
  B2: "MCL",
  B3: "MCBF",
  B4: "PL",
  B5: "PBF",
};

/** All 5 fulfillment-type codes in canonical order (matches PRICING_TIERS). */
export const FULFILLMENT_TYPES: readonly FulfillmentType[] = [
  "LCD",
  "MCL",
  "MCBF",
  "PL",
  "PBF",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Type guard: is `value` a registered tier? Pure.
 *
 * Use at the API boundary — never trust a tier id from a request
 * body without `isPricingTier(...)`.
 */
export function isPricingTier(value: unknown): value is PricingTier {
  return (
    typeof value === "string" &&
    (PRICING_TIERS as readonly string[]).includes(value)
  );
}

/**
 * Compute the bag count for an order line. Pure.
 *
 * `unitCount` is how many of the order unit (cases / master
 * cartons / pallets) the customer is ordering.
 *
 * Example: `bagsForOrderLine("B2", 3)` → 108 bags (3 master
 * cartons × 36 bags).
 *
 * Throws on negative or non-finite `unitCount` (defensive — we
 * never want to silently sign a 0-bag invoice).
 */
export function bagsForOrderLine(
  tier: PricingTier,
  unitCount: number,
): number {
  if (!Number.isFinite(unitCount) || unitCount < 0) {
    throw new Error(
      `bagsForOrderLine: unitCount must be a non-negative finite number; got ${unitCount}`,
    );
  }
  return Math.floor(unitCount) * BAGS_PER_UNIT[tier];
}

/**
 * Compute the order-line subtotal (bags × per-bag price). Pure.
 *
 * Returned in USD as a `number`; rounded to 2 decimals for
 * invoice presentation. The bag-count math is exact (integers);
 * the rounding is on the final product.
 *
 * Example: `lineSubtotalUsd("B2", 3)` → `108 × 3.49 = $376.92`.
 */
export function lineSubtotalUsd(
  tier: PricingTier,
  unitCount: number,
): number {
  const bags = bagsForOrderLine(tier, unitCount);
  const subtotal = bags * BAG_PRICE_USD[tier];
  return Math.round(subtotal * 100) / 100;
}

/** Whether this tier is selectable in the online wholesale flow. */
export function availableInOnlineFlow(tier: PricingTier): boolean {
  return ONLINE_AVAILABLE[tier];
}

/** All tiers that should be exposed in the online wholesale UI. */
export function onlineTiers(): readonly PricingTier[] {
  return PRICING_TIERS.filter((t) => ONLINE_AVAILABLE[t]);
}

/**
 * Decide whether a freight quote should be "custom" (Ben prices
 * manually based on route + opportunistic value). Pure.
 *
 * Per `/contracts/wholesale-pricing.md` §3: custom freight only at
 * 3+ pallets. B4 (pallet landed) at 1-2 pallets resolves to the
 * canonical landed price; B4 at 3+ pallets escalates to a custom
 * quote that supersedes the table.
 */
export function shouldUseCustomFreightQuote(
  tier: PricingTier,
  unitCount: number,
): boolean {
  if (!Number.isFinite(unitCount) || unitCount < 0) return false;
  // Only pallet tiers (B4 / B5) can hit the 3+ pallet custom-freight
  // threshold. Master-carton tiers stay at landed / buyer-paid
  // regardless of unit count.
  if (tier !== "B4" && tier !== "B5") return false;
  return Math.floor(unitCount) >= 3;
}

/**
 * Look up the bag-count quoted in canonical doctrine for a single
 * unit of this tier. Used in customer-facing copy ("Master carton
 * — 36 bags").
 */
export function bagsPerUnit(tier: PricingTier): number {
  return BAGS_PER_UNIT[tier];
}

/** Look up the per-bag price for this tier. */
export function bagPriceUsd(tier: PricingTier): number {
  return BAG_PRICE_USD[tier];
}

/** Look up the freight mode for this tier. */
export function freightMode(tier: PricingTier): FreightMode {
  return FREIGHT_MODE[tier];
}

/** Look up the human-readable display label. */
export function tierDisplay(tier: PricingTier): string {
  return TIER_DISPLAY[tier];
}

/** Look up the QBO invoice line text label. */
export function tierInvoiceLabel(tier: PricingTier): string {
  return TIER_INVOICE_LABEL[tier];
}

/**
 * Format an order-line into a structured display object suitable
 * for both UI rendering AND QBO line text. Pure.
 *
 * Example return:
 *   {
 *     tier: "B2",
 *     unitCount: 3,
 *     unitLabel: "Master carton (landed)",
 *     bags: 108,
 *     bagPriceUsd: 3.49,
 *     subtotalUsd: 376.92,
 *     freightMode: "landed",
 *     invoiceLabel: "B2 — Master carton (36 bags), landed",
 *     customFreightRequired: false,
 *   }
 */
export interface OrderLineSummary {
  tier: PricingTier;
  unitCount: number;
  unitLabel: string;
  bags: number;
  bagPriceUsd: number;
  subtotalUsd: number;
  freightMode: FreightMode;
  invoiceLabel: string;
  customFreightRequired: boolean;
}

export function summarizeOrderLine(
  tier: PricingTier,
  unitCount: number,
): OrderLineSummary {
  return {
    tier,
    unitCount: Math.floor(unitCount),
    unitLabel: TIER_DISPLAY[tier],
    bags: bagsForOrderLine(tier, unitCount),
    bagPriceUsd: BAG_PRICE_USD[tier],
    subtotalUsd: lineSubtotalUsd(tier, unitCount),
    freightMode: FREIGHT_MODE[tier],
    invoiceLabel: TIER_INVOICE_LABEL[tier],
    customFreightRequired: shouldUseCustomFreightQuote(tier, unitCount),
  };
}

/**
 * Map a B-tier internal id to its fulfillment-type code (the
 * customer-facing 2-4 char code used in batch SKUs + invoice SKU
 * column). Pure.
 *
 * Locked 2026-04-28 by Rene + Viktor batch-SKU session.
 */
export function tierToFulfillmentType(tier: PricingTier): FulfillmentType {
  return FULFILLMENT_TYPE[tier];
}

/**
 * Type guard: is `value` a registered fulfillment-type code? Pure.
 *
 * Use at boundaries where the SKU is parsed from external input
 * (QBO invoice line, hand-typed batch SKU, etc.).
 */
export function isFulfillmentType(value: unknown): value is FulfillmentType {
  return (
    typeof value === "string" &&
    (FULFILLMENT_TYPES as readonly string[]).includes(value)
  );
}

/** Reverse lookup: fulfillment-type code → B-tier internal id. */
export function fulfillmentTypeToTier(ft: FulfillmentType): PricingTier {
  // Build the inverse map once. Cheap (5 entries) and pure.
  const entries = Object.entries(FULFILLMENT_TYPE) as Array<
    [PricingTier, FulfillmentType]
  >;
  for (const [tier, code] of entries) {
    if (code === ft) return tier;
  }
  // Unreachable given the type guard at the boundary, but defensive.
  throw new Error(`fulfillmentTypeToTier: unknown FulfillmentType ${ft}`);
}

/**
 * Standard noun for the order unit at this tier. Used by email/
 * invoice composers for pluralization-aware copy ("3 master cartons"
 * vs "1 master carton"). Pure.
 *
 * Single source of truth — composers should import this rather
 * than reinventing per-module switch tables.
 */
export function unitNoun(tier: PricingTier, count: number): string {
  const plural = count !== 1;
  switch (tier) {
    case "B1":
      return plural ? "cases" : "case";
    case "B2":
    case "B3":
      return plural ? "master cartons" : "master carton";
    case "B4":
    case "B5":
      return plural ? "pallets" : "pallet";
  }
}
