import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type KpiRow = {
  metric_name: string;
  value: number | string;
  captured_for_date: string;
};

type PulseMetric = {
  value: number;
  vs7d: number;
};

type PulseTotals = {
  revenue: { shopify: number; amazon: number; total: number; vs7d: number };
  orders: { shopify: number; amazon: number; total: number; vs7d: number };
  sessions: PulseMetric;
  aov: PulseMetric;
  date: string;
};

const METRICS = [
  "daily_revenue_shopify",
  "daily_revenue_amazon",
  "daily_orders_shopify",
  "daily_orders_amazon",
  "daily_sessions",
  "daily_aov",
] as const;

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Missing Supabase credentials");
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(12000),
  });

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!res.ok) {
    throw new Error(
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${typeof json === "string" ? json : JSON.stringify(json)}`,
    );
  }
  return json;
}

function toNumber(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round((value || 0) * 100) / 100;
}

function buildMetricDateMap(rows: KpiRow[]): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!map.has(row.metric_name)) map.set(row.metric_name, new Map());
    const metricMap = map.get(row.metric_name)!;
    const current = metricMap.get(row.captured_for_date) || 0;
    metricMap.set(row.captured_for_date, current + toNumber(row.value));
  }
  return map;
}

function avg(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pctVsBaseline(current: number, baseline: number): number {
  if (baseline === 0) return current === 0 ? 0 : 100;
  return ((current - baseline) / Math.abs(baseline)) * 100;
}

function metricValue(metricMap: Map<string, Map<string, number>>, metric: string, date: string): number {
  return metricMap.get(metric)?.get(date) || 0;
}

function metricAvg(metricMap: Map<string, Map<string, number>>, metric: string, dates: string[]): number {
  const values = dates.map((date) => metricValue(metricMap, metric, date));
  return avg(values);
}

function buildPulse(rows: KpiRow[]): PulseTotals {
  const dateSet = new Set<string>();
  for (const row of rows) {
    if (row.captured_for_date) dateSet.add(row.captured_for_date);
  }
  const sortedDates = [...dateSet].sort((a, b) => b.localeCompare(a));
  const latestDate = sortedDates[0] || new Date().toISOString().slice(0, 10);
  const prior7Dates = sortedDates.filter((date) => date < latestDate).slice(0, 7);

  const metricMap = buildMetricDateMap(rows);
  const revenueShopify = metricValue(metricMap, "daily_revenue_shopify", latestDate);
  const revenueAmazon = metricValue(metricMap, "daily_revenue_amazon", latestDate);
  const ordersShopify = metricValue(metricMap, "daily_orders_shopify", latestDate);
  const ordersAmazon = metricValue(metricMap, "daily_orders_amazon", latestDate);
  const sessions = metricValue(metricMap, "daily_sessions", latestDate);
  const aov = metricValue(metricMap, "daily_aov", latestDate);

  const revenueBaseline =
    metricAvg(metricMap, "daily_revenue_shopify", prior7Dates) +
    metricAvg(metricMap, "daily_revenue_amazon", prior7Dates);
  const ordersBaseline =
    metricAvg(metricMap, "daily_orders_shopify", prior7Dates) +
    metricAvg(metricMap, "daily_orders_amazon", prior7Dates);
  const sessionsBaseline = metricAvg(metricMap, "daily_sessions", prior7Dates);
  const aovBaseline = metricAvg(metricMap, "daily_aov", prior7Dates);

  const revenueTotal = revenueShopify + revenueAmazon;
  const ordersTotal = ordersShopify + ordersAmazon;

  return {
    revenue: {
      shopify: round2(revenueShopify),
      amazon: round2(revenueAmazon),
      total: round2(revenueTotal),
      vs7d: round2(pctVsBaseline(revenueTotal, revenueBaseline)),
    },
    orders: {
      shopify: Math.round(ordersShopify),
      amazon: Math.round(ordersAmazon),
      total: Math.round(ordersTotal),
      vs7d: round2(pctVsBaseline(ordersTotal, ordersBaseline)),
    },
    sessions: {
      value: Math.round(sessions),
      vs7d: round2(pctVsBaseline(sessions, sessionsBaseline)),
    },
    aov: {
      value: round2(aov),
      vs7d: round2(pctVsBaseline(aov, aovBaseline)),
    },
    date: latestDate,
  };
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const since = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const metricFilter = encodeURIComponent(`(${METRICS.join(",")})`);
    const rows = (await sbFetch(
      `/rest/v1/kpi_timeseries?window_type=eq.daily&metric_name=in.${metricFilter}&captured_for_date=gte.${since}&select=metric_name,value,captured_for_date&order=captured_for_date.desc&limit=500`,
    )) as KpiRow[];

    const pulse = buildPulse(Array.isArray(rows) ? rows : []);
    return NextResponse.json(pulse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load pulse data" },
      { status: 500 },
    );
  }
}
