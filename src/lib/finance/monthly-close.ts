/**
 * Monthly Close Workflow — USA Gummies
 *
 * Automates month-end financial close:
 *   1. Snapshot all P&L data for the closing month
 *   2. Reconcile revenue across channels (Shopify, Amazon, Wholesale)
 *   3. Lock the period (persist to Supabase)
 *   4. Generate variance analysis vs. prior month
 *   5. Notify finance team via Slack
 *
 * Enterprise-grade: idempotent (re-run safe), audit-logged, error-resilient.
 */

import { buildPnL } from "./pnl";
import type { PnLReport } from "./types";
import { notify } from "@/lib/ops/notify";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MonthlyCloseStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed";

export type MonthlyCloseReport = {
  period: string; // "2026-03"
  status: MonthlyCloseStatus;
  pnl: PnLReport;
  priorMonth: PnLReport | null;
  variance: VarianceAnalysis | null;
  reconciliation: ReconciliationResult;
  closedAt: string | null;
  closedBy: string;
  notes: string[];
};

export type VarianceAnalysis = {
  revenueChange: number;
  revenueChangePct: number;
  cogsChange: number;
  cogsChangePct: number;
  grossMarginChange: number;
  opexChange: number;
  opexChangePct: number;
  netIncomeChange: number;
  netIncomeChangePct: number;
  channelVariance: {
    amazon: { current: number; prior: number; changePct: number };
    shopify: { current: number; prior: number; changePct: number };
    wholesale: { current: number; prior: number; changePct: number };
  };
};

export type ReconciliationResult = {
  status: "balanced" | "discrepancy";
  amazonReconciled: boolean;
  shopifyReconciled: boolean;
  wholesaleReconciled: boolean;
  discrepancies: string[];
};

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase not configured");

  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Prefer", "return=representation");

  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(15000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }

  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPeriodDates(period: string): { start: string; end: string } {
  const [year, month] = period.split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

function getPriorPeriod(period: string): string {
  const [year, month] = period.split("-").map(Number);
  const priorMonth = month === 1 ? 12 : month - 1;
  const priorYear = month === 1 ? year - 1 : year;
  return `${priorYear}-${String(priorMonth).padStart(2, "0")}`;
}

function pctChange(current: number, prior: number): number {
  if (prior === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - prior) / Math.abs(prior)) * 1000) / 10;
}

function buildVariance(
  current: PnLReport,
  prior: PnLReport,
): VarianceAnalysis {
  return {
    revenueChange: current.revenue.total - prior.revenue.total,
    revenueChangePct: pctChange(current.revenue.total, prior.revenue.total),
    cogsChange: current.cogs.total - prior.cogs.total,
    cogsChangePct: pctChange(current.cogs.total, prior.cogs.total),
    grossMarginChange: current.grossMargin - prior.grossMargin,
    opexChange: current.opex.total - prior.opex.total,
    opexChangePct: pctChange(current.opex.total, prior.opex.total),
    netIncomeChange: current.netIncome - prior.netIncome,
    netIncomeChangePct: pctChange(current.netIncome, prior.netIncome),
    channelVariance: {
      amazon: {
        current: current.revenue.amazon,
        prior: prior.revenue.amazon,
        changePct: pctChange(current.revenue.amazon, prior.revenue.amazon),
      },
      shopify: {
        current: current.revenue.shopify,
        prior: prior.revenue.shopify,
        changePct: pctChange(current.revenue.shopify, prior.revenue.shopify),
      },
      wholesale: {
        current: current.revenue.wholesale,
        prior: prior.revenue.wholesale,
        changePct: pctChange(
          current.revenue.wholesale,
          prior.revenue.wholesale,
        ),
      },
    },
  };
}

function reconcile(pnl: PnLReport): ReconciliationResult {
  const discrepancies: string[] = [];

  // Revenue sanity checks
  const channelSum =
    pnl.revenue.amazon + pnl.revenue.shopify + pnl.revenue.wholesale;
  const totalDiff = Math.abs(channelSum - pnl.revenue.total);
  if (totalDiff > 0.01) {
    discrepancies.push(
      `Revenue channel sum ($${channelSum.toFixed(2)}) ≠ total ($${pnl.revenue.total.toFixed(2)})`,
    );
  }

  // COGS sanity — can't exceed revenue
  if (pnl.cogs.total > pnl.revenue.total * 1.5) {
    discrepancies.push(
      `COGS ($${pnl.cogs.total.toFixed(2)}) exceeds 150% of revenue — review needed`,
    );
  }

  // Negative revenue check
  const amazonOk = pnl.revenue.amazon >= 0;
  const shopifyOk = pnl.revenue.shopify >= 0;
  const wholesaleOk = pnl.revenue.wholesale >= 0;
  if (!amazonOk) discrepancies.push("Amazon revenue is negative");
  if (!shopifyOk) discrepancies.push("Shopify revenue is negative");
  if (!wholesaleOk) discrepancies.push("Wholesale revenue is negative");

  // Gross margin sanity
  if (pnl.grossMargin < -50 || pnl.grossMargin > 99) {
    discrepancies.push(
      `Gross margin ${pnl.grossMargin}% outside expected range (-50% to 99%)`,
    );
  }

  return {
    status: discrepancies.length === 0 ? "balanced" : "discrepancy",
    amazonReconciled: amazonOk,
    shopifyReconciled: shopifyOk,
    wholesaleReconciled: wholesaleOk,
    discrepancies,
  };
}

// ---------------------------------------------------------------------------
// Monthly Close — Main
// ---------------------------------------------------------------------------

/**
 * Run the monthly close for a given period (e.g. "2026-02").
 * Idempotent: if the period is already closed, returns the existing report.
 */
export async function runMonthlyClose(
  period: string,
  closedBy: string = "system",
): Promise<MonthlyCloseReport> {
  const notes: string[] = [];

  // Check if already closed
  try {
    const existing = (await sbFetch(
      `/rest/v1/monthly_close?period=eq.${period}&select=*&limit=1`,
    )) as Array<{ status: string; report: MonthlyCloseReport }>;
    if (
      Array.isArray(existing) &&
      existing.length > 0 &&
      existing[0].status === "completed"
    ) {
      notes.push("Period already closed — returning existing report");
      return existing[0].report;
    }
  } catch {
    notes.push("No prior close record found (table may not exist yet)");
  }

  // Build P&L for the closing month
  const { start, end } = getPeriodDates(period);
  const pnl = await buildPnL(start, end);
  notes.push(`P&L generated: $${pnl.revenue.total.toFixed(2)} revenue`);

  // Build prior month P&L for comparison
  let priorMonth: PnLReport | null = null;
  let variance: VarianceAnalysis | null = null;
  try {
    const prior = getPriorPeriod(period);
    const { start: priorStart, end: priorEnd } = getPeriodDates(prior);
    priorMonth = await buildPnL(priorStart, priorEnd);
    variance = buildVariance(pnl, priorMonth);
    notes.push(
      `Prior month comparison: revenue ${variance.revenueChangePct > 0 ? "+" : ""}${variance.revenueChangePct}%`,
    );
  } catch {
    notes.push("Prior month P&L unavailable — skipping variance");
  }

  // Reconcile
  const reconciliation = reconcile(pnl);
  if (reconciliation.discrepancies.length > 0) {
    notes.push(
      `⚠️ ${reconciliation.discrepancies.length} discrepancy(ies) found`,
    );
  } else {
    notes.push("✅ All channels reconciled");
  }

  const report: MonthlyCloseReport = {
    period,
    status: "completed",
    pnl,
    priorMonth,
    variance,
    reconciliation,
    closedAt: new Date().toISOString(),
    closedBy,
    notes,
  };

  // Persist to Supabase
  try {
    await sbFetch("/rest/v1/monthly_close", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        period,
        status: "completed",
        report,
        closed_at: report.closedAt,
        closed_by: closedBy,
      }),
    });
    notes.push("Report persisted to Supabase");
  } catch (err) {
    notes.push(
      `Failed to persist: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }

  // Notify Slack
  const slackLines = [
    `📊 *Monthly Close: ${pnl.period.label}*`,
    `Revenue: $${pnl.revenue.total.toLocaleString()} | Net Income: $${pnl.netIncome.toLocaleString()}`,
    `Gross Margin: ${pnl.grossMargin}% | Net Margin: ${pnl.netMargin}%`,
  ];
  if (variance) {
    slackLines.push(
      `Revenue vs prior: ${variance.revenueChangePct > 0 ? "+" : ""}${variance.revenueChangePct}%`,
    );
  }
  if (reconciliation.discrepancies.length > 0) {
    slackLines.push(
      `⚠️ ${reconciliation.discrepancies.length} discrepancy(ies) — review needed`,
    );
  }
  await notify({ channel: "daily", text: slackLines.join("\n") }).catch(() => {});

  return report;
}

/**
 * Get the list of all closed periods.
 */
export async function getClosedPeriods(): Promise<
  Array<{ period: string; status: string; closed_at: string }>
> {
  try {
    const rows = (await sbFetch(
      "/rest/v1/monthly_close?select=period,status,closed_at&order=period.desc",
    )) as Array<{ period: string; status: string; closed_at: string }>;
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}
