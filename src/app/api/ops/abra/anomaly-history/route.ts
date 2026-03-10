import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type KpiRow = {
  metric_name: string;
  value: number | string;
  captured_for_date: string;
};

type AnomalyRow = {
  date: string;
  metric: string;
  direction: "spike" | "drop";
  severity: "info" | "warning" | "critical";
  z_score: number;
  deviation_pct: number;
  current_value: number;
  expected_value: number;
};

const METRICS = [
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

function parseDays(value: string | null): number {
  const parsed = Number(value || 30);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(Math.max(Math.floor(parsed), 7), 365);
}

function toNumber(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[], center: number): number {
  if (values.length <= 1) return 0;
  const variance =
    values.reduce((sum, value) => {
      const delta = value - center;
      return sum + delta * delta;
    }, 0) / values.length;
  return Math.sqrt(variance);
}

function severityFor(absZ: number): AnomalyRow["severity"] | null {
  if (absZ >= 3) return "critical";
  if (absZ >= 2) return "warning";
  if (absZ >= 1.5) return "info";
  return null;
}

function round2(value: number): number {
  return Math.round((value || 0) * 100) / 100;
}

function nDaysAgo(days: number): string {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10);
}

function detectMetricAnomalies(rows: KpiRow[], days: number): AnomalyRow[] {
  const since = nDaysAgo(days);
  const historyByMetric = new Map<string, Array<{ date: string; value: number }>>();

  for (const row of rows) {
    if (!historyByMetric.has(row.metric_name)) {
      historyByMetric.set(row.metric_name, []);
    }
    historyByMetric.get(row.metric_name)!.push({
      date: row.captured_for_date,
      value: toNumber(row.value),
    });
  }

  const anomalies: AnomalyRow[] = [];
  for (const metric of METRICS) {
    const points = (historyByMetric.get(metric) || []).sort((a, b) => a.date.localeCompare(b.date));
    for (let idx = 7; idx < points.length; idx += 1) {
      const current = points[idx];
      if (current.date < since) continue;

      const baselineWindow = points.slice(idx - 7, idx).map((point) => point.value);
      const expected = mean(baselineWindow);
      const sigma = stdDev(baselineWindow, expected);
      if (!Number.isFinite(sigma) || sigma === 0) continue;

      const zScore = (current.value - expected) / sigma;
      const severity = severityFor(Math.abs(zScore));
      if (!severity) continue;

      const deviationPct =
        expected === 0 ? 0 : ((current.value - expected) / Math.abs(expected)) * 100;

      anomalies.push({
        date: current.date,
        metric,
        direction: zScore >= 0 ? "spike" : "drop",
        severity,
        z_score: round2(zScore),
        deviation_pct: round2(deviationPct),
        current_value: round2(current.value),
        expected_value: round2(expected),
      });
    }
  }

  return anomalies.sort((a, b) => {
    const dateCompare = b.date.localeCompare(a.date);
    if (dateCompare !== 0) return dateCompare;
    return Math.abs(b.z_score) - Math.abs(a.z_score);
  });
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const days = parseDays(url.searchParams.get("days"));
    const since = nDaysAgo(days + 14);
    const metricFilter = encodeURIComponent(`(${METRICS.join(",")})`);

    const rows = (await sbFetch(
      `/rest/v1/kpi_timeseries?window_type=eq.daily&metric_name=in.${metricFilter}&captured_for_date=gte.${since}&select=metric_name,value,captured_for_date&order=captured_for_date.asc&limit=5000`,
    )) as KpiRow[];

    const anomalies = detectMetricAnomalies(Array.isArray(rows) ? rows : [], days);
    return NextResponse.json({ anomalies });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load anomaly history" },
      { status: 500 },
    );
  }
}
