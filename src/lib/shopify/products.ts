// src/lib/shopify/products.ts
import { storefrontFetch } from "./storefront";

export type MoneyV2 = { amount: string; currencyCode: string };

export type ProductCardData = {
  id: string;
  handle: string;
  title: string;
  vendor: string;
  availableForSale: boolean;
  createdAt: string;
  totalInventory?: number | null;
  featuredImage?: { url: string; altText?: string | null } | null;
  priceRange: {
    minVariantPrice: MoneyV2;
    maxVariantPrice: MoneyV2;
  };
  variants: {
    nodes: Array<{
      id: string;
      availableForSale: boolean;
      price: MoneyV2;
      compareAtPrice?: MoneyV2 | null;
    }>;
  };
};

export type SortValue =
  | "featured"
  | "best-selling"
  | "price-asc"
  | "price-desc"
  | "newest";

type PageInfo = {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string | null;
  endCursor?: string | null;
};

export type ProductsPageResult = {
  nodes: ProductCardData[];
  pageInfo: PageInfo;
};

type ProductsQueryResponse = {
  products: ProductsPageResult;
};

type CollectionQueryResponse = {
  collectionByHandle: null | {
    id: string;
    handle: string;
    title: string;
    products: ProductsPageResult;
  };
};

const EMPTY_PRODUCTS_PAGE: ProductsPageResult = {
  nodes: [],
  pageInfo: {
    hasNextPage: false,
    hasPreviousPage: false,
    startCursor: null,
    endCursor: null,
  },
};

function toShopifySort(sort: SortValue): { sortKey: string | null; reverse: boolean } {
  switch (sort) {
    case "best-selling":
      return { sortKey: "BEST_SELLING", reverse: false };
    case "price-asc":
      return { sortKey: "PRICE", reverse: false };
    case "price-desc":
      return { sortKey: "PRICE", reverse: true };
    case "newest":
      return { sortKey: "CREATED_AT", reverse: true };
    case "featured":
    default:
      return { sortKey: null, reverse: false };
  }
}

function buildProductQueryString(q?: string) {
  const cleaned = (q ?? "").trim();
  if (!cleaned) return undefined;
  return cleaned;
}

function buildPaginationVars(params: {
  pageSize: number;
  after?: string;
  before?: string;
}): Record<string, unknown> {
  const isPrev = Boolean(params.before);
  if (isPrev) {
    return {
      last: params.pageSize,
      before: params.before ?? null,
    };
  }
  return {
    first: params.pageSize,
    after: params.after ?? null,
  };
}

/**
 * We try multiple handles so "Featured" merchandising works even if the admin
 * collection handle isn't what we expected.
 *
 * Order of preference:
 * - "shop" (clean canonical)
 * - "frontpage" (Shopify default)
 * - "all" (common fallback)
 */
const FEATURED_COLLECTION_HANDLES = ["shop", "frontpage", "all"] as const;

const PRODUCT_FIELDS = /* GraphQL */ `
  fragment ProductCardFields on Product {
    id
    handle
    title
    vendor
    availableForSale
    createdAt
    totalInventory
    featuredImage {
      url
      altText
    }
    priceRange {
      minVariantPrice {
        amount
        currencyCode
      }
      maxVariantPrice {
        amount
        currencyCode
      }
    }
    variants(first: 1) {
      nodes {
        id
        availableForSale
        price {
          amount
          currencyCode
        }
        compareAtPrice {
          amount
          currencyCode
        }
      }
    }
  }
`;

const PRODUCTS_QUERY = /* GraphQL */ `
  ${PRODUCT_FIELDS}
  query ProductsPage(
    $first: Int
    $last: Int
    $after: String
    $before: String
    $sortKey: ProductSortKeys
    $reverse: Boolean
    $query: String
  ) {
    products(
      first: $first
      last: $last
      after: $after
      before: $before
      sortKey: $sortKey
      reverse: $reverse
      query: $query
    ) {
      nodes {
        ...ProductCardFields
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

const COLLECTION_FEATURED_QUERY = /* GraphQL */ `
  ${PRODUCT_FIELDS}
  query FeaturedCollectionProducts(
    $handle: String!
    $first: Int
    $last: Int
    $after: String
    $before: String
  ) {
    collectionByHandle(handle: $handle) {
      id
      handle
      title
      products(first: $first, last: $last, after: $after, before: $before) {
        nodes {
          ...ProductCardFields
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  }
`;

async function tryFeaturedCollection(params: {
  pageSize: number;
  after?: string;
  before?: string;
}): Promise<ProductsPageResult | null> {
  const pagination = buildPaginationVars(params);

  for (const handle of FEATURED_COLLECTION_HANDLES) {
    const data = await storefrontFetch<CollectionQueryResponse>({
      query: COLLECTION_FEATURED_QUERY,
      variables: { handle, ...pagination },
      tags: ["products", `collection:${handle}`],
      revalidate: 120,
    });

    const collection = data?.collectionByHandle;
    if (collection?.products) {
      return collection.products;
    }
  }

  return null;
}

export async function getProductsPage(params: {
  pageSize: number;
  sort: SortValue;
  after?: string;
  before?: string;
  q?: string;
}): Promise<ProductsPageResult> {
  const qClean = buildProductQueryString(params.q);

  // Use collection merchandising order ONLY when:
  // - sort is "featured"
  // - there is no search query
  const canUseFeaturedCollection = params.sort === "featured" && !qClean;

  if (canUseFeaturedCollection) {
    const featured = await tryFeaturedCollection({
      pageSize: params.pageSize,
      after: params.after,
      before: params.before,
    });

    if (featured) return featured;
  }

  // Normal products query (search + explicit sorts)
  const { sortKey, reverse } = toShopifySort(params.sort);

  const variables: Record<string, unknown> = {
    ...buildPaginationVars({
      pageSize: params.pageSize,
      after: params.after,
      before: params.before,
    }),
    sortKey,
    reverse,
    query: qClean ?? null,
  };

  const data = await storefrontFetch<ProductsQueryResponse>({
    query: PRODUCTS_QUERY,
    variables,
    tags: ["products"],
    revalidate: 120,
  });

  return data?.products ?? EMPTY_PRODUCTS_PAGE;
}

/**
 * Cart add-ons helper (AOV lever)
 * Priority: bundle → case → pack → gift → sampler, then fallback to best-selling.
 * Excludes anything already in cart.
 */
export async function getSuggestedCartAddOns(params: {
  excludeHandles: string[];
  limit: number;
}): Promise<ProductCardData[]> {
  const exclude = new Set((params.excludeHandles ?? []).filter(Boolean));
  const limit = Math.max(0, Math.min(6, params.limit ?? 2)); // keep it lightweight
  if (limit === 0) return [];

  const priorityQueries = ["bundle", "case", "pack", "gift", "sampler"];

  const picked: ProductCardData[] = [];

  const takeFrom = (candidates: ProductCardData[]) => {
    for (const p of candidates) {
      if (picked.length >= limit) break;
      if (!p?.handle) continue;
      if (exclude.has(p.handle)) continue;
      if (p.availableForSale === false) continue;
      picked.push(p);
    }
  };

  // 1) Try priority keywords first
  for (const q of priorityQueries) {
    if (picked.length >= limit) break;

    try {
      const res = await getProductsPage({
        pageSize: Math.max(8, limit * 4),
        sort: "best-selling",
        q,
      });
      takeFrom(res.nodes ?? []);
    } catch {
      // ignore and keep going
    }
  }

  // 2) Fallback to best-sellers
  if (picked.length < limit) {
    try {
      const res = await getProductsPage({
        pageSize: Math.max(8, limit * 4),
        sort: "best-selling",
      });
      takeFrom(res.nodes ?? []);
    } catch {
      // ignore
    }
  }

  return picked.slice(0, limit);
}
