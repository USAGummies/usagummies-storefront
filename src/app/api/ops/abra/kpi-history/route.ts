import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type KpiRow = {
  metric_name: string;
  value: number | string;
  captured_for_date: string;
};

const DEFAULT_METRICS = [
  "daily_revenue_shopify",
  "daily_revenue_amazon",
  "daily_orders_shopify",
  "daily_orders_amazon",
  "daily_sessions",
  "daily_pageviews",
  "daily_aov",
] as const;

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials");
  }
  return { baseUrl, serviceKey };
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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
    );
  }

  return json;
}

function toNumber(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDays(value: string | null): number {
  const parsed = Number(value || 30);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(Math.max(Math.floor(parsed), 1), 365);
}

function parseMetrics(value: string | null): string[] {
  if (!value) return [...DEFAULT_METRICS];
  const requested = value
    .split(",")
    .map((item) => item.trim().replace(/[^a-zA-Z0-9_]/g, ""))
    .filter(Boolean);
  if (requested.length === 0) return [...DEFAULT_METRICS];
  return requested.slice(0, 25);
}

function dateNDaysAgo(days: number): string {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const days = parseDays(url.searchParams.get("days"));
    const metrics = parseMetrics(url.searchParams.get("metrics"));
    const start = dateNDaysAgo(days);
    const metricFilter = encodeURIComponent(`(${metrics.join(",")})`);

    const rows = (await sbFetch(
      `/rest/v1/kpi_timeseries?window_type=eq.daily&metric_name=in.${metricFilter}&captured_for_date=gte.${encodeURIComponent(start)}&select=metric_name,value,captured_for_date&order=captured_for_date.asc&limit=5000`,
    )) as KpiRow[];

    const grouped: Record<string, Array<{ date: string; value: number }>> = {};
    for (const metric of metrics) {
      grouped[metric] = [];
    }

    const metricDateSums = new Map<string, Map<string, number>>();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!metricDateSums.has(row.metric_name)) {
        metricDateSums.set(row.metric_name, new Map());
      }
      const dateMap = metricDateSums.get(row.metric_name)!;
      const current = dateMap.get(row.captured_for_date) || 0;
      dateMap.set(row.captured_for_date, current + toNumber(row.value));
    }

    for (const metric of metrics) {
      const dateMap = metricDateSums.get(metric);
      if (!dateMap) continue;
      grouped[metric] = [...dateMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, value]) => ({
          date,
          value,
        }));
    }

    const sortedDates = Array.from(
      new Set(
        (Array.isArray(rows) ? rows : [])
          .map((row) => row.captured_for_date)
          .filter((date): date is string => typeof date === "string" && !!date),
      ),
    ).sort((a, b) => a.localeCompare(b));

    return NextResponse.json({
      metrics: grouped,
      range: {
        start: sortedDates[0] || start,
        end: sortedDates[sortedDates.length - 1] || new Date().toISOString().slice(0, 10),
        days,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load KPI history" },
      { status: 500 },
    );
  }
}
