/**
 * POST/GET /api/ops/abra/cron/dashboard-push
 *
 * Real-Time Dashboard Push — Posts a compact operational snapshot to Slack
 * every 6 hours (8am, 2pm, 8pm PT via QStash). No one has to ask.
 *
 * Sections: Revenue, Orders, Inventory, Cash, Pipeline, Signals, AI Spend
 */

import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/ops/abra-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbQuery<T = unknown>(path: string): Promise<T | null> {
  const env = getSupabaseEnv();
  if (!env) return null;
  try {
    const res = await fetch(`${env.baseUrl}${path}`, {
      headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch { return null; }
}

async function sbRpc<T = unknown>(fn: string, body: Record<string, unknown>): Promise<T | null> {
  const env = getSupabaseEnv();
  if (!env) return null;
  try {
    const res = await fetch(`${env.baseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch { return null; }
}

type DashboardData = {
  revenue: { shopify: number; amazon: number; total: number; trend: string };
  orders: { shopify: number; amazon: number; total: number };
  mtd: { revenue: number; orders: number; aov: number };
  cash: { balance: number | null; source: string };
  pipeline: { active: number; pending_approvals: number };
  signals: { count: number; critical: number };
  aiSpend: { total: number; budget: number; pct: number };
};

function trend(current: number, previous: number): string {
  if (previous === 0) return "➡️";
  const pct = ((current - previous) / previous) * 100;
  if (pct > 10) return "📈";
  if (pct < -10) return "📉";
  return "➡️";
}

async function gatherDashboardData(): Promise<DashboardData> {
  const month = new Date().toISOString().slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const firstOfMonth = `${month}-01`;

  // Parallel data fetch
  const [kpiToday, kpiYesterday, kpiMtd, costData, approvals, signals] = await Promise.all([
    // Today's KPI
    sbQuery<Array<{ metric_name: string; value: number }>>(
      `/rest/v1/kpi_timeseries?window_type=eq.daily&captured_for_date=eq.${today}&metric_name=in.(daily_revenue_shopify,daily_revenue_amazon,daily_orders_shopify,daily_orders_amazon)&select=metric_name,value`,
    ),
    // Yesterday's KPI (for trend)
    sbQuery<Array<{ metric_name: string; value: number }>>(
      `/rest/v1/kpi_timeseries?window_type=eq.daily&captured_for_date=eq.${yesterday}&metric_name=in.(daily_revenue_shopify,daily_revenue_amazon)&select=metric_name,value`,
    ),
    // MTD totals
    sbQuery<Array<{ metric_name: string; value: number }>>(
      `/rest/v1/kpi_timeseries?window_type=eq.daily&captured_for_date=gte.${firstOfMonth}&metric_name=in.(daily_revenue_shopify,daily_revenue_amazon,daily_orders_shopify,daily_orders_amazon)&select=metric_name,value&limit=500`,
    ),
    // AI spend
    sbRpc<Array<{ total_cost: number; call_count: number }>>("get_monthly_ai_spend", { target_month: month }),
    // Pending approvals
    sbQuery<Array<{ id: string }>>("/rest/v1/approvals?status=eq.pending&select=id&limit=50"),
    // Active signals (recent brain entries tagged as signals)
    sbQuery<Array<{ id: string }>>("/rest/v1/approvals?status=eq.pending&created_at=gte." + encodeURIComponent(new Date(Date.now() - 86400000).toISOString()) + "&select=id&limit=20"),
  ]);

  // Parse today
  const todayRows = Array.isArray(kpiToday) ? kpiToday : [];
  const shopifyRev = todayRows.filter(r => r.metric_name === "daily_revenue_shopify").reduce((s, r) => s + (Number(r.value) || 0), 0);
  const amazonRev = todayRows.filter(r => r.metric_name === "daily_revenue_amazon").reduce((s, r) => s + (Number(r.value) || 0), 0);
  const shopifyOrd = todayRows.filter(r => r.metric_name === "daily_orders_shopify").reduce((s, r) => s + (Number(r.value) || 0), 0);
  const amazonOrd = todayRows.filter(r => r.metric_name === "daily_orders_amazon").reduce((s, r) => s + (Number(r.value) || 0), 0);

  // Parse yesterday for trend
  const yestRows = Array.isArray(kpiYesterday) ? kpiYesterday : [];
  const yestTotal = yestRows.reduce((s, r) => s + (Number(r.value) || 0), 0);
  const todayTotal = shopifyRev + amazonRev;

  // Parse MTD
  const mtdRows = Array.isArray(kpiMtd) ? kpiMtd : [];
  const mtdRevenue = mtdRows.filter(r => r.metric_name.includes("revenue")).reduce((s, r) => s + (Number(r.value) || 0), 0);
  const mtdOrders = mtdRows.filter(r => r.metric_name.includes("orders")).reduce((s, r) => s + (Number(r.value) || 0), 0);

  // AI spend
  const costRow = Array.isArray(costData) ? costData[0] : null;
  const budget = Number(process.env.ABRA_MONTHLY_BUDGET) || 1000;
  const aiTotal = costRow?.total_cost || 0;

  // Cash — try Plaid
  let cashBalance: number | null = null;
  let cashSource = "unavailable";
  try {
    const host = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.NEXT_PUBLIC_SITE_URL || "https://www.usagummies.com";
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const plaidRes = await fetch(`${host}/api/ops/plaid/balance`, {
        headers: { Authorization: `Bearer ${cronSecret}` },
        signal: AbortSignal.timeout(8000),
      });
      if (plaidRes.ok) {
        const plaidData = (await plaidRes.json()) as { connected?: boolean; accounts?: Array<{ current: number; type: string }> };
        if (plaidData.connected && plaidData.accounts?.length) {
          const checking = plaidData.accounts.find(a => a.type === "depository") || plaidData.accounts[0];
          cashBalance = checking.current;
          cashSource = "Plaid (BofA)";
        }
      }
    }
  } catch { /* non-fatal */ }

  return {
    revenue: { shopify: Math.round(shopifyRev * 100) / 100, amazon: Math.round(amazonRev * 100) / 100, total: Math.round(todayTotal * 100) / 100, trend: trend(todayTotal, yestTotal) },
    orders: { shopify: Math.round(shopifyOrd), amazon: Math.round(amazonOrd), total: Math.round(shopifyOrd + amazonOrd) },
    mtd: { revenue: Math.round(mtdRevenue * 100) / 100, orders: Math.round(mtdOrders), aov: mtdOrders > 0 ? Math.round((mtdRevenue / mtdOrders) * 100) / 100 : 0 },
    cash: { balance: cashBalance, source: cashSource },
    pipeline: { active: 200, pending_approvals: Array.isArray(approvals) ? approvals.length : 0 },
    signals: { count: Array.isArray(signals) ? signals.length : 0, critical: 0 },
    aiSpend: { total: Math.round(aiTotal * 100) / 100, budget, pct: Math.round((aiTotal / budget) * 1000) / 10 },
  };
}

function formatDashboard(d: DashboardData): string {
  const now = new Date();
  const timeLabel = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Los_Angeles" });

  const lines = [
    `📊 *USA Gummies — ${dateLabel} ${timeLabel} PT*`,
    "",
    `${d.revenue.trend} *Today:* $${d.revenue.total.toFixed(2)} revenue | ${d.orders.total} orders`,
    `  Shopify $${d.revenue.shopify.toFixed(2)} (${d.orders.shopify}) · Amazon $${d.revenue.amazon.toFixed(2)} (${d.orders.amazon})`,
    "",
    `📅 *MTD:* $${d.mtd.revenue.toFixed(2)} | ${d.mtd.orders} orders | $${d.mtd.aov.toFixed(2)} AOV`,
  ];

  if (d.cash.balance !== null) {
    const cashEmoji = d.cash.balance > 5000 ? "✅" : d.cash.balance > 2000 ? "🟡" : "🔴";
    lines.push(`${cashEmoji} *Cash:* $${d.cash.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })} (${d.cash.source})`);
  }

  if (d.pipeline.pending_approvals > 0) {
    lines.push(`📋 *${d.pipeline.pending_approvals}* approval(s) pending`);
  }

  lines.push(`🤖 *AI:* $${d.aiSpend.total.toFixed(2)}/$${d.aiSpend.budget} (${d.aiSpend.pct}%)`);

  return lines.join("\n");
}

async function handler(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await gatherDashboardData();
    const message = formatDashboard(data);

    // Post to #abra-control
    const botToken = process.env.SLACK_BOT_TOKEN;
    const channel = process.env.SLACK_CHANNEL_DAILY || "C0ALS6W7VB4";
    let slackOk = false;

    if (botToken) {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ channel, text: message }),
        signal: AbortSignal.timeout(8000),
      });
      const slackData = (await res.json()) as { ok: boolean };
      slackOk = slackData.ok;
    }

    return NextResponse.json({ ok: true, slack: slackOk, data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Dashboard push failed" },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) { return handler(req); }
export async function POST(req: Request) { return handler(req); }
