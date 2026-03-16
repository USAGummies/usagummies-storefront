/**
 * Daily Goal Tracker
 *
 * Derives daily revenue targets from Pro Forma v23 monthly plans,
 * tracks MTD progress, and computes pace/gap metrics.
 */

import { TOTAL_REVENUE, MONTHS, type Month } from "./pro-forma";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCurrentMonth(): Month | null {
  const monthMap: Record<number, Month> = {
    2: "mar", 3: "apr", 4: "may", 5: "jun", 6: "jul",
    7: "aug", 8: "sep", 9: "oct", 10: "nov", 11: "dec",
  };
  const now = new Date();
  return monthMap[now.getMonth()] ?? null;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getDayOfMonth(): number {
  return new Date().getDate();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DailyGoalSnapshot = {
  date: string;
  month: Month;
  monthlyTarget: number;
  dailyTarget: number;
  dayOfMonth: number;
  daysInMonth: number;
  daysRemaining: number;
  mtdTarget: number;
  mtdActual: number;
  mtdGap: number;
  mtdPacePct: number;
  dailyRunRate: number;
  requiredDailyRate: number;
  onTrack: boolean;
  status: "ahead" | "on-track" | "behind" | "critical";
  statusEmoji: string;
  channels: {
    shopify: { mtd: number; today: number };
    amazon: { mtd: number; today: number };
  };
};

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string): Promise<unknown> {
  const env = getSupabaseEnv();
  if (!env) return null;

  const res = await fetch(`${env.baseUrl}${path}`, {
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return null;
  const text = await res.text();
  try { return JSON.parse(text); } catch { return null; }
}

async function getMTDRevenue(monthStart: string): Promise<{
  shopify: { mtd: number; today: number };
  amazon: { mtd: number; today: number };
  total: number;
}> {
  const today = new Date().toISOString().split("T")[0];

  const [shopifyRows, amazonRows] = await Promise.all([
    sbFetch(
      `/rest/v1/kpi_timeseries?metric_name=eq.daily_revenue_shopify&window_type=eq.daily&captured_for_date=gte.${monthStart}&captured_for_date=lte.${today}&select=value,captured_for_date&order=captured_for_date.desc`,
    ) as Promise<Array<{ value: number | string; captured_for_date: string }> | null>,
    sbFetch(
      `/rest/v1/kpi_timeseries?metric_name=eq.daily_revenue_amazon&window_type=eq.daily&captured_for_date=gte.${monthStart}&captured_for_date=lte.${today}&select=value,captured_for_date&order=captured_for_date.desc`,
    ) as Promise<Array<{ value: number | string; captured_for_date: string }> | null>,
  ]);

  const shopifyMTD = (shopifyRows || []).reduce((sum, r) => sum + Number(r.value || 0), 0);
  const amazonMTD = (amazonRows || []).reduce((sum, r) => sum + Number(r.value || 0), 0);
  const shopifyToday = Number((shopifyRows || [])[0]?.captured_for_date === today ? (shopifyRows || [])[0]?.value || 0 : 0);
  const amazonToday = Number((amazonRows || [])[0]?.captured_for_date === today ? (amazonRows || [])[0]?.value || 0 : 0);

  return {
    shopify: { mtd: shopifyMTD, today: shopifyToday },
    amazon: { mtd: amazonMTD, today: amazonToday },
    total: shopifyMTD + amazonMTD,
  };
}

/**
 * Get the daily goal snapshot — how are we tracking vs plan today?
 */
export async function getDailyGoalSnapshot(): Promise<DailyGoalSnapshot | null> {
  const month = getCurrentMonth();
  if (!month) return null; // Jan/Feb not in pro forma

  const now = new Date();
  const year = now.getFullYear();
  const monthIdx = MONTHS.indexOf(month);
  const calendarMonth = monthIdx + 2; // mar=2 → calendar month 2 (March is index 2 in 0-based)
  const daysInMonth = getDaysInMonth(year, calendarMonth);
  const dayOfMonth = getDayOfMonth();
  const daysRemaining = daysInMonth - dayOfMonth;

  const monthlyTarget = TOTAL_REVENUE[month];
  const dailyTarget = monthlyTarget / daysInMonth;
  const mtdTarget = dailyTarget * dayOfMonth;

  const monthStart = `${year}-${String(calendarMonth + 1).padStart(2, "0")}-01`;
  const revenue = await getMTDRevenue(monthStart);
  const mtdActual = revenue.total;
  const mtdGap = mtdActual - mtdTarget;
  const mtdPacePct = mtdTarget > 0 ? (mtdActual / mtdTarget) * 100 : 0;
  const dailyRunRate = dayOfMonth > 0 ? mtdActual / dayOfMonth : 0;
  const requiredDailyRate = daysRemaining > 0 ? (monthlyTarget - mtdActual) / daysRemaining : 0;

  let status: DailyGoalSnapshot["status"];
  let statusEmoji: string;
  if (mtdPacePct >= 105) { status = "ahead"; statusEmoji = "🚀"; }
  else if (mtdPacePct >= 90) { status = "on-track"; statusEmoji = "✅"; }
  else if (mtdPacePct >= 70) { status = "behind"; statusEmoji = "⚠️"; }
  else { status = "critical"; statusEmoji = "🚨"; }

  return {
    date: now.toISOString().split("T")[0],
    month,
    monthlyTarget,
    dailyTarget,
    dayOfMonth,
    daysInMonth,
    daysRemaining,
    mtdTarget: Math.round(mtdTarget * 100) / 100,
    mtdActual: Math.round(mtdActual * 100) / 100,
    mtdGap: Math.round(mtdGap * 100) / 100,
    mtdPacePct: Math.round(mtdPacePct * 10) / 10,
    dailyRunRate: Math.round(dailyRunRate * 100) / 100,
    requiredDailyRate: Math.round(requiredDailyRate * 100) / 100,
    onTrack: mtdPacePct >= 90,
    status,
    statusEmoji,
    channels: revenue,
  };
}

/**
 * Format daily goal snapshot as Slack text for morning brief integration.
 */
export function formatGoalSlack(goal: DailyGoalSnapshot): string {
  const lines: string[] = [];
  lines.push(`${goal.statusEmoji} *Daily Goal Tracker — Day ${goal.dayOfMonth}/${goal.daysInMonth}*`);
  lines.push(`• Monthly target: $${goal.monthlyTarget.toLocaleString()} | Daily target: $${Math.round(goal.dailyTarget).toLocaleString()}`);
  lines.push(`• MTD actual: $${goal.mtdActual.toLocaleString()} / $${goal.mtdTarget.toLocaleString()} (${goal.mtdPacePct}% of pace)`);

  if (goal.mtdGap >= 0) {
    lines.push(`• *+$${Math.round(goal.mtdGap).toLocaleString()} ahead* of pace`);
  } else {
    lines.push(`• *-$${Math.round(Math.abs(goal.mtdGap)).toLocaleString()} behind* pace — need $${Math.round(goal.requiredDailyRate).toLocaleString()}/day to catch up`);
  }

  lines.push(`• Run rate: $${Math.round(goal.dailyRunRate).toLocaleString()}/day | ${goal.daysRemaining} days left`);
  return lines.join("\n");
}
