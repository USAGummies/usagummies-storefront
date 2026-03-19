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
