/**
 * Proactive Alerts System — B2 build.
 *
 * Monitors key business metrics and proactively alerts Ben via Slack
 * when something needs attention, without him having to ask.
 *
 * Checks:
 *   - Revenue drop vs 7-day average (>30% below)
 *   - Approval backlog (>10 pending or any >6h old)
 *   - No Shopify orders today (after 2pm ET)
 *   - Agent failure spike (>3 failures in last hour)
 *   - Cash flow warning (projected negative within 30 days)
 *
 * Deduplication via Vercel KV state to prevent alert fatigue.
 */

import { readState, writeState } from "@/lib/ops/state";
import { notify } from "@/lib/ops/notify";
import { getRecentErrors, type TrackedError } from "@/lib/ops/error-tracker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProactiveAlertType =
  | "revenue_drop"
  | "stalled_deal"
  | "approval_backlog"
  | "inventory_low"
  | "agent_failure_spike"
  | "cash_flow_warning"
  | "no_orders_today";

export type ProactiveAlertSeverity = "critical" | "warning" | "info";

export type ProactiveAlert = {
  id: string;
  type: ProactiveAlertType;
  severity: ProactiveAlertSeverity;
  title: string;
  message: string;
  data: Record<string, unknown>;
  dedupKey: string;
  dedupTtlHours: number;
};

export type ProactiveScanResult = {
  alerts: ProactiveAlert[];
  sent: number;
  suppressed: number;
};

type DedupMap = Record<string, number>; // dedupKey → timestamp ms
type SignalPostState = Record<string, number>;
const SIGNAL_POST_STATE_KEY = "abra:signal_posts" as never;

// ---------------------------------------------------------------------------
// Supabase helpers (matches codebase convention — raw fetch, no SDK)
// ---------------------------------------------------------------------------

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const env = getSupabaseEnv();
  if (!env) return null;

  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");

  try {
    const res = await fetch(`${env.baseUrl}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: init.signal || AbortSignal.timeout(10_000),
    });

    if (!res.ok) return null;
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Shopify Admin helpers
// ---------------------------------------------------------------------------

async function fetchShopifyOrdersForDate(dateStr: string): Promise<{
  revenue: number;
  orderCount: number;
}> {
  try {
    const { adminRequest } = await import("@/lib/shopify/admin");
    const query = /* GraphQL */ `
      query OrdersByDate($query: String!) {
        orders(first: 250, query: $query) {
          edges {
            node {
              id
              totalPriceSet {
                shopMoney {
                  amount
                }
              }
            }
          }
        }
      }
    `;

    const result = await adminRequest<{
      orders: {
        edges: Array<{
          node: {
            id: string;
            totalPriceSet: { shopMoney: { amount: string } };
          };
        }>;
      };
    }>(query, {
      query: `created_at:>='${dateStr}T00:00:00Z' AND created_at:<='${dateStr}T23:59:59Z'`,
    });

    if (!result.ok || !result.data) {
      return { revenue: 0, orderCount: 0 };
    }

    const edges = result.data.orders?.edges || [];
    const revenue = edges.reduce(
      (sum, edge) =>
        sum + parseFloat(edge.node.totalPriceSet?.shopMoney?.amount || "0"),
      0,
    );

    return {
      revenue: Math.round(revenue * 100) / 100,
      orderCount: edges.length,
    };
  } catch {
    return { revenue: 0, orderCount: 0 };
  }
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

async function loadDedupMap(): Promise<DedupMap> {
  return readState("proactive-alert-dedup", {} as DedupMap);
}

async function saveDedupMap(map: DedupMap): Promise<void> {
  await writeState("proactive-alert-dedup", map);
}

async function loadSignalPostState(): Promise<SignalPostState> {
  return readState(SIGNAL_POST_STATE_KEY, {} as SignalPostState);
}

async function saveSignalPostState(map: SignalPostState): Promise<void> {
  await writeState(SIGNAL_POST_STATE_KEY, map);
}

function isDuplicate(dedupKey: string, dedupTtlHours: number, map: DedupMap): boolean {
  const lastTs = map[dedupKey];
  if (!lastTs) return false;
  const ttlMs = dedupTtlHours * 60 * 60 * 1000;
  return Date.now() - lastTs < ttlMs;
}

// ---------------------------------------------------------------------------
// ET time helper
// ---------------------------------------------------------------------------

function getNowET(): Date {
  const now = new Date();
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  return new Date(etStr);
}

function getDateStringET(offsetDays = 0): string {
  const d = getNowET();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split("T")[0];
}

// ---------------------------------------------------------------------------
// Check: Revenue Drop
// ---------------------------------------------------------------------------

export async function checkRevenueDrop(): Promise<ProactiveAlert | null> {
  const todayStr = getDateStringET(0);
  const todayData = await fetchShopifyOrdersForDate(todayStr);

  // Fetch last 7 days of revenue for comparison
  const revenueByDay: number[] = [];
  for (let i = 1; i <= 7; i++) {
    const dateStr = getDateStringET(-i);
    const dayData = await fetchShopifyOrdersForDate(dateStr);
    revenueByDay.push(dayData.revenue);
  }

  const avgRevenue =
    revenueByDay.length > 0
      ? revenueByDay.reduce((a, b) => a + b, 0) / revenueByDay.length
      : 0;

  // Only alert if we have meaningful baseline data
  if (avgRevenue < 10) return null;

  const dropPct =
    avgRevenue > 0 ? ((avgRevenue - todayData.revenue) / avgRevenue) * 100 : 0;

  if (dropPct <= 30) return null;

  return {
    id: `revenue-drop-${todayStr}`,
    type: "revenue_drop",
    severity: dropPct > 60 ? "critical" : "warning",
    title: "Revenue Drop Detected",
    message: `Today's Shopify revenue ($${todayData.revenue.toFixed(2)}) is ${dropPct.toFixed(0)}% below the 7-day average ($${avgRevenue.toFixed(2)}).`,
    data: {
      todayRevenue: todayData.revenue,
      todayOrders: todayData.orderCount,
      avgRevenue,
      dropPct: Math.round(dropPct),
    },
    dedupKey: `revenue-drop-${todayStr}`,
    dedupTtlHours: 6,
  };
}

// ---------------------------------------------------------------------------
// Check: Approval Backlog
// ---------------------------------------------------------------------------

export async function checkApprovalBacklog(): Promise<ProactiveAlert | null> {
  // Query pending approvals from Supabase
  const rows = await sbFetch<Array<{ id: string; created_at: string }>>(
    "/rest/v1/approvals?status=eq.pending&select=id,created_at&limit=200",
  );

  if (!rows || !Array.isArray(rows)) return null;

  const pending = rows.length;
  const now = Date.now();
  const sixHoursMs = 6 * 60 * 60 * 1000;
  const staleCount = rows.filter(
    (r) => now - new Date(r.created_at).getTime() > sixHoursMs,
  ).length;

  if (pending <= 10 && staleCount === 0) return null;

  const reasons: string[] = [];
  if (pending > 10) reasons.push(`${pending} pending approvals`);
  if (staleCount > 0) reasons.push(`${staleCount} older than 6 hours`);

  return {
    id: `approval-backlog-${getDateStringET()}`,
    type: "approval_backlog",
    severity: staleCount > 0 ? "warning" : "info",
    title: "Approval Backlog",
    message: `Approval queue needs attention: ${reasons.join(", ")}.`,
    data: { pending, staleCount },
    dedupKey: "approval-backlog",
    dedupTtlHours: 4,
  };
}

// ---------------------------------------------------------------------------
// Check: No Orders Today
// ---------------------------------------------------------------------------

export async function checkNoOrdersToday(): Promise<ProactiveAlert | null> {
  const nowET = getNowET();
  const etHour = nowET.getHours();

  // Only alert after 2pm ET
  if (etHour < 14) return null;

  const todayStr = getDateStringET(0);
  const todayData = await fetchShopifyOrdersForDate(todayStr);

  if (todayData.orderCount > 0) return null;

  return {
    id: `no-orders-${todayStr}`,
    type: "no_orders_today",
    severity: etHour >= 18 ? "critical" : "warning",
    title: "No Orders Today",
    message: `It's ${etHour}:00 ET and there have been no Shopify orders today.`,
    data: { etHour, date: todayStr },
    dedupKey: `no-orders-${todayStr}`,
    dedupTtlHours: 4,
  };
}

// ---------------------------------------------------------------------------
// Check: Agent Failure Spike
// ---------------------------------------------------------------------------

export async function checkAgentFailureSpike(): Promise<ProactiveAlert | null> {
  let errors: TrackedError[];
  try {
    errors = await getRecentErrors(50, { resolved: false });
  } catch {
    return null;
  }

  // Filter to last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recentErrors = errors.filter((e) => e.last_seen_at >= oneHourAgo);

  if (recentErrors.length <= 3) return null;

  const sources = [...new Set(recentErrors.map((e) => e.source))];
  const criticalCount = recentErrors.filter(
    (e) => e.severity === "critical",
  ).length;

  return {
    id: `agent-failure-spike-${Date.now()}`,
    type: "agent_failure_spike",
    severity: criticalCount > 0 ? "critical" : "warning",
    title: "Agent Failure Spike",
    message: `${recentErrors.length} errors in the last hour across ${sources.length} source(s): ${sources.slice(0, 5).join(", ")}.`,
    data: {
      errorCount: recentErrors.length,
      criticalCount,
      sources: sources.slice(0, 10),
      sampleMessages: recentErrors.slice(0, 3).map((e) => e.message.slice(0, 100)),
    },
    dedupKey: "agent-failure-spike",
    dedupTtlHours: 1,
  };
}

// ---------------------------------------------------------------------------
// Check: Cash Flow Warning
// ---------------------------------------------------------------------------

export async function checkCashFlowWarning(): Promise<ProactiveAlert | null> {
  // Read from state — cash position is maintained by FinOps agents
  const cashPosition = await readState("cash-position", null as Record<string, unknown> | null);

  if (!cashPosition) return null;

  const currentBalance = Number(cashPosition.balance ?? 0);
  const monthlyBurn = Number(cashPosition.monthly_burn ?? 0);

  // If we don't have burn rate data, skip
  if (!monthlyBurn || monthlyBurn <= 0) return null;

  const dailyBurn = monthlyBurn / 30;
  const daysOfRunway = dailyBurn > 0 ? currentBalance / dailyBurn : Infinity;

  if (daysOfRunway > 30) return null;

  return {
    id: `cash-flow-warning-${getDateStringET()}`,
    type: "cash_flow_warning",
    severity: daysOfRunway <= 14 ? "critical" : "warning",
    title: "Cash Flow Warning",
    message: `Projected cash runway is ${Math.round(daysOfRunway)} days. Current balance: $${currentBalance.toFixed(2)}, monthly burn: $${monthlyBurn.toFixed(2)}.`,
    data: {
      currentBalance,
      monthlyBurn,
      dailyBurn: Math.round(dailyBurn * 100) / 100,
      daysOfRunway: Math.round(daysOfRunway),
    },
    dedupKey: "cash-flow-warning",
    dedupTtlHours: 12,
  };
}

// ---------------------------------------------------------------------------
// Slack formatting
// ---------------------------------------------------------------------------

function severityEmoji(severity: ProactiveAlertSeverity): string {
  switch (severity) {
    case "critical":
      return ":red_circle:";
    case "warning":
      return ":warning:";
    case "info":
      return ":information_source:";
  }
}

function formatAlertForSlack(alert: ProactiveAlert): string {
  return `${severityEmoji(alert.severity)} *${alert.title}*\n${alert.message}`;
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------

export async function runProactiveAlertScan(): Promise<ProactiveScanResult> {
  // Run all checks in parallel
  const results = await Promise.allSettled([
    checkRevenueDrop(),
    checkApprovalBacklog(),
    checkNoOrdersToday(),
    checkAgentFailureSpike(),
    checkCashFlowWarning(),
  ]);

  // Collect non-null alerts
  const alerts: ProactiveAlert[] = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      alerts.push(result.value);
    } else if (result.status === "rejected") {
      console.error("[proactive-alerts] Check failed:", result.reason);
    }
  }

  // Deduplication
  const dedupMap = await loadDedupMap();
  const signalPostState = await loadSignalPostState();
  let sent = 0;
  let suppressed = 0;

  // Clean expired entries from dedup map
  const now = Date.now();
  for (const [key, ts] of Object.entries(dedupMap)) {
    // Remove entries older than 24h regardless of TTL
    if (now - ts > 24 * 60 * 60 * 1000) {
      delete dedupMap[key];
    }
  }
  for (const [key, ts] of Object.entries(signalPostState)) {
    if (now - ts > 24 * 60 * 60 * 1000) {
      delete signalPostState[key];
    }
  }

  for (const alert of alerts) {
    if (isDuplicate(alert.dedupKey, alert.dedupTtlHours, dedupMap)) {
      suppressed++;
      continue;
    }
    const signalKey = `${alert.type}|proactive-alerts`;
    const lastSignalTs = signalPostState[signalKey];
    if (lastSignalTs && now - lastSignalTs < 6 * 60 * 60 * 1000) {
      suppressed++;
      continue;
    }

    // Send to Slack
    const slackText = formatAlertForSlack(alert);
    await notify({
      channel: "alerts",
      text: slackText,
      sms: alert.severity === "critical",
    }).catch((err) => {
      console.error("[proactive-alerts] Slack send failed:", err);
    });

    // Mark as sent in dedup map
    dedupMap[alert.dedupKey] = now;
    signalPostState[signalKey] = now;
    sent++;
  }

  // Persist updated dedup map
  await saveDedupMap(dedupMap);
  await saveSignalPostState(signalPostState);

  return { alerts, sent, suppressed };
}
