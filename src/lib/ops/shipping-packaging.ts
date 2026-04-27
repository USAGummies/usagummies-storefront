/**
 * Shipping packaging picker — Ben's canonical rules.
 *
 * Also hosts the SKU → bags-per-unit lookup so the auto-ship pipeline
 * can compute bag count from any channel's line items (Amazon FBM,
 * Shopify DTC, Faire wholesale) without each caller carrying its own
 * SKU table.
 *
 * Every outbound order maps to exactly one packaging profile based on
 * bag count. These ranges define the auto-ship eligibility fence; any
 * bag count outside the defined ranges must surface for approval in
 * `#ops-approvals` instead of auto-buying a label.
 *
 *   1–4 bags    → 6×9 padded mailer  (USG-FBM-1PK orders up to a 4-pack)
 *   5–12 bags   → 7×7×7 inner case box
 *   36 bags     → master carton (21×14×8, 21 lb packed)
 *   everything  → surface for review (no auto-buy)
 *   else
 *
 * The biggest bundle currently listed on Amazon is a 10-pack, so the
 * vast majority of FBM orders land in the mailer bucket. The 5–12 range
 * covers 5-pack + 10-pack variants; 36 is the full-case co-packer ship.
 *
 * Weights are derived from measured packed weight:
 *   mailer tare   = 0.05 lb (empty 6×9 padded mailer)
 *   per-bag tare  = 0.50 lb (one 7.5 oz bag in packaging)
 *   case tare     = 0.50 lb (empty 7×7×7 box with filler)
 *   master carton = 21.125 lb (measured 2026-04-20)
 */

// ---------------------------------------------------------------------------
// SKU → bags-per-unit lookup
// ---------------------------------------------------------------------------
//
// Every channel's order lines reduce to "how many 7.5 oz bags are in
// this shipment?" — because packaging + postage are keyed off bag count,
// not dollar value or unit count. A Shopify line item of "USG-5PK ×
// quantity 2" = 10 bags. An Amazon line item of "USG-FBM-1PK × quantity
// 4" = 4 bags. This table is the single source of truth.
//
// Extend this map when a new SKU goes live. Unknown SKUs default to
// 1 bag/unit with a console warning — safer to under-estimate and
// surface for review than to silently over-pack.

const SKU_BAGS_PER_UNIT: Record<string, number> = {
  // Amazon FBM — current live SKU is 1-pack; 2/3-pack added pre-emptively
  // so a future variant launch doesn't silently undercount via the
  // bagsPerUnitForSku default-to-1 fallback.
  "USG-FBM-1PK": 1,
  "USG-FBM-2PK": 2,
  "USG-FBM-3PK": 3,
  "USG-FBM-5PK": 5,
  "USG-FBM-10PK": 10,
  // Shopify DTC (populate with real variant SKUs as they ship)
  "USG-1PK": 1,
  "USG-3PK": 3,
  "USG-5PK": 5,
  "USG-10PK": 10,
  // Wholesale / case
  "USG-CASE-6": 6,
  "UG-AAGB-6CT": 6,
  // Master carton
  "USG-MC-36": 36,
};

/**
 * Given a line-item SKU, return bags per unit. Falls back to 1 if the
 * SKU isn't registered (with a console warning so we notice new SKUs
 * on first order instead of in a surprise mis-pack).
 */
export function bagsPerUnitForSku(sku: string | null | undefined): number {
  if (!sku) return 1;
  const key = sku.trim().toUpperCase();
  const mapped = SKU_BAGS_PER_UNIT[key];
  if (mapped !== undefined) return mapped;
  console.warn(
    `[shipping-packaging] Unknown SKU "${sku}" — defaulting to 1 bag/unit. ` +
      `Add this to SKU_BAGS_PER_UNIT in src/lib/ops/shipping-packaging.ts.`,
  );
  return 1;
}

/**
 * Sum bag count across a list of order items. Handles both Amazon
 * (QuantityOrdered field) and ShipStation (quantity field) shapes by
 * accepting a generic {sku, quantity} interface.
 */
export function totalBagsForItems(
  items: Array<{ sku: string | null; quantity: number | null }>,
): number {
  let total = 0;
  for (const item of items) {
    const raw = Number(item.quantity);
    // Defensive: NaN / ±Infinity / non-positive → skip the line.
    // Amazon never sends those today, but a corrupted order item or
    // future channel sync bug shouldn't compute infinite bags and
    // hand undefined behavior to pickPackagingForBags downstream.
    if (!Number.isFinite(raw)) continue;
    const qty = Math.max(0, Math.floor(raw));
    if (qty === 0) continue;
    total += qty * bagsPerUnitForSku(item.sku);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Packaging profile
// ---------------------------------------------------------------------------

export type PackagingProfile = {
  /** Machine-readable profile id. Stable across all callers. */
  id: "mailer" | "inner_box_7x7x7" | "master_carton";
  /** Human label — matches the ShipStation "Custom Packages" entry. */
  shipStationPackage: string;
  /** Dimensions in inches. */
  length: number;
  width: number;
  height: number;
  /** Total packed weight in pounds (includes tare + bags). */
  weightLbs: number;
  /** Weight in ounces — preferred unit for USPS First-Class eligibility. */
  weightOunces: number;
  /**
   * `true` when the bag count falls within a canonical range we can auto-buy
   * for. `false` = surface for review (unusual qty, pallet, etc.).
   */
  autoBuyEligible: boolean;
  /** When not auto-buyable, the reason we surfaced it. */
  refuseReason?: string;
};

export function pickPackagingForBags(bags: number): PackagingProfile {
  const n = Math.floor(Number(bags) || 0);

  // 1–4 bags → branded mailer
  if (n >= 1 && n <= 4) {
    const weightLbs = Math.round((0.05 + 0.5 * n) * 100) / 100;
    return {
      id: "mailer",
      shipStationPackage: "Sample Mailer (Branded)",
      length: 11,
      width: 9,
      height: 1,
      weightLbs,
      weightOunces: Math.round(weightLbs * 16 * 10) / 10,
      autoBuyEligible: true,
    };
  }

  // 5–12 bags → 7×7×7 inner case box
  if (n >= 5 && n <= 12) {
    const weightLbs = Math.round((0.5 + 0.5 * n) * 100) / 100;
    return {
      id: "inner_box_7x7x7",
      shipStationPackage: "Inner Case Box (6-ct)",
      length: 7,
      width: 7,
      height: 7,
      weightLbs,
      weightOunces: Math.round(weightLbs * 16 * 10) / 10,
      autoBuyEligible: true,
    };
  }

  // Exactly 36 bags → master carton (strict — we don't assume 13–35 or 37+)
  if (n === 36) {
    return {
      id: "master_carton",
      shipStationPackage: "Master Carton (36-ct)",
      length: 21,
      width: 14,
      height: 8,
      weightLbs: 21.125,
      weightOunces: Math.round(21.125 * 16 * 10) / 10,
      autoBuyEligible: true,
    };
  }

  // Fallthrough: surface for approval. Default dims are the mailer so a
  // UI preview doesn't crash, but autoBuyEligible=false blocks auto-buy.
  return {
    id: "mailer",
    shipStationPackage: "Sample Mailer (Branded)",
    length: 11,
    width: 9,
    height: 1,
    weightLbs: 0.55,
    weightOunces: 8.8,
    autoBuyEligible: false,
    refuseReason:
      n <= 0
        ? "Order has no bags — route to #ops-approvals for manual review."
        : n >= 13 && n <= 35
          ? `Unusual bag count (${n}) — falls between the 12-bag case limit and 36-bag master carton. Manual review needed.`
          : n > 36
            ? `Multi-carton shipment (${n} bags) — surface for manual split + review.`
            : `Bag count ${n} does not match any auto-buy profile.`,
  };
}
