/**
 * GET /api/ops/channels — Per-channel revenue breakdown with Faire separation
 *
 * Fetches Shopify orders with extended fields (tags, app, sourceUrl, note),
 * then uses the channel-splitter to classify each order as DTC, Faire,
 * Distributor, or Other. Also fetches Amazon data for the combined view.
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
  classifyOrder,
  type ChannelBreakdown,
  type ChannelName,
  type ShopifyOrderNode,
} from "@/lib/ops/channel-splitter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const shopifyToken = () => process.env.SHOPIFY_ADMIN_TOKEN || "";
const shopifyDomain = () =>
  process.env.SHOPIFY_STORE_DOMAIN ||
  process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
  "";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

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

    // Check for GraphQL-level errors (HTTP 200 but query failed)
    if (json.errors) {
      console.error("[channels] Shopify GraphQL errors:", JSON.stringify(json.errors));
      // Fall back to simpler query without extended fields
      return fetchShopifyOrdersSimple(endpoint, dateFilter);
    }

    const edges = json.data?.orders?.edges || [];
    if (edges.length === 0 && !json.data?.orders) {
      console.warn("[channels] Shopify returned null orders data — falling back to simple query");
      return fetchShopifyOrdersSimple(endpoint, dateFilter);
    }
    return edges.map((e: { node: ShopifyOrderNode }) => e.node);
  } catch (err) {
    console.error("[channels] Shopify fetch failed:", err);
    return [];
  }
}

/**
 * Fallback: fetch orders with only basic fields (same as dashboard API).
 * All orders are classified as DTC since we can't distinguish channels
 * without tags/app fields.
 */
async function fetchShopifyOrdersSimple(
  endpoint: string,
  dateFilter: string,
): Promise<ShopifyOrderNode[]> {
  try {
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

    if (!res.ok) {
      console.error("[channels] Shopify simple fallback returned", res.status);
      return [];
    }

    const json = await res.json();
    if (json.errors) {
      console.error("[channels] Shopify simple fallback GraphQL errors:", JSON.stringify(json.errors));
      return [];
    }

    const edges = json.data?.orders?.edges || [];
    console.log(`[channels] Simple fallback returned ${edges.length} orders (all classified as DTC)`);
    return edges.map((e: { node: Record<string, unknown> }) => ({
      name: (e.node.name as string) || "",
      createdAt: (e.node.createdAt as string) || "",
      displayFinancialStatus: (e.node.displayFinancialStatus as string) || "",
      totalPriceSet: e.node.totalPriceSet as { shopMoney: { amount: string } },
      tags: [],
      note: null,
      app: null,
      customer: null,
    }));
  } catch (err) {
    console.error("[channels] Shopify simple fallback failed:", err);
    return [];
  }
}

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

type ChannelFeeMetric = {
  revenue: number;
  fees: number;
  netRevenue: number;
  marginPct: number;
  orderCount: number;
};

type ChannelMetrics = {
  dtc: ChannelFeeMetric;
  faire: ChannelFeeMetric;
  distributor: ChannelFeeMetric;
  other: ChannelFeeMetric;
  amazon: ChannelFeeMetric | null;
  all: ChannelFeeMetric;
};

type DailyChannelResponse = {
  date: string;
  label: string;
  dtcRevenue: number;
  faireRevenue: number;
  distributorRevenue: number;
  otherRevenue: number;
  totalRevenue: number;
};

type ChannelsResponse = {
  shopify: ChannelBreakdown;
  amazon: {
    revenue: number;
    orders: number;
    avgOrderValue: number;
    inventory: AmazonKPIs["inventory"] | null;
    fees: AmazonKPIs["fees"] | null;
  } | null;
  dailyByChannel: DailyChannelResponse[];
  channelMetrics: ChannelMetrics;
  combined: {
    totalRevenue: number;
    totalOrders: number;
  };
  generatedAt: string;
};

function shopifyFeeForOrder(channel: ChannelName, total: number, customerOrders: number): number {
  if (channel === "faire") {
    const commissionRate = customerOrders > 1 ? 0.15 : 0.25;
    return total * commissionRate;
  }
  if (channel === "dtc" || channel === "distributor" || channel === "other") {
    return total * 0.029 + 0.3;
  }
  return 0;
}

function normalizeMarginPct(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  if (value > 1) return value / 100;
  return value;
}

function buildChannelMetrics(
  shopifyOrders: ShopifyOrderNode[],
  amazon: AmazonKPIs | null,
): ChannelMetrics {
  const interim: Record<ChannelName, { revenue: number; fees: number; orderCount: number }> = {
    dtc: { revenue: 0, fees: 0, orderCount: 0 },
    faire: { revenue: 0, fees: 0, orderCount: 0 },
    distributor: { revenue: 0, fees: 0, orderCount: 0 },
    other: { revenue: 0, fees: 0, orderCount: 0 },
  };

  for (const order of shopifyOrders) {
    const channel = classifyOrder(order);
    const total = parseFloat(order.totalPriceSet?.shopMoney?.amount || "0");
    const customerOrders = order.customer?.numberOfOrders || 0;
    const fees = shopifyFeeForOrder(channel, total, customerOrders);
    interim[channel].revenue += total;
    interim[channel].fees += fees;
    interim[channel].orderCount += 1;
  }

  const finalize = (row: { revenue: number; fees: number; orderCount: number }): ChannelFeeMetric => {
    const revenue = round2(row.revenue);
    const fees = round2(row.fees);
    const netRevenue = round2(revenue - fees);
    const marginPct = revenue > 0 ? round2(netRevenue / revenue) : 0;
    return { revenue, fees, netRevenue, marginPct, orderCount: row.orderCount };
  };

  const shopifyDtc = finalize(interim.dtc);
  const shopifyFaire = finalize(interim.faire);
  const shopifyDistributor = finalize(interim.distributor);
  const shopifyOther = finalize(interim.other);

  let amazonMetric: ChannelFeeMetric | null = null;
  if (amazon) {
    const revenue = round2(amazon.revenue.monthToDate || 0);
    const orderCount = amazon.orders.monthToDate || 0;
    const estimatedFeePerOrder = amazon.fees?.totalFee || 0;
    let fees = round2(estimatedFeePerOrder * orderCount);
    let netRevenue = round2(revenue - fees);
    let marginPct = revenue > 0 ? round2(netRevenue / revenue) : 0;

    const normalizedEstimatedMargin = normalizeMarginPct(
      amazon.fees?.estimatedNetMargin,
    );
    if (normalizedEstimatedMargin > 0) {
      marginPct = round2(normalizedEstimatedMargin);
      if (fees <= 0 && revenue > 0) {
        netRevenue = round2(revenue * marginPct);
        fees = round2(revenue - netRevenue);
      }
    }

    amazonMetric = {
      revenue,
      fees,
      netRevenue,
      marginPct,
      orderCount,
    };
  }

  const totalRevenue =
    shopifyDtc.revenue +
    shopifyFaire.revenue +
    shopifyDistributor.revenue +
    shopifyOther.revenue +
    (amazonMetric?.revenue || 0);
  const totalFees =
    shopifyDtc.fees +
    shopifyFaire.fees +
    shopifyDistributor.fees +
    shopifyOther.fees +
    (amazonMetric?.fees || 0);
  const totalOrders =
    shopifyDtc.orderCount +
    shopifyFaire.orderCount +
    shopifyDistributor.orderCount +
    shopifyOther.orderCount +
    (amazonMetric?.orderCount || 0);

  const all: ChannelFeeMetric = {
    revenue: round2(totalRevenue),
    fees: round2(totalFees),
    netRevenue: round2(totalRevenue - totalFees),
    marginPct: totalRevenue > 0 ? round2((totalRevenue - totalFees) / totalRevenue) : 0,
    orderCount: totalOrders,
  };

  return {
    dtc: shopifyDtc,
    faire: shopifyFaire,
    distributor: shopifyDistributor,
    other: shopifyOther,
    amazon: amazonMetric,
    all,
  };
}

export async function GET() {
  try {
    const [shopifyOrders, amazon] = await Promise.all([
      fetchShopifyOrders(),
      fetchAmazon(),
    ]);

    const shopify = buildChannelBreakdown(shopifyOrders);
    const dailyByChannel = buildDailyChannelData(shopifyOrders).map((row) => ({
      date: row.date,
      label: row.label,
      dtcRevenue: row.dtc,
      faireRevenue: row.faire,
      distributorRevenue: row.distributor,
      otherRevenue: row.other,
      totalRevenue: row.combined,
    }));
    const channelMetrics = buildChannelMetrics(shopifyOrders, amazon);

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
      channelMetrics,
      combined: {
        totalRevenue: round2(shopify.total.revenue + amazonRevenue),
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
        channelMetrics: null,
        combined: { totalRevenue: 0, totalOrders: 0 },
        error: "Failed to load channel data",
        generatedAt: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
