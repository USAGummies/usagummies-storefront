import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type KpiRow = {
  metric_name: string;
  value: number | string;
  captured_for_date: string;
};

type ChannelKey = "shopify" | "amazon" | "faire";

const CHANNEL_METRICS: Record<ChannelKey, { revenue: string[]; orders: string[] }> = {
  shopify: {
    revenue: ["daily_revenue_shopify"],
    orders: ["daily_orders_shopify"],
  },
  amazon: {
    revenue: ["daily_revenue_amazon"],
    orders: ["daily_orders_amazon"],
  },
  faire: {
    revenue: ["daily_revenue_faire", "daily_revenue_wholesale"],
    orders: ["daily_orders_faire", "daily_orders_wholesale"],
  },
};

const ALL_METRICS = Array.from(
  new Set(
    Object.values(CHANNEL_METRICS).flatMap((group) => [...group.revenue, ...group.orders]),
  ),
);

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials");
  }
  return { baseUrl, serviceKey };
}

function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  return !!secret && authHeader === `Bearer ${secret}`;
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

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

function parseDays(value: string | null): number {
  const parsed = Number(value || 30);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(Math.max(Math.floor(parsed), 1), 365);
}

function toNumber(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round((value || 0) * 100) / 100;
}

function dateNDaysAgo(days: number): string {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10);
}

function sumMetricByDate(rows: KpiRow[], metricNames: string[], dateFilter?: Set<string>): number {
  return rows.reduce((sum, row) => {
    if (!metricNames.includes(row.metric_name)) return sum;
    if (dateFilter && !dateFilter.has(row.captured_for_date)) return sum;
    return sum + toNumber(row.value);
  }, 0);
}

function buildTrend(rows: KpiRow[], metricNames: string[]): Array<{ date: string; value: number }> {
  const dateMap = new Map<string, number>();
  for (const row of rows) {
    if (!metricNames.includes(row.metric_name)) continue;
    const current = dateMap.get(row.captured_for_date) || 0;
    dateMap.set(row.captured_for_date, current + toNumber(row.value));
  }
  return [...dateMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, value: round2(value) }));
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.email && !isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const days = parseDays(url.searchParams.get("days"));
    const start = dateNDaysAgo(days);
    const metricFilter = encodeURIComponent(`(${ALL_METRICS.join(",")})`);

    const rows = (await sbFetch(
      `/rest/v1/kpi_timeseries?window_type=eq.daily&metric_name=in.${metricFilter}&captured_for_date=gte.${start}&select=metric_name,value,captured_for_date&order=captured_for_date.asc&limit=5000`,
    )) as KpiRow[];
    const safeRows = Array.isArray(rows) ? rows : [];

    const channelPayload = (["shopify", "amazon", "faire"] as ChannelKey[]).reduce(
      (acc, channel) => {
        const defs = CHANNEL_METRICS[channel];
        const revenue = sumMetricByDate(safeRows, defs.revenue);
        const orders = sumMetricByDate(safeRows, defs.orders);
        acc[channel] = {
          revenue: round2(revenue),
          orders: Math.round(orders),
          aov: orders > 0 ? round2(revenue / orders) : 0,
          trend: buildTrend(safeRows, defs.revenue),
        };
        return acc;
      },
      {} as Record<ChannelKey, { revenue: number; orders: number; aov: number; trend: Array<{ date: string; value: number }> }>,
    );

    const totalRevenue =
      channelPayload.shopify.revenue +
      channelPayload.amazon.revenue +
      channelPayload.faire.revenue;
    const totalOrders =
      channelPayload.shopify.orders +
      channelPayload.amazon.orders +
      channelPayload.faire.orders;

    return NextResponse.json({
      channels: channelPayload,
      total: {
        revenue: round2(totalRevenue),
        orders: totalOrders,
        aov: totalOrders > 0 ? round2(totalRevenue / totalOrders) : 0,
      },
      period: {
        start,
        end: new Date().toISOString().slice(0, 10),
        days,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load revenue by channel",
      },
      { status: 500 },
    );
  }
}
