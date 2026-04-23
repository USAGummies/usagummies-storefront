/**
 * Shipping packaging picker — Ben's canonical rules.
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
