import { getMonthlySpend, getPreferredClaudeModel } from "@/lib/ops/abra-cost-tracker";
import { detectAnomalies } from "@/lib/ops/abra-anomaly-detection";
import { getActiveSignals } from "@/lib/ops/abra-operational-signals";
import { generateRevenueForecast } from "@/lib/ops/abra-forecasting";
import { analyzeInventory } from "@/lib/ops/abra-inventory-forecast";
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

export async function generateMorningBrief(): Promise<string> {
  const date = new Date();
  const dateLabel = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const lines: string[] = [`🌅 *ABRA MORNING BRIEF — ${dateLabel}*`, ""];

  try {
    const [
      shopifyRevenue,
      amazonRevenue,
      shopifyOrders,
      amazonOrders,
      sessions,
    ] = await Promise.all([
      getMetricSnapshot("daily_revenue_shopify"),
      getMetricSnapshot("daily_revenue_amazon"),
      getMetricSnapshot("daily_orders_shopify"),
      getMetricSnapshot("daily_orders_amazon"),
      getMetricSnapshot("daily_sessions"),
    ]);
    const revenueTotal =
      Number(shopifyRevenue?.current || 0) + Number(amazonRevenue?.current || 0);
    const ordersTotal =
      Number(shopifyOrders?.current || 0) + Number(amazonOrders?.current || 0);
    const revenueVsAvg =
      Number(shopifyRevenue?.pctVsAvg || 0) + Number(amazonRevenue?.pctVsAvg || 0);
    const ordersVsAvg =
      Number(shopifyOrders?.pctVsAvg || 0) + Number(amazonOrders?.pctVsAvg || 0);
    const aov = ordersTotal > 0 ? revenueTotal / ordersTotal : 0;

    lines.push("📊 *Yesterday's Scorecard*");
    lines.push(
      `• Revenue — Shopify $${Number(shopifyRevenue?.current || 0).toFixed(2)} (${arrow(shopifyRevenue?.pctVsAvg || 0)}${Math.abs(shopifyRevenue?.pctVsAvg || 0).toFixed(1)}%), Amazon $${Number(amazonRevenue?.current || 0).toFixed(2)} (${arrow(amazonRevenue?.pctVsAvg || 0)}${Math.abs(amazonRevenue?.pctVsAvg || 0).toFixed(1)}%), Total $${revenueTotal.toFixed(2)} (${arrow(revenueVsAvg)}${Math.abs(revenueVsAvg).toFixed(1)}%)`,
    );
    lines.push(
      `• Orders — Shopify ${Math.round(shopifyOrders?.current || 0)}, Amazon ${Math.round(amazonOrders?.current || 0)}, Total ${Math.round(ordersTotal)} (${arrow(ordersVsAvg)}${Math.abs(ordersVsAvg).toFixed(1)}%)`,
    );
    lines.push(
      `• Sessions ${Math.round(sessions?.current || 0)} (${arrow(sessions?.pctVsAvg || 0)}${Math.abs(sessions?.pctVsAvg || 0).toFixed(1)}%), AOV $${aov.toFixed(2)}`,
    );
    lines.push("");
  } catch {
    // Skip scorecard if metric reads fail
  }

  try {
    const anomalies = await detectAnomalies();
    const top = anomalies.slice(0, 3);
    lines.push("🚨 *Anomalies Detected*");
    if (top.length === 0) {
      lines.push("• No major anomalies vs baseline.");
    } else {
      for (const anomaly of top) {
        const icon =
          anomaly.severity === "critical"
            ? "🔴"
            : anomaly.severity === "warning"
              ? "🟡"
              : "🔵";
        const metric = anomaly.metric.replace(/^daily_/, "").replace(/_/g, " ");
        lines.push(
          `• ${icon} ${metric}: ${anomaly.direction === "spike" ? "+" : "-"}${Math.abs(anomaly.deviation_pct).toFixed(1)}% vs avg`,
        );
      }
    }
    lines.push("");
  } catch {
    // Skip anomaly section
  }

  try {
    const signals = await getActiveSignals({ limit: 5 });
    lines.push("⚠️ *Active Signals*");
    if (signals.length === 0) {
      lines.push("• No unacknowledged signals.");
    } else {
      for (const signal of signals.slice(0, 5)) {
        const icon =
          signal.severity === "critical"
            ? "🔴"
            : signal.severity === "warning"
              ? "🟡"
              : "🔵";
        lines.push(`• ${icon} ${signal.title}`);
      }
    }
    lines.push("");
  } catch {
    // Skip active signals section
  }

  try {
    const forecasts = await generateRevenueForecast({
      days_ahead: 7,
      channel: "total",
    });
    const total = forecasts[0];
    if (total) {
      const projected = total.points.reduce((sum, point) => sum + point.predicted, 0);
      const spreadAvg =
        total.points.reduce((sum, point) => sum + (point.upper_bound - point.lower_bound), 0) /
        Math.max(total.points.length, 1);
      lines.push("📈 *Forecast Preview*");
      lines.push(
        `• Next 7 days projected: $${projected.toFixed(0)} (±$${(spreadAvg / 2).toFixed(0)})`,
      );
      lines.push(
        `• Trend: ${total.trend} at ${total.growth_rate_pct >= 0 ? "+" : ""}${total.growth_rate_pct.toFixed(1)}% annualized`,
      );
      lines.push("");
    }
  } catch {
    // Skip forecast section
  }

  try {
    const inventory = await analyzeInventory();
    const watch = inventory
      .filter((item) => item.channel === "total" && item.urgency !== "ok")
      .slice(0, 3);
    lines.push("📦 *Inventory Watch*");
    if (watch.length === 0) {
      lines.push("• No urgent stockout risk detected.");
    } else {
      for (const item of watch) {
        const icon = item.urgency === "critical" ? "🔴" : "🟡";
        const daysText = Number.isFinite(item.days_until_stockout)
          ? `~${item.days_until_stockout} days`
          : "unknown";
        lines.push(
          `• ${icon} ${item.product_name}: ${item.current_stock} units left, ${daysText} to stockout`,
        );
      }
    }
    lines.push("");
  } catch {
    // Skip inventory watch section
  }

  try {
    const pendingApprovals = await getPendingApprovalsCount();
    lines.push("⏳ *Pending Actions*");
    lines.push(`• ${pendingApprovals} approvals pending your review`);
    lines.push("");
  } catch {
    // Skip pending actions section
  }

  try {
    const [spend, preferredModel] = await Promise.all([
      getMonthlySpend(),
      getPreferredClaudeModel(
        process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
      ),
    ]);
    lines.push("💰 *AI Budget*");
    lines.push(
      `• AI spend: $${spend.total.toFixed(2)} / $${spend.budget.toFixed(2)} (${spend.pctUsed.toFixed(1)}%)`,
    );
    lines.push(`• Model governor: ${preferredModel}`);
    lines.push("");
  } catch {
    // Skip budget section
  }

  const dashboardBase = process.env.NEXTAUTH_URL || "https://usagummies.com";
  lines.push(`Reply in Slack: \`/abra <question>\` | Dashboard: ${dashboardBase}/ops`);

  const text = lines.join("\n");
  return text.length > 1990 ? `${text.slice(0, 1987)}...` : text;
}

export async function sendMorningBrief(): Promise<void> {
  const brief = await generateMorningBrief();
  await notify({ channel: "daily", text: brief });
}
