// src/lib/shopify/storefront.ts
import "server-only";
import { cache } from "react";
import { shopifyRequest } from "./fetch";

const DEFAULT_STOREFRONT_API_VERSION = "2024-07";

function buildMissingEnvMessage(missing: Array<"endpoint" | "token">) {
  const lines = [
    `[Shopify] Missing ${missing.join(" & ")} configuration.`,
    "Expected environment variables:",
    "  Domain: SHOPIFY_STORE_DOMAIN or NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN (or SHOPIFY_DOMAIN / NEXT_PUBLIC_SHOPIFY_DOMAIN)",
    "  Token: SHOPIFY_STOREFRONT_API_TOKEN or SHOPIFY_STOREFRONT_ACCESS_TOKEN (or NEXT_PUBLIC_*)",
    "  Version: SHOPIFY_STOREFRONT_API_VERSION (defaults to 2024-07 if unset)",
    "Optional:",
    "  SHOPIFY_STOREFRONT_API_ENDPOINT to override the derived endpoint",
  ];
  return lines.join("\n");
}

let warnedConfig = false;

function getShopifyConfig() {
  const explicit = process.env.SHOPIFY_STOREFRONT_API_ENDPOINT;
  if (explicit) {
    return {
      endpoint: explicit,
      token:
        process.env.SHOPIFY_STOREFRONT_API_TOKEN ||
        process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_TOKEN ||
        process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN ||
        process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN,
    };
  }

  const domain =
    process.env.SHOPIFY_STORE_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
    process.env.SHOPIFY_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN;

  const version =
    process.env.SHOPIFY_STOREFRONT_API_VERSION ||
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_VERSION ||
    DEFAULT_STOREFRONT_API_VERSION;

  const endpoint =
    domain &&
    `https://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}/api/${version}/graphql.json`;

  const token =
    process.env.SHOPIFY_STOREFRONT_API_TOKEN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_TOKEN ||
    process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN;

  return { endpoint, token };
}

async function shopifyFetch<T>({
  query,
  variables,
  tags = [],
  revalidate = 60,
}: {
  query: string;
  variables?: Record<string, any>;
  tags?: string[];
  revalidate?: number;
}): Promise<T | null> {
  const { endpoint, token } = getShopifyConfig();
  if (!endpoint || !token) {
    if (!warnedConfig) {
      const missing: Array<"endpoint" | "token"> = [];
      if (!endpoint) missing.push("endpoint");
      if (!token) missing.push("token");
      console.warn(buildMissingEnvMessage(missing.length ? missing : ["endpoint", "token"]));
      warnedConfig = true;
    }
    return null;
  }

  const result = await shopifyRequest<T>({
    endpoint,
    token,
    body: { query, variables },
    next: { revalidate, tags },
    warnPrefix: "Shopify",
  });

  return result.ok ? result.data : null;
}

export { shopifyFetch as storefrontFetch };

/** -----------------------
 Queries
--------------------- */
const SHOP_QUERY = /* GraphQL */ `
  query ShopInfo {
    shop {
      name
      description
      primaryDomain { url host }
    }
  }
`;

const PRODUCTS_QUERY = /* GraphQL */ `
  query Products(
    $first: Int!
    $after: String
    $sortKey: ProductSortKeys
    $reverse: Boolean
    $query: String
  ) {
    products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse, query: $query) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          handle
          description
          featuredImage { url altText width height }
          priceRange { minVariantPrice { amount currencyCode } }
          variants(first: 1) { edges { node { id availableForSale } } }
        }
      }
    }
  }
`;

const PRODUCT_BY_HANDLE_QUERY = /* GraphQL */ `
  query ProductByHandle($handle: String!) {
    product(handle: $handle) {
      id
      title
      handle
      description
      descriptionHtml
      vendor
      productType
      featuredImage { url altText width height }
      images(first: 12) { edges { node { url altText width height } } }
      priceRange { minVariantPrice { amount currencyCode } }
      bundleTiers: metafield(namespace: "usagummies", key: "bundle_tiers") { value type }
      variants(first: 50) {
        edges {
          node {
            id
            title
            sku
            availableForSale
            price { amount currencyCode }
            bundleBadge: metafield(namespace: "custom", key: "bundle_badge") { value }
          }
        }
      }
    }
  }
`;

const CART_UPSELL_QUERY = /* GraphQL */ `
  query CartUpsell($first: Int!) {
    products(first: $first, sortKey: BEST_SELLING) {
      edges {
        node {
          title
          handle
          featuredImage { url altText width height }
          priceRange { minVariantPrice { amount currencyCode } }
          variants(first: 10) {
            edges { node { id title availableForSale price { amount currencyCode } } }
          }
        }
      }
    }
  }
`;

export type ShopInfo = {
  shop: {
    name: string;
    description: string | null;
    primaryDomain: { url: string; host: string };
  };
};

export type ProductCard = {
  id: string;
  title: string;
  handle: string;
  description: string;
  featuredImage: {
    url: string;
    altText: string | null;
    width: number;
    height: number;
  } | null;
  priceRange: { minVariantPrice: { amount: string; currencyCode: string } };
  variants: { edges: Array<{ node: { id: string; availableForSale: boolean } }> };
};

export type ProductsResult = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: ProductCard }>;
  };
};

export type ProductByHandleResult = {
  product: {
    id: string;
    title: string;
    handle: string;
    description: string;
    vendor: string;
    productType: string;
    featuredImage: {
      url: string;
      altText: string | null;
      width: number;
      height: number;
    } | null;
    images: {
      edges: Array<{ node: { url: string; altText: string | null; width: number; height: number } }>;
    };
    priceRange: { minVariantPrice: { amount: string; currencyCode: string } };
    bundleTiers: { value: string | null; type: string | null } | null;
    variants: {
      edges: Array<{
        node: {
          id: string;
          title: string;
          sku: string | null;
          availableForSale: boolean;
          price: { amount: string; currencyCode: string };
          bundleBadge: { value: string | null } | null;
        };
      }>;
    };
  } | null;
};

export type CartUpsell = {
  title: string;
  handle: string;
  image: { url: string; altText: string | null; width: number; height: number } | null;
  price: { amount: string; currencyCode: string };
  variantId: string;
  variantTitle: string;
};

type CartUpsellResult = {
  products: {
    edges: Array<{
      node: {
        title: string;
        handle: string;
        featuredImage: { url: string; altText: string | null; width: number; height: number } | null;
        priceRange: { minVariantPrice: { amount: string; currencyCode: string } };
        variants: {
          edges: Array<{
            node: {
              id: string;
              title: string;
              availableForSale: boolean;
              price: { amount: string; currencyCode: string };
            };
          }>;
        };
      };
    }>;
  };
};

export const getShopInfo = cache(async () => {
  const data = await shopifyFetch<ShopInfo>({
    query: SHOP_QUERY,
    tags: ["shop"],
    revalidate: 3600,
  });
  return data ?? null;
});

export const getProducts = cache(async (opts?: {
  first?: number;
  after?: string | null;
  sort?: "BEST_SELLING" | "CREATED_AT" | "PRICE" | "TITLE";
  reverse?: boolean;
  query?: string | null;
}) => {
  const first = opts?.first ?? 12;
  const after = opts?.after ?? null;

  const data = await shopifyFetch<ProductsResult>({
    query: PRODUCTS_QUERY,
    variables: {
      first,
      after,
      sortKey: opts?.sort ?? "BEST_SELLING",
      reverse: opts?.reverse ?? false,
      query: opts?.query ?? null,
    },
    tags: ["products"],
    revalidate: 120,
  });

  return data ?? null;
});

export const getProductByHandle = cache(async (handle: string) => {
  const data = await shopifyFetch<ProductByHandleResult>({
    query: PRODUCT_BY_HANDLE_QUERY,
    variables: { handle },
    tags: ["product", `product:${handle}`],
    revalidate: 120,
  });

  return data ?? null;
});

export const getCartUpsell = cache(async (): Promise<CartUpsell | null> => {
  const data = await shopifyFetch<CartUpsellResult>({
    query: CART_UPSELL_QUERY,
    variables: { first: 6 },
    tags: ["products", "cart-upsell"],
    revalidate: 300,
  });

  if (!data) return null;

  const products = data.products.edges.map((e) => e.node);

  for (const p of products) {
    const v = p.variants.edges.map((e) => e.node).find((x) => x.availableForSale);
    if (!v) continue;

    const price = v.price?.amount ? v.price : p.priceRange.minVariantPrice;

    return {
      title: p.title,
      handle: p.handle,
      image: p.featuredImage ?? null,
      price,
      variantId: v.id,
      variantTitle: v.title,
    };
  }

  return null;
});

export function money(amount: string, currencyCode: string) {
  const n = Number(amount);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: n % 1 === 0 ? 0 : 2,
    }).format(n);
  } catch {
    return `${amount} ${currencyCode}`;
  }
}
