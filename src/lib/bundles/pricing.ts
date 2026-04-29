// src/lib/bundles/pricing.ts

export const BASE_PRICE = 5.99;
export const MIN_PER_BAG = 4.30;
export const DISCOUNT_START_QTY = 5;
export const MAX_DISCOUNT_QTY = 12;
// 2026-04-28 (Ben directive): free shipping on EVERYTHING. Even single bags.
// Eat the ~$5/order ship cost as customer-acquisition spend on entry-level
// orders. Cart messaging now sells the per-bag-savings ladder (5+ bags drops
// from $5.99/bag to $5.00/bag = save ~$5 = "essentially a free bag").
export const FREE_SHIP_QTY = 1;
export const SHIPPING_COST = 0;
export const FREE_SHIPPING_PHRASE = "Free shipping on every order";

/** Subscription saves $0.50/bag below bundle pricing (min 5 bags) */
export const SUBSCRIPTION_DISCOUNT_PER_BAG = 0.50;
export const SUBSCRIPTION_MIN_QTY = 5;
export const SUBSCRIPTION_FREQUENCIES = [
  { label: "Monthly", days: 30 },
  { label: "Every 6 Weeks", days: 42 },
  { label: "Bi-Monthly", days: 60 },
] as const;

/**
 * Per-bag price: $5.00 at 5 bags, drops $0.10 per additional bag.
 *   5 → $5.00, 6 → $4.90, 7 → $4.80 … 12 → $4.30
 * 1-4 bags are full retail ($5.99).
 */
export function perBagForQty(qty: number) {
  const q = Number(qty) || 0;
  if (q <= 0) return BASE_PRICE;
  if (q < DISCOUNT_START_QTY) return BASE_PRICE;
  if (q >= MAX_DISCOUNT_QTY) return MIN_PER_BAG;

  // $5.00 at 5 bags, subtract $0.10 for each bag beyond 5
  const per = 5.0 - (q - 5) * 0.1;
  return Math.max(MIN_PER_BAG, parseFloat(per.toFixed(2)));
}

export function totalForQty(qty: number) {
  const per = perBagForQty(qty);
  return per * (Number(qty) || 0);
}

export function pricingForQty(qty: number) {
  const perBag = perBagForQty(qty);
  const total = totalForQty(qty);
  return { perBag, total };
}

/** Shipping cost for a given quantity (free at 5+) */
export function shippingForQty(qty: number): number {
  return (Number(qty) || 0) >= FREE_SHIP_QTY ? 0 : SHIPPING_COST;
}

/** Subscription per-bag price = bundle price - $0.50 */
export function subscriptionPerBagForQty(qty: number): number {
  const q = Number(qty) || 0;
  if (q < SUBSCRIPTION_MIN_QTY) return perBagForQty(q);
  return Math.max(0, perBagForQty(q) - SUBSCRIPTION_DISCOUNT_PER_BAG);
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
