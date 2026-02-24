/**
 * GET /api/ops/finance — Financial summary from Shopify Admin API
 *
 * Returns order count, total revenue, AOV, and recent orders.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || "";
const SHOPIFY_STORE_DOMAIN =
  process.env.SHOPIFY_STORE_DOMAIN ||
  process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
  "";

const ORDERS_QUERY = `
  query {
    orders(first: 50, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          name
          createdAt
          displayFinancialStatus
          totalPriceSet { shopMoney { amount } }
        }
      }
    }
  }
`;

export async function GET() {
  if (!SHOPIFY_ADMIN_TOKEN || !SHOPIFY_STORE_DOMAIN) {
    return NextResponse.json({ shopify: null, generatedAt: new Date().toISOString() });
  }

  try {
    const domain = SHOPIFY_STORE_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const endpoint = `https://${domain}/admin/api/2024-10/graphql.json`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      },
      body: JSON.stringify({ query: ORDERS_QUERY }),
    });

    if (!res.ok) {
      return NextResponse.json({ shopify: null, error: `Shopify ${res.status}`, generatedAt: new Date().toISOString() });
    }

    const json = await res.json();
    const edges = json.data?.orders?.edges || [];
    const orders = edges.map((e: { node: Record<string, unknown> }) => {
      const o = e.node;
      return {
        name: o.name,
        createdAt: o.createdAt,
        financialStatus: ((o.displayFinancialStatus as string) || "").toLowerCase().replace(/_/g, " "),
        total: (o.totalPriceSet as { shopMoney: { amount: string } })?.shopMoney?.amount || "0",
      };
    });

    const totalRevenue = orders.reduce((sum: number, o: { total: string }) => sum + parseFloat(o.total), 0);
    const totalOrders = orders.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    return NextResponse.json({
      shopify: {
        totalOrders,
        totalRevenue,
        avgOrderValue,
        recentOrders: orders.slice(0, 20),
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ shopify: null, error: String(err), generatedAt: new Date().toISOString() });
  }
}
