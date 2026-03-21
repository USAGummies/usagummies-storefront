/**
 * Predictive Cash Flow Engine
 *
 * Models future cash position using:
 *  - Current Plaid balance
 *  - Known commitments (production runs, recurring expenses)
 *  - Expected inflows (Amazon settlements, Shopify payouts)
 *  - Historical burn rate
 *
 * Projects cash position at 30/60/90 day intervals.
 */

export type CashProjection = {
  date: string;
  label: string;
  balance: number;
  inflows: number;
  outflows: number;
  notes: string[];
};

export type CashFlowForecast = {
  currentBalance: number;
  balanceSource: string;
  monthlyBurnRate: number;
  monthlyRevenue: number;
  projections: CashProjection[];
  runwayDays: number;
  alerts: string[];
  generatedAt: string;
};

// Known upcoming commitments
const KNOWN_COMMITMENTS = [
  {
    description: "Powers 50K production run deposit (50% upfront)",
    amount: -9341, // 50K × $0.385 × 50% ≈ $9,341
    expectedDate: "2026-04-01",
    category: "production",
  },
  {
    description: "Albanese raw materials (50K units × $0.919/unit)",
    amount: -45950, // Bulk gummy base
    expectedDate: "2026-04-01",
    category: "production",
  },
  {
    description: "Belmark packaging film (50K units × $0.144/unit)",
    amount: -7200,
    expectedDate: "2026-03-28",
    category: "production",
  },
];

// Recurring monthly expenses (from burn rate analysis)
const RECURRING_MONTHLY: Array<{ description: string; amount: number }> = [
  { description: "Software (Shopify, Anthropic, tools)", amount: -350 },
  { description: "Insurance", amount: -150 },
  { description: "Amazon PPC advertising", amount: -200 },
  { description: "Misc operational", amount: -200 },
];

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function getRecentMonthlyRevenue(): Promise<number> {
  const env = getSupabaseEnv();
  if (!env) return 0;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  try {
    const res = await fetch(
      `${env.baseUrl}/rest/v1/kpi_timeseries?window_type=eq.daily&metric_name=in.(daily_revenue_shopify,daily_revenue_amazon)&captured_for_date=gte.${thirtyDaysAgo}&select=value&limit=500`,
      {
        headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) return 0;
    const rows = (await res.json()) as Array<{ value: number }>;
    return Array.isArray(rows) ? rows.reduce((s, r) => s + (Number(r.value) || 0), 0) : 0;
  } catch { return 0; }
}

async function getCurrentCashBalance(host: string, cronSecret: string): Promise<{ balance: number; source: string }> {
  try {
    const res = await fetch(`${host}/api/ops/plaid/balance`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { balance: 0, source: "unavailable" };
    const data = (await res.json()) as { connected?: boolean; accounts?: Array<{ current: number; type: string }> };
    if (data.connected && data.accounts?.length) {
      const checking = data.accounts.find(a => a.type === "depository") || data.accounts[0];
      return { balance: checking.current, source: "Plaid (BofA)" };
    }
  } catch { /* */ }
  return { balance: 0, source: "unavailable" };
}

export async function generateCashFlowForecast(): Promise<CashFlowForecast> {
  const host = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.NEXT_PUBLIC_SITE_URL || "https://www.usagummies.com";
  const cronSecret = (process.env.CRON_SECRET || "").trim();

  const [cashData, monthlyRevenue] = await Promise.all([
    getCurrentCashBalance(host, cronSecret),
    getRecentMonthlyRevenue(),
  ]);

  const currentBalance = cashData.balance;
  const monthlyBurn = RECURRING_MONTHLY.reduce((s, e) => s + Math.abs(e.amount), 0);
  const netMonthlyCashFlow = monthlyRevenue - monthlyBurn;

  // Build projections at 30/60/90 days
  const projections: CashProjection[] = [];
  const alerts: string[] = [];

  for (const horizon of [30, 60, 90]) {
    const targetDate = new Date(Date.now() + horizon * 86400000);
    const dateStr = targetDate.toISOString().slice(0, 10);
    const months = horizon / 30;

    // Expected inflows (revenue run-rate)
    const expectedInflows = Math.round(monthlyRevenue * months * 100) / 100;

    // Expected outflows (recurring)
    let expectedOutflows = Math.round(monthlyBurn * months * 100) / 100;
    const notes: string[] = [];

    // Add known commitments that fall within this window
    for (const commitment of KNOWN_COMMITMENTS) {
      const commitDate = new Date(commitment.expectedDate);
      if (commitDate <= targetDate && commitDate >= new Date()) {
        expectedOutflows += Math.abs(commitment.amount);
        notes.push(`${commitment.description}: $${Math.abs(commitment.amount).toLocaleString()}`);
      }
    }

    const projectedBalance = Math.round((currentBalance + expectedInflows - expectedOutflows) * 100) / 100;

    projections.push({
      date: dateStr,
      label: `${horizon} days`,
      balance: projectedBalance,
      inflows: expectedInflows,
      outflows: expectedOutflows,
      notes,
    });

    if (projectedBalance < 0) {
      alerts.push(`🔴 Cash goes negative by ${dateStr} ($${projectedBalance.toLocaleString()})`);
    } else if (projectedBalance < 2000) {
      alerts.push(`🟡 Cash below $2,000 by ${dateStr} ($${projectedBalance.toLocaleString()})`);
    }
  }

  // Calculate runway
  const dailyBurn = (monthlyBurn - (monthlyRevenue * 0.85)) / 30; // Net daily burn after revenue (85% collection rate)
  const runwayDays = dailyBurn > 0 ? Math.round(currentBalance / dailyBurn) : 999;

  return {
    currentBalance,
    balanceSource: cashData.source,
    monthlyBurnRate: monthlyBurn,
    monthlyRevenue: Math.round(monthlyRevenue * 100) / 100,
    projections,
    runwayDays,
    alerts,
    generatedAt: new Date().toISOString(),
  };
}
