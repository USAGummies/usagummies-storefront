/**
 * GET /api/ops/dashboard — Unified business dashboard (Shopify + Amazon)
 *
 * Aggregates data from both channels in parallel for a single frontend fetch.
 * Returns merged daily chart data for Recharts rendering.
 * Amazon KPIs use the shared kpi-builder (single-fetch, rate-limit safe).
 * Protected by middleware (requires JWT session).
 */

import { NextResponse } from "next/server";
import type { AmazonKPIs, ShopifyKPIs, UnifiedDashboard, DailyDataPoint } from "@/lib/amazon/types";
import { isAmazonConfigured, ptDate } from "@/lib/amazon/sp-api";
import { getCachedKPIs, setCachedKPIs } from "@/lib/amazon/cache";
import { buildAmazonKPIs } from "@/lib/amazon/kpi-builder";
import { readState, writeState } from "@/lib/ops/state";
import { createPage, DB, NotionProp, queryDatabase } from "@/lib/notion/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Shopify fetcher — date-filtered, up to 250 orders, with daily breakdown
// ---------------------------------------------------------------------------

const shopifyToken = () => process.env.SHOPIFY_ADMIN_TOKEN || "";
const shopifyDomain = () =>
  process.env.SHOPIFY_STORE_DOMAIN ||
  process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
  "";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function fetchShopify(): Promise<ShopifyKPIs | null> {
  if (!shopifyToken() || !shopifyDomain()) return null;

  try {
    const domain = shopifyDomain().replace(/^https?:\/\//, "").replace(/\/$/, "");
    const endpoint = `https://${domain}/admin/api/2024-10/graphql.json`;

    // Fetch last 30 days of orders (up to 250 — Shopify's max per page)
    const thirtyDaysAgo = ptDate(30);
    const dateFilter = `created_at:>=${thirtyDaysAgo}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": shopifyToken(),
      },
      body: JSON.stringify({
        query: `
          query($query: String!) {
            orders(first: 250, query: $query, sortKey: CREATED_AT, reverse: true) {
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
        variables: { query: dateFilter },
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

    // Build daily breakdown for charts
    const dailyMap = new Map<string, { revenue: number; orders: number }>();
    for (const order of orders) {
      const ptDay = new Date(order.createdAt).toLocaleDateString("en-CA", {
        timeZone: "America/Los_Angeles",
      });
      const existing = dailyMap.get(ptDay) || { revenue: 0, orders: 0 };
      existing.revenue += parseFloat(order.total);
      existing.orders += 1;
      dailyMap.set(ptDay, existing);
    }

    // Fill all 30 days for chart continuity
    const dailyBreakdown: DailyDataPoint[] = [];
    for (let i = 29; i >= 0; i--) {
      const dateStr = ptDate(i);
      const data = dailyMap.get(dateStr) || { revenue: 0, orders: 0 };
      const d = new Date(dateStr + "T12:00:00Z");
      dailyBreakdown.push({
        date: dateStr,
        label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        revenue: round2(data.revenue),
        orders: data.orders,
      });
    }

    return {
      totalOrders,
      totalRevenue: round2(totalRevenue),
      avgOrderValue: round2(avgOrderValue),
      recentOrders: orders.slice(0, 20),
      dailyBreakdown,
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
// Merge daily chart data from both channels
// ---------------------------------------------------------------------------

function mergeChartData(
  shopify: ShopifyKPIs | null,
  amazon: AmazonKPIs | null,
) {
  // Use 30-day date range, fill from whichever source has data
  const merged = new Map<
    string,
    {
      label: string;
      amazon: number;
      shopify: number;
      amazonOrders: number;
      shopifyOrders: number;
    }
  >();

  // Seed with all 30 days
  for (let i = 29; i >= 0; i--) {
    const dateStr = ptDate(i);
    const d = new Date(dateStr + "T12:00:00Z");
    merged.set(dateStr, {
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      amazon: 0,
      shopify: 0,
      amazonOrders: 0,
      shopifyOrders: 0,
    });
  }

  // Layer Amazon data
  if (amazon?.dailyBreakdown) {
    for (const dp of amazon.dailyBreakdown) {
      const existing = merged.get(dp.date);
      if (existing) {
        existing.amazon = dp.revenue;
        existing.amazonOrders = dp.orders;
      }
    }
  }

  // Layer Shopify data
  if (shopify?.dailyBreakdown) {
    for (const dp of shopify.dailyBreakdown) {
      const existing = merged.get(dp.date);
      if (existing) {
        existing.shopify = dp.revenue;
        existing.shopifyOrders = dp.orders;
      }
    }
  }

  // Sort by date and add combined totals
  const sorted = Array.from(merged.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      label: data.label,
      amazon: data.amazon,
      shopify: data.shopify,
      combined: round2(data.amazon + data.shopify),
      amazonOrders: data.amazonOrders,
      shopifyOrders: data.shopifyOrders,
      combinedOrders: data.amazonOrders + data.shopifyOrders,
    }));

  return sorted;
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

    // Merge daily chart data
    const chartData = mergeChartData(shopify, amazon);

    // Fire-and-forget: write KPI snapshot to Notion if new day
    maybeWriteKPISnapshot(shopify, amazon).catch(() => {});

    const payload: UnifiedDashboard = {
      combined: {
        totalRevenue: round2(totalRevenue),
        totalOrders,
        avgOrderValue: totalOrders > 0 ? round2(totalRevenue / totalOrders) : 0,
      },
      shopify,
      amazon,
      chartData,
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
        chartData: [],
        error: "Failed to load dashboard data",
        generatedAt: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Notion KPI snapshot (fire-and-forget, once per day)
// ---------------------------------------------------------------------------

async function maybeWriteKPISnapshot(
  shopify: ShopifyKPIs | null,
  amazon: AmazonKPIs | null,
) {
  try {
    const today = ptDate(0); // "YYYY-MM-DD" in PT

    // Fast check: already wrote today?
    const lastSnapshot = await readState<string>("notion-kpi-snapshot", "");
    if (lastSnapshot === today) return;

    // Belt-and-suspenders: check Notion for existing row
    const existing = await queryDatabase(DB.DAILY_PERFORMANCE, {
      property: "Date",
      date: { equals: today },
    });
    if (existing && existing.length > 0) {
      await writeState("notion-kpi-snapshot", today);
      return;
    }

    // Build daily snapshot values
    const shopifyTodayRow = shopify?.dailyBreakdown?.find(
      (d) => d.date === today,
    );
    const shopifyTodayRevenue = shopifyTodayRow?.revenue || 0;
    const shopifyTodayOrders = shopifyTodayRow?.orders || 0;
    const amazonTodayRevenue = amazon?.revenue.today || 0;
    const amazonTodayOrders = amazon?.orders.today || 0;
    const totalRevenue = shopifyTodayRevenue + amazonTodayRevenue;
    const totalOrders = shopifyTodayOrders + amazonTodayOrders;
    const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    await createPage(DB.DAILY_PERFORMANCE, {
      Name: NotionProp.title(today),
      Date: NotionProp.date(today),
      "Shopify Revenue": NotionProp.number(round2(shopifyTodayRevenue)),
      "Amazon Revenue": NotionProp.number(round2(amazonTodayRevenue)),
      "Total Revenue": NotionProp.number(round2(totalRevenue)),
      "Shopify Orders": NotionProp.number(shopifyTodayOrders),
      "Amazon Orders": NotionProp.number(amazonTodayOrders),
      "Total Orders": NotionProp.number(totalOrders),
      AOV: NotionProp.number(round2(aov)),
      "Amazon Units Sold": NotionProp.number(amazon?.unitsSold.today || 0),
      "FBA Fulfillable Units": NotionProp.number(
        amazon?.inventory.fulfillable || 0,
      ),
    });

    await writeState("notion-kpi-snapshot", today);
    console.log(`[dashboard] Wrote KPI snapshot to Notion for ${today}`);
  } catch (err) {
    console.error("[dashboard] KPI snapshot write failed:", err);
  }
}
