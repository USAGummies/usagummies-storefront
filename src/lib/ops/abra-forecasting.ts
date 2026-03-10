type KpiRow = {
  captured_for_date: string;
  value: number | string;
};

export type ForecastPoint = {
  date: string;
  predicted: number;
  lower_bound: number;
  upper_bound: number;
  channel: string;
};

export type ForecastResult = {
  channel: string;
  points: ForecastPoint[];
  trend: "growing" | "flat" | "declining";
  growth_rate_pct: number;
  confidence: "high" | "medium" | "low";
  data_points_used: number;
};

type SeriesPoint = {
  date: string;
  value: number;
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

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function dateDaysAgo(daysBack: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - Math.max(daysBack, 1) + 1);
  return toIsoDate(d);
}

function denseSeries(rows: SeriesPoint[], daysBack: number): SeriesPoint[] {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    byDate.set(row.date, (byDate.get(row.date) || 0) + row.value);
  }
  const start = dateDaysAgo(daysBack);
  const out: SeriesPoint[] = [];
  for (let i = 0; i < daysBack; i += 1) {
    const date = addDays(start, i);
    out.push({ date, value: byDate.get(date) || 0 });
  }
  return out;
}

function movingAverage(values: number[], window = 7): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    const avg = slice.reduce((sum, v) => sum + v, 0) / (slice.length || 1);
    out.push(avg);
  }
  return out;
}

function linearRegression(values: number[]): { slope: number; intercept: number } {
  if (values.length < 2) {
    return { slope: 0, intercept: values[0] || 0 };
  }

  const n = values.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }

  const denom = n * sumXX - sumX * sumX;
  if (!denom) {
    return { slope: 0, intercept: sumY / n };
  }

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function weekdayIndex(dateIso: string): number {
  const d = new Date(`${dateIso}T00:00:00Z`);
  return d.getUTCDay();
}

function rmse(actual: number[], predicted: number[]): number {
  if (actual.length === 0 || predicted.length === 0) return 0;
  const n = Math.min(actual.length, predicted.length);
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const err = actual[i] - predicted[i];
    sum += err * err;
  }
  return Math.sqrt(sum / n);
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function classifyTrend(growthRatePct: number): "growing" | "flat" | "declining" {
  if (growthRatePct > 10) return "growing";
  if (growthRatePct < -5) return "declining";
  return "flat";
}

function classifyConfidence(points: number): "high" | "medium" | "low" {
  if (points > 60) return "high";
  if (points > 30) return "medium";
  return "low";
}

async function fetchMetricSeries(metricName: string, daysBack: number): Promise<SeriesPoint[]> {
  const since = dateDaysAgo(daysBack);
  const rows = (await sbFetch(
    `/rest/v1/kpi_timeseries?window_type=eq.daily&metric_name=eq.${encodeURIComponent(metricName)}&captured_for_date=gte.${since}&select=captured_for_date,value&order=captured_for_date.asc&limit=5000`,
  )) as KpiRow[];

  const merged = new Map<string, number>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.captured_for_date) continue;
    merged.set(
      row.captured_for_date,
      (merged.get(row.captured_for_date) || 0) + toNumber(row.value),
    );
  }

  const list = [...merged.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, value }));
  return denseSeries(list, daysBack);
}

function forecastFromSeries(params: {
  channel: string;
  history: SeriesPoint[];
  daysAhead: number;
}): ForecastResult {
  const history = params.history;
  const values = history.map((row) => row.value);
  const smoothed = movingAverage(values, 7);
  const { slope, intercept } = linearRegression(smoothed);
  const overallAvg =
    values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);

  const weekdaySums = Array.from({ length: 7 }, () => 0);
  const weekdayCounts = Array.from({ length: 7 }, () => 0);
  history.forEach((row) => {
    const idx = weekdayIndex(row.date);
    weekdaySums[idx] += row.value;
    weekdayCounts[idx] += 1;
  });

  const weekdayAvg = weekdaySums.map((sum, idx) =>
    weekdayCounts[idx] > 0 ? sum / weekdayCounts[idx] : overallAvg || 1,
  );

  const backtestCount = Math.min(30, history.length);
  const backtestPredicted: number[] = [];
  const backtestActual: number[] = [];
  for (let i = history.length - backtestCount; i < history.length; i += 1) {
    const row = history[i];
    const dow = weekdayIndex(row.date);
    const seasonalFactor =
      overallAvg > 0 ? weekdayAvg[dow] / Math.max(overallAvg, 0.0001) : 1;
    const predicted = Math.max(0, (intercept + slope * i) * seasonalFactor);
    backtestPredicted.push(predicted);
    backtestActual.push(row.value);
  }
  const stdDev = rmse(backtestActual, backtestPredicted);

  const lastDate = history[history.length - 1]?.date || toIsoDate(new Date());
  const points: ForecastPoint[] = [];
  for (let step = 0; step < params.daysAhead; step += 1) {
    const date = addDays(lastDate, step);
    const dow = weekdayIndex(date);
    const seasonalFactor =
      overallAvg > 0 ? weekdayAvg[dow] / Math.max(overallAvg, 0.0001) : 1;
    const dayIndex = history.length - 1 + step;
    const predicted = Math.max(0, (intercept + slope * dayIndex) * seasonalFactor);
    const lower = Math.max(0, predicted - 1.28 * stdDev);
    const upper = Math.max(0, predicted + 1.28 * stdDev);
    points.push({
      date,
      predicted: round2(predicted),
      lower_bound: round2(lower),
      upper_bound: round2(upper),
      channel: params.channel,
    });
  }

  const dailyGrowth = overallAvg > 0 ? slope / overallAvg : 0;
  const annualizedGrowth = dailyGrowth * 365 * 100;

  return {
    channel: params.channel,
    points,
    trend: classifyTrend(annualizedGrowth),
    growth_rate_pct: round2(annualizedGrowth),
    confidence: classifyConfidence(history.length),
    data_points_used: history.length,
  };
}

export async function getHistoricalMetric(
  metric_name: string,
  days_back: number,
): Promise<Array<{ date: string; value: number }>> {
  return fetchMetricSeries(metric_name, Math.min(Math.max(days_back, 1), 365));
}

export async function generateRevenueForecast(opts?: {
  days_ahead?: number;
  channel?: string;
}): Promise<ForecastResult[]> {
  const daysAhead = Math.min(Math.max(Math.floor(opts?.days_ahead || 30), 1), 90);
  const channel = (opts?.channel || "all").toLowerCase();
  const historyDays = 90;

  const [shopifyHistory, amazonHistory] = await Promise.all([
    fetchMetricSeries("daily_revenue_shopify", historyDays),
    fetchMetricSeries("daily_revenue_amazon", historyDays),
  ]);

  const totalHistory = shopifyHistory.map((row, idx) => ({
    date: row.date,
    value: row.value + (amazonHistory[idx]?.value || 0),
  }));

  const results: ForecastResult[] = [];
  if (channel === "all" || channel === "shopify") {
    results.push(
      forecastFromSeries({
        channel: "shopify",
        history: shopifyHistory,
        daysAhead,
      }),
    );
  }
  if (channel === "all" || channel === "amazon") {
    results.push(
      forecastFromSeries({
        channel: "amazon",
        history: amazonHistory,
        daysAhead,
      }),
    );
  }
  if (channel === "all" || channel === "total") {
    results.push(
      forecastFromSeries({
        channel: "total",
        history: totalHistory,
        daysAhead,
      }),
    );
  }

  return results;
}
