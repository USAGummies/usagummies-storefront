import { getMonthlySpend, getPreferredClaudeModel } from "@/lib/ops/abra-cost-tracker";
import { detectAnomalies } from "@/lib/ops/abra-anomaly-detection";
import { getActiveSignals } from "@/lib/ops/abra-operational-signals";
import { generateRevenueForecast } from "@/lib/ops/abra-forecasting";
import { analyzeInventory } from "@/lib/ops/abra-inventory-forecast";
import { detectAwaitingReplies } from "@/lib/ops/abra-email-fetch";
import { notify } from "@/lib/ops/notify";
import { createNotionPage } from "@/lib/ops/abra-notion-write";
import { readState } from "@/lib/ops/state";
import { getDailyGoalSnapshot, formatGoalSlack } from "@/lib/ops/daily-goal-tracker";

type MetricSnapshot = {
  metric: string;
  current: number;
  avg7: number;
  pctVsAvg: number;
  stale?: boolean;
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

export async function generateLLMMorningBrief(): Promise<string> {
  const payload = await generateMorningBriefPayload();
  const date = new Date();
  const dateLabel = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

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

  try {
    const model = await getPreferredClaudeModel(
      process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    );

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
            content: `Generate the morning brief for ${dateLabel}.\n\nOperational data:\n${JSON.stringify(payload, null, 2)}`,
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

export async function sendMorningBrief(): Promise<void> {
  const brief = await generateLLMMorningBrief();
  await notify({ channel: "daily", text: brief });
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
