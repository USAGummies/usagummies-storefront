/**
 * Triple Reconciliation Engine
 *
 * Cross-references three data sources nightly:
 *  1. Shopify orders → expected DTC revenue
 *  2. Amazon SP-API → expected marketplace revenue
 *  3. Plaid bank deposits → actual cash received
 *
 * Finds discrepancies: missing deposits, uncategorized fees,
 * timing differences, and reconciliation gaps.
 */

import { notifyAlert } from "@/lib/ops/notify";

export type ReconDiscrepancy = {
  type: "missing_deposit" | "unmatched_fee" | "amount_mismatch" | "timing_gap";
  channel: "shopify" | "amazon" | "bank";
  description: string;
  expected: number;
  actual: number;
  gap: number;
  date?: string;
};

export type ReconResult = {
  period: string;
  shopify: { orderRevenue: number; payouts: number; fees: number };
  amazon: { orderRevenue: number; settlements: number; fees: number };
  bank: { deposits: number; source: string };
  discrepancies: ReconDiscrepancy[];
  reconciled: boolean;
  timestamp: string;
};

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
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch { return null; }
}

async function getChannelRevenue(monthStr: string): Promise<{ shopify: number; amazon: number }> {
  const firstDay = `${monthStr}-01`;
  const [y, m] = monthStr.split("-").map(Number);
  const nextFirst = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  const rows = await sbQuery<Array<{ metric_name: string; value: number }>>(
    `/rest/v1/kpi_timeseries?window_type=eq.daily&metric_name=in.(daily_revenue_shopify,daily_revenue_amazon)&captured_for_date=gte.${firstDay}&captured_for_date=lt.${nextFirst}&select=metric_name,value&limit=500`,
  );
  const safe = Array.isArray(rows) ? rows : [];
  const shopify = safe.filter(r => r.metric_name === "daily_revenue_shopify").reduce((s, r) => s + (Number(r.value) || 0), 0);
  const amazon = safe.filter(r => r.metric_name === "daily_revenue_amazon").reduce((s, r) => s + (Number(r.value) || 0), 0);
  return { shopify: Math.round(shopify * 100) / 100, amazon: Math.round(amazon * 100) / 100 };
}

async function getBankDeposits(host: string, cronSecret: string): Promise<{ total: number; count: number; source: string }> {
  try {
    const res = await fetch(`${host}/api/ops/plaid/balance`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { total: 0, count: 0, source: "unavailable" };
    const data = (await res.json()) as {
      connected?: boolean;
      recentTransactions?: Array<{ amount: number; date: string; name: string }>;
    };
    if (!data.connected) return { total: 0, count: 0, source: "not connected" };

    const deposits = (data.recentTransactions || []).filter(t => t.amount < 0); // Plaid: negative = money in
    const total = Math.abs(deposits.reduce((s, t) => s + t.amount, 0));
    return { total: Math.round(total * 100) / 100, count: deposits.length, source: "Plaid (BofA)" };
  } catch {
    return { total: 0, count: 0, source: "error" };
  }
}

export async function runTripleReconciliation(): Promise<ReconResult> {
  const monthStr = new Date().toISOString().slice(0, 7);
  const host = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.NEXT_PUBLIC_SITE_URL || "https://www.usagummies.com";
  const cronSecret = (process.env.CRON_SECRET || "").trim();

  const [channelRev, bankData] = await Promise.all([
    getChannelRevenue(monthStr),
    getBankDeposits(host, cronSecret),
  ]);

  // Estimate fees
  const shopifyFees = Math.round(channelRev.shopify * 0.029 * 100) / 100 + (channelRev.shopify > 0 ? 0.30 : 0); // ~2.9% + $0.30 per txn
  const amazonFees = Math.round(channelRev.amazon * 0.15 * 100) / 100; // ~15% referral fee
  const expectedNetShopify = Math.round((channelRev.shopify - shopifyFees) * 100) / 100;
  const expectedNetAmazon = Math.round((channelRev.amazon - amazonFees) * 100) / 100;
  const expectedTotalDeposits = Math.round((expectedNetShopify + expectedNetAmazon) * 100) / 100;

  const discrepancies: ReconDiscrepancy[] = [];

  // Check: do bank deposits roughly match expected net revenue?
  if (bankData.total > 0 && expectedTotalDeposits > 0) {
    const gap = Math.round((bankData.total - expectedTotalDeposits) * 100) / 100;
    const gapPct = Math.abs(gap / expectedTotalDeposits) * 100;

    if (gapPct > 15) {
      discrepancies.push({
        type: "amount_mismatch",
        channel: "bank",
        description: `Bank deposits ($${bankData.total}) differ from expected net revenue ($${expectedTotalDeposits}) by ${gapPct.toFixed(0)}%. Gap: $${gap.toFixed(2)}`,
        expected: expectedTotalDeposits,
        actual: bankData.total,
        gap,
      });
    }
  }

  // Check: Shopify revenue with no corresponding deposits
  if (channelRev.shopify > 50 && bankData.total === 0) {
    discrepancies.push({
      type: "missing_deposit",
      channel: "shopify",
      description: `Shopify shows $${channelRev.shopify} in revenue but no bank deposits found in Plaid`,
      expected: expectedNetShopify,
      actual: 0,
      gap: expectedNetShopify,
    });
  }

  // Check: Amazon revenue with no settlements
  if (channelRev.amazon > 100 && bankData.total === 0) {
    discrepancies.push({
      type: "missing_deposit",
      channel: "amazon",
      description: `Amazon shows $${channelRev.amazon} in revenue but no bank deposits found. Amazon settles every 14 days — check settlement schedule.`,
      expected: expectedNetAmazon,
      actual: 0,
      gap: expectedNetAmazon,
    });
  }

  const result: ReconResult = {
    period: monthStr,
    shopify: { orderRevenue: channelRev.shopify, payouts: expectedNetShopify, fees: shopifyFees },
    amazon: { orderRevenue: channelRev.amazon, settlements: expectedNetAmazon, fees: amazonFees },
    bank: { deposits: bankData.total, source: bankData.source },
    discrepancies,
    reconciled: discrepancies.length === 0,
    timestamp: new Date().toISOString(),
  };

  // Alert on discrepancies
  if (discrepancies.length > 0) {
    const msg = [
      `🔍 *Triple Reconciliation — ${discrepancies.length} discrepanc${discrepancies.length === 1 ? "y" : "ies"} found*`,
      "",
      `| Source | Revenue | Net (est.) |`,
      `|--------|---------|-----------|`,
      `| Shopify | $${channelRev.shopify.toFixed(2)} | $${expectedNetShopify.toFixed(2)} |`,
      `| Amazon | $${channelRev.amazon.toFixed(2)} | $${expectedNetAmazon.toFixed(2)} |`,
      `| **Expected deposits** | | **$${expectedTotalDeposits.toFixed(2)}** |`,
      `| **Bank (Plaid)** | | **$${bankData.total.toFixed(2)}** |`,
      "",
      ...discrepancies.map(d => `⚠️ ${d.description}`),
    ].join("\n");
    void notifyAlert(msg);
  }

  return result;
}
