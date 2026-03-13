export type RevenueSnapshot = {
  period: string;
  shopify_revenue: number;
  amazon_revenue: number;
  total_revenue: number;
  order_count: number;
  avg_order_value: number;
  vs_prior_period_pct: number;
};

export type MarginAnalysis = {
  estimated_cogs_per_unit: number;
  estimated_gross_margin_pct: number;
  revenue: number;
  estimated_cogs: number;
  estimated_gross_profit: number;
};

type KPIValueRow = {
  metric_name: string;
  value: number | string;
  captured_for_date: string;
};

type ProductConfigRow = {
  config_key: string;
  config_value: string;
};

const REVENUE_METRICS = ["daily_revenue_shopify", "daily_revenue_amazon"] as const;
const ORDER_METRICS = ["daily_orders_shopify", "daily_orders_amazon"] as const;

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase not configured");

  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${env.baseUrl}${path}`, {
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
  return Math.round((Number(value) || 0) * 100) / 100;
}

function windowSize(period: "day" | "week" | "month"): number {
  if (period === "day") return 1;
  if (period === "week") return 7;
  return 30;
}

async function fetchKpiRows(days: number): Promise<KPIValueRow[]> {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - Math.max(days, 7));
  const since = start.toISOString().slice(0, 10);
  const metrics = [...REVENUE_METRICS, ...ORDER_METRICS];
  const metricFilter = encodeURIComponent(`(${metrics.join(",")})`);
  const rows = (await sbFetch(
    `/rest/v1/kpi_timeseries?window_type=eq.daily&metric_name=in.${metricFilter}&captured_for_date=gte.${since}&select=metric_name,value,captured_for_date&order=captured_for_date.desc&limit=500`,
  )) as KPIValueRow[];
  return Array.isArray(rows) ? rows : [];
}

function sumMetric(rows: KPIValueRow[], metricName: string, dates: Set<string>): number {
  return rows.reduce((sum, row) => {
    if (row.metric_name !== metricName) return sum;
    if (!dates.has(row.captured_for_date)) return sum;
    return sum + toNumber(row.value);
  }, 0);
}

function listUniqueDates(rows: KPIValueRow[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    if (typeof row.captured_for_date === "string" && row.captured_for_date) {
      set.add(row.captured_for_date);
    }
  }
  return [...set].sort((a, b) => b.localeCompare(a));
}

function formatPeriodLabel(dates: string[]): string {
  if (!dates.length) return "no-data";
  const sorted = [...dates].sort((a, b) => a.localeCompare(b));
  if (sorted.length === 1) return sorted[0];
  return `${sorted[0]} to ${sorted[sorted.length - 1]}`;
}

export async function getRevenueSnapshot(period: "day" | "week" | "month"): Promise<RevenueSnapshot> {
  const size = windowSize(period);
  const rows = await fetchKpiRows(size * 2 + 5);
  const uniqueDates = listUniqueDates(rows);
  const currentDates = uniqueDates.slice(0, size);
  const priorDates = uniqueDates.slice(size, size * 2);
  const currentSet = new Set(currentDates);
  const priorSet = new Set(priorDates);

  const shopifyRevenue = sumMetric(rows, "daily_revenue_shopify", currentSet);
  const amazonRevenue = sumMetric(rows, "daily_revenue_amazon", currentSet);
  const totalRevenue = shopifyRevenue + amazonRevenue;
  const orderCount =
    sumMetric(rows, "daily_orders_shopify", currentSet) +
    sumMetric(rows, "daily_orders_amazon", currentSet);
  const avgOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;

  const priorRevenue =
    sumMetric(rows, "daily_revenue_shopify", priorSet) +
    sumMetric(rows, "daily_revenue_amazon", priorSet);
  const vsPriorPeriodPct =
    priorRevenue > 0 ? ((totalRevenue - priorRevenue) / Math.abs(priorRevenue)) * 100 : 0;

  return {
    period: formatPeriodLabel(currentDates),
    shopify_revenue: round2(shopifyRevenue),
    amazon_revenue: round2(amazonRevenue),
    total_revenue: round2(totalRevenue),
    order_count: Math.round(orderCount),
    avg_order_value: round2(avgOrderValue),
    vs_prior_period_pct: round2(vsPriorPeriodPct),
  };
}

async function fetchCogsConfig(): Promise<{
  cogsPerUnit: number;
  packagingPerUnit: number;
  freightPerUnit: number;
}> {
  const keys = encodeURIComponent(
    "(current_cogs_per_unit,default_packaging_cost_per_unit,default_freight_cost_per_unit)",
  );
  const rows = (await sbFetch(
    `/rest/v1/product_config?config_key=in.${keys}&select=config_key,config_value`,
  )) as ProductConfigRow[];

  const map = new Map<string, number>();
  for (const row of Array.isArray(rows) ? rows : []) {
    map.set(row.config_key, toNumber(row.config_value));
  }

  return {
    cogsPerUnit: map.get("current_cogs_per_unit") || 0,
    packagingPerUnit: map.get("default_packaging_cost_per_unit") || 0,
    freightPerUnit: map.get("default_freight_cost_per_unit") || 0,
  };
}

export async function getMarginAnalysis(): Promise<MarginAnalysis> {
  const [snapshot, cogsConfig] = await Promise.all([
    getRevenueSnapshot("month"),
    fetchCogsConfig(),
  ]);

  const estimatedCogsPerUnit =
    cogsConfig.cogsPerUnit + cogsConfig.packagingPerUnit + cogsConfig.freightPerUnit;
  const estimatedCogs = estimatedCogsPerUnit * snapshot.order_count;
  const estimatedGrossProfit = snapshot.total_revenue - estimatedCogs;
  const estimatedGrossMarginPct =
    snapshot.total_revenue > 0
      ? (estimatedGrossProfit / snapshot.total_revenue) * 100
      : 0;

  return {
    estimated_cogs_per_unit: round2(estimatedCogsPerUnit),
    estimated_gross_margin_pct: round2(estimatedGrossMarginPct),
    revenue: round2(snapshot.total_revenue),
    estimated_cogs: round2(estimatedCogs),
    estimated_gross_profit: round2(estimatedGrossProfit),
  };
}

/**
 * Calendar-month revenue snapshot. Unlike getRevenueSnapshot("month") which
 * uses a rolling 30-day window, this returns exact calendar-month figures
 * (e.g. March 1–today for the current month).
 */
export async function getCalendarMonthRevenue(): Promise<{
  month: string;
  shopify_revenue: number;
  amazon_revenue: number;
  total_revenue: number;
  shopify_orders: number;
  amazon_orders: number;
  total_orders: number;
  avg_order_value: number;
  days_with_data: number;
}> {
  const now = new Date();
  const monthStr = now.toISOString().slice(0, 7); // e.g. "2026-03"
  const firstOfMonth = `${monthStr}-01`;
  const metrics = [...REVENUE_METRICS, ...ORDER_METRICS];
  const metricFilter = encodeURIComponent(`(${metrics.join(",")})`);

  const rows = (await sbFetch(
    `/rest/v1/kpi_timeseries?window_type=eq.daily&metric_name=in.${metricFilter}&captured_for_date=gte.${firstOfMonth}&select=metric_name,value,captured_for_date&order=captured_for_date.desc&limit=500`,
  )) as KPIValueRow[];

  const safeRows = Array.isArray(rows) ? rows : [];
  const allDates = new Set(safeRows.map((r) => r.captured_for_date));

  const shopifyRevenue = safeRows
    .filter((r) => r.metric_name === "daily_revenue_shopify")
    .reduce((s, r) => s + toNumber(r.value), 0);
  const amazonRevenue = safeRows
    .filter((r) => r.metric_name === "daily_revenue_amazon")
    .reduce((s, r) => s + toNumber(r.value), 0);
  const shopifyOrders = safeRows
    .filter((r) => r.metric_name === "daily_orders_shopify")
    .reduce((s, r) => s + toNumber(r.value), 0);
  const amazonOrders = safeRows
    .filter((r) => r.metric_name === "daily_orders_amazon")
    .reduce((s, r) => s + toNumber(r.value), 0);

  const totalRevenue = shopifyRevenue + amazonRevenue;
  const totalOrders = shopifyOrders + amazonOrders;

  return {
    month: monthStr,
    shopify_revenue: round2(shopifyRevenue),
    amazon_revenue: round2(amazonRevenue),
    total_revenue: round2(totalRevenue),
    shopify_orders: Math.round(shopifyOrders),
    amazon_orders: Math.round(amazonOrders),
    total_orders: Math.round(totalOrders),
    avg_order_value: totalOrders > 0 ? round2(totalRevenue / totalOrders) : 0,
    days_with_data: allDates.size,
  };
}

export async function getRevenueTimeline(
  days: number,
): Promise<Array<{ date: string; revenue: number; channel: string }>> {
  const lookback = Math.min(Math.max(Math.floor(days || 30), 1), 365);
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - lookback);
  const since = start.toISOString().slice(0, 10);
  const metrics = encodeURIComponent(`(${REVENUE_METRICS.join(",")})`);

  const rows = (await sbFetch(
    `/rest/v1/kpi_timeseries?window_type=eq.daily&metric_name=in.${metrics}&captured_for_date=gte.${since}&select=metric_name,value,captured_for_date&order=captured_for_date.asc&limit=1000`,
  )) as KPIValueRow[];

  const timeline: Array<{ date: string; revenue: number; channel: string }> = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const channel =
      row.metric_name === "daily_revenue_shopify"
        ? "shopify"
        : row.metric_name === "daily_revenue_amazon"
          ? "amazon"
          : "unknown";
    timeline.push({
      date: row.captured_for_date,
      revenue: round2(toNumber(row.value)),
      channel,
    });
  }

  return timeline;
}
