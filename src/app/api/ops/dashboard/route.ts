/**
 * GET /api/ops/dashboard — Unified business dashboard (Shopify + Amazon)
 *
 * Aggregates data from both channels in parallel for a single frontend fetch.
 * Amazon KPIs use the shared kpi-builder (sequential fetching, rate-limit safe).
 * Protected by middleware (requires JWT session).
 */

import { NextResponse } from "next/server";
import type { AmazonKPIs, ShopifyKPIs, UnifiedDashboard } from "@/lib/amazon/types";
import { isAmazonConfigured } from "@/lib/amazon/sp-api";
import { getCachedKPIs, setCachedKPIs } from "@/lib/amazon/cache";
import { buildAmazonKPIs } from "@/lib/amazon/kpi-builder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Shopify fetcher (reuses finance route pattern)
// ---------------------------------------------------------------------------

const shopifyToken = () => process.env.SHOPIFY_ADMIN_TOKEN || "";
const shopifyDomain = () =>
  process.env.SHOPIFY_STORE_DOMAIN ||
  process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
  "";

async function fetchShopify(): Promise<ShopifyKPIs | null> {
  if (!shopifyToken() || !shopifyDomain()) return null;

  try {
    const domain = shopifyDomain().replace(/^https?:\/\//, "").replace(/\/$/, "");
    const endpoint = `https://${domain}/admin/api/2024-10/graphql.json`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": shopifyToken(),
      },
      body: JSON.stringify({
        query: `
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
        `,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return null;

    const json = await res.json();
    const edges = json.data?.orders?.edges || [];
    const orders = edges.map((e: { node: Record<string, unknown> }) => {
      const o = e.node;
      return {
        name: o.name as string,
        createdAt: o.createdAt as string,
        financialStatus: ((o.displayFinancialStatus as string) || "")
          .toLowerCase()
          .replace(/_/g, " "),
        total: (o.totalPriceSet as { shopMoney: { amount: string } })?.shopMoney
          ?.amount || "0",
      };
    });

    const totalRevenue = orders.reduce(
      (sum: number, o: { total: string }) => sum + parseFloat(o.total),
      0,
    );
    const totalOrders = orders.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    return {
      totalOrders,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      avgOrderValue: Math.round(avgOrderValue * 100) / 100,
      recentOrders: orders.slice(0, 20),
    };
  } catch (err) {
    console.error("[dashboard] Shopify fetch failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Amazon fetcher (with caching, uses shared kpi-builder)
// ---------------------------------------------------------------------------

async function fetchAmazonKPIs(): Promise<AmazonKPIs | null> {
  if (!isAmazonConfigured()) return null;

  // Check cache
  const cached = await getCachedKPIs<AmazonKPIs>();
  if (cached) return cached;

  try {
    const kpis = await buildAmazonKPIs();
    await setCachedKPIs(kpis);
    return kpis;
  } catch (err) {
    console.error("[dashboard] Amazon fetch failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    // Fetch both channels in parallel
    const [shopify, amazon] = await Promise.all([
      fetchShopify(),
      fetchAmazonKPIs(),
    ]);

    // Combined metrics
    const shopifyRevenue = shopify?.totalRevenue || 0;
    const amazonRevenue = amazon?.revenue.monthToDate || 0;
    const shopifyOrders = shopify?.totalOrders || 0;
    const amazonOrders = amazon?.orders.monthToDate || 0;
    const totalRevenue = shopifyRevenue + amazonRevenue;
    const totalOrders = shopifyOrders + amazonOrders;

    const payload: UnifiedDashboard = {
      combined: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalOrders,
        avgOrderValue: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
      },
      shopify,
      amazon,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(payload);
  } catch (err) {
    console.error("[dashboard] Unified fetch failed:", err);
    return NextResponse.json(
      {
        combined: { totalRevenue: 0, totalOrders: 0, avgOrderValue: 0 },
        shopify: null,
        amazon: null,
        error: err instanceof Error ? err.message : String(err),
        generatedAt: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
