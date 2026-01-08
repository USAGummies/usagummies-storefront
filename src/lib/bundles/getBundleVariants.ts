import "server-only";
import { storefrontFetch } from "@/lib/shopify/storefront";

type VariantNode = {
  id: string;
  title: string;
  availableForSale: boolean;
  price?: { amount: string; currencyCode?: string | null };
};

export type BundleTier = {
  qty: number;
  title: string;
  descriptor: string;
  variantId: string;
  price: number | null;
  perBag: number | null;
  currencyCode: string | null | undefined;
  available: boolean;
  shippingText: string;
  badge?: string;
};

export type BundleVariantsResult = {
  tiers: BundleTier[];
  productHandle: string;
};

const DEFAULT_HANDLE = "all-american-gummy-bears-7-5-oz-single-bag";
const BUNDLE_HANDLE = DEFAULT_HANDLE;

const QUERY = /* GraphQL */ `
  query BundleVariants($handle: String!) {
    product(handle: $handle) {
      handle
      variants(first: 50) {
        edges {
          node {
            id
            title
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

function parseQtyFromTitle(title?: string | null): number | null {
  if (!title) return null;
  const m = title.match(/^(\d+)\s*(bag|bags)?/i);
  if (!m) return null;
  const qty = Number(m[1]);
  return Number.isFinite(qty) ? qty : null;
}

function descriptorForQty(qty: number) {
  if (qty === 5) return "Starter bundle";
  if (qty === 8) return "Most popular bundle";
  if (qty === 12) return "Stock up case";
  if (qty >= 9) return "Stock-up bundle";
  if (qty >= 6) return "Bundle & save";
  return "Smaller pack";
}

export async function getBundleVariants(): Promise<BundleVariantsResult | null> {
  const data = await storefrontFetch<{
    product: {
      handle: string;
      variants: { edges: Array<{ node: VariantNode }> };
    } | null;
  }>({
    query: QUERY,
    variables: { handle: BUNDLE_HANDLE },
    tags: ["product", `bundle:${BUNDLE_HANDLE}`],
    revalidate: 120,
  });

  if (!data?.product) return null;

  const tiers: BundleTier[] = [];
  for (const edge of data.product.variants.edges || []) {
    const node = edge?.node;
    if (!node?.id) continue;
    const qty = parseQtyFromTitle(node.title);
    if (!qty || qty < 2) continue; // skip single bag for homepage; still return 2+ for PDP use
    const priceNum = Number(node.price?.amount);
    const price = Number.isFinite(priceNum) ? priceNum : null;
    const shippingText = qty >= 5 ? "Free shipping" : "+ $7.99 shipping";
    const badge =
      qty === 8
        ? "Most popular"
        : qty === 12
        ? "Stock up"
        : qty >= 9
        ? "Stock up"
        : undefined;

    tiers.push({
      qty,
      title: node.title || `${qty} bags`,
      descriptor: descriptorForQty(qty),
      variantId: node.id,
      price,
      perBag: price && qty ? price / qty : null,
      currencyCode: node.price?.currencyCode ?? null,
      available: Boolean(node.availableForSale),
      shippingText,
      badge,
    });
  }

  tiers.sort((a, b) => a.qty - b.qty);

  return { tiers, productHandle: data.product.handle };
}
