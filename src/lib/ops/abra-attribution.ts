import { recordKPI } from "@/lib/ops/abra-kpi-recorder";

export type ChannelMetrics = {
  channel: string;
  revenue_30d: number;
  orders_30d: number;
  aov: number;
  customers_30d: number;
  repeat_rate_pct: number;
  estimated_cac: number;
  ltv_estimate: number;
  margin_pct: number;
  roas: number;
};

export type AttributionReport = {
  channels: ChannelMetrics[];
  total_revenue_30d: number;
  total_orders_30d: number;
  blended_cac: number;
  blended_aov: number;
  period: { start: string; end: string };
};

type KpiRow = {
  metric_name: string;
  value: number | string;
  captured_for_date: string;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Supabase not configured");
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
    signal: init.signal || AbortSignal.timeout(15000),
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

function daysAgoIso(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function fetchKpiMetric(metricName: string, days = 30): Promise<number> {
  const since = daysAgoIso(days);
  const rows = (await sbFetch(
    `/rest/v1/kpi_timeseries?metric_name=eq.${encodeURIComponent(metricName)}&window_type=eq.daily&captured_for_date=gte.${since}&select=value,captured_for_date&limit=5000`,
  )) as KpiRow[];
  return round2(
    (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + toNumber(row.value), 0),
  );
}

async function fetchLatestKpiMetric(metricName: string, days = 90): Promise<number | null> {
  const since = daysAgoIso(days);
  const rows = (await sbFetch(
    `/rest/v1/kpi_timeseries?metric_name=eq.${encodeURIComponent(metricName)}&captured_for_date=gte.${since}&select=value,captured_for_date&order=captured_for_date.desc&limit=1`,
  )) as KpiRow[];
  if (!Array.isArray(rows) || !rows[0]) return null;
  return toNumber(rows[0].value);
}

async function fetchFaireMetrics(): Promise<{ revenue: number; orders: number }> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const rows = (await sbFetch(
      `/rest/v1/open_brain_entries?created_at=gte.${encodeURIComponent(since)}&source_ref=ilike.*faire*&select=raw_text,summary_text&limit=500`,
    )) as Array<{ raw_text?: string; summary_text?: string }>;

    let revenue = 0;
    let orders = 0;
    for (const row of Array.isArray(rows) ? rows : []) {
      const text = `${row.raw_text || ""} ${row.summary_text || ""}`;
      const revMatch = text.match(/\$([0-9][0-9,]*(?:\.[0-9]{1,2})?)/);
      const ordMatch = text.match(/([0-9]+)\s+wholesale\s+orders?/i) || text.match(/([0-9]+)\s+orders?/i);
      if (revMatch) revenue += Number(revMatch[1].replace(/,/g, ""));
      if (ordMatch) orders += Number(ordMatch[1] || 0);
    }
    return { revenue: round2(revenue), orders: Math.round(orders) };
  } catch {
    return { revenue: 0, orders: 0 };
  }
}

async function fetchWholesaleMetrics(): Promise<{ revenue: number; orders: number }> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const rows = (await sbFetch(
      `/rest/v1/abra_deals?status=eq.closed_won&updated_at=gte.${encodeURIComponent(since)}&select=value,id`,
    )) as Array<{ value?: number | string }>;
    const revenue = (Array.isArray(rows) ? rows : []).reduce(
      (sum, row) => sum + toNumber(row.value),
      0,
    );
    return { revenue: round2(revenue), orders: Array.isArray(rows) ? rows.length : 0 };
  } catch {
    return { revenue: 0, orders: 0 };
  }
}

function computeChannelMetrics(params: {
  channel: ChannelMetrics["channel"];
  revenue: number;
  orders: number;
  customers: number;
  adSpend: number | null;
  defaultCac: number;
  marginPct: number;
}): ChannelMetrics {
  const aov = params.orders > 0 ? params.revenue / params.orders : 0;
  const customers = Math.max(0, params.customers);
  const estimatedCac =
    params.adSpend && customers > 0 ? params.adSpend / customers : params.defaultCac;
  const ltv = aov * 2.5;
  const roas = params.adSpend && params.adSpend > 0 ? params.revenue / params.adSpend : 0;

  return {
    channel: params.channel,
    revenue_30d: round2(params.revenue),
    orders_30d: Math.round(params.orders),
    aov: round2(aov),
    customers_30d: Math.round(customers),
    repeat_rate_pct: 22,
    estimated_cac: round2(estimatedCac),
    ltv_estimate: round2(ltv),
    margin_pct: round2(params.marginPct),
    roas: round2(roas),
  };
}

export async function generateAttributionReport(): Promise<AttributionReport> {
  const [
    shopifyRevenue,
    shopifyOrders,
    amazonRevenue,
    amazonOrders,
    faire,
    wholesale,
    shopifyAdSpend,
    amazonAdSpend,
  ] = await Promise.all([
    fetchKpiMetric("daily_revenue_shopify", 30),
    fetchKpiMetric("daily_orders_shopify", 30),
    fetchKpiMetric("daily_revenue_amazon", 30),
    fetchKpiMetric("daily_orders_amazon", 30),
    fetchFaireMetrics(),
    fetchWholesaleMetrics(),
    fetchLatestKpiMetric("monthly_ad_spend_shopify", 90),
    fetchLatestKpiMetric("monthly_ad_spend_amazon", 90),
  ]);

  const channels: ChannelMetrics[] = [
    computeChannelMetrics({
      channel: "shopify_dtc",
      revenue: shopifyRevenue,
      orders: shopifyOrders,
      customers: shopifyOrders,
      adSpend: shopifyAdSpend,
      defaultCac: 25,
      marginPct: 65,
    }),
    computeChannelMetrics({
      channel: "amazon_fba",
      revenue: amazonRevenue,
      orders: amazonOrders,
      customers: amazonOrders,
      adSpend: amazonAdSpend,
      defaultCac: 15,
      marginPct: 40,
    }),
    computeChannelMetrics({
      channel: "faire",
      revenue: faire.revenue,
      orders: faire.orders,
      customers: faire.orders,
      adSpend: null,
      defaultCac: 10,
      marginPct: 50,
    }),
    computeChannelMetrics({
      channel: "wholesale",
      revenue: wholesale.revenue,
      orders: wholesale.orders,
      customers: wholesale.orders,
      adSpend: null,
      defaultCac: 20,
      marginPct: 45,
    }),
  ];

  const totalRevenue = channels.reduce((sum, channel) => sum + channel.revenue_30d, 0);
  const totalOrders = channels.reduce((sum, channel) => sum + channel.orders_30d, 0);
  const totalCustomers = channels.reduce((sum, channel) => sum + channel.customers_30d, 0);
  const weightedCac =
    totalCustomers > 0
      ? channels.reduce(
          (sum, channel) => sum + channel.estimated_cac * channel.customers_30d,
          0,
        ) / totalCustomers
      : 0;

  const end = new Date().toISOString().slice(0, 10);
  const start = daysAgoIso(30);

  return {
    channels,
    total_revenue_30d: round2(totalRevenue),
    total_orders_30d: Math.round(totalOrders),
    blended_cac: round2(weightedCac),
    blended_aov: round2(totalOrders > 0 ? totalRevenue / totalOrders : 0),
    period: { start, end },
  };
}

export async function recordChannelKPIs(): Promise<void> {
  const report = await generateAttributionReport();
  const writes: Array<Promise<void>> = [];
  for (const channel of report.channels) {
    const key = channel.channel.toLowerCase();
    writes.push(
      recordKPI({
        metric_name: `channel_revenue_30d_${key}`,
        value: channel.revenue_30d,
        department: "sales_and_growth",
        source_system: "calculated",
        metric_group: "sales",
        entity_ref: key,
      }),
    );
    writes.push(
      recordKPI({
        metric_name: `channel_orders_30d_${key}`,
        value: channel.orders_30d,
        department: "sales_and_growth",
        source_system: "calculated",
        metric_group: "sales",
        entity_ref: key,
      }),
    );
    writes.push(
      recordKPI({
        metric_name: `channel_roas_${key}`,
        value: channel.roas,
        department: "sales_and_growth",
        source_system: "calculated",
        metric_group: "sales",
        entity_ref: key,
      }),
    );
  }
  await Promise.all(writes);
}
