/**
 * Escalation-clause variants per `/contracts/pricing-route-governance.md` §6.
 *
 * Required on every booth quote (R7). Variants:
 *   - Reorder protection (anchor account): N=3 pallets, M=90 days
 *   - Landed delivery offer: N=1 pallet, M=30 days
 *   - Strategic / sample / show special: "this order only"
 *
 * Pure functions only — fully unit-testable.
 */
import type { ApprovalRequirement, PricingClass } from "./booth-visit-types";

/** Pick the right clause variant for a given quote shape. */
export function escalationClauseFor(args: {
  pricingClass: PricingClass;
  approval: ApprovalRequirement;
  totalBags: number;
}): string {
  // Sample drops (free) — no escalation needed but still document in audit.
  if (args.pricingClass === "C-EXC" && args.totalBags <= 6) {
    return "Sample drop — this order only. No reorder protection; future orders priced at the published wholesale tier when buyer is ready.";
  }
  // Strategic exception — explicit "this order only" with deal memo.
  if (args.pricingClass === "C-EXC") {
    return "Strategic / one-off pricing — this order only. Reorders require fresh deal-check and may quote at the published wholesale tier.";
  }
  // Route anchor — longest exposure, longest protection.
  if (args.pricingClass === "C-ANCH") {
    return "Pricing held for the next 3 pallets / 90 days, whichever comes first. Reorders beyond that window are subject to repricing based on (a) input cost movement (gelatin, sugar, packaging, freight), (b) route density at the time of reorder, and (c) any updates to USA Gummies' standard wholesale pricing schedule.";
  }
  // Pickup floor — same 3-pallet / 90-day window as anchor (precedent-setting).
  if (args.pricingClass === "C-PU") {
    return "Pickup pricing held for the next 3 master cartons / 90 days, whichever comes first. Reorders beyond that window are subject to repricing per USA Gummies' standard pickup terms.";
  }
  // Route fill — anchor's escalation governs the route; fill stops re-quote per route.
  if (args.pricingClass === "C-FILL") {
    return "Pricing held for this delivery and the next planned trip to the region. Reorders outside the anchor's window may reprice based on route density and standard wholesale pricing.";
  }
  // Landed standard (B2/B4) — tighter window since freight is exposed to market.
  if (args.totalBags >= 36) {
    return "Pricing held for the current order and the next 1 pallet / 30 days, whichever comes first. Reorders beyond that window are subject to repricing based on input cost movement, freight market, and any updates to USA Gummies' standard wholesale pricing schedule.";
  }
  // Sub-master-carton.
  return "Pricing held for the current order. Reorders are subject to USA Gummies' standard wholesale pricing schedule at time of order.";
}
