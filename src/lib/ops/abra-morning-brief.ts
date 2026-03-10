import { getMonthlySpend, logAICost } from "@/lib/ops/abra-cost-tracker";
import { detectAnomalies } from "@/lib/ops/abra-anomaly-detection";
import { getActiveSignals } from "@/lib/ops/abra-operational-signals";
import { checkInitiativeHealth } from "@/lib/ops/abra-initiative-health";
import { notify } from "@/lib/ops/notify";

type MetricSnapshot = {
  metric: string;
  current: number;
  avg7: number;
  pctVsAvg: number;
};

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

function avg(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pct(value: number, base: number): number {
  if (!base) return 0;
  return ((value - base) / Math.abs(base)) * 100;
}

function arrow(value: number): string {
  return value >= 0 ? "▲" : "▼";
}

async function getMetricSnapshot(metric: string): Promise<MetricSnapshot | null> {
  const rows = (await sbFetch(
    `/rest/v1/kpi_timeseries?metric_name=eq.${encodeURIComponent(metric)}&window_type=eq.daily&select=value,captured_for_date&order=captured_for_date.desc&limit=8`,
  )) as Array<{ value: number | string; captured_for_date: string }>;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const current = Number(rows[0]?.value || 0);
  const history = rows.slice(1).map((row) => Number(row.value || 0));
  const avg7 = history.length ? avg(history) : current;
  return {
    metric,
    current,
    avg7,
    pctVsAvg: pct(current, avg7),
  };
}

async function getPendingApprovalsCount(): Promise<number> {
  const rows = (await sbFetch(
    "/rest/v1/approvals?status=eq.pending&select=id&limit=200",
  )) as Array<{ id: string }>;
  return Array.isArray(rows) ? rows.length : 0;
}

async function getTodaySessionCount(): Promise<number> {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const rows = (await sbFetch(
    `/rest/v1/abra_sessions?started_at=gte.${encodeURIComponent(start.toISOString())}&started_at=lt.${encodeURIComponent(end.toISOString())}&select=id&limit=200`,
  )) as Array<{ id: string }>;
  return Array.isArray(rows) ? rows.length : 0;
}

export async function generateMorningBrief(): Promise<string> {
  const [
    signalsRes,
    anomaliesRes,
    healthRes,
    approvalsRes,
    spendRes,
    sessionsTodayRes,
  ] = await Promise.allSettled([
    getActiveSignals({ limit: 20 }),
    detectAnomalies(),
    checkInitiativeHealth(),
    getPendingApprovalsCount(),
    getMonthlySpend(),
    getTodaySessionCount(),
  ]);
  const [
    shopifyRevenueRes,
    shopifyOrdersRes,
    amazonRevenueRes,
    amazonOrdersRes,
    sessionsRes,
  ] = await Promise.allSettled([
    getMetricSnapshot("daily_revenue_shopify"),
    getMetricSnapshot("daily_orders_shopify"),
    getMetricSnapshot("daily_revenue_amazon"),
    getMetricSnapshot("daily_orders_amazon"),
    getMetricSnapshot("daily_sessions"),
  ]);

  const signals =
    signalsRes.status === "fulfilled" && Array.isArray(signalsRes.value)
      ? signalsRes.value
      : [];
  const anomalies =
    anomaliesRes.status === "fulfilled" && Array.isArray(anomaliesRes.value)
      ? anomaliesRes.value
      : [];
  const health =
    healthRes.status === "fulfilled" && Array.isArray(healthRes.value)
      ? healthRes.value
      : [];
  const approvals =
    approvalsRes.status === "fulfilled" ? Number(approvalsRes.value || 0) : 0;
  const spend =
    spendRes.status === "fulfilled"
      ? spendRes.value
      : { total: 0, budget: 1000, pctUsed: 0 };
  const todaySessions =
    sessionsTodayRes.status === "fulfilled"
      ? Number(sessionsTodayRes.value || 0)
      : 0;
  const shopifyRevenue =
    shopifyRevenueRes.status === "fulfilled" ? shopifyRevenueRes.value : null;
  const shopifyOrders =
    shopifyOrdersRes.status === "fulfilled" ? shopifyOrdersRes.value : null;
  const amazonRevenue =
    amazonRevenueRes.status === "fulfilled" ? amazonRevenueRes.value : null;
  const amazonOrders =
    amazonOrdersRes.status === "fulfilled" ? amazonOrdersRes.value : null;
  const sessions =
    sessionsRes.status === "fulfilled" ? sessionsRes.value : null;

  const stale = health.filter((item) => item.health !== "healthy");
  const signalLines = signals.slice(0, 5).map((signal) => {
    const icon =
      signal.severity === "critical"
        ? "🔴"
        : signal.severity === "warning"
          ? "🟡"
          : "🔵";
    return `• ${icon} ${signal.title}`;
  });

  const dateLabel = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const lines: string[] = [];
  lines.push(`☀️ *Good morning, Ben. Here's your Abra brief for ${dateLabel}.*`);
  lines.push("");
  lines.push("📊 *Yesterday's Numbers*");
  lines.push(
    `• Shopify: $${shopifyRevenue?.current.toFixed(2) || "0.00"} revenue (${Math.round(shopifyOrders?.current || 0)} orders) — ${arrow(shopifyRevenue?.pctVsAvg || 0)} ${Math.abs(shopifyRevenue?.pctVsAvg || 0).toFixed(1)}% vs 7-day avg`,
  );
  lines.push(
    `• Amazon: $${amazonRevenue?.current.toFixed(2) || "0.00"} revenue (${Math.round(amazonOrders?.current || 0)} orders) — ${arrow(amazonRevenue?.pctVsAvg || 0)} ${Math.abs(amazonRevenue?.pctVsAvg || 0).toFixed(1)}% vs 7-day avg`,
  );
  lines.push(
    `• Traffic: ${Math.round(sessions?.current || 0)} sessions — ${arrow(sessions?.pctVsAvg || 0)} ${Math.abs(sessions?.pctVsAvg || 0).toFixed(1)}% vs 7-day avg`,
  );

  lines.push("");
  lines.push(`⚠️ *Signals (${signalLines.length} active)*`);
  if (signalLines.length === 0) {
    lines.push("• No new overnight signals.");
  } else {
    lines.push(...signalLines);
  }

  lines.push("");
  lines.push("📋 *Action Items*");
  lines.push(`• ${approvals} pending approvals`);
  lines.push(`• ${stale.length} stale initiatives`);
  lines.push(`• ${anomalies.length} metric anomalies detected`);
  lines.push(`• ${todaySessions} sessions scheduled/started today`);

  lines.push("");
  lines.push(
    `💰 *AI Budget*: $${spend.total.toFixed(2)} / $${spend.budget.toFixed(2)} (${spend.pctUsed.toFixed(1)}%)`,
  );
  lines.push("");
  lines.push("Reply here or in /ops/abra to take action.");

  return lines.join("\n");
}

export async function sendMorningBrief(): Promise<void> {
  const brief = await generateMorningBrief();
  await notify({ channel: "daily", text: brief });
  void logAICost({
    model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
    provider: "anthropic",
    inputTokens: 0,
    outputTokens: 0,
    endpoint: "morning-brief",
    department: "executive",
  });
}
