/**
 * GET /api/ops/channels — Per-channel revenue breakdown with Faire separation
 *
 * Fetches Shopify orders with extended fields (tags, app, sourceUrl, note),
 * then uses the channel-splitter to classify each order as DTC, Faire,
 * Distributor, or Other. Also fetches Amazon data for the combined view.
 *
 * Returns:
 *  - Per-channel breakdown (revenue, orders, AOV, top items)
 *  - Daily channel chart data for stacked visualizations
 *  - Amazon metrics alongside Shopify channels
 *  - lastFetched timestamp for staleness detection
 *
 * Protected by middleware (requires JWT session).
 */

import { NextResponse } from "next/server";
import { ptDate, isAmazonConfigured } from "@/lib/amazon/sp-api";
import { getCachedKPIs, setCachedKPIs } from "@/lib/amazon/cache";
import { buildAmazonKPIs } from "@/lib/amazon/kpi-builder";
import type { AmazonKPIs } from "@/lib/amazon/types";
import {
  CHANNEL_ORDER_FRAGMENT,
  buildChannelBreakdown,
  buildDailyChannelData,
  type ChannelBreakdown,
  type DailyChannelData,
  type ShopifyOrderNode,
} from "@/lib/ops/channel-splitter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Shopify fetcher — extended fields for channel classification
// ---------------------------------------------------------------------------

const shopifyToken = () => process.env.SHOPIFY_ADMIN_TOKEN || "";
const shopifyDomain = () =>
  process.env.SHOPIFY_STORE_DOMAIN ||
  process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
  "";

async function fetchShopifyOrders(): Promise<ShopifyOrderNode[]> {
  if (!shopifyToken() || !shopifyDomain()) return [];

  try {
    const domain = shopifyDomain()
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    const endpoint = `https://${domain}/admin/api/2024-10/graphql.json`;

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
                  ${CHANNEL_ORDER_FRAGMENT}
                }
              }
            }
          }
        `,
        variables: { query: dateFilter },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.error("[channels] Shopify returned", res.status);
      return [];
    }

    const json = await res.json();
    const edges = json.data?.orders?.edges || [];
    return edges.map(
      (e: { node: ShopifyOrderNode }) => e.node,
    );
  } catch (err) {
    console.error("[channels] Shopify fetch failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Amazon fetcher (reuses existing cache + kpi-builder)
// ---------------------------------------------------------------------------

async function fetchAmazon(): Promise<AmazonKPIs | null> {
  if (!isAmazonConfigured()) return null;

  const cached = await getCachedKPIs<AmazonKPIs>();
  if (cached) return cached;

  try {
    const kpis = await buildAmazonKPIs();
    await setCachedKPIs(kpis);
    return kpis;
  } catch (err) {
    console.error("[channels] Amazon fetch failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

type ChannelsResponse = {
  shopify: ChannelBreakdown;
  amazon: {
    revenue: number;
    orders: number;
    avgOrderValue: number;
    inventory: AmazonKPIs["inventory"] | null;
    fees: AmazonKPIs["fees"] | null;
  } | null;
  dailyByChannel: DailyChannelData[];
  combined: {
    totalRevenue: number;
    totalOrders: number;
  };
  generatedAt: string;
};

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    // Fetch both channels in parallel
    const [shopifyOrders, amazon] = await Promise.all([
      fetchShopifyOrders(),
      fetchAmazon(),
    ]);

    // Classify Shopify orders into channels
    const shopify = buildChannelBreakdown(shopifyOrders);

    // Build daily stacked chart data (Shopify only — Amazon has its own daily data)
    const dailyByChannel = buildDailyChannelData(shopifyOrders);

    // Combined totals across all channels
    const amazonRevenue = amazon?.revenue?.monthToDate ?? 0;
    const amazonOrders = amazon?.orders?.monthToDate ?? 0;

    const payload: ChannelsResponse = {
      shopify,
      amazon: amazon
        ? {
            revenue: amazonRevenue,
            orders: amazonOrders,
            avgOrderValue:
              amazonOrders > 0
                ? Math.round((amazonRevenue / amazonOrders) * 100) / 100
                : 0,
            inventory: amazon.inventory,
            fees: amazon.fees,
          }
        : null,
      dailyByChannel,
      combined: {
        totalRevenue:
          Math.round((shopify.total.revenue + amazonRevenue) * 100) / 100,
        totalOrders: shopify.total.orders + amazonOrders,
      },
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(payload);
  } catch (err) {
    console.error("[channels] Unified channel fetch failed:", err);
    return NextResponse.json(
      {
        shopify: null,
        amazon: null,
        dailyByChannel: [],
        combined: { totalRevenue: 0, totalOrders: 0 },
        error: err instanceof Error ? err.message : String(err),
        generatedAt: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
