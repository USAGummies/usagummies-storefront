// src/lib/bundles/pricing.ts

export const BASE_PRICE = 5.99;
export const MIN_PER_BAG = 4.30;
export const DISCOUNT_START_QTY = 5;
export const MAX_DISCOUNT_QTY = 12;
export const FREE_SHIP_QTY = 5;
export const FREE_SHIPPING_PHRASE = "Free shipping on 5+ bags";

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
