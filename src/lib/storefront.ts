// src/lib/storefront.ts
import { cache } from "react";

function getShopifyEndpoint() {
  // Prefer explicit endpoint if provided
  const explicit = process.env.SHOPIFY_STOREFRONT_API_ENDPOINT;
  if (explicit) return explicit;

  // Fallback: build endpoint from common env vars if they exist
  const domain =
    process.env.SHOPIFY_STORE_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
    process.env.SHOPIFY_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN;

  const version =
    process.env.SHOPIFY_STOREFRONT_API_VERSION ||
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_VERSION;

  if (domain && version) {
    const clean = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${clean}/api/${version}/graphql.json`;
  }

  return undefined;
}

function getShopifyToken() {
  return (
    process.env.SHOPIFY_STOREFRONT_API_TOKEN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_TOKEN ||
    process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN
  );
}

const SHOPIFY_ENDPOINT = getShopifyEndpoint();
const SHOPIFY_TOKEN = getShopifyToken();

type ShopifyResponse<T> = { data?: T; errors?: Array<{ message: string }> };

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
}): Promise<T> {
  if (!SHOPIFY_ENDPOINT) {
    throw new Error(
      "Missing Shopify endpoint. Set SHOPIFY_STOREFRONT_API_ENDPOINT OR (SHOPIFY_STORE_DOMAIN + SHOPIFY_STOREFRONT_API_VERSION)."
    );
  }
  if (!SHOPIFY_TOKEN) {
    throw new Error(
      "Missing Shopify token. Set SHOPIFY_STOREFRONT_API_TOKEN (or a supported token env var)."
    );
  }

  const res = await fetch(SHOPIFY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": SHOPIFY_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
    next: { revalidate, tags },
  });

  const json = (await res.json()) as ShopifyResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join(" | "));
  }
  if (!json.data) throw new Error("No data returned from Shopify.");
  return json.data;
}

/** -----------------------
 *  Queries
 *  --------------------- */

const SHOP_QUERY = /* GraphQL */ `
  query ShopInfo {
    shop {
      name
      description
      primaryDomain {
        url
        host
      }
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
    products(
      first: $first
      after: $after
      sortKey: $sortKey
      reverse: $reverse
      query: $query
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          handle
          description
          featuredImage {
            url
            altText
            width
            height
          }
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          variants(first: 1) {
            edges {
              node {
                id
                availableForSale
              }
            }
          }
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
      featuredImage {
        url
        altText
        width
        height
      }
      images(first: 12) {
        edges {
          node {
            url
            altText
            width
            height
          }
        }
      }
      priceRange {
        minVariantPrice {
          amount
          currencyCode
        }
      }
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

// ✅ Cart upsell query: one best-selling, in-stock variant
const CART_UPSELL_QUERY = /* GraphQL */ `
  query CartUpsell($first: Int!) {
    products(first: $first, sortKey: BEST_SELLING) {
      edges {
        node {
          title
          handle
          featuredImage {
            url
            altText
            width
            height
          }
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          variants(first: 10) {
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
      edges: Array<{
        node: { url: string; altText: string | null; width: number; height: number };
      }>;
    };
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

/** -----------------------
 *  Public API
 *  --------------------- */

export const getShopInfo = cache(async () => {
  return shopifyFetch<ShopInfo>({
    query: SHOP_QUERY,
    tags: ["shop"],
    revalidate: 3600,
  });
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

  return shopifyFetch<ProductsResult>({
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
});

export const getProductByHandle = cache(async (handle: string) => {
  return shopifyFetch<ProductByHandleResult>({
    query: PRODUCT_BY_HANDLE_QUERY,
    variables: { handle },
    tags: ["product", `product:${handle}`],
    revalidate: 120,
  });
});

// ✅ New: Cart upsell helper (best-selling, in-stock variant)
export const getCartUpsell = cache(async (): Promise<CartUpsell | null> => {
  const data = await shopifyFetch<CartUpsellResult>({
    query: CART_UPSELL_QUERY,
    variables: { first: 6 },
    tags: ["products", "cart-upsell"],
    revalidate: 300,
  });

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