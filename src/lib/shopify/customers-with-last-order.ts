/**
 * Shopify Admin — customer-with-last-order fetcher.
 *
 * Powers Phase D4 v0.2 (Shopify DTC reorder slot). The existing
 * `src/lib/comms/shopify-customers.ts` is for inquiry-detection
 * (notes/refunds/order tags); this one is purpose-built for the
 * reorder-window classifier — returns customers + their lastOrderAt
 * timestamps via Shopify's Customer.lastOrder field.
 *
 * Uses the existing `adminRequest()` helper from `./admin.ts`, so
 * env-guard + auth + error-handling are inherited.
 *
 * Fail-soft: every error path returns an empty array. Callers degrade
 * gracefully (no Shopify candidates surfaced if env not set or admin
 * API unreachable).
 */
import { adminRequest } from "./admin";

export interface ShopifyCustomerWithLastOrder {
  /** Shopify customer id (gid). */
  id: string;
  /** Numeric id portion (last segment of the gid) — useful for storefront URLs. */
  numericId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  /** ISO-8601 timestamp of the customer's most-recent order. Null when zero orders. */
  lastOrderAt: string | null;
  /** Customer-lifetime order count. */
  ordersCount: number;
  /** Customer-lifetime spend (USD). */
  totalSpentUsd: number | null;
  /** Customer-record createdAt. */
  customerCreatedAt: string | null;
}

const QUERY = /* GraphQL */ `
  query ShopifyCustomersWithLastOrder($first: Int!, $after: String, $q: String) {
    customers(first: $first, after: $after, query: $q, sortKey: UPDATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          email
          firstName
          lastName
          phone
          numberOfOrders
          createdAt
          amountSpent {
            amount
            currencyCode
          }
          lastOrder {
            id
            createdAt
          }
        }
      }
    }
  }
`;

interface ShopifyCustomerNode {
  id?: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  numberOfOrders?: string | number | null;
  createdAt?: string | null;
  amountSpent?: { amount?: string | null; currencyCode?: string | null } | null;
  lastOrder?: { id?: string | null; createdAt?: string | null } | null;
}

interface CustomersResponse {
  customers?: {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    edges?: Array<{ node?: ShopifyCustomerNode }>;
  };
}

/**
 * Extract numeric id from a Shopify gid (`gid://shopify/Customer/12345` → `12345`).
 * Returns the original string if the format doesn't match (so callers
 * can still log it in audits / Slack).
 */
export function numericIdFromGid(gid: string): string {
  const match = /\/(\d+)$/.exec(gid);
  return match?.[1] ?? gid;
}

function projectNode(node: ShopifyCustomerNode): ShopifyCustomerWithLastOrder | null {
  if (!node.id) return null;
  const ordersCount = Number(node.numberOfOrders);
  const totalSpent = node.amountSpent?.amount ? Number(node.amountSpent.amount) : null;
  return {
    id: node.id,
    numericId: numericIdFromGid(node.id),
    email: node.email ?? null,
    firstName: node.firstName ?? null,
    lastName: node.lastName ?? null,
    phone: node.phone ?? null,
    lastOrderAt: node.lastOrder?.createdAt ?? null,
    ordersCount: Number.isFinite(ordersCount) ? ordersCount : 0,
    totalSpentUsd: totalSpent !== null && Number.isFinite(totalSpent) ? totalSpent : null,
    customerCreatedAt: node.createdAt ?? null,
  };
}

/**
 * List Shopify customers with their lastOrder timestamp. Paginates
 * automatically up to `limit` customers (cap 500 — beyond that the
 * Admin API rate limits start dominating).
 *
 * `query` is a Shopify search query string — e.g. `"orders_count:>0"`
 * to filter out browse-only accounts. Defaults to all customers.
 *
 * Fail-soft: returns `[]` on auth failure / network error / non-2xx.
 */
export async function listShopifyCustomersWithLastOrder(opts: {
  limit?: number;
  query?: string;
} = {}): Promise<ShopifyCustomerWithLastOrder[]> {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 200));
  const query = opts.query ?? "orders_count:>0";
  const out: ShopifyCustomerWithLastOrder[] = [];

  let cursor: string | undefined;
  while (out.length < limit) {
    const pageSize = Math.min(50, limit - out.length); // Admin API max 50/page
    const res = await adminRequest<CustomersResponse>(QUERY, {
      first: pageSize,
      after: cursor,
      q: query,
    });
    if (!res.ok || !res.data?.customers) break;
    const edges = res.data.customers.edges ?? [];
    for (const edge of edges) {
      const node = edge?.node;
      if (!node) continue;
      const projected = projectNode(node);
      if (projected) out.push(projected);
    }
    if (!res.data.customers.pageInfo?.hasNextPage) break;
    cursor = res.data.customers.pageInfo.endCursor ?? undefined;
    if (!cursor) break;
  }
  return out;
}

/** Test hook — exported for the unit test to verify projection. */
export const __internal = { projectNode };
