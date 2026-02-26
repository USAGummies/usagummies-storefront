/**
 * Shopify Customer Inquiry Reader — USA Gummies
 *
 * Pulls recent orders with customer info and notes that indicate
 * inquiries or support interactions. Shopify doesn't have a native
 * inbox API, so we derive communication signals from order data.
 *
 * Uses existing SHOPIFY_ADMIN_TOKEN env var.
 */

import type { CommMessage } from "./types";

const SHOPIFY_ADMIN_TOKEN = () => process.env.SHOPIFY_ADMIN_TOKEN || "";
const SHOPIFY_STORE_DOMAIN = () =>
  (process.env.SHOPIFY_STORE_DOMAIN || process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

export function isShopifyCustomerConfigured(): boolean {
  return !!(SHOPIFY_ADMIN_TOKEN() && SHOPIFY_STORE_DOMAIN());
}

// ---------------------------------------------------------------------------
// GraphQL query
// ---------------------------------------------------------------------------

const RECENT_ORDERS_QUERY = `
  query($q: String!) {
    orders(first: 20, query: $q, reverse: true, sortKey: CREATED_AT) {
      edges {
        node {
          id
          name
          createdAt
          note
          tags
          financialStatus
          customer {
            email
            firstName
            lastName
          }
          totalPriceSet {
            shopMoney { amount currencyCode }
          }
        }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchShopifyCustomerMessages(limit = 15): Promise<CommMessage[]> {
  if (!isShopifyCustomerConfigured()) return [];

  const token = SHOPIFY_ADMIN_TOKEN();
  const domain = SHOPIFY_STORE_DOMAIN();

  try {
    // Get recent orders from the last 14 days
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const dateFilter = `created_at:>=${fourteenDaysAgo.toISOString().split("T")[0]}`;

    const res = await fetch(`https://${domain}/admin/api/2025-01/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        query: RECENT_ORDERS_QUERY,
        variables: { q: dateFilter },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return [];
    const json = await res.json();
    const edges = json.data?.orders?.edges || [];

    const messages: CommMessage[] = [];

    for (const edge of edges) {
      const order = edge.node;
      const customer = order.customer;
      if (!customer?.email) continue;

      const customerName = [customer.firstName, customer.lastName]
        .filter(Boolean)
        .join(" ") || customer.email;

      // Create a message for each order (especially those with notes or refund statuses)
      const hasNote = !!order.note;
      const isRefund = order.financialStatus === "REFUNDED" || order.financialStatus === "PARTIALLY_REFUNDED";
      const isPending = order.financialStatus === "PENDING";
      const tags = (order.tags || []) as string[];
      const hasSupport = tags.some((t: string) =>
        t.toLowerCase().includes("support") || t.toLowerCase().includes("inquiry"),
      );

      // Determine priority
      let priority: CommMessage["priority"] = "normal";
      if (isRefund || hasSupport) priority = "high";

      // Build subject and snippet
      let subject = `Order ${order.name}`;
      let snippet = `$${order.totalPriceSet?.shopMoney?.amount || "0"} — ${order.financialStatus}`;

      if (hasNote) {
        subject += " — Customer Note";
        snippet = order.note.slice(0, 200);
      }
      if (isRefund) {
        subject += " — Refund";
      }

      messages.push({
        id: `shopify-${order.id}`,
        source: "shopify_customer",
        from: customerName,
        subject,
        snippet,
        date: order.createdAt,
        read: !hasNote && !isRefund && !isPending,
        priority,
        category: isRefund || hasSupport ? "support" : "sales",
      });
    }

    return messages
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, limit);
  } catch (err) {
    console.error("[shopify-customers] Fetch failed:", err);
    return [];
  }
}
