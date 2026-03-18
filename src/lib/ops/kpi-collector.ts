/**
 * KPI Daily Metric Collector — gathers metrics from all data sources
 * and records them into the Supabase `kpi_timeseries` table via the
 * existing `recordKPI` helper.
 *
 * Called nightly by the R13 agent (Daily KPI Collector) at 22:00.
 */

import { recordKPI } from "@/lib/ops/abra-kpi-recorder";
import { adminRequest } from "@/lib/shopify/admin";
import {
  isAmazonConfigured,
  fetchAmazonOrderStats,
} from "@/lib/amazon/sp-api";
import { getRecentErrors } from "@/lib/ops/error-tracker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CollectedMetric = {
  key: string;
  value: number;
};

export type CollectionResult = {
  metrics: CollectedMetric[];
  errors: string[];
};

// ---------------------------------------------------------------------------
// Supabase helpers (raw fetch for counts — avoids importing full SDK)
// ---------------------------------------------------------------------------

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const env = getSupabaseEnv();
  if (!env) return null;

  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");

  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(12_000),
  });

  if (!res.ok) return null;
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Individual metric collectors
// ---------------------------------------------------------------------------

async function fetchShopifyTodayRevenue(): Promise<{
  revenue: number;
  orderCount: number;
  error: string | null;
}> {
  const today = new Date().toISOString().split("T")[0];

  const query = /* GraphQL */ `
    query TodayOrders($query: String!) {
      orders(first: 250, query: $query) {
        edges {
          node {
            id
            totalPriceSet {
              shopMoney {
                amount
              }
            }
          }
        }
      }
    }
  `;

  const result = await adminRequest<{
    orders: {
      edges: Array<{
        node: {
          id: string;
          totalPriceSet: { shopMoney: { amount: string } };
        };
      }>;
    };
  }>(query, {
    query: `created_at:>='${today}T00:00:00Z' AND created_at:<='${today}T23:59:59Z'`,
  });

  if (!result.ok || !result.data) {
    return {
      revenue: 0,
      orderCount: 0,
      error: result.error || "Shopify query failed",
    };
  }

  const edges = result.data.orders?.edges || [];
  const revenue = edges.reduce(
    (sum, edge) =>
      sum + parseFloat(edge.node.totalPriceSet?.shopMoney?.amount || "0"),
    0,
  );

  return {
    revenue: Math.round(revenue * 100) / 100,
    orderCount: edges.length,
    error: null,
  };
}

async function fetchAmazonTodayRevenue(): Promise<{
  revenue: number;
  orderCount: number;
  error: string | null;
}> {
  if (!isAmazonConfigured()) {
    return { revenue: 0, orderCount: 0, error: null };
  }

  try {
    const stats = await fetchAmazonOrderStats(1);
    return {
      revenue: stats.totalRevenue,
      orderCount: stats.totalOrders,
      error: null,
    };
  } catch (err) {
    return {
      revenue: 0,
      orderCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchPendingApprovalsCount(): Promise<number> {
  const rows = await sbFetch<Array<{ id: string }>>(
    "/rest/v1/approvals?status=eq.pending&select=id&limit=200",
  );
  return Array.isArray(rows) ? rows.length : 0;
}

async function fetchActivePipelineDeals(): Promise<number> {
  const notionKey = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
  const b2bDb = process.env.NOTION_B2B_PROSPECTS_DB;
  if (!notionKey || !b2bDb) return 0;

  try {
    const res = await fetch(
      `https://api.notion.com/v1/databases/${b2bDb.replace(/-/g, "")}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${notionKey}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          page_size: 100,
          filter: {
            or: [
              { property: "Status", select: { equals: "Contacted" } },
              { property: "Status", select: { equals: "Negotiating" } },
              { property: "Status", select: { equals: "Proposal Sent" } },
              { property: "Status", select: { equals: "Follow Up" } },
              { property: "Status", select: { equals: "Meeting Scheduled" } },
            ],
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) return 0;
    const data = (await res.json()) as { results?: unknown[] };
    return Array.isArray(data.results) ? data.results.length : 0;
  } catch {
    return 0;
  }
}

async function fetchErrorCount(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const errors = await getRecentErrors(100);
    return errors.filter((e) => e.last_seen_at >= cutoff).length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Collect all daily KPIs from Shopify, Amazon, Supabase, Notion, and
 * the error tracker. Returns the collected metrics and any errors that
 * occurred during collection (non-fatal — partial results are fine).
 */
export async function collectDailyKPIs(): Promise<CollectionResult> {
  const metrics: CollectedMetric[] = [];
  const errors: string[] = [];

  // Gather all data in parallel
  const [shopify, amazon, approvals, pipelineDeals, errorCount] =
    await Promise.all([
      fetchShopifyTodayRevenue().catch((err) => {
        errors.push(`Shopify: ${err instanceof Error ? err.message : String(err)}`);
        return { revenue: 0, orderCount: 0, error: "fetch failed" };
      }),
      fetchAmazonTodayRevenue().catch((err) => {
        errors.push(`Amazon: ${err instanceof Error ? err.message : String(err)}`);
        return { revenue: 0, orderCount: 0, error: "fetch failed" };
      }),
      fetchPendingApprovalsCount().catch((err) => {
        errors.push(`Approvals: ${err instanceof Error ? err.message : String(err)}`);
        return 0;
      }),
      fetchActivePipelineDeals().catch((err) => {
        errors.push(`Pipeline: ${err instanceof Error ? err.message : String(err)}`);
        return 0;
      }),
      fetchErrorCount().catch((err) => {
        errors.push(`Errors: ${err instanceof Error ? err.message : String(err)}`);
        return 0;
      }),
    ]);

  if (shopify.error) {
    errors.push(`Shopify: ${shopify.error}`);
  }
  if (amazon.error) {
    errors.push(`Amazon: ${amazon.error}`);
  }

  // Build metrics list — using metric names that match the kpi-history API's
  // DEFAULT_METRICS so the forecast page can read them
  metrics.push(
    { key: "daily_revenue_shopify", value: shopify.revenue },
    { key: "daily_revenue_amazon", value: amazon.revenue },
    { key: "daily_revenue_total", value: shopify.revenue + amazon.revenue },
    { key: "daily_orders_shopify", value: shopify.orderCount },
    { key: "daily_orders_amazon", value: amazon.orderCount },
    { key: "daily_orders_total", value: shopify.orderCount + amazon.orderCount },
    { key: "pending_approvals", value: approvals },
    { key: "active_pipeline_deals", value: pipelineDeals },
    { key: "error_count", value: errorCount },
  );

  return { metrics, errors };
}

/**
 * Record collected metrics into the Supabase `kpi_timeseries` table.
 * Uses the existing `recordKPI` function which handles upsert logic
 * (delete + insert for the same metric+date).
 *
 * @returns Number of metrics successfully recorded.
 */
export async function recordKPIs(
  metrics: CollectedMetric[],
): Promise<number> {
  let recorded = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const m of metrics) {
    try {
      await recordKPI({
        metric_name: m.key,
        value: m.value,
        date: today,
        source_system: inferSourceFromKey(m.key),
        metric_group: inferGroupFromKey(m.key),
      });
      recorded++;
    } catch {
      // Non-fatal — continue with remaining metrics
    }
  }

  return recorded;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferSourceFromKey(
  key: string,
): "amazon" | "shopify" | "calculated" {
  if (key.includes("amazon")) return "amazon";
  if (key.includes("shopify")) return "shopify";
  return "calculated";
}

function inferGroupFromKey(
  key: string,
): "sales" | "operations" {
  if (
    key.includes("revenue") ||
    key.includes("orders") ||
    key.includes("pipeline")
  ) {
    return "sales";
  }
  return "operations";
}
