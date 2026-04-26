import { adminRequest } from "@/lib/shopify/admin";

export type DiscountOpts = {
  code: string;
  type: "percentage" | "fixed";
  value: number;
  appliesTo?: "all" | string[];
  startsAt?: string;
  endsAt?: string;
};

export type ShopifyOrder = {
  id: string;
  name: string;
  createdAt: string;
  financialStatus: string;
  fulfillmentStatus: string;
  totalAmount: number;
  currencyCode: string;
  customerName: string;
  customerEmail: string;
};

export type OrderQueryOpts = {
  status?: "open" | "closed" | "cancelled";
  days?: number;
  limit?: number;
};

type InventoryLevelNode = {
  location: { id: string; name: string };
  quantities: Array<{ name: string; quantity: number }>;
};

type ProductVariantLookup = {
  productVariant: {
    id: string;
    title: string;
    inventoryItem: {
      id: string;
      sku: string | null;
      inventoryLevels: {
        edges: Array<{ node: InventoryLevelNode }>;
      };
    } | null;
  } | null;
};

type InventoryAdjustResult = {
  inventoryAdjustQuantities: {
    inventoryAdjustmentGroup: {
      changes: Array<{
        delta: number;
        quantityAfterChange: number;
        item: { sku: string | null } | null;
        location: { name: string } | null;
      }>;
    } | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
};

type DiscountCreateResult = {
  discountCodeBasicCreate: {
    codeDiscountNode: {
      id: string;
      codeDiscount: {
        codes: { nodes: Array<{ code: string }> };
      } | null;
    } | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
};

type OrdersQueryResult = {
  orders: {
    edges: Array<{
      node: {
        id: string;
        name: string;
        createdAt: string;
        displayFinancialStatus: string | null;
        displayFulfillmentStatus: string | null;
        totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
        customer: { displayName: string | null; email: string | null } | null;
      };
    }>;
  };
};

type ProductVariantsResult = {
  product: {
    variants: {
      edges: Array<{
        node: {
          id: string;
          title: string;
          sku: string | null;
        };
      }>;
    };
  } | null;
};

const PRODUCT_VARIANT_LOOKUP = /* GraphQL */ `
  query ProductVariantLookup($id: ID!) {
    productVariant(id: $id) {
      id
      title
      inventoryItem {
        id
        sku
        inventoryLevels(first: 10) {
          edges {
            node {
              location {
                id
                name
              }
              quantities(names: ["available"]) {
                name
                quantity
              }
            }
          }
        }
      }
    }
  }
`;

const INVENTORY_ADJUST = /* GraphQL */ `
  mutation InventoryAdjust($input: InventoryAdjustQuantitiesInput!) {
    inventoryAdjustQuantities(input: $input) {
      inventoryAdjustmentGroup {
        changes {
          delta
          quantityAfterChange
          item {
            sku
          }
          location {
            name
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const DISCOUNT_CREATE = /* GraphQL */ `
  mutation DiscountCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            codes(first: 1) {
              nodes {
                code
              }
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const ORDERS_QUERY = /* GraphQL */ `
  query RecentOrders($limit: Int!, $query: String!) {
    orders(first: $limit, query: $query, reverse: true, sortKey: CREATED_AT) {
      edges {
        node {
          id
          name
          createdAt
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          customer {
            displayName
            email
          }
        }
      }
    }
  }
`;

const PRODUCT_VARIANTS_QUERY = /* GraphQL */ `
  query ProductVariants($id: ID!) {
    product(id: $id) {
      variants(first: 50) {
        edges {
          node {
            id
            title
            sku
          }
        }
      }
    }
  }
`;

function normalizeError(error: string | undefined): string {
  return error || "Shopify Admin request failed";
}

function cleanISODate(value?: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function buildOrdersQuery(opts: OrderQueryOpts): string {
  const parts: string[] = [];
  const days = Math.max(1, Math.min(90, opts.days || 7));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  parts.push(`created_at:>=${since}`);

  const status = opts.status || "open";
  if (status === "closed") {
    parts.push("status:closed");
  } else if (status === "cancelled") {
    parts.push("status:cancelled");
  } else {
    parts.push("status:open");
  }

  return parts.join(" ");
}

export async function shopifyAdminQuery<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const result = await adminRequest<T>(query, variables);
  if (!result.ok || !result.data) {
    throw new Error(normalizeError(result.error));
  }
  return result.data;
}

export async function adjustInventory(
  variantId: string,
  delta: number,
  reason: string,
): Promise<{ success: boolean; newQuantity?: number; locationName?: string; error?: string }> {
  const lookup = await shopifyAdminQuery<ProductVariantLookup>(PRODUCT_VARIANT_LOOKUP, {
    id: variantId,
  });

  const inventoryItem = lookup.productVariant?.inventoryItem;
  const firstLevel = inventoryItem?.inventoryLevels.edges[0]?.node;
  if (!inventoryItem?.id || !firstLevel?.location?.id) {
    return { success: false, error: "Variant inventory metadata not found" };
  }

  const result = await shopifyAdminQuery<InventoryAdjustResult>(INVENTORY_ADJUST, {
    input: {
      reason,
      name: "available",
      changes: [
        {
          inventoryItemId: inventoryItem.id,
          locationId: firstLevel.location.id,
          delta,
        },
      ],
    },
  });

  const errors = result.inventoryAdjustQuantities.userErrors;
  if (errors.length > 0) {
    return { success: false, error: errors.map((item) => item.message).join("; ") };
  }

  const change = result.inventoryAdjustQuantities.inventoryAdjustmentGroup?.changes[0];
  return {
    success: true,
    newQuantity: change?.quantityAfterChange,
    locationName: change?.location?.name || firstLevel.location.name,
  };
}

export async function createDiscountCode(
  opts: DiscountOpts,
): Promise<{ ok: boolean; code?: string; id?: string; error?: string }> {
  const startsAt = cleanISODate(opts.startsAt) || new Date().toISOString();
  const endsAt = cleanISODate(opts.endsAt);
  const items = opts.appliesTo === "all" || !Array.isArray(opts.appliesTo)
    ? { all: true }
    : { products: { productsToAdd: opts.appliesTo } };

  const basicCodeDiscount: Record<string, unknown> = {
    title: opts.code,
    code: opts.code,
    startsAt,
    ...(endsAt ? { endsAt } : {}),
    customerSelection: { all: true },
    customerGets: {
      value: opts.type === "fixed"
        ? {
            discountAmount: {
              amount: Number(opts.value).toFixed(2),
              appliesOnEachItem: false,
            },
          }
        : {
            percentage: Number(opts.value) / 100,
          },
      items,
    },
    appliesOncePerCustomer: false,
  };

  const result = await shopifyAdminQuery<DiscountCreateResult>(DISCOUNT_CREATE, {
    basicCodeDiscount,
  });

  const errors = result.discountCodeBasicCreate.userErrors;
  if (errors.length > 0) {
    return { ok: false, error: errors.map((item) => item.message).join("; ") };
  }

  return {
    ok: true,
    code: result.discountCodeBasicCreate.codeDiscountNode?.codeDiscount?.codes.nodes[0]?.code || opts.code,
    id: result.discountCodeBasicCreate.codeDiscountNode?.id,
  };
}

export async function queryRecentOrders(opts: OrderQueryOpts = {}): Promise<ShopifyOrder[]> {
  const result = await shopifyAdminQuery<OrdersQueryResult>(ORDERS_QUERY, {
    limit: Math.max(1, Math.min(100, opts.limit || 25)),
    query: buildOrdersQuery(opts),
  });

  return result.orders.edges.map(({ node }) => ({
    id: node.id,
    name: node.name,
    createdAt: node.createdAt,
    financialStatus: node.displayFinancialStatus || "UNKNOWN",
    fulfillmentStatus: node.displayFulfillmentStatus || "UNFULFILLED",
    totalAmount: Number(node.totalPriceSet.shopMoney.amount || 0),
    currencyCode: node.totalPriceSet.shopMoney.currencyCode,
    customerName: node.customer?.displayName || "Unknown",
    customerEmail: node.customer?.email || "",
  }));
}

// ---------------------------------------------------------------------------
// Dispatch-ready orders — unfulfilled paid orders with shipping address
// ---------------------------------------------------------------------------

/**
 * Extended Shopify order payload carrying everything the S-08 classifier
 * + buy-label route need to dispatch without a second round-trip.
 *
 * Used by `/api/ops/shopify/unshipped` + `/ops/shopify-orders` as a
 * fallback for when the `orders/paid` webhook misses or hasn't been
 * configured yet (guide §2).
 */
export interface DispatchReadyOrder {
  id: string;
  name: string; // "#1018"
  createdAt: string;
  financialStatus: string;
  fulfillmentStatus: string;
  totalAmount: number;
  currencyCode: string;
  customer: {
    displayName: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  shippingAddress: {
    name: string | null;
    company: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    provinceCode: string | null;
    zip: string | null;
    country: string | null;
    countryCode: string | null;
    phone: string | null;
  } | null;
  lineItems: Array<{
    title: string;
    sku: string | null;
    quantity: number;
  }>;
  tags: string[];
  note: string | null;
}

const DISPATCH_ORDERS_QUERY = /* GraphQL */ `
  query UnshippedPaidOrders($limit: Int!, $query: String!) {
    orders(first: $limit, query: $query, reverse: true, sortKey: CREATED_AT) {
      edges {
        node {
          id
          name
          createdAt
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          customer {
            displayName
            email
            phone
          }
          shippingAddress {
            name
            company
            address1
            address2
            city
            province
            provinceCode
            zip
            country
            countryCode
            phone
          }
          lineItems(first: 20) {
            edges {
              node {
                title
                sku
                quantity
              }
            }
          }
          tags
          note
        }
      }
    }
  }
`;

interface DispatchOrdersQueryResult {
  orders: {
    edges: Array<{
      node: {
        id: string;
        name: string;
        createdAt: string;
        displayFinancialStatus: string | null;
        displayFulfillmentStatus: string | null;
        totalPriceSet: {
          shopMoney: { amount: string; currencyCode: string };
        };
        customer: {
          displayName: string | null;
          email: string | null;
          phone: string | null;
        } | null;
        shippingAddress: {
          name: string | null;
          company: string | null;
          address1: string | null;
          address2: string | null;
          city: string | null;
          province: string | null;
          provinceCode: string | null;
          zip: string | null;
          country: string | null;
          countryCode: string | null;
          phone: string | null;
        } | null;
        lineItems: {
          edges: Array<{
            node: { title: string; sku: string | null; quantity: number };
          }>;
        };
        tags: string[];
        note: string | null;
      };
    }>;
  };
}

/**
 * Pull the last N days of paid Shopify orders — for burn-rate
 * calibration. Returns total units shipped across all line items per
 * order, so the caller can divide by window days to get bags/day.
 */
export interface PaidOrderSummary {
  id: string;
  name: string;
  createdAt: string;
  totalUnits: number;
  totalAmount: number;
}

export async function queryPaidOrdersForBurnRate(opts: {
  days?: number;
  limit?: number;
  /**
   * Optional Shopify tag filter. `include` adds positive `tag:X`
   * clauses (AND-joined) to the search. `exclude` adds negative
   * `-tag:X` clauses. The KPI scorecard uses this to split paid
   * orders into Shopify DTC (exclude:["wholesale"]) and B2B
   * (include:["wholesale"]) without double-counting.
   *
   * When omitted, behaves identically to the original signature
   * (every paid order in the window, no tag discrimination) — so
   * existing callers (e.g. `burn-rate-calibration.ts`) are unaffected.
   */
  tagFilter?: { include?: string[]; exclude?: string[] };
} = {}): Promise<PaidOrderSummary[]> {
  const days = opts.days ?? 30;
  const limit = Math.max(1, Math.min(250, opts.limit ?? 250));
  const createdSince = new Date(Date.now() - days * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  // Include refunded/cancelled-on-paid? Only `financial_status:paid`
  // counts as a sale for burn calculation. Returns don't matter — we
  // compute forward burn, not lifetime net.
  const queryParts = [`financial_status:paid`, `created_at:>${createdSince}`];
  for (const t of opts.tagFilter?.include ?? []) {
    if (t.trim()) queryParts.push(`tag:${t.trim()}`);
  }
  for (const t of opts.tagFilter?.exclude ?? []) {
    if (t.trim()) queryParts.push(`-tag:${t.trim()}`);
  }
  const query = queryParts.join(" ");
  const result = await shopifyAdminQuery<DispatchOrdersQueryResult>(
    DISPATCH_ORDERS_QUERY,
    { limit, query },
  );
  return result.orders.edges.map(({ node }) => ({
    id: node.id,
    name: node.name,
    createdAt: node.createdAt,
    totalUnits: node.lineItems.edges.reduce(
      (s, e) => s + (e.node.quantity ?? 0),
      0,
    ),
    totalAmount: Number(node.totalPriceSet.shopMoney.amount ?? 0),
  }));
}

/**
 * Query Shopify for unfulfilled paid orders with full ship-to + line
 * items. Paired with the UI queue at /ops/shopify-orders.
 */
export async function queryUnfulfilledPaidOrders(opts: {
  days?: number;
  limit?: number;
} = {}): Promise<DispatchReadyOrder[]> {
  const days = opts.days ?? 14;
  const limit = Math.max(1, Math.min(100, opts.limit ?? 50));
  // Shopify query syntax: financial_status:paid fulfillment_status:unfulfilled
  const createdSince = new Date(Date.now() - days * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const query = `financial_status:paid fulfillment_status:unfulfilled created_at:>${createdSince}`;
  const result = await shopifyAdminQuery<DispatchOrdersQueryResult>(
    DISPATCH_ORDERS_QUERY,
    { limit, query },
  );
  return result.orders.edges.map(({ node }) => ({
    id: node.id,
    name: node.name,
    createdAt: node.createdAt,
    financialStatus: node.displayFinancialStatus ?? "UNKNOWN",
    fulfillmentStatus: node.displayFulfillmentStatus ?? "UNFULFILLED",
    totalAmount: Number(node.totalPriceSet.shopMoney.amount ?? 0),
    currencyCode: node.totalPriceSet.shopMoney.currencyCode,
    customer: node.customer,
    shippingAddress: node.shippingAddress,
    lineItems: node.lineItems.edges.map((e) => ({
      title: e.node.title,
      sku: e.node.sku,
      quantity: e.node.quantity,
    })),
    tags: node.tags ?? [],
    note: node.note,
  }));
}

export async function getProductVariants(
  productId: string,
): Promise<Array<{ id: string; title: string; sku: string }>> {
  const result = await shopifyAdminQuery<ProductVariantsResult>(PRODUCT_VARIANTS_QUERY, {
    id: productId,
  });
  return (result.product?.variants.edges || []).map(({ node }) => ({
    id: node.id,
    title: node.title,
    sku: node.sku || "",
  }));
}

// ---------------------------------------------------------------------------
// On-hand inventory across all products (Shipping Hub ATP + Ops Agent low-stock)
// ---------------------------------------------------------------------------

export interface OnHandRow {
  productTitle: string;
  variantId: string;
  variantTitle: string;
  sku: string;
  /** Sum of on-hand across every location. */
  onHand: number;
  /** Per-location breakdown so Ben can see Ashford vs elsewhere. */
  byLocation: Array<{ locationId: string; locationName: string; onHand: number }>;
}

const ON_HAND_QUERY = /* GraphQL */ `
  query AllOnHand($first: Int!, $cursor: String) {
    products(first: $first, after: $cursor, query: "status:active") {
      edges {
        cursor
        node {
          id
          title
          variants(first: 50) {
            edges {
              node {
                id
                title
                sku
                inventoryItem {
                  id
                  tracked
                  inventoryLevels(first: 10) {
                    edges {
                      node {
                        location {
                          id
                          name
                        }
                        quantities(names: ["on_hand"]) {
                          name
                          quantity
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

interface OnHandQueryResult {
  products: {
    edges: Array<{
      cursor: string;
      node: {
        id: string;
        title: string;
        variants: {
          edges: Array<{
            node: {
              id: string;
              title: string;
              sku: string | null;
              inventoryItem: {
                id: string;
                tracked: boolean;
                inventoryLevels: {
                  edges: Array<{
                    node: {
                      location: { id: string; name: string };
                      quantities: Array<{ name: string; quantity: number }>;
                    };
                  }>;
                };
              } | null;
            };
          }>;
        };
      };
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

/**
 * Fetch on-hand inventory for every active product + variant, summed
 * across all Shopify locations.
 *
 * Paginates through `products` until `hasNextPage` is false. At the 7
 * SKUs USA Gummies has today this is one page; the pagination is here
 * so we don't silently truncate as the catalog grows.
 */
export async function getAllOnHandInventory(): Promise<OnHandRow[]> {
  const rows: OnHandRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const result: OnHandQueryResult = await shopifyAdminQuery<OnHandQueryResult>(ON_HAND_QUERY, {
      first: 50,
      cursor,
    });
    for (const { node: product } of result.products.edges) {
      for (const { node: variant } of product.variants.edges) {
        if (!variant.inventoryItem || !variant.inventoryItem.tracked) continue;
        const levels = variant.inventoryItem.inventoryLevels.edges.map(({ node }) => {
          const onHandQ = node.quantities.find((q) => q.name === "on_hand");
          return {
            locationId: node.location.id,
            locationName: node.location.name,
            onHand: Number(onHandQ?.quantity ?? 0),
          };
        });
        rows.push({
          productTitle: product.title,
          variantId: variant.id,
          variantTitle: variant.title,
          sku: variant.sku || "",
          onHand: levels.reduce((a, l) => a + l.onHand, 0),
          byLocation: levels,
        });
      }
    }
    if (!result.products.pageInfo.hasNextPage) break;
    cursor = result.products.pageInfo.endCursor;
    if (!cursor) break;
  }
  return rows;
}
