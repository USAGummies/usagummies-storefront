// src/lib/bundles/atomic.ts

export const SINGLE_BAG_VARIANT_ID = "gid://shopify/ProductVariant/62295921099123";
export const SINGLE_BAG_SKU = "199284624702";

export function isSingleBagVariant(variantId?: string | null) {
  return Boolean(variantId && variantId === SINGLE_BAG_VARIANT_ID);
}

export function normalizeSingleBagVariant(variantId?: string | null) {
  return isSingleBagVariant(variantId) ? SINGLE_BAG_VARIANT_ID : null;
}
