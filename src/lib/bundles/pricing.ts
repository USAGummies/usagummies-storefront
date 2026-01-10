// src/lib/bundles/pricing.ts

export const BASE_PRICE = 5.99;
export const MIN_PER_BAG = 4.25;
export const DISCOUNT_START_QTY = 4;
export const MAX_DISCOUNT_QTY = 12;
export const FREE_SHIP_QTY = 5;
export const FREE_SHIPPING_PHRASE = "Free shipping on 5+ bags";

export function perBagForQty(qty: number) {
  const q = Number(qty) || 0;
  if (q <= 0) return BASE_PRICE;
  if (q < DISCOUNT_START_QTY) return BASE_PRICE;
  if (q >= MAX_DISCOUNT_QTY) return MIN_PER_BAG;

  const steps = MAX_DISCOUNT_QTY - (DISCOUNT_START_QTY - 1); // 9 steps (4..12)
  const t = (q - (DISCOUNT_START_QTY - 1)) / steps;
  const per = BASE_PRICE - (BASE_PRICE - MIN_PER_BAG) * t;
  return Math.max(MIN_PER_BAG, per);
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
