import { getMonthlySpend, getPreferredClaudeModel } from "@/lib/ops/abra-cost-tracker";
import { detectAnomalies } from "@/lib/ops/abra-anomaly-detection";
import { getActiveSignals } from "@/lib/ops/abra-operational-signals";
import { generateRevenueForecast } from "@/lib/ops/abra-forecasting";
import { analyzeInventory } from "@/lib/ops/abra-inventory-forecast";
import { detectAwaitingReplies } from "@/lib/ops/abra-email-fetch";
import { notify } from "@/lib/ops/notify";
import { createNotionPage } from "@/lib/ops/abra-notion-write";
import { readState, writeState } from "@/lib/ops/state";
import { RECONCILIATION_SUMMARY_STATE_KEY, type ReconciliationSummary } from "@/lib/ops/operator/reconciliation";
import { OPEN_PO_TRACKER_STATE_KEY, type OpenPoSummary } from "@/lib/ops/operator/po-tracker";
import { UNIFIED_INVENTORY_STATE_KEY, type UnifiedInventorySummary } from "@/lib/ops/operator/unified-inventory";
import { UNIFIED_REVENUE_STATE_KEY, type UnifiedRevenueSummary } from "@/lib/ops/operator/unified-revenue";
import { getDailyGoalSnapshot, formatGoalSlack } from "@/lib/ops/daily-goal-tracker";

type MetricSnapshot = {
  metric: string;
  current: number;
  avg7: number;
  pctVsAvg: number;
  stale?: boolean;
};

type OperatorTaskBrief = {
  completedLast24h: number;
  completedByType: Record<string, number>;
  pendingCount: number;
  needsApproval: Array<{ title: string; task_type: string }>;
};

export type MorningBriefPayload = {
  generated_at: string;
  feed_data_available: boolean;
  fallback_message: string | null;
  revenue: {
    shopify: MetricSnapshot | null;
    amazon: MetricSnapshot | null;
    total_current: number;
    total_delta_pct: number;
  };
  traffic: {
    sessions: MetricSnapshot | null;
  };
  initiatives: {
    active_count: number;
    by_department: Record<string, number>;
  };
  open_action_items: {
    pending_approvals: number;
    pending_tasks: number;
    total_open: number;
  };
  operator: {
    completed_last_24h: number;
    completed_by_type: Record<string, number>;
    pending_count: number;
    needs_approval: Array<{
      title: string;
      task_type: string;
    }>;
  };
  anomalies: {
    count: number;
    items: Array<{
      metric: string;
      direction: "spike" | "drop";
      deviation_pct: number;
      severity: "info" | "warning" | "critical";
    }>;
  };
  signals: {
    count: number;
    items: Array<{
      id: string;
      title: string;
      severity: "info" | "warning" | "critical";
      department: string | null;
    }>;
  };
  goal_tracker: {
    monthlyTarget: number;
    dailyTarget: number;
    mtdActual: number;
    mtdTarget: number;
    mtdPacePct: number;
    status: string;
    daysRemaining: number;
    requiredDailyRate: number;
  } | null;
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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
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
    `/rest/v1/kpi_timeseries?metric_name=eq.${encodeURIComponent(metric)}&window_type=eq.daily&select=value,captured_for_date,created_at&order=captured_for_date.desc&limit=8`,
  )) as Array<{ value: number | string; captured_for_date: string; created_at?: string }>;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  // Freshness check: use created_at if available, else fall back to captured_for_date
  const latestTs = rows[0]?.created_at
    ? Date.parse(rows[0].created_at)
    : Date.parse(`${rows[0]?.captured_for_date}T00:00:00Z`);
  const ageMs = Number.isFinite(latestTs) ? Date.now() - latestTs : Infinity;
  const ageHours = ageMs / (60 * 60 * 1000);

  if (ageHours > 4) {
    console.warn(
      `[morning-brief] kpi_timeseries "${metric}" is ${ageHours.toFixed(1)}h old — data may be stale; returning null`,
    );
    return null;
  }

  const current = Number(rows[0]?.value || 0);
  const history = rows.slice(1).map((row) => Number(row.value || 0));
  const avg7 = history.length ? avg(history) : current;
  return {
    metric: ageHours > 2 ? `${metric} (stale data)` : metric,
    current,
    avg7,
    pctVsAvg: pct(current, avg7),
    stale: ageHours > 2,
  };
}

async function getPendingApprovalsCount(): Promise<number> {
  const rows = (await sbFetch(
    "/rest/v1/approvals?status=eq.pending&select=id&limit=200",
  )) as Array<{ id: string }>;
  return Array.isArray(rows) ? rows.length : 0;
}

async function getActiveInitiativesSummary(): Promise<{
  active_count: number;
  by_department: Record<string, number>;
}> {
  const rows = (await sbFetch(
    "/rest/v1/abra_initiatives?status=not.in.(completed,paused)&select=department,status&limit=500",
  )) as Array<{ department?: string | null }>;
  const byDepartment: Record<string, number> = {};
  for (const row of rows || []) {
    const department = (row?.department || "unknown").toString();
    byDepartment[department] = (byDepartment[department] || 0) + 1;
  }
  return {
    active_count: Array.isArray(rows) ? rows.length : 0,
    by_department: byDepartment,
  };
}

async function getPendingTaskCount(): Promise<number> {
  const [abraTasks, legacyTasks] = await Promise.allSettled([
    sbFetch(
      "/rest/v1/abra_tasks?status=in.(pending,in_progress)&select=id&limit=1000",
    ) as Promise<Array<{ id: string }>>,
    sbFetch(
      "/rest/v1/tasks?status=in.(pending,in_progress)&select=id&limit=1000",
    ) as Promise<Array<{ id: string }>>,
  ]);
  const abrCount =
    abraTasks.status === "fulfilled" && Array.isArray(abraTasks.value)
      ? abraTasks.value.length
      : 0;
  const legacyCount =
    legacyTasks.status === "fulfilled" && Array.isArray(legacyTasks.value)
      ? legacyTasks.value.length
      : 0;
  return abrCount + legacyCount;
}

async function getOperatorTaskBrief(): Promise<OperatorTaskBrief> {
  const completedSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [completedRows, pendingRows, approvalRows] = await Promise.all([
    sbFetch(
      `/rest/v1/abra_operator_tasks?status=eq.completed&completed_at=gte.${encodeURIComponent(completedSince)}&select=task_type&limit=500`,
    ) as Promise<Array<{ task_type?: string | null }>>,
    sbFetch(
      "/rest/v1/abra_operator_tasks?status=eq.pending&select=id&limit=500",
    ) as Promise<Array<{ id: string }>>,
    sbFetch(
      "/rest/v1/abra_operator_tasks?status=eq.needs_approval&select=title,task_type&order=created_at.asc&limit=5",
    ) as Promise<Array<{ title?: string | null; task_type?: string | null }>>,
  ]);

  const completedByType: Record<string, number> = {};
  for (const row of completedRows || []) {
    const key = String(row.task_type || "other");
    completedByType[key] = (completedByType[key] || 0) + 1;
  }

  return {
    completedLast24h: Array.isArray(completedRows) ? completedRows.length : 0,
    completedByType,
    pendingCount: Array.isArray(pendingRows) ? pendingRows.length : 0,
    needsApproval: (approvalRows || []).map((row) => ({
      title: String(row.title || "Operator task"),
      task_type: String(row.task_type || "task"),
    })),
  };
}

export async function generateMorningBriefPayload(): Promise<MorningBriefPayload> {
  const [
    shopifyRevenue,
    amazonRevenue,
    sessions,
    anomalies,
    signals,
    initiatives,
    pendingApprovals,
    pendingTasks,
    operatorSummary,
    goalSnapshot,
  ] = await Promise.all([
    getMetricSnapshot("daily_revenue_shopify"),
    getMetricSnapshot("daily_revenue_amazon"),
    getMetricSnapshot("daily_sessions"),
    detectAnomalies().catch(() => []),
    getActiveSignals({ limit: 10 }).catch(() => []),
    getActiveInitiativesSummary().catch(() => ({
      active_count: 0,
      by_department: {},
    })),
    getPendingApprovalsCount().catch(() => 0),
    getPendingTaskCount().catch(() => 0),
    getOperatorTaskBrief().catch(() => ({
      completedLast24h: 0,
      completedByType: {},
      pendingCount: 0,
      needsApproval: [],
    })),
    getDailyGoalSnapshot().catch(() => null),
  ]);

  const revenueTotal =
    Number(shopifyRevenue?.current || 0) + Number(amazonRevenue?.current || 0);
  const revenueDelta =
    Number(shopifyRevenue?.pctVsAvg || 0) + Number(amazonRevenue?.pctVsAvg || 0);
  const hasFeedData = Boolean(
    shopifyRevenue ||
      amazonRevenue ||
      sessions ||
      (Array.isArray(signals) && signals.length > 0),
  );

  return {
    generated_at: new Date().toISOString(),
    feed_data_available: hasFeedData,
    fallback_message: hasFeedData
      ? null
      : "No feed data available yet — run feeds first.",
    revenue: {
      shopify: shopifyRevenue,
      amazon: amazonRevenue,
      total_current: revenueTotal,
      total_delta_pct: revenueDelta,
    },
    traffic: {
      sessions,
    },
    initiatives,
    open_action_items: {
      pending_approvals: pendingApprovals,
      pending_tasks: pendingTasks,
      total_open: pendingApprovals + pendingTasks,
    },
    operator: {
      completed_last_24h: operatorSummary.completedLast24h,
      completed_by_type: operatorSummary.completedByType,
      pending_count: operatorSummary.pendingCount,
      needs_approval: operatorSummary.needsApproval,
    },
    anomalies: {
      count: Array.isArray(anomalies) ? anomalies.length : 0,
      items: (Array.isArray(anomalies) ? anomalies : []).slice(0, 10).map((item) => ({
        metric: item.metric,
        direction: item.direction,
        deviation_pct: item.deviation_pct,
        severity: item.severity,
      })),
    },
    signals: {
      count: Array.isArray(signals) ? signals.length : 0,
      items: (Array.isArray(signals) ? signals : []).slice(0, 10).map((signal) => ({
        id: signal.id,
        title: signal.title,
        severity: signal.severity,
        department: signal.department,
      })),
    },
    goal_tracker: goalSnapshot
      ? {
          monthlyTarget: goalSnapshot.monthlyTarget,
          dailyTarget: goalSnapshot.dailyTarget,
          mtdActual: goalSnapshot.mtdActual,
          mtdTarget: goalSnapshot.mtdTarget,
          mtdPacePct: goalSnapshot.mtdPacePct,
          status: goalSnapshot.status,
          daysRemaining: goalSnapshot.daysRemaining,
          requiredDailyRate: goalSnapshot.requiredDailyRate,
        }
      : null,
  };
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

  // Daily Goal Tracker
  try {
    const goalSnapshot = await getDailyGoalSnapshot();
    if (goalSnapshot) {
      lines.push(formatGoalSlack(goalSnapshot));
      lines.push("");
    }
  } catch {
    // Skip goal tracker section
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

  // Awaiting-Reply Section — unanswered outbound emails
  try {
    const awaiting = await detectAwaitingReplies({ sentCount: 30, lookbackHours: 72 });
    const important = awaiting.filter((a) => a.escalation === "critical" || a.escalation === "important");
    if (important.length > 0) {
      lines.push("\u{1F4EC} *Awaiting Reply*");
      for (const item of important.slice(0, 5)) {
        const icon = item.escalation === "critical" ? "\u{1F6A8}" : "\u{26A0}\u{FE0F}";
        lines.push(`• ${icon} *${item.recipientName}* — _${item.subject}_ (${item.hoursAgo}h ago)`);
        if (item.reason) lines.push(`  ${item.reason}`);
      }
      lines.push("");
    }
  } catch {
    // Skip awaiting-reply section
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
    const operator = await getOperatorTaskBrief();
    const parts = Object.entries(operator.completedByType)
      .slice(0, 4)
      .map(([taskType, count]) => {
        const label =
          taskType === "qbo_categorize" ? "categorizations" :
          taskType === "qbo_assign_vendor" ? "vendor assignments" :
          taskType === "email_draft_response" ? "email drafts" :
          taskType === "vendor_followup" || taskType === "distributor_followup" ? "follow-ups" :
          taskType.replace(/_/g, " ");
        return `${count} ${label}`;
      });

    lines.push("🤖 *Operator*");
    lines.push(
      `• ${operator.completedLast24h} tasks completed overnight${parts.length ? ` (${parts.join(", ")})` : ""}. ${operator.pendingCount} pending.`,
    );
    if (operator.needsApproval.length > 0) {
      lines.push(`• ${operator.needsApproval.length} tasks need your approval:`);
      for (const task of operator.needsApproval.slice(0, 3)) {
        lines.push(`  - ${task.title}`);
      }
    }
    lines.push("");
  } catch {
    // Skip operator section
  }

  try {
    const cashPos = await readState("cash-position", null) as {
      balance?: number;
      monthlyIncome?: number;
      monthlyExpenses?: number;
      monthlyNet?: number;
      lastUpdated?: string;
    } | null;
    if (cashPos && typeof cashPos.balance === "number") {
      lines.push("💰 *Cash Position*");
      lines.push(`• Balance: $${cashPos.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      if (typeof cashPos.monthlyIncome === "number") {
        lines.push(`• MTD: +$${cashPos.monthlyIncome.toFixed(2)} income, -$${Math.abs(cashPos.monthlyExpenses || 0).toFixed(2)} expenses, net $${(cashPos.monthlyNet || 0).toFixed(2)}`);
      }
      if (cashPos.lastUpdated) {
        const age = Math.round((Date.now() - new Date(cashPos.lastUpdated).getTime()) / 86400000);
        if (age > 3) lines.push(`• ⚠️ Data is ${age} days old — upload latest BofA CSV`);
      }
      lines.push("");
    }
  } catch {
    // Skip cash position section
  }

  try {
    const [spend, preferredModel] = await Promise.all([
      getMonthlySpend(),
      getPreferredClaudeModel(
        process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      ),
    ]);
    lines.push("🤖 *AI Budget*");
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

// ── Prior Observation Helpers ────────────────────────────────────────────────

/**
 * Reads Abra's own prior morning-brief observations from the last 30 days.
 * These are the entries Abra wrote after each previous run — the "case file"
 * that enables pattern recognition across cycles.
 */
async function fetchPriorBriefObservations(): Promise<string> {
  const env = getSupabaseEnv();
  if (!env) return "";

  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const rows = await sbFetch(
      `/rest/v1/open_brain_entries?source_ref=like.morning-brief-*&created_at=gte.${since}&select=title,summary_text,raw_text,created_at&order=created_at.desc&limit=30`,
    ) as Array<{ title?: string; summary_text?: string; raw_text?: string; created_at: string }>;

    if (!Array.isArray(rows) || rows.length === 0) return "";

    const lines = rows.map((r) => {
      const date = r.created_at.split("T")[0];
      const body = r.summary_text || r.raw_text || "";
      return `[${date}] ${r.title || "Morning Brief"}: ${body.slice(0, 400)}`;
    });

    return lines.join("\n\n");
  } catch {
    return "";
  }
}

/**
 * Writes today's morning brief as an open_brain_entries record so future
 * runs can read it and build on it — the accumulation loop.
 */
async function writeBriefToMemory(briefText: string, dateShort: string): Promise<void> {
  const env = getSupabaseEnv();
  if (!env) return;

  // Strip Slack formatting for a clean stored copy
  const clean = briefText.replace(/[*`]/g, "").replace(/\n{3,}/g, "\n\n").trim();
  // Title = first non-empty line (strip leading emoji + asterisks)
  const firstLine = clean.split("\n").find((l) => l.trim().length > 0) || "Morning Brief";
  const title = firstLine.replace(/^[^\w]*/, "").slice(0, 200);

  try {
    const headers = new Headers();
    headers.set("apikey", env.serviceKey);
    headers.set("Authorization", `Bearer ${env.serviceKey}`);
    headers.set("Content-Type", "application/json");
    headers.set("Prefer", "return=minimal");

    await fetch(`${env.baseUrl}/rest/v1/open_brain_entries`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        source_type: "agent",
        source_ref: `morning-brief-${dateShort}`,
        entry_type: "summary",
        title,
        raw_text: clean,
        summary_text: clean.slice(0, 800),
        category: "operational",
        department: "operations",
        confidence: "high",
        priority: "normal",
        tags: ["morning-brief", "daily-synthesis"],
      }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
  } catch (err) {
    // Best-effort — don't break the brief if write-back fails
    console.error("[morning-brief] write-back to brain failed:", err instanceof Error ? err.message : err);
  }
}

export async function generateLLMMorningBrief(): Promise<string> {
  const payload = await generateMorningBriefPayload();
  const date = new Date();
  const dateLabel = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const dateShort = date.toISOString().split("T")[0];

  // Load versioned prompt with fallback
  const FALLBACK_PROMPT = `You are the executive briefing analyst for USA Gummies, a CPG company selling vitamin gummies on Shopify and Amazon.

Given the operational data below, write a concise morning brief for the founder (Ben). Structure:
1. **Lead with the headline** — the single most important thing Ben needs to know today (1 sentence)
2. **Scorecard** — yesterday's revenue, orders, sessions with vs-average context (2-3 bullet points)
3. **Action items** — what needs Ben's attention today, ranked by urgency (numbered list)
4. **Signals & anomalies** — any operational warnings or opportunities detected (bullet points, skip if none)
5. **Forecast** — brief forward-looking statement if data available

Rules:
- Be specific with numbers, never vague
- Flag anything that deviated >15% from average
- Keep total length under 300 words
- Use Slack formatting (*bold*, bullet points)
- Start with an emoji that reflects the day's tone (🚀 great, ✅ normal, ⚠️ needs attention, 🚨 critical)`;

  let systemPrompt = FALLBACK_PROMPT;
  try {
    const { getActivePrompt } = await import("@/lib/ops/auto-research-runner");
    const versioned = await getActivePrompt("morning_brief");
    if (versioned?.prompt_text) {
      systemPrompt = versioned.prompt_text;
    }
  } catch {
    // fallback to hardcoded
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    // No API key — fall back to rule-based brief
    return generateMorningBrief();
  }

  // Load prior observations in parallel with LLM setup — best-effort
  const priorObservations = await fetchPriorBriefObservations().catch(() => "");

  try {
    const model = await getPreferredClaudeModel(
      process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    );

    const priorContext = priorObservations
      ? `\n\nPrior observations (your own notes from the last 30 days — use these to identify patterns and trends):\n${priorObservations}`
      : "";

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0.3,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Generate the morning brief for ${dateLabel}.\n\nOperational data:\n${JSON.stringify(payload, null, 2)}${priorContext}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      console.error(`[morning-brief] LLM call failed (${res.status})`);
      return generateMorningBrief();
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    // Log cost (best-effort)
    try {
      const { logAICost } = await import("@/lib/ops/abra-cost-tracker");
      if (data.usage) {
        await logAICost({
          model,
          provider: "anthropic",
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
          endpoint: "morning-brief",
          department: "operations",
        });
      }
    } catch {
      // best-effort
    }

    const text = data.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text || "")
      .join("\n");

    if (!text) {
      return generateMorningBrief();
    }

    // Write this brief back to brain so future runs can build on it
    writeBriefToMemory(text, dateShort).catch(() => {});

    // Prepend header and append footer
    const header = `🌅 *ABRA MORNING BRIEF — ${dateLabel}*\n\n`;
    const dashboardBase = process.env.NEXTAUTH_URL || "https://usagummies.com";
    const footer = `\n\nReply in Slack: \`/abra <question>\` | Dashboard: ${dashboardBase}/ops`;

    const fullText = header + text + footer;
    return fullText.length > 1990 ? fullText.slice(0, 1987) + "..." : fullText;
  } catch (error) {
    console.error("[morning-brief] LLM synthesis failed:", error instanceof Error ? error.message : error);
    return generateMorningBrief();
  }
}

const BEN_SLACK_USER_ID = "U08JY86Q508";
const RENE_SLACK_USER_ID = "U0ALL27JM38";
const FINANCIALS_CHANNEL = "C0AKG9FSC2J";
const MORNING_BRIEF_HOLD_KEY = "abra:morning_brief_hold" as never;
const MORNING_BRIEF_HELD_KEY = "abra:morning_brief_held" as never;
const BEN_LAST_SEEN_KEY = "abra:ben_last_seen" as never;

type HeldMorningBrief = {
  date: string;
  content: string;
  held_at: string;
};

function pacificDateLabel(value = new Date()): string {
  return value.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function isSamePacificDay(iso: string | null | undefined, now = new Date()): boolean {
  if (!iso) return false;
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) return false;
  return pacificDateLabel(parsed) === pacificDateLabel(now);
}

async function fetchInternalOpsJson(path: string): Promise<Record<string, unknown> | null> {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret) return null;
  const host =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const res = await fetch(`${host}${path}`, {
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value || 0);
}

function shortOperatorLabel(taskType: string): string {
  if (taskType === "qbo_categorize") return "categorizations";
  if (taskType === "qbo_assign_vendor") return "vendor assignments";
  if (taskType === "email_draft_response") return "email drafts";
  if (taskType === "vendor_followup" || taskType === "distributor_followup") return "follow-ups";
  return taskType.replace(/_/g, " ");
}

function compactCurrency(value: number, digits = 0): string {
  return `$${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function compactCountLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function topOperatorTypes(completedByType: Record<string, number>, limit = 1): string {
  return Object.entries(completedByType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([taskType, count]) => `${count} ${shortOperatorLabel(taskType)}`)
    .join(", ");
}

async function fetchCompactAttentionItems(limit = 2): Promise<string[]> {
  const rows = await sbFetch(
    `/rest/v1/abra_operator_tasks?status=in.(pending,needs_approval)&select=title&order=created_at.asc&limit=${limit}`,
  ).catch(() => []);
  return Array.isArray(rows)
    ? (rows as Array<{ title?: string | null }>)
        .map((row) => String(row.title || "").trim())
        .filter(Boolean)
        .slice(0, limit)
    : [];
}

function shortEmailName(name: string): string {
  return name
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b(inc|llc|co|corporation|confections)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function buildCompactBenBrief(): Promise<string> {
  const [revenue, inventory, operator, approvals, awaiting, priorities, openPo, followUps] = await Promise.all([
    readState<UnifiedRevenueSummary | null>(UNIFIED_REVENUE_STATE_KEY, null).catch(() => null),
    readState<UnifiedInventorySummary | null>(UNIFIED_INVENTORY_STATE_KEY, null).catch(() => null),
    getOperatorTaskBrief().catch(() => ({
      completedLast24h: 0,
      completedByType: {},
      pendingCount: 0,
      needsApproval: [],
    })),
    getPendingApprovalsCount().catch(() => 0),
    detectAwaitingReplies({ sentCount: 30, lookbackHours: 72 }).catch(() => []),
    fetchCompactAttentionItems(2).catch(() => []),
    readState<OpenPoSummary | null>(OPEN_PO_TRACKER_STATE_KEY, null).catch(() => null),
    readState<{ due?: Array<{ entity?: string; daysSince?: number }> } | null>("operator:step:follow_up_scheduler:summary" as never, null).catch(() => null),
  ]);

  const emailLine = Array.isArray(awaiting) && awaiting.length
    ? awaiting
        .slice(0, 3)
        .map((item) => `${shortEmailName(item.recipientName || item.recipientEmail.split("@")[0] || "Contact")} ${Math.max(1, Math.round(Number(item.hoursAgo || 0) / 24))}d`)
        .join(", ")
    : "none";
  const inventoryBits: string[] = [];
  if (inventory?.fbaUnits) inventoryBits.push(`~${inventory.fbaUnits} units FBA`);
  if (inventory?.andrewUnits) inventoryBits.push(`${inventory.andrewUnits} incoming from Andrew`);
  if (inventory?.powersUnits) inventoryBits.push(`${inventory.powersUnits} at Powers`);
  const followUpLine = Array.isArray(followUps?.due) && followUps.due.length
    ? followUps.due.slice(0, 2).map((item) => `${item.entity} ${item.daysSince}d`).join(", ")
    : "";
  const lines = [
    `🌅 Good morning <@${BEN_SLACK_USER_ID}>`,
    "",
    `💰 Yesterday: ${compactCurrency(revenue?.total || 0, 2)} | MTD: ${compactCurrency(revenue?.mtd || 0)} (Amazon ${revenue?.mix.amazonPct || 0}%, DTC ${revenue?.mix.shopifyPct || 0}%)`,
    `📧 ${compactCountLabel(Array.isArray(awaiting) ? awaiting.length : 0, "email")} need response${emailLine !== "none" ? ` (${emailLine})` : ""}`,
    `📦 Inventory: ${inventoryBits.join(", ") || "position updating"}`,
    `📋 Open POs: ${openPo?.openCount || 0} orders, ${compactCurrency(openPo?.committedRevenue || 0)} committed${openPo?.overdue[0] ? ` | PO #${openPo.overdue[0].poNumber} overdue ${openPo.overdue[0].daysOverdue}d` : ""}`,
    followUpLine ? `📞 Follow-ups due: ${followUpLine}` : "",
    `🎯 Today: ${(priorities || []).join(", ") || "review operator queue, clear approvals"}`,
    `⚠️ ${compactCountLabel(approvals, "approval")} pending`,
    "",
    `Reply "emails" for drafts or "approve" for pending items.`,
  ];

  return lines.join("\n").slice(0, 500);
}

async function buildCompactReneBrief(): Promise<string> {
  const [revenue, operator, approvals, purchasesData, pendingEmailTasks, reconciliation, openPo] = await Promise.all([
    readState<UnifiedRevenueSummary | null>(UNIFIED_REVENUE_STATE_KEY, null).catch(() => null),
    getOperatorTaskBrief().catch(() => ({
      completedLast24h: 0,
      completedByType: {},
      pendingCount: 0,
      needsApproval: [],
    })),
    getPendingApprovalsCount().catch(() => 0),
    fetchInternalOpsJson("/api/ops/qbo/query?type=purchases&limit=200"),
    sbFetch("/rest/v1/abra_operator_tasks?task_type=in.(email_draft_response,vendor_followup,distributor_followup)&status=in.(pending,needs_approval)&select=id&limit=50").catch(() => []),
    readState<ReconciliationSummary | null>(RECONCILIATION_SUMMARY_STATE_KEY, null).catch(() => null),
    readState<OpenPoSummary | null>(OPEN_PO_TRACKER_STATE_KEY, null).catch(() => null),
  ]);

  const purchases = Array.isArray((purchasesData || {}).purchases)
    ? ((purchasesData || {}).purchases as Array<Record<string, unknown>>)
    : [];
  const reviewCount = purchases.filter((purchase) => {
    const firstLine = Array.isArray(purchase.Lines) ? ((purchase.Lines[0] || {}) as Record<string, unknown>) : {};
    const account = String(firstLine.Account || "").toLowerCase();
    return !account || account.includes("uncategorized");
  }).length;
  const categorizedCount = Math.max(0, purchases.length - reviewCount);
  const qboHealthPct = purchases.length ? Math.round((categorizedCount / purchases.length) * 100) : 100;
  const operatorLead = topOperatorTypes(operator.completedByType, 1) || "0 categorizations";
  const approvalCount = Math.max(approvals, operator.needsApproval.length);

  const lines = [
    `🌅 Good morning <@${RENE_SLACK_USER_ID}>`,
    "",
    `💰 Yesterday: ${compactCurrency(revenue?.total || 0, 2)} rev | MTD: ${compactCurrency(revenue?.mtd || 0)}`,
    `📊 QBO: ${qboHealthPct}% categorized | ${reviewCount} need review`,
    `📧 ${compactCountLabel(Array.isArray(pendingEmailTasks) ? pendingEmailTasks.length : 0, "vendor email")} need response`,
    `📋 Open POs: ${openPo?.openCount || 0} orders, ${compactCurrency(openPo?.committedRevenue || 0)} committed${openPo?.overdue[0] ? ` | #${openPo.overdue[0].poNumber} overdue ${openPo.overdue[0].daysOverdue}d` : ""}`,
    `✅ Operator: ${operatorLead} overnight`,
    `⚠️ ${compactCountLabel(approvalCount, "approval")} pending${reconciliation?.ran && reconciliation.bankDifference > 5 ? ` | Bank diff ${compactCurrency(reconciliation.bankDifference, 2)}` : ""}`,
    "",
    `Reply "review" to see transactions or "emails" to see drafts.`,
  ];

  return lines.join("\n").slice(0, 500);
}

function thresholdForDays(days: number): "healthy" | "info" | "warning" | "critical" {
  if (!Number.isFinite(days) || days > 45) return "healthy";
  if (days > 30) return "info";
  if (days >= 14) return "warning";
  return "critical";
}

async function getInventoryBrief(): Promise<{
  counts: Record<"healthy" | "info" | "warning" | "critical", number>;
  watch: string[];
}> {
  const inventory = await analyzeInventory();
  const totals = inventory.filter((item) => item.channel === "total");
  const counts = {
    healthy: 0,
    info: 0,
    warning: 0,
    critical: 0,
  };

  for (const item of totals) {
    counts[thresholdForDays(item.days_until_stockout)] += 1;
  }

  const watch = totals
    .filter((item) => thresholdForDays(item.days_until_stockout) !== "healthy")
    .slice(0, 3)
    .map((item) => {
      const threshold = thresholdForDays(item.days_until_stockout);
      const icon = threshold === "critical" ? "🔴" : threshold === "warning" ? "🟡" : "⚠️";
      return `${icon} ${item.product_name}: ${item.current_stock} units, ~${Number.isFinite(item.days_until_stockout) ? item.days_until_stockout.toFixed(1) : "?"} days`;
    });

  return { counts, watch };
}

async function getVendorPaymentBrief(): Promise<{
  dueSoonCount: number;
  dueSoonAmount: number;
  overdueCount: number;
  overdueAmount: number;
}> {
  const billsData = await fetchInternalOpsJson("/api/ops/qbo/query?type=bills");
  const bills = Array.isArray((billsData || {}).bills)
    ? ((billsData || {}).bills as Array<Record<string, unknown>>)
    : [];

  let dueSoonAmount = 0;
  let overdueAmount = 0;
  let dueSoonCount = 0;
  let overdueCount = 0;

  for (const bill of bills) {
    const balance = numberValue(bill.Balance);
    if (balance <= 0) continue;
    const due = String(bill.DueDate || bill.Date || "");
    const target = new Date(`${due.slice(0, 10)}T00:00:00Z`).getTime();
    if (!Number.isFinite(target)) continue;
    const daysUntil = Math.floor((target - Date.now()) / 86400000);
    if (daysUntil < 0) {
      overdueCount += 1;
      overdueAmount += balance;
    } else if (daysUntil <= 5) {
      dueSoonCount += 1;
      dueSoonAmount += balance;
    }
  }

  return { dueSoonCount, dueSoonAmount, overdueCount, overdueAmount };
}

export async function sendMorningBrief(): Promise<void> {
  const brief = await buildCompactBenBrief();
  const holdEnabled = await readState<boolean>(MORNING_BRIEF_HOLD_KEY, true).catch(() => true);
  const benLastSeen = await readState<{ ts?: string } | null>(BEN_LAST_SEEN_KEY, null).catch(() => null);
  const lastSeenTs = benLastSeen?.ts || null;
  const benSeenRecently = lastSeenTs
    ? Number.isFinite(Date.parse(lastSeenTs)) && Date.now() - Date.parse(lastSeenTs) <= 30 * 60 * 1000
    : false;
  const benSeenToday = isSamePacificDay(lastSeenTs);

  // DM the morning brief to Ben only — not to any channel
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (holdEnabled && (!benSeenRecently || !benSeenToday)) {
    await writeState<HeldMorningBrief>(MORNING_BRIEF_HELD_KEY, {
      date: pacificDateLabel(),
      content: brief,
      held_at: new Date().toISOString(),
    }).catch(() => {});
    console.log("[morning-brief] Holding Ben brief until Ben pings Abra");
  } else if (botToken) {
    try {
      // Open DM channel with Ben
      const dmRes = await fetch("https://slack.com/api/conversations.open", {
        method: "POST",
        headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ users: BEN_SLACK_USER_ID }),
        signal: AbortSignal.timeout(5000),
      });
      const dmData = (await dmRes.json()) as { ok: boolean; channel?: { id: string } };
      if (dmData.ok && dmData.channel?.id) {
        await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: dmData.channel.id,
            text: `☀️ *Morning Brief*\n\n${brief}`,
            mrkdwn: true,
          }),
          signal: AbortSignal.timeout(10000),
        });
        console.log("[morning-brief] DM sent to Ben");
      } else {
        await notify({
          channel: "alerts",
          text: `☀️ Ben Morning Brief\n\n${brief}`,
        });
        console.warn("[morning-brief] Ben DM unavailable, posted brief to alerts channel");
      }
    } catch (err) {
      console.warn("[morning-brief] Ben DM failed:", err instanceof Error ? err.message : err);
      await notify({
        channel: "alerts",
        text: `☀️ Ben Morning Brief\n\n${brief}`,
      });
    }
  } else {
    await notify({
      channel: "alerts",
      text: "⚠️ Morning brief for Ben was not sent because SLACK_BOT_TOKEN is not configured.",
    });
  }

  // Send Rene a finance-focused DM
  try {
    await sendReneMorningDM();
  } catch (err) {
    console.warn("[morning-brief] Rene DM failed:", err instanceof Error ? err.message : err);
  }
}

async function sendReneMorningDM(): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) return;
  const brief = await buildCompactReneBrief();

  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: FINANCIALS_CHANNEL,
      text: brief,
      mrkdwn: true,
      unfurl_links: false,
    }),
    signal: AbortSignal.timeout(5000),
  });

  // Rene's finance brief goes to #financials only — no DM

  console.log("[morning-brief] Sent Rene finance brief to #financials");
}

// ── End-of-Day Summary ──────────────────────────────────────────────────
// Creates a Notion daily log page and sends a Slack summary at end of day.

export async function sendEndOfDaySummary(): Promise<void> {
  const date = new Date();
  const dateLabel = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const dateShort = date.toISOString().split("T")[0];

  const lines: string[] = [];
  const notionLines: string[] = [`# Daily Log — ${dateLabel}`, ""];

  // Revenue scorecard
  try {
    const [shopRev, amzRev, shopOrd, amzOrd] = await Promise.all([
      getMetricSnapshot("daily_revenue_shopify"),
      getMetricSnapshot("daily_revenue_amazon"),
      getMetricSnapshot("daily_orders_shopify"),
      getMetricSnapshot("daily_orders_amazon"),
    ]);
    const totalRev = Number(shopRev?.current || 0) + Number(amzRev?.current || 0);
    const totalOrd = Number(shopOrd?.current || 0) + Number(amzOrd?.current || 0);

    const revSection = [
      "## Revenue",
      `- Shopify: $${Number(shopRev?.current || 0).toFixed(2)} (${Math.round(shopOrd?.current || 0)} orders)`,
      `- Amazon: $${Number(amzRev?.current || 0).toFixed(2)} (${Math.round(amzOrd?.current || 0)} orders)`,
      `- Total: $${totalRev.toFixed(2)} (${Math.round(totalOrd)} orders)`,
      "",
    ];
    notionLines.push(...revSection);
    lines.push(`📊 Revenue: $${totalRev.toFixed(2)} (${Math.round(totalOrd)} orders) — Shopify $${Number(shopRev?.current || 0).toFixed(2)}, Amazon $${Number(amzRev?.current || 0).toFixed(2)}`);
  } catch {
    lines.push("📊 Revenue data unavailable");
    notionLines.push("## Revenue", "- Data unavailable", "");
  }

  // Signals and activity
  try {
    const signals = await getActiveSignals({ limit: 10 });
    const criticalSignals = signals.filter((s) => s.severity === "critical");
    const warningSignals = signals.filter((s) => s.severity === "warning");

    notionLines.push("## Signals");
    if (signals.length === 0) {
      notionLines.push("- No active signals", "");
    } else {
      for (const s of signals.slice(0, 10)) {
        const icon = s.severity === "critical" ? "🔴" : s.severity === "warning" ? "🟡" : "🔵";
        notionLines.push(`- ${icon} ${s.title}`);
      }
      notionLines.push("");
    }
    lines.push(`⚠️ Signals: ${criticalSignals.length} critical, ${warningSignals.length} warning, ${signals.length} total`);
  } catch {
    notionLines.push("## Signals", "- Data unavailable", "");
  }

  // Brain entries created today
  try {
    const todayEntries = await sbFetch(
      `/rest/v1/open_brain_entries?created_at=gte.${dateShort}T00:00:00Z&select=id,title,category&limit=50`,
    ) as Array<{ id: string; title?: string; category?: string }>;
    const count = Array.isArray(todayEntries) ? todayEntries.length : 0;
    notionLines.push("## Brain Activity");
    notionLines.push(`- ${count} entries created today`);
    if (count > 0) {
      const byCat: Record<string, number> = {};
      for (const e of todayEntries) {
        const cat = e.category || "other";
        byCat[cat] = (byCat[cat] || 0) + 1;
      }
      for (const [cat, n] of Object.entries(byCat)) {
        notionLines.push(`  - ${cat}: ${n}`);
      }
    }
    notionLines.push("");
    lines.push(`🧠 Brain: ${count} entries created today`);
  } catch {
    notionLines.push("## Brain Activity", "- Data unavailable", "");
  }

  // Email activity
  try {
    const todayEmails = await sbFetch(
      `/rest/v1/email_events?received_at=gte.${dateShort}T00:00:00Z&select=id,subject,category,priority,action_required&limit=50`,
    ) as Array<{ id: string; subject?: string; category?: string; priority?: string; action_required?: boolean }>;
    const emailCount = Array.isArray(todayEmails) ? todayEmails.length : 0;
    const actionRequired = todayEmails.filter((e) => e.action_required);
    notionLines.push("## Emails Processed");
    notionLines.push(`- ${emailCount} emails fetched`);
    if (actionRequired.length > 0) {
      notionLines.push(`- ${actionRequired.length} requiring action:`);
      for (const e of actionRequired.slice(0, 5)) {
        notionLines.push(`  - ${e.subject || "No subject"} (${e.priority || "normal"})`);
      }
    }
    notionLines.push("");
    lines.push(`📧 Emails: ${emailCount} processed, ${actionRequired.length} need action`);
  } catch {
    notionLines.push("## Emails Processed", "- Data unavailable", "");
  }

  // Pending items
  try {
    const [approvals, tasks] = await Promise.all([
      getPendingApprovalsCount().catch(() => 0),
      getPendingTaskCount().catch(() => 0),
    ]);
    notionLines.push("## Pending Items");
    notionLines.push(`- ${approvals} approvals pending`);
    notionLines.push(`- ${tasks} tasks open`);
    notionLines.push("");
    lines.push(`⏳ Pending: ${approvals} approvals, ${tasks} tasks`);
  } catch {
    // skip
  }

  // Create Notion page
  const meetingNotesDbId = process.env.NOTION_MEETING_NOTES_DB_ID || process.env.NOTION_MEETING_DB_ID;
  let notionUrl = "";
  if (meetingNotesDbId) {
    try {
      const pageId = await createNotionPage({
        parent_id: meetingNotesDbId,
        title: `Daily Log — ${dateLabel}`,
        content: notionLines.join("\n"),
      });
      if (pageId) {
        notionUrl = `https://notion.so/${pageId.replace(/-/g, "")}`;
      }
    } catch {
      // Notion write failed — still send Slack
    }
  }

  // Send Slack summary
  const slackText = [
    `🌙 *ABRA END-OF-DAY — ${dateLabel}*`,
    "",
    ...lines,
    "",
    notionUrl ? `📝 Full log: ${notionUrl}` : "",
    `Dashboard: ${process.env.NEXTAUTH_URL || "https://usagummies.com"}/ops`,
  ].filter(Boolean).join("\n");

  await notify({ channel: "daily", text: slackText });
}
