// src/lib/bundles/pricing.ts
//
// 2026-04-30 (Ben directive): retire sliding-scale per-bag pricing in favor
// of "Buy X, Get Y FREE" frames. Floor: customer never pays below $4/bag.
//   5-Pack  → Buy 4, Get 1 FREE  (4 × $5.99 = $23.96 → $4.79/bag)
//   7-Pack  → Buy 5, Get 2 FREE  (5 × $5.99 = $29.95 → $4.28/bag)
//  10-Pack  → Buy 7, Get 3 FREE  (7 × $5.99 = $41.93 → $4.19/bag)
// Native Shopify BXGY automatic discounts apply the math at checkout — see
// scripts/discounts/replace-bundle-ladder.mjs for the discount setup.
//
// Off-tier quantities (1–4, 6, 8, 9, 11+) bill at retail × qty.
// FREE SHIPPING applies to every order (Ben directive 2026-04-28).

export const BASE_PRICE = 5.99;
export const MIN_PER_BAG = 4.19; // floor of the new ladder (10-pack rate)

// Free shipping on ALL orders.
export const FREE_SHIP_QTY = 1;
export const SHIPPING_COST = 0;
export const FREE_SHIPPING_PHRASE = "Free shipping on every order";

// Bundle definitions. Each tier is a "Buy X get Y free" deal.
export type BundleTier = {
  paid: number;       // bags charged for
  free: number;       // free bags
  total: number;      // total bags shipped (paid + free)
  list: number;       // dollar list price (paid × $5.99)
  perBag: number;     // effective $/bag = list / total
  hook: string;       // marketing hook (e.g. "Buy 4, Get 1 FREE")
  shortLabel: string; // short label for tabs/buttons (e.g. "5-Pack")
};

export const BUNDLE_TIERS: readonly BundleTier[] = [
  { paid: 4, free: 1, total: 5,  list: 23.96, perBag: 4.79, hook: "Buy 4, Get 1 FREE",  shortLabel: "5-Pack" },
  { paid: 5, free: 2, total: 7,  list: 29.95, perBag: 4.28, hook: "Buy 5, Get 2 FREE",  shortLabel: "7-Pack" },
  { paid: 7, free: 3, total: 10, list: 41.93, perBag: 4.19, hook: "Buy 7, Get 3 FREE",  shortLabel: "10-Pack" },
] as const;

// Min/max user-selectable bundle qty in slider UIs.
export const DISCOUNT_START_QTY = 5;
export const MAX_DISCOUNT_QTY = 10;

/** Subscription disabled — keep stubs at retail until S&S relaunches. */
export const SUBSCRIPTION_DISCOUNT_PER_BAG = 0;
export const SUBSCRIPTION_MIN_QTY = 5;
export const SUBSCRIPTION_FREQUENCIES = [
  { label: "Monthly", days: 30 },
  { label: "Every 6 Weeks", days: 42 },
  { label: "Bi-Monthly", days: 60 },
] as const;

/**
 * Find the bundle tier whose `total` exactly matches qty.
 * Returns `null` for off-tier qtys (those bill at retail × qty).
 */
export function bundleTierForQty(qty: number): BundleTier | null {
  const q = Number(qty) || 0;
  return BUNDLE_TIERS.find((t) => t.total === q) ?? null;
}

/**
 * Per-bag price:
 *   • On-tier qty (5, 7, 10): bundle per-bag rate.
 *   • Off-tier qty: full retail ($5.99/bag).
 */
export function perBagForQty(qty: number) {
  const tier = bundleTierForQty(qty);
  return tier ? tier.perBag : BASE_PRICE;
}

export function totalForQty(qty: number) {
  const tier = bundleTierForQty(qty);
  if (tier) return tier.list;
  return BASE_PRICE * (Number(qty) || 0);
}

export function pricingForQty(qty: number) {
  const perBag = perBagForQty(qty);
  const total = totalForQty(qty);
  return { perBag, total };
}

/** Shipping cost for a given qty (always free per current policy). */
export function shippingForQty(_qty: number): number {
  return 0;
}

/** Subscription per-bag = bundle per-bag (no S&S discount currently active). */
export function subscriptionPerBagForQty(qty: number): number {
  return perBagForQty(qty);
}

export function subscriptionTotalForQty(qty: number): number {
  return subscriptionPerBagForQty(qty) * (Number(qty) || 0);
}

export function subscriptionPricingForQty(qty: number) {
  const perBag = subscriptionPerBagForQty(qty);
  const total = subscriptionTotalForQty(qty);
  const bundleTotal = totalForQty(qty);
  const savings = bundleTotal - total;
  return { perBag, total, savings };
}
