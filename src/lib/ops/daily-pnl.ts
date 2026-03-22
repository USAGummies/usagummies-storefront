/**
 * Daily P&L Snapshot
 *
 * Computes yesterday's P&L and posts a one-line summary every morning:
 * "Yesterday: $47.92 revenue, $6.22 COGS, $30 fixed = $11.70 net"
 */

import { notifyDaily } from "@/lib/ops/notify";

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

export type DailyPnL = {
  date: string;
  revenue: { shopify: number; amazon: number; total: number };
  cogs: number; // Estimated from units × forward COGS
  fixedCosts: number; // Daily share of monthly recurring
  netIncome: number;
  mtd: { revenue: number; cogs: number; fixedCosts: number; netIncome: number };
};

const FORWARD_COGS_PER_UNIT = 1.557;
const MONTHLY_FIXED_COSTS = 900; // Software, insurance, misc (from burn rate)
const DAILY_FIXED = Math.round((MONTHLY_FIXED_COSTS / 30) * 100) / 100;

export async function computeDailyPnL(): Promise<DailyPnL> {
  const env = getSupabaseEnv();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const monthStr = yesterday.slice(0, 7);
  const firstOfMonth = `${monthStr}-01`;

  let shopifyRev = 0, amazonRev = 0, shopifyOrd = 0, amazonOrd = 0;
  let mtdShopifyRev = 0, mtdAmazonRev = 0, mtdShopifyOrd = 0, mtdAmazonOrd = 0;

  if (env) {
    try {
      // Yesterday's data
      const yRes = await fetch(
        `${env.baseUrl}/rest/v1/kpi_timeseries?window_type=eq.daily&captured_for_date=eq.${yesterday}&metric_name=in.(daily_revenue_shopify,daily_revenue_amazon,daily_orders_shopify,daily_orders_amazon)&select=metric_name,value`,
        { headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(8000) },
      );
      if (yRes.ok) {
        const rows = (await yRes.json()) as Array<{ metric_name: string; value: number }>;
        for (const r of Array.isArray(rows) ? rows : []) {
          if (r.metric_name === "daily_revenue_shopify") shopifyRev += Number(r.value) || 0;
          if (r.metric_name === "daily_revenue_amazon") amazonRev += Number(r.value) || 0;
          if (r.metric_name === "daily_orders_shopify") shopifyOrd += Number(r.value) || 0;
          if (r.metric_name === "daily_orders_amazon") amazonOrd += Number(r.value) || 0;
        }
      }

      // MTD data
      const mRes = await fetch(
        `${env.baseUrl}/rest/v1/kpi_timeseries?window_type=eq.daily&captured_for_date=gte.${firstOfMonth}&captured_for_date=lte.${yesterday}&metric_name=in.(daily_revenue_shopify,daily_revenue_amazon,daily_orders_shopify,daily_orders_amazon)&select=metric_name,value&limit=500`,
        { headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(8000) },
      );
      if (mRes.ok) {
        const rows = (await mRes.json()) as Array<{ metric_name: string; value: number }>;
        for (const r of Array.isArray(rows) ? rows : []) {
          if (r.metric_name === "daily_revenue_shopify") mtdShopifyRev += Number(r.value) || 0;
          if (r.metric_name === "daily_revenue_amazon") mtdAmazonRev += Number(r.value) || 0;
          if (r.metric_name === "daily_orders_shopify") mtdShopifyOrd += Number(r.value) || 0;
          if (r.metric_name === "daily_orders_amazon") mtdAmazonOrd += Number(r.value) || 0;
        }
      }
    } catch { /* non-fatal */ }
  }

  const totalRev = Math.round((shopifyRev + amazonRev) * 100) / 100;
  const totalUnits = Math.round((shopifyOrd + amazonOrd) * 1.5); // ~1.5 units per order avg
  const cogs = Math.round(totalUnits * FORWARD_COGS_PER_UNIT * 100) / 100;
  const netIncome = Math.round((totalRev - cogs - DAILY_FIXED) * 100) / 100;

  const mtdRev = Math.round((mtdShopifyRev + mtdAmazonRev) * 100) / 100;
  const mtdUnits = Math.round((mtdShopifyOrd + mtdAmazonOrd) * 1.5);
  const mtdCogs = Math.round(mtdUnits * FORWARD_COGS_PER_UNIT * 100) / 100;
  const dayOfMonth = new Date(yesterday).getDate();
  const mtdFixed = Math.round(DAILY_FIXED * dayOfMonth * 100) / 100;
  const mtdNet = Math.round((mtdRev - mtdCogs - mtdFixed) * 100) / 100;

  return {
    date: yesterday,
    revenue: { shopify: Math.round(shopifyRev * 100) / 100, amazon: Math.round(amazonRev * 100) / 100, total: totalRev },
    cogs,
    fixedCosts: DAILY_FIXED,
    netIncome,
    mtd: { revenue: mtdRev, cogs: mtdCogs, fixedCosts: mtdFixed, netIncome: mtdNet },
  };
}

export async function postDailyPnL(): Promise<DailyPnL> {
  const pnl = await computeDailyPnL();

  const netEmoji = pnl.netIncome >= 0 ? "🟢" : "🔴";
  const mtdEmoji = pnl.mtd.netIncome >= 0 ? "🟢" : "🔴";

  const msg = [
    `💰 *Daily P&L — ${new Date(pnl.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}*`,
    `${netEmoji} $${pnl.revenue.total.toFixed(2)} rev − $${pnl.cogs.toFixed(2)} COGS − $${pnl.fixedCosts.toFixed(2)} fixed = **$${pnl.netIncome.toFixed(2)} net**`,
    `  Shopify $${pnl.revenue.shopify.toFixed(2)} · Amazon $${pnl.revenue.amazon.toFixed(2)}`,
    `${mtdEmoji} *MTD:* $${pnl.mtd.revenue.toFixed(2)} rev − $${pnl.mtd.cogs.toFixed(2)} COGS − $${pnl.mtd.fixedCosts.toFixed(2)} fixed = **$${pnl.mtd.netIncome.toFixed(2)} net**`,
  ].join("\n");

  void notifyDaily(msg);
  return pnl;
}
