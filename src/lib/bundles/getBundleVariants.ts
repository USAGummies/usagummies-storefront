import "server-only";

import { storefrontFetch } from "@/lib/shopify/storefront";
import { pricingForQty, FREE_SHIP_QTY } from "./pricing";
import { SINGLE_BAG_VARIANT_ID, SINGLE_BAG_SKU } from "./atomic";

export interface BundleVariant {
  quantity: number;
  perBagPrice: number;
  totalPrice: number;
  freeShipping: boolean;
}

type VariantNode = {
  id: string;
  title: string;
  sku?: string | null;
  availableForSale: boolean;
  price?: { amount: string; currencyCode?: string | null };
};

const VARIANTS_QUERY = /* GraphQL */ `
  query BundleVariants($first: Int!) {
    products(first: 20) {
      nodes {
        variants(first: $first) {
          nodes {
            id
            title
            sku
            availableForSale
            price {
              amount
              currencyCode
            }
          }
        }
      }
    }
  }
`;

export async function getBundleVariants(): Promise<{
  variants: BundleVariant[];
  singleBagVariantId: string;
  singleBagSku: string;
  availableForSale: boolean;
}> {
  let availableForSale = true;

  try {
    const data = await storefrontFetch<{
      products: { nodes: Array<{ variants: { nodes: VariantNode[] } }> };
    }>({
      query: VARIANTS_QUERY,
      variables: { first: 250 },
    });

    const allVariants =
      data?.products?.nodes?.flatMap((p) => p.variants?.nodes ?? []) ?? [];

    const single = allVariants.find(
      (v) => v.id === SINGLE_BAG_VARIANT_ID || v.sku === SINGLE_BAG_SKU
    );

    if (single) availableForSale = !!single.availableForSale;
  } catch {
    availableForSale = true;
  }

  const variants: BundleVariant[] = [];

  for (let qty = 1; qty <= 12; qty++) {
    const p = pricingForQty(qty);
    variants.push({
      quantity: qty,
      perBagPrice: p.perBag,
      totalPrice: p.total,
      freeShipping: qty >= FREE_SHIP_QTY,
    });
  }

  return {
    variants,
    singleBagVariantId: SINGLE_BAG_VARIANT_ID,
    singleBagSku: SINGLE_BAG_SKU,
    availableForSale,
  };
}

export function getRecommendedVariant(): BundleVariant {
  const variants = Array.from({ length: 12 }, (_, i) => {
    const qty = i + 1;
    const p = pricingForQty(qty);
    return {
      quantity: qty,
      perBagPrice: p.perBag,
      totalPrice: p.total,
      freeShipping: qty >= FREE_SHIP_QTY,
    };
  });

  return variants.find((v) => v.quantity === 8)!;
}

// Back-compat: older components import BundleTier
export type BundleTier = BundleVariant;
