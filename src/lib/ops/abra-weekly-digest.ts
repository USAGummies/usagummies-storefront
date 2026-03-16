import { getAccuracyReport } from "@/lib/ops/abra-truth-benchmark";
import { getActiveSignals } from "@/lib/ops/abra-operational-signals";
import {
  extractClaudeUsage,
  getPreferredClaudeModel,
  getMonthlySpend,
  getSpendByDepartment,
  getSpendByModel,
  logAICost,
} from "@/lib/ops/abra-cost-tracker";
import { generateRevenueForecast } from "@/lib/ops/abra-forecasting";
import { analyzePipeline } from "@/lib/ops/abra-pipeline-intelligence";
import { generateAttributionReport } from "@/lib/ops/abra-attribution";
import { analyzeInventory } from "@/lib/ops/abra-inventory-forecast";
import { getSystemHealth } from "@/lib/ops/abra-health-monitor";
import { recordKPI } from "@/lib/ops/abra-kpi-recorder";
import { notify } from "@/lib/ops/notify";
import { sendOpsEmail } from "@/lib/ops/email";

const DEPARTMENTS = [
  "executive",
  "operations",
  "finance",
  "sales_and_growth",
  "supply_chain",
] as const;

type DepartmentDigest = {
  department: string;
  activeInitiatives: number;
  statusCounts: Record<string, number>;
  openQuestions: number;
  kpiHighlight: string | null;
  weeklySpend: number;
};

type Initiative30DaySummary = {
  department: string;
  started: number;
  completed: number;
};

export type WeeklyDigestPreview = {
  generated_at: string;
  feed_data_available: boolean;
  fallback_message: string | null;
  comparisons: {
    revenue_total: { this_week: number; last_week: number; wow_pct: number };
    orders_total: { this_week: number; last_week: number; wow_pct: number };
    sessions_total: { this_week: number; last_week: number; wow_pct: number };
    aov: { this_week: number; last_week: number; wow_pct: number };
  };
  channels: {
    shopify_revenue: { this_week: number; last_week: number; wow_pct: number };
    amazon_revenue: { this_week: number; last_week: number; wow_pct: number };
  };
  active_initiatives: {
    total: number;
    by_department: Record<string, number>;
  };
  open_action_items: {
    pending_approvals: number;
    pending_tasks: number;
    total_open: number;
  };
  signals: {
    count: number;
    severity_counts: { critical: number; warning: number; info: number };
  };
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}) {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase not configured");

  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  headers.set("Content-Type", "application/json");

  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(10000),
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

function usd(value: number): string {
  return `$${Number(value || 0).toFixed(2)}`;
}

function sumCosts(rows: Array<{ estimated_cost_usd?: number }>): number {
  return Math.round(
    rows.reduce((sum, row) => sum + Number(row.estimated_cost_usd || 0), 0) * 100,
  ) / 100;
}

function lookbackIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

async function getDepartmentDigest(
  department: string,
  sinceIso: string,
): Promise<DepartmentDigest> {
  const [initiativesRes, questionsRes, kpiRes, costRes] = await Promise.allSettled([
    sbFetch(
      `/rest/v1/abra_initiatives?department=eq.${department}&status=not.in.(completed,paused)&select=status&limit=200`,
    ),
    sbFetch(
      `/rest/v1/abra_unanswered_questions?department=eq.${department}&answered=eq.false&select=id&limit=200`,
    ),
    sbFetch(
      `/rest/v1/open_brain_entries?department=eq.${department}&entry_type=eq.kpi&select=title,summary_text,created_at&order=created_at.desc&limit=1`,
    ),
    sbFetch(
      `/rest/v1/abra_cost_log?department=eq.${department}&created_at=gte.${encodeURIComponent(sinceIso)}&select=estimated_cost_usd&limit=1000`,
    ),
  ]);

  const initiatives = initiativesRes.status === "fulfilled" && Array.isArray(initiativesRes.value)
    ? (initiativesRes.value as Array<{ status?: string }>)
    : [];
  const questions = questionsRes.status === "fulfilled" && Array.isArray(questionsRes.value)
    ? questionsRes.value
    : [];
  const kpis = kpiRes.status === "fulfilled" && Array.isArray(kpiRes.value)
    ? (kpiRes.value as Array<{ title?: string; summary_text?: string }>)
    : [];
  const costRows = costRes.status === "fulfilled" && Array.isArray(costRes.value)
    ? (costRes.value as Array<{ estimated_cost_usd?: number }>)
    : [];

  const statusCounts: Record<string, number> = {};
  for (const row of initiatives) {
    const status = (row.status || "unknown").toString();
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  const kpiHighlight = kpis[0]
    ? [kpis[0].title || "KPI update", kpis[0].summary_text || ""]
        .filter(Boolean)
        .join(" — ")
        .slice(0, 180)
    : null;

  return {
    department,
    activeInitiatives: initiatives.length,
    statusCounts,
    openQuestions: questions.length,
    kpiHighlight,
    weeklySpend: sumCosts(costRows),
  };
}

async function getMeetingCount(sinceIso: string): Promise<number> {
  try {
    const rows = (await sbFetch(
      `/rest/v1/abra_sessions?started_at=gte.${encodeURIComponent(sinceIso)}&select=id&limit=1000`,
    )) as Array<{ id: string }>;
    return Array.isArray(rows) ? rows.length : 0;
  } catch {
    return 0;
  }
}

async function getInitiative30DaySummary(
  department: string,
  sinceIso: string,
): Promise<Initiative30DaySummary> {
  const [startedRes, completedRes] = await Promise.allSettled([
    sbFetch(
      `/rest/v1/abra_initiatives?department=eq.${department}&created_at=gte.${encodeURIComponent(sinceIso)}&select=id&limit=1000`,
    ),
    sbFetch(
      `/rest/v1/abra_initiatives?department=eq.${department}&status=eq.completed&updated_at=gte.${encodeURIComponent(sinceIso)}&select=id&limit=1000`,
    ),
  ]);

  const startedRows = startedRes.status === "fulfilled" && Array.isArray(startedRes.value)
    ? startedRes.value
    : [];
  const completedRows = completedRes.status === "fulfilled" && Array.isArray(completedRes.value)
    ? completedRes.value
    : [];

  return {
    department,
    started: startedRows.length,
    completed: completedRows.length,
  };
}

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function sumMetricWindow(
  metricName: string,
  startDaysAgo: number,
  endDaysAgo: number,
): Promise<number> {
  const start = isoDateDaysAgo(startDaysAgo);
  const end = isoDateDaysAgo(endDaysAgo);
  try {
    const rows = (await sbFetch(
      `/rest/v1/kpi_timeseries?metric_name=eq.${encodeURIComponent(metricName)}&window_type=eq.daily&captured_for_date=gte.${start}&captured_for_date=lt.${end}&select=value&limit=5000`,
    )) as Array<{ value?: number | string }>;
    return rows.reduce((sum, row) => sum + Number(row.value || 0), 0);
  } catch {
    return 0;
  }
}

function safePctDelta(current: number, base: number): number {
  if (!base) return 0;
  return ((current - base) / Math.abs(base)) * 100;
}

async function getOpenActionItemsSummary(): Promise<{
  pending_approvals: number;
  pending_tasks: number;
  total_open: number;
}> {
  const [approvalRows, abrTasks, legacyTasks] = await Promise.allSettled([
    sbFetch("/rest/v1/approvals?status=eq.pending&select=id&limit=1000") as Promise<
      Array<{ id: string }>
    >,
    sbFetch("/rest/v1/abra_tasks?status=in.(pending,in_progress)&select=id&limit=1000") as Promise<
      Array<{ id: string }>
    >,
    sbFetch("/rest/v1/tasks?status=in.(pending,in_progress)&select=id&limit=1000") as Promise<
      Array<{ id: string }>
    >,
  ]);

  const pendingApprovals =
    approvalRows.status === "fulfilled" && Array.isArray(approvalRows.value)
      ? approvalRows.value.length
      : 0;
  const pendingTasksA =
    abrTasks.status === "fulfilled" && Array.isArray(abrTasks.value)
      ? abrTasks.value.length
      : 0;
  const pendingTasksB =
    legacyTasks.status === "fulfilled" && Array.isArray(legacyTasks.value)
      ? legacyTasks.value.length
      : 0;
  const pendingTasks = pendingTasksA + pendingTasksB;
  return {
    pending_approvals: pendingApprovals,
    pending_tasks: pendingTasks,
    total_open: pendingApprovals + pendingTasks,
  };
}

async function getActiveInitiativesSummary(): Promise<{
  total: number;
  by_department: Record<string, number>;
}> {
  const rows = (await sbFetch(
    "/rest/v1/abra_initiatives?status=not.in.(completed,paused)&select=department&limit=1000",
  )) as Array<{ department?: string | null }>;
  const byDepartment: Record<string, number> = {};
  for (const row of rows || []) {
    const department = (row?.department || "unknown").toString();
    byDepartment[department] = (byDepartment[department] || 0) + 1;
  }
  return {
    total: Array.isArray(rows) ? rows.length : 0,
    by_department: byDepartment,
  };
}

export async function generateWeeklyDigestPreview(): Promise<WeeklyDigestPreview> {
  const [
    thisWeekRevenueShopify,
    lastWeekRevenueShopify,
    thisWeekRevenueAmazon,
    lastWeekRevenueAmazon,
    thisWeekOrdersShopify,
    lastWeekOrdersShopify,
    thisWeekOrdersAmazon,
    lastWeekOrdersAmazon,
    thisWeekSessions,
    lastWeekSessions,
    activeSignals,
    activeInitiatives,
    openActionItems,
  ] = await Promise.all([
    sumMetricWindow("daily_revenue_shopify", 7, 0),
    sumMetricWindow("daily_revenue_shopify", 14, 7),
    sumMetricWindow("daily_revenue_amazon", 7, 0),
    sumMetricWindow("daily_revenue_amazon", 14, 7),
    sumMetricWindow("daily_orders_shopify", 7, 0),
    sumMetricWindow("daily_orders_shopify", 14, 7),
    sumMetricWindow("daily_orders_amazon", 7, 0),
    sumMetricWindow("daily_orders_amazon", 14, 7),
    sumMetricWindow("daily_sessions", 7, 0),
    sumMetricWindow("daily_sessions", 14, 7),
    getActiveSignals({ limit: 200 }).catch(() => []),
    getActiveInitiativesSummary().catch(() => ({ total: 0, by_department: {} })),
    getOpenActionItemsSummary().catch(() => ({
      pending_approvals: 0,
      pending_tasks: 0,
      total_open: 0,
    })),
  ]);

  const totalThisWeekRevenue = thisWeekRevenueShopify + thisWeekRevenueAmazon;
  const totalLastWeekRevenue = lastWeekRevenueShopify + lastWeekRevenueAmazon;
  const totalThisWeekOrders = thisWeekOrdersShopify + thisWeekOrdersAmazon;
  const totalLastWeekOrders = lastWeekOrdersShopify + lastWeekOrdersAmazon;
  const aovThisWeek =
    totalThisWeekOrders > 0 ? totalThisWeekRevenue / totalThisWeekOrders : 0;
  const aovLastWeek =
    totalLastWeekOrders > 0 ? totalLastWeekRevenue / totalLastWeekOrders : 0;

  const hasFeedData =
    totalThisWeekRevenue > 0 ||
    totalThisWeekOrders > 0 ||
    thisWeekSessions > 0;

  const severityCounts = {
    critical: activeSignals.filter((signal) => signal.severity === "critical").length,
    warning: activeSignals.filter((signal) => signal.severity === "warning").length,
    info: activeSignals.filter((signal) => signal.severity === "info").length,
  };

  return {
    generated_at: new Date().toISOString(),
    feed_data_available: hasFeedData,
    fallback_message: hasFeedData
      ? null
      : "No feed data available yet — run feeds first.",
    comparisons: {
      revenue_total: {
        this_week: totalThisWeekRevenue,
        last_week: totalLastWeekRevenue,
        wow_pct: safePctDelta(totalThisWeekRevenue, totalLastWeekRevenue),
      },
      orders_total: {
        this_week: totalThisWeekOrders,
        last_week: totalLastWeekOrders,
        wow_pct: safePctDelta(totalThisWeekOrders, totalLastWeekOrders),
      },
      sessions_total: {
        this_week: thisWeekSessions,
        last_week: lastWeekSessions,
        wow_pct: safePctDelta(thisWeekSessions, lastWeekSessions),
      },
      aov: {
        this_week: aovThisWeek,
        last_week: aovLastWeek,
        wow_pct: safePctDelta(aovThisWeek, aovLastWeek),
      },
    },
    channels: {
      shopify_revenue: {
        this_week: thisWeekRevenueShopify,
        last_week: lastWeekRevenueShopify,
        wow_pct: safePctDelta(thisWeekRevenueShopify, lastWeekRevenueShopify),
      },
      amazon_revenue: {
        this_week: thisWeekRevenueAmazon,
        last_week: lastWeekRevenueAmazon,
        wow_pct: safePctDelta(thisWeekRevenueAmazon, lastWeekRevenueAmazon),
      },
    },
    active_initiatives: activeInitiatives,
    open_action_items: openActionItems,
    signals: {
      count: activeSignals.length,
      severity_counts: severityCounts,
    },
  };
}

async function runClaudeDigestText(
  prompt: string,
  endpoint: "digest/weekly-summary" | "digest/weekly-priorities",
): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return "Claude summary unavailable (missing ANTHROPIC_API_KEY).";
  const model = await getPreferredClaudeModel(
    process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
  );

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: endpoint === "digest/weekly-summary" ? 250 : 450,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }
  if (!res.ok) {
    return `Claude output unavailable (${res.status}).`;
  }

  const usage = extractClaudeUsage(payload);
  if (usage) {
    void logAICost({
      model,
      provider: "anthropic",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      endpoint,
      department: "executive",
    });
  }

  const content = Array.isArray(payload.content)
    ? payload.content
    : [];
  const out = content
    .map((item) =>
      item && typeof item === "object" && "text" in item
        ? String(item.text || "")
        : "",
    )
    .join("\n")
    .trim();
  return out || "No summary generated.";
}

export async function generateWeeklyDigest(): Promise<string> {
  const weekLabel = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const [
    thisWeekRevenueShopify,
    lastWeekRevenueShopify,
    fourWeekAvgRevenueShopify,
    thisWeekRevenueAmazon,
    lastWeekRevenueAmazon,
    fourWeekAvgRevenueAmazon,
    thisWeekOrdersShopify,
    lastWeekOrdersShopify,
    fourWeekAvgOrdersShopify,
    thisWeekOrdersAmazon,
    lastWeekOrdersAmazon,
    fourWeekAvgOrdersAmazon,
    thisWeekSessions,
    lastWeekSessions,
    fourWeekAvgSessions,
  ] = await Promise.all([
    sumMetricWindow("daily_revenue_shopify", 7, 0),
    sumMetricWindow("daily_revenue_shopify", 14, 7),
    sumMetricWindow("daily_revenue_shopify", 35, 7).then((value) => value / 4),
    sumMetricWindow("daily_revenue_amazon", 7, 0),
    sumMetricWindow("daily_revenue_amazon", 14, 7),
    sumMetricWindow("daily_revenue_amazon", 35, 7).then((value) => value / 4),
    sumMetricWindow("daily_orders_shopify", 7, 0),
    sumMetricWindow("daily_orders_shopify", 14, 7),
    sumMetricWindow("daily_orders_shopify", 35, 7).then((value) => value / 4),
    sumMetricWindow("daily_orders_amazon", 7, 0),
    sumMetricWindow("daily_orders_amazon", 14, 7),
    sumMetricWindow("daily_orders_amazon", 35, 7).then((value) => value / 4),
    sumMetricWindow("daily_sessions", 7, 0),
    sumMetricWindow("daily_sessions", 14, 7),
    sumMetricWindow("daily_sessions", 35, 7).then((value) => value / 4),
  ]);

  const [attribution, forecasts, pipeline, inventory, activeSignals, health, spend] =
    await Promise.all([
      generateAttributionReport(),
      generateRevenueForecast({ days_ahead: 7 }),
      analyzePipeline(),
      analyzeInventory(),
      getActiveSignals({ limit: 200 }),
      getSystemHealth(),
      getMonthlySpend(),
    ]);

  const totalThisWeekRevenue = thisWeekRevenueShopify + thisWeekRevenueAmazon;
  const totalLastWeekRevenue = lastWeekRevenueShopify + lastWeekRevenueAmazon;
  const totalFourWeekAvgRevenue = fourWeekAvgRevenueShopify + fourWeekAvgRevenueAmazon;
  const totalThisWeekOrders = thisWeekOrdersShopify + thisWeekOrdersAmazon;
  const totalLastWeekOrders = lastWeekOrdersShopify + lastWeekOrdersAmazon;
  const totalFourWeekAvgOrders = fourWeekAvgOrdersShopify + fourWeekAvgOrdersAmazon;
  const aovThisWeek =
    totalThisWeekOrders > 0 ? totalThisWeekRevenue / totalThisWeekOrders : 0;
  const aovLastWeek =
    totalLastWeekOrders > 0 ? totalLastWeekRevenue / totalLastWeekOrders : 0;
  const aovFourWeekAvg =
    totalFourWeekAvgOrders > 0 ? totalFourWeekAvgRevenue / totalFourWeekAvgOrders : 0;

  const forecastTotal = forecasts.find((item) => item.channel === "total");
  const forecast7dRevenue = (forecastTotal?.points || []).reduce(
    (sum, point) => sum + point.predicted,
    0,
  );
  const inventoryWatch = inventory
    .filter((item) => item.channel === "total" && item.urgency !== "ok")
    .slice(0, 5);

  // Runtime data blocks for prompt injection
  const revenueData = JSON.stringify({
    this_week: totalThisWeekRevenue,
    last_week: totalLastWeekRevenue,
    delta_pct: safePctDelta(totalThisWeekRevenue, totalLastWeekRevenue),
  });
  const pipelineData = JSON.stringify({
    total_pipeline_value: pipeline.total_pipeline_value,
    at_risk_count: pipeline.at_risk_deals.length,
    win_rate_30d: pipeline.win_rate_30d,
  });
  const signalsData = JSON.stringify(
    activeSignals.slice(0, 8).map((signal) => ({
      severity: signal.severity,
      title: signal.title,
    })),
  );
  const inventoryData = JSON.stringify(
    inventoryWatch.map((item) => ({
      sku: item.sku,
      urgency: item.urgency,
      days_until_stockout: item.days_until_stockout,
    })),
  );
  const revenueSummaryData = JSON.stringify({
    total_this_week: totalThisWeekRevenue,
    total_last_week: totalLastWeekRevenue,
    sessions_this_week: thisWeekSessions,
    sessions_last_week: lastWeekSessions,
  });
  const attributionData = JSON.stringify(attribution.channels);
  const forecastData = JSON.stringify({
    trend: forecastTotal?.trend || "flat",
    growth_rate_pct: forecastTotal?.growth_rate_pct || 0,
    projected_7d: forecast7dRevenue,
  });
  const fullPipelineData = JSON.stringify(pipeline);
  const fullInventoryData = JSON.stringify(inventoryWatch);
  const healthData = JSON.stringify({
    active_feeds: health.feeds.active,
    disabled_feeds: health.feeds.disabled,
    unresolved_dead_letters: health.feeds.unresolved_dead_letters,
    down_integrations: health.uptime.down,
  });
  const spendData = JSON.stringify(spend);

  let summaryPrompt = [
    "Given the following weekly business data for USA Gummies (DTC gummy vitamin brand),",
    "write a 3-sentence executive summary highlighting the most important trends and risks:",
    `Revenue: ${revenueData}`,
    `Pipeline: ${pipelineData}`,
    `Signals: ${signalsData}`,
    `Inventory: ${inventoryData}`,
  ].join("\n");

  let prioritiesPrompt = [
    "You are Abra, operations strategist for USA Gummies.",
    "Given this weekly snapshot, return 3-5 priorities for this week as a numbered list.",
    "Each item must include a short rationale after a dash.",
    `Revenue summary: ${revenueSummaryData}`,
    `Attribution: ${attributionData}`,
    `Forecast: ${forecastData}`,
    `Pipeline: ${fullPipelineData}`,
    `Inventory: ${fullInventoryData}`,
    `Signals: ${signalsData}`,
    `Health: ${healthData}`,
    `AI spend: ${spendData}`,
  ].join("\n");

  // --- Versioned prompt loading (auto-research) ---
  try {
    const { getActivePrompt } = await import("@/lib/ops/auto-research-runner");
    const versioned = await getActivePrompt("weekly_digest");
    if (versioned?.prompt_text) {
      const replacePlaceholders = (template: string) =>
        template
          .replace(/\{\{?REVENUE_DATA\}?\}/g, revenueData)
          .replace(/\{\{?PIPELINE_DATA\}?\}/g, pipelineData)
          .replace(/\{\{?SIGNALS_DATA\}?\}/g, signalsData)
          .replace(/\{\{?INVENTORY_DATA\}?\}/g, inventoryData)
          .replace(/\{\{?REVENUE_SUMMARY_DATA\}?\}/g, revenueSummaryData)
          .replace(/\{\{?ATTRIBUTION_DATA\}?\}/g, attributionData)
          .replace(/\{\{?FORECAST_DATA\}?\}/g, forecastData)
          .replace(/\{\{?FULL_PIPELINE_DATA\}?\}/g, fullPipelineData)
          .replace(/\{\{?FULL_INVENTORY_DATA\}?\}/g, fullInventoryData)
          .replace(/\{\{?HEALTH_DATA\}?\}/g, healthData)
          .replace(/\{\{?SPEND_DATA\}?\}/g, spendData);

      // The versioned prompt may contain both summary and priorities sections
      // separated by "---PRIORITIES---"
      const parts = versioned.prompt_text.split(/---PRIORITIES---/i);
      if (parts.length >= 2) {
        summaryPrompt = replacePlaceholders(parts[0].trim());
        prioritiesPrompt = replacePlaceholders(parts[1].trim());
      } else {
        // Single prompt — apply to summary only
        summaryPrompt = replacePlaceholders(versioned.prompt_text);
      }
    }
  } catch {
    // Fallback to hardcoded prompts above
  }

  const executiveSummary = await runClaudeDigestText(
    summaryPrompt,
    "digest/weekly-summary",
  );
  const prioritiesText = await runClaudeDigestText(
    prioritiesPrompt,
    "digest/weekly-priorities",
  );

  const severityCounts = {
    critical: activeSignals.filter((signal) => signal.severity === "critical").length,
    warning: activeSignals.filter((signal) => signal.severity === "warning").length,
    info: activeSignals.filter((signal) => signal.severity === "info").length,
  };

  const lines: string[] = [];
  lines.push(`📊 *WEEKLY STRATEGY SESSION — Week of ${weekLabel}*`);
  lines.push("");
  lines.push("## Executive Summary");
  lines.push(executiveSummary);
  lines.push("");
  lines.push("## Performance Scorecard");
  lines.push("| Metric | This Week | Last Week | 4-Week Avg | vs Last Week |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  lines.push(
    `| Revenue (Shopify) | ${usd(thisWeekRevenueShopify)} | ${usd(lastWeekRevenueShopify)} | ${usd(fourWeekAvgRevenueShopify)} | ${safePctDelta(thisWeekRevenueShopify, lastWeekRevenueShopify).toFixed(1)}% |`,
  );
  lines.push(
    `| Revenue (Amazon) | ${usd(thisWeekRevenueAmazon)} | ${usd(lastWeekRevenueAmazon)} | ${usd(fourWeekAvgRevenueAmazon)} | ${safePctDelta(thisWeekRevenueAmazon, lastWeekRevenueAmazon).toFixed(1)}% |`,
  );
  lines.push(
    `| Revenue (Total) | ${usd(totalThisWeekRevenue)} | ${usd(totalLastWeekRevenue)} | ${usd(totalFourWeekAvgRevenue)} | ${safePctDelta(totalThisWeekRevenue, totalLastWeekRevenue).toFixed(1)}% |`,
  );
  lines.push(
    `| Orders (Shopify) | ${Math.round(thisWeekOrdersShopify)} | ${Math.round(lastWeekOrdersShopify)} | ${Math.round(fourWeekAvgOrdersShopify)} | ${safePctDelta(thisWeekOrdersShopify, lastWeekOrdersShopify).toFixed(1)}% |`,
  );
  lines.push(
    `| Orders (Amazon) | ${Math.round(thisWeekOrdersAmazon)} | ${Math.round(lastWeekOrdersAmazon)} | ${Math.round(fourWeekAvgOrdersAmazon)} | ${safePctDelta(thisWeekOrdersAmazon, lastWeekOrdersAmazon).toFixed(1)}% |`,
  );
  lines.push(
    `| Orders (Total) | ${Math.round(totalThisWeekOrders)} | ${Math.round(totalLastWeekOrders)} | ${Math.round(totalFourWeekAvgOrders)} | ${safePctDelta(totalThisWeekOrders, totalLastWeekOrders).toFixed(1)}% |`,
  );
  lines.push(
    `| AOV | ${usd(aovThisWeek)} | ${usd(aovLastWeek)} | ${usd(aovFourWeekAvg)} | ${safePctDelta(aovThisWeek, aovLastWeek).toFixed(1)}% |`,
  );
  lines.push(
    `| Sessions | ${Math.round(thisWeekSessions)} | ${Math.round(lastWeekSessions)} | ${Math.round(fourWeekAvgSessions)} | ${safePctDelta(thisWeekSessions, lastWeekSessions).toFixed(1)}% |`,
  );
  lines.push("");
  lines.push("## Channel Attribution");
  lines.push(
    `Revenue split (30d): ${attribution.channels
      .map((channel) => `${channel.channel}: ${usd(channel.revenue_30d)}`)
      .join(" | ")}`,
  );
  const sortedChannels = [...attribution.channels].sort(
    (a, b) => b.revenue_30d - a.revenue_30d,
  );
  lines.push(
    `Top channel: ${sortedChannels[0]?.channel || "n/a"} (${usd(sortedChannels[0]?.revenue_30d || 0)}).`,
  );
  const channelGrowth = [
    {
      channel: "shopify_dtc",
      growth_pct: safePctDelta(thisWeekRevenueShopify, lastWeekRevenueShopify),
    },
    {
      channel: "amazon_fba",
      growth_pct: safePctDelta(thisWeekRevenueAmazon, lastWeekRevenueAmazon),
    },
  ].sort((a, b) => b.growth_pct - a.growth_pct);
  lines.push(
    `Fastest-growing channel: ${channelGrowth[0]?.channel || "n/a"} (${(channelGrowth[0]?.growth_pct || 0).toFixed(1)}% WoW).`,
  );
  lines.push("");
  lines.push("## Revenue Forecast");
  lines.push(
    `Next 7-day projection: ${usd(forecast7dRevenue)}. Trend: ${forecastTotal?.trend || "flat"} (${forecastTotal?.growth_rate_pct?.toFixed(1) || "0.0"}% annualized).`,
  );
  lines.push("");
  lines.push("## Pipeline Update");
  lines.push(
    `Total pipeline value: ${usd(pipeline.total_pipeline_value)} | Win rate (30d): ${pipeline.win_rate_30d.toFixed(1)}% | Avg cycle: ${pipeline.avg_deal_cycle_days.toFixed(1)} days`,
  );
  lines.push(
    `Deals by stage: ${Object.entries(pipeline.deals_by_stage)
      .map(([stage, data]) => `${stage}: ${data.count} (${usd(data.value)})`)
      .join(" | ")}`,
  );
  for (const deal of pipeline.at_risk_deals.slice(0, 3)) {
    lines.push(
      `- At-risk: ${deal.company_name} (${deal.stage}, ${deal.days_in_stage}d) — ${deal.recommended_action}`,
    );
  }
  lines.push("");
  lines.push("## Inventory Watch");
  if (inventoryWatch.length === 0) {
    lines.push("- No critical inventory risks this week.");
  } else {
    for (const item of inventoryWatch.slice(0, 5)) {
      lines.push(
        `- ${item.urgency.toUpperCase()}: ${item.product_name} (${item.sku}) — ${item.current_stock} units, ${Number.isFinite(item.days_until_stockout) ? `${item.days_until_stockout}d` : "unknown"} to stockout; reorder ${Math.ceil(item.suggested_reorder_qty)}.`,
      );
    }
  }
  lines.push("");
  lines.push("## Unresolved Signals");
  lines.push(
    `Counts — critical: ${severityCounts.critical}, warning: ${severityCounts.warning}, info: ${severityCounts.info}`,
  );
  for (const signal of activeSignals.slice(0, 5)) {
    lines.push(`- [${signal.severity}] ${signal.title}`);
  }
  lines.push("");
  lines.push("## System Health");
  lines.push(
    `Integrations: healthy ${health.uptime.healthy}, degraded ${health.uptime.degraded}, down ${health.uptime.down}.`,
  );
  lines.push(
    `Feeds: active ${health.feeds.active}/${health.feeds.total_feeds}, disabled ${health.feeds.disabled}, dead letters ${health.feeds.unresolved_dead_letters}.`,
  );
  lines.push("");
  lines.push("## AI Budget");
  const dayOfMonth = new Date().getUTCDate();
  const daysInMonth = new Date(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth() + 1,
    0,
  ).getUTCDate();
  const projectedMonthEnd = dayOfMonth > 0 ? (spend.total / dayOfMonth) * daysInMonth : spend.total;
  lines.push(
    `Month-to-date spend: ${usd(spend.total)} / ${usd(spend.budget)} (${spend.pctUsed.toFixed(1)}%). Projected month-end: ${usd(projectedMonthEnd)}.`,
  );
  lines.push("");
  lines.push("## Recommended Priorities for This Week");
  lines.push(prioritiesText);
  lines.push("");
  lines.push("Generated by Abra | Reply `/abra <question>` for details");
  return lines.join("\n");
}

export async function sendWeeklyDigest(): Promise<void> {
  const digest = await generateWeeklyDigest();
  await notify({ channel: "daily", text: digest });

  const today = new Date().toISOString().slice(0, 10);
  try {
    await sbFetch("/rest/v1/open_brain_entries", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_type: "agent",
        source_ref: "weekly-digest",
        entry_type: "report",
        title: `Weekly Strategy Session — ${today}`,
        raw_text: digest,
        summary_text: digest.slice(0, 500),
        category: "report",
        department: "executive",
        confidence: "high",
        priority: "important",
        processed: true,
      }),
    });
  } catch {
    // best-effort persistence
  }

  try {
    await recordKPI({
      metric_name: "weekly_digest_generated",
      value: 1,
      department: "executive",
      source_system: "calculated",
      metric_group: "operations",
    });
  } catch {
    // best-effort KPI record
  }
}

export async function generateMonthlyReport(): Promise<string> {
  const sinceIso = lookbackIso(30);
  const monthLabel = new Date().toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const [deptRows, initiativeSummary, accuracy, monthlySpend, byModel, byDepartment, meetings] =
    await Promise.all([
      Promise.all(DEPARTMENTS.map((department) => getDepartmentDigest(department, sinceIso))),
      Promise.all(DEPARTMENTS.map((department) => getInitiative30DaySummary(department, sinceIso))),
      getAccuracyReport(30),
      getMonthlySpend(),
      getSpendByModel(),
      getSpendByDepartment(),
      getMeetingCount(sinceIso),
    ]);

  const initiativeRows = initiativeSummary
    .map((row) => `<tr><td>${row.department}</td><td>${row.started}</td><td>${row.completed}</td></tr>`)
    .join("");

  const modelRows = Object.entries(byModel)
    .map(([model, cost]) => `<tr><td>${model}</td><td>${usd(cost)}</td></tr>`)
    .join("");

  const deptCostRows = Object.entries(byDepartment)
    .map(([department, cost]) => `<tr><td>${department}</td><td>${usd(cost)}</td></tr>`)
    .join("");

  const deptSummaryRows = deptRows
    .map(
      (row) =>
        `<tr><td>${row.department}</td><td>${row.activeInitiatives}</td><td>${row.openQuestions}</td><td>${usd(row.weeklySpend)}</td></tr>`,
    )
    .join("");

  const trendText = accuracy.trends.correctionRateImproving
    ? "Improving"
    : "Declining";

  return `
    <h2>Abra Monthly Report — ${monthLabel}</h2>
    <p><strong>AI Spend:</strong> ${usd(monthlySpend.total)} / ${usd(monthlySpend.budget)} (${monthlySpend.pctUsed}% used)</p>
    <p><strong>Accuracy (30d):</strong> ${accuracy.overall.totalAnswers} answers, ${accuracy.overall.correctionRate}% correction rate (${trendText})</p>
    <p><strong>Meetings (30d):</strong> ${meetings}</p>

    <h3>Department Snapshot</h3>
    <table border="1" cellpadding="6" cellspacing="0">
      <thead><tr><th>Department</th><th>Active Initiatives</th><th>Open Questions</th><th>30d AI Spend</th></tr></thead>
      <tbody>${deptSummaryRows}</tbody>
    </table>

    <h3>Initiative Progress (30d)</h3>
    <table border="1" cellpadding="6" cellspacing="0">
      <thead><tr><th>Department</th><th>Started</th><th>Completed</th></tr></thead>
      <tbody>${initiativeRows}</tbody>
    </table>

    <h3>Cost Breakdown by Model</h3>
    <table border="1" cellpadding="6" cellspacing="0">
      <thead><tr><th>Model</th><th>Cost</th></tr></thead>
      <tbody>${modelRows || "<tr><td colspan=\"2\">No usage</td></tr>"}</tbody>
    </table>

    <h3>Cost Breakdown by Department</h3>
    <table border="1" cellpadding="6" cellspacing="0">
      <thead><tr><th>Department</th><th>Cost</th></tr></thead>
      <tbody>${deptCostRows || "<tr><td colspan=\"2\">No usage</td></tr>"}</tbody>
    </table>
  `.trim();
}

export async function sendMonthlyReport(): Promise<void> {
  const html = await generateMonthlyReport();
  const monthLabel = new Date().toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  await sendOpsEmail({
    to: "ben@usagummies.com",
    subject: `Abra Monthly Report — ${monthLabel}`,
    body: html,
    allowRepeat: true,
  });

  const approxTokens = Math.max(400, Math.round(html.length / 4));
  void logAICost({
    model: "claude-3-5-haiku-latest",
    provider: "anthropic",
    inputTokens: approxTokens,
    outputTokens: 0,
    endpoint: "digest/monthly",
    department: "executive",
  });
}
