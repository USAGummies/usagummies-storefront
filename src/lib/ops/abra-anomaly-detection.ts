export type Anomaly = {
  metric: string;
  department: string;
  current_value: number;
  expected_value: number;
  deviation_pct: number;
  z_score: number;
  direction: "spike" | "drop";
  severity: "info" | "warning" | "critical";
  context: string;
};

type MetricRow = {
  metric_name: string;
  value: number | string;
  captured_for_date: string;
  department: string | null;
};

const METRICS: Array<{ name: string; department: string }> = [
  { name: "daily_revenue_shopify", department: "sales_and_growth" },
  { name: "daily_revenue_amazon", department: "sales_and_growth" },
  { name: "daily_sessions", department: "sales_and_growth" },
  { name: "daily_orders_shopify", department: "sales_and_growth" },
  { name: "daily_orders_amazon", department: "sales_and_growth" },
  { name: "daily_pageviews", department: "sales_and_growth" },
  { name: "daily_aov", department: "sales_and_growth" },
  { name: "conversion_rate", department: "sales_and_growth" },
];

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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
    );
  }
  return json;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[], center: number): number {
  if (values.length <= 1) return 0;
  const variance = values.reduce((sum, value) => {
    const delta = value - center;
    return sum + delta * delta;
  }, 0) / values.length;
  return Math.sqrt(variance);
}

function computeSeverity(absZ: number): Anomaly["severity"] | null {
  if (absZ > 3) return "critical";
  if (absZ > 2) return "warning";
  if (absZ > 1.5) return "info";
  return null;
}

function buildContext(metric: string, current: number, expected: number): string {
  const deltaPct =
    expected === 0 ? 0 : ((current - expected) / Math.abs(expected)) * 100;
  const direction = deltaPct >= 0 ? "increased" : "dropped";
  return `${metric} ${direction} ${Math.abs(deltaPct).toFixed(1)}% vs 7-day average (${current.toFixed(2)} vs ${expected.toFixed(2)})`;
}

async function fetchMetricSeries(metricName: string): Promise<MetricRow[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const rows = (await sbFetch(
    `/rest/v1/kpi_timeseries?metric_name=eq.${encodeURIComponent(metricName)}&window_type=eq.daily&captured_for_date=gte.${since}&select=metric_name,value,captured_for_date,department&order=captured_for_date.desc&limit=60`,
  )) as MetricRow[];

  return Array.isArray(rows) ? rows : [];
}

export async function checkMetricAnomaly(
  metricName: string,
  currentValue: number,
  department: string,
): Promise<Anomaly | null> {
  const rows = await fetchMetricSeries(metricName);
  const history = rows
    .map((row) => Number(row.value || 0))
    .filter((value) => Number.isFinite(value))
    .slice(1, 8);

  if (history.length < 3) return null;

  const expected = mean(history);
  const sigma = stdDev(history, expected);
  if (sigma === 0) return null;

  const zScore = (currentValue - expected) / sigma;
  const severity = computeSeverity(Math.abs(zScore));
  if (!severity) return null;

  const deviationPct =
    expected === 0 ? 0 : ((currentValue - expected) / Math.abs(expected)) * 100;

  return {
    metric: metricName,
    department,
    current_value: currentValue,
    expected_value: expected,
    deviation_pct: deviationPct,
    z_score: zScore,
    direction: zScore >= 0 ? "spike" : "drop",
    severity,
    context: buildContext(metricName, currentValue, expected),
  };
}

export async function detectAnomalies(): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = [];

  for (const metric of METRICS) {
    try {
      const rows = await fetchMetricSeries(metric.name);
      const latest = rows[0];
      if (!latest) continue;
      const currentValue = Number(latest.value || 0);
      if (!Number.isFinite(currentValue)) continue;

      const anomaly = await checkMetricAnomaly(
        metric.name,
        currentValue,
        latest.department || metric.department,
      );
      if (anomaly) anomalies.push(anomaly);
    } catch {
      // best-effort, skip failed metric
    }
  }

  return anomalies.sort(
    (a, b) => Math.abs(b.z_score) - Math.abs(a.z_score),
  );
}
