/**
 * Finance Truth Layer — USA Gummies
 *
 * Single interface for verified financial data with source hierarchy and
 * cross-checking. Abra should use this module as the authoritative lens
 * for any financial question before consulting raw sources directly.
 *
 * Source priority (highest → lowest):
 *   1. brain_verified  — manually verified entries from Found Banking exports
 *   2. qbo             — QuickBooks Online (current working system)
 *   3. notion_ledger   — Notion Cash & Transactions database (historical)
 *   4. kpi_timeseries  — Supabase KPI daily aggregates
 *   5. shopify_live    — real-time Shopify Admin API orders
 *   6. amazon_live     — real-time Amazon SP-API (currently limited)
 */

import { queryLedgerSummary } from "@/lib/ops/abra-notion-write";
import { getCalendarMonthRevenue, getRevenueSnapshot } from "@/lib/ops/abra-financial-intel";
import { queryRecentOrders } from "@/lib/ops/shopify-admin-actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FinanceSource =
  | "qbo"
  | "notion_ledger"
  | "kpi_timeseries"
  | "shopify_live"
  | "amazon_live"
  | "brain_verified";

export type VerifiedAmount = {
  value: number;
  source: FinanceSource;
  verified: boolean;
  asOf: string; // ISO timestamp
  note?: string;
};

export type FinanceDiscrepancy = {
  field: string;
  sources: Array<{ source: FinanceSource; value: number; asOf: string }>;
  delta: number;
  severity: "info" | "warning" | "critical";
};

// ---------------------------------------------------------------------------
// Brain-verified constants (from Found Banking exports, verified 2026-03-13)
// ---------------------------------------------------------------------------

export const BRAIN_VERIFIED = {
  /** HISTORICAL COGS from Dutch Valley Foods Run #1 (Sept 2025, 2,500 units).
   *  This was the initial small run and is NOT the go-forward COGS.
   *  Go-forward COGS uses Albanese + Belmark + Powers supply chain. */
  COGS_PER_UNIT_RUN1: 3.11,

  /** Forward-looking COGS per unit from new supply chain (pro forma, partially quoted).
   *  Components: Albanese candy $0.919 + Belmark film $0.144 + Powers co-packing $0.35 + freight $0.109
   *  NOTE: Powers pricing is a QUOTE, not a final contracted rate. */
  COGS_PER_UNIT_FORWARD: 1.522,

  /** Full-year 2025 total revenue (Found Banking P&L). */
  REVENUE_2025: 1484.8,

  /** Full-year 2025 net income (Found Banking P&L). */
  NET_INCOME_2025: -30183.14,

  /** Full-year 2025 total COGS (packaging + ingredients). */
  COGS_2025: 7779.71,

  /** Full-year 2025 total operating expenses (excl. COGS). */
  OPEX_2025: 23888.23,

  /** 2026 YTD revenue through March 13, 2026. */
  REVENUE_2026_YTD: 2931.36,

  /** 2026 YTD net income through March 13, 2026. */
  NET_INCOME_2026_YTD: -168.73,

  /** 2026 YTD total operating expenses through March 13, 2026. */
  OPEX_2026_YTD: 3100.09,

  /** Date through which brain_verified data is current. */
  DATA_THROUGH: "2026-03-13",

  /** Entity type — C-Corporation, Form 1120, cash-basis accounting. */
  ENTITY: "C-Corporation (Wyoming), Form 1120, cash-basis",
} as const;

// ---------------------------------------------------------------------------
// Supabase helper (mirrors abra-financial-intel.ts pattern)
// ---------------------------------------------------------------------------

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${(
        (typeof json === "string" ? json : JSON.stringify(json)) || ""
      ).slice(0, 500)}`,
    );
  }

  return json;
}

// ---------------------------------------------------------------------------
// Internal QBO fetch (server-to-server, uses hardcoded production base URL
// matching the pattern in abra-actions.ts handleQueryQBO)
// ---------------------------------------------------------------------------

function getQBOBaseUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://www.usagummies.com";
}

async function fetchQBOQuery(type: string, params: Record<string, string> = {}): Promise<unknown> {
  const searchParams = new URLSearchParams({ type, ...params });
  const res = await fetch(`${getQBOBaseUrl()}/api/ops/qbo/query?${searchParams.toString()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`QBO query (type=${type}) failed: ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Brain search helper — queries Supabase open_brain_entries for financial
// entries so we can pull brain_verified figures dynamically.
// ---------------------------------------------------------------------------

type BrainEntry = {
  id: string;
  title: string;
  raw_text: string;
  category: string;
  tags: string[] | null;
  priority: string | null;
  confidence: string | null;
  created_at: string;
};

async function searchBrainEntries(category: string, tag?: string): Promise<BrainEntry[]> {
  let path = `/rest/v1/open_brain_entries?category=eq.${encodeURIComponent(category)}&department=eq.finance&select=id,title,raw_text,category,tags,priority,confidence,created_at&order=created_at.desc&limit=20`;
  if (tag) {
    path += `&tags=cs.{${encodeURIComponent(tag)}}`;
  }
  const rows = (await sbFetch(path)) as BrainEntry[];
  return Array.isArray(rows) ? rows : [];
}

function nowISO(): string {
  return new Date().toISOString();
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

// ---------------------------------------------------------------------------
// Period overlap helper — checks whether a date range overlaps a brain entry
// that references a given year/period substring.
// ---------------------------------------------------------------------------

function periodMatchesBrainEntry(period: { start: string; end: string }, entryText: string): boolean {
  const startYear = period.start.slice(0, 4);
  const endYear = period.end.slice(0, 4);
  // Accept if the entry text mentions either year
  return entryText.includes(startYear) || entryText.includes(endYear);
}

// ---------------------------------------------------------------------------
// getVerifiedRevenue
// ---------------------------------------------------------------------------

/**
 * Returns the best available revenue figure for the given date range,
 * trying sources in priority order:
 *   1. brain_verified (Found Banking P&L)
 *   2. kpi_timeseries (Supabase rolling aggregates)
 *   3. shopify_live + amazon_live fallback
 */
export async function getVerifiedRevenue(period: {
  start: string;
  end: string;
}): Promise<VerifiedAmount> {
  // 1. brain_verified — check for a matching P&L seed entry
  try {
    const entries = await searchBrainEntries("financial", "verified");
    for (const entry of entries) {
      if (
        (entry.tags || []).includes("pnl") &&
        (entry.tags || []).includes("verified") &&
        periodMatchesBrainEntry(period, entry.raw_text)
      ) {
        // Parse the income line from the verified entry
        const incomeMatch = entry.raw_text.match(/Business Income:\s*\$([\d,]+\.?\d*)/i);
        if (incomeMatch) {
          const value = parseFloat(incomeMatch[1].replace(/,/g, ""));
          if (value > 0) {
            return {
              value,
              source: "brain_verified",
              verified: true,
              asOf: `${BRAIN_VERIFIED.DATA_THROUGH}T00:00:00.000Z`,
              note: `Found Banking P&L export (data through ${BRAIN_VERIFIED.DATA_THROUGH}). May not include transactions after that date.`,
            };
          }
        }
      }
    }
  } catch {
    // Brain unavailable — fall through
  }

  // 2. kpi_timeseries — calendar month or rolling snapshot
  try {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const periodMonth = period.start.slice(0, 7);
    if (periodMonth === currentMonth || period.start >= new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10)) {
      const calMonth = await getCalendarMonthRevenue();
      if (calMonth.days_with_data > 0) {
        return {
          value: calMonth.total_revenue,
          source: "kpi_timeseries",
          verified: false,
          asOf: nowISO(),
          note: `Calendar month ${calMonth.month} (${calMonth.days_with_data} days with data). Shopify: $${calMonth.shopify_revenue}, Amazon: $${calMonth.amazon_revenue}.`,
        };
      }
    }
  } catch {
    // kpi_timeseries unavailable — fall through
  }

  // 3. shopify_live — sum recent orders
  try {
    const startDate = new Date(period.start);
    const daysDiff = Math.ceil(
      (Date.now() - startDate.getTime()) / 86400000,
    );
    const clampedDays = Math.max(1, Math.min(daysDiff, 90));
    const orders = await queryRecentOrders({ days: clampedDays, limit: 100 });
    const periodRevenue = orders
      .filter((o) => {
        const d = o.createdAt.slice(0, 10);
        return d >= period.start && d <= period.end;
      })
      .reduce((sum, o) => sum + o.totalAmount, 0);

    return {
      value: Math.round(periodRevenue * 100) / 100,
      source: "shopify_live",
      verified: false,
      asOf: nowISO(),
      note: "Shopify Admin API — DTC orders only, does not include Amazon revenue.",
    };
  } catch {
    // Shopify unavailable
  }

  // Final fallback — return zero with explanation
  return {
    value: 0,
    source: "kpi_timeseries",
    verified: false,
    asOf: nowISO(),
    note: "No revenue data available for this period from any source.",
  };
}

// ---------------------------------------------------------------------------
// getVerifiedExpenses
// ---------------------------------------------------------------------------

/**
 * Returns the best available operating expense figure for the given period,
 * trying:
 *   1. brain_verified (Found Banking P&L)
 *   2. notion_ledger (Notion Cash & Transactions)
 *   3. qbo (QuickBooks P&L report)
 */
export async function getVerifiedExpenses(period: {
  start: string;
  end: string;
}): Promise<VerifiedAmount> {
  // 1. brain_verified
  try {
    const entries = await searchBrainEntries("financial", "verified");
    for (const entry of entries) {
      if (
        (entry.tags || []).includes("pnl") &&
        (entry.tags || []).includes("verified") &&
        periodMatchesBrainEntry(period, entry.raw_text)
      ) {
        const opexMatch = entry.raw_text.match(/Total Operating Expenses:\s*\$([\d,]+\.?\d*)/i);
        if (opexMatch) {
          const value = parseFloat(opexMatch[1].replace(/,/g, ""));
          return {
            value,
            source: "brain_verified",
            verified: true,
            asOf: `${BRAIN_VERIFIED.DATA_THROUGH}T00:00:00.000Z`,
            note: `Found Banking P&L export — operating expenses only, excludes COGS. Data through ${BRAIN_VERIFIED.DATA_THROUGH}.`,
          };
        }
      }
    }
  } catch {
    // Brain unavailable
  }

  // 2. notion_ledger
  try {
    const year = period.start.slice(0, 4);
    const ledger = await queryLedgerSummary({ fiscalYear: `FY${year}` });
    if (ledger.summary.transactionCount > 0) {
      return {
        value: Math.round(ledger.summary.totalExpenses * 100) / 100,
        source: "notion_ledger",
        verified: false,
        asOf: nowISO(),
        note: `Notion Cash & Transactions ledger — FY${year}. ${ledger.summary.transactionCount} transactions. May be incomplete — ledger is manually maintained.`,
      };
    }
  } catch {
    // Notion unavailable
  }

  // 3. qbo P&L
  try {
    const data = (await fetchQBOQuery("pnl", {
      start: period.start,
      end: period.end,
    })) as { summary?: Record<string, number | string> };

    const summary = data?.summary || {};
    // QBO P&L summary uses section labels as keys — look for Expenses total
    const expensesKey = Object.keys(summary).find(
      (k) => k.toLowerCase().includes("expense") || k.toLowerCase().includes("opex"),
    );
    const rawValue = expensesKey ? summary[expensesKey] : null;
    const value = rawValue !== null && rawValue !== undefined ? Number(rawValue) : 0;

    if (value !== 0) {
      return {
        value: Math.abs(Math.round(value * 100) / 100),
        source: "qbo",
        verified: false,
        asOf: nowISO(),
        note: `QuickBooks Online P&L (${period.start} to ${period.end}). QBO may be incomplete — not all transactions are categorized.`,
      };
    }
  } catch {
    // QBO unavailable
  }

  return {
    value: 0,
    source: "notion_ledger",
    verified: false,
    asOf: nowISO(),
    note: "No expense data available for this period from any source.",
  };
}

// ---------------------------------------------------------------------------
// getVerifiedBalance
// ---------------------------------------------------------------------------

/**
 * Returns the book balance for a named account (bank account or credit card).
 * Source: QBO Balance Sheet (highest fidelity for current balances).
 *
 * NOTE: QBO book balance ≠ bank balance if there are uncleared transactions.
 * The note field always includes this caveat.
 */
export async function getVerifiedBalance(accountName: string): Promise<VerifiedAmount> {
  // Try QBO balance sheet first
  try {
    const data = (await fetchQBOQuery("balance_sheet")) as {
      summary?: Record<string, number | string>;
    };
    const summary = data?.summary || {};

    // Find a key that matches the requested account name (case-insensitive substring)
    const matchKey = Object.keys(summary).find((k) =>
      k.toLowerCase().includes(accountName.toLowerCase()),
    );

    if (matchKey) {
      const rawValue = summary[matchKey];
      const value = Number(rawValue);
      if (Number.isFinite(value)) {
        return {
          value: Math.round(value * 100) / 100,
          source: "qbo",
          verified: false,
          asOf: nowISO(),
          note: `QuickBooks Online Balance Sheet — book balance for "${matchKey}". This is the QBO book balance, which may not match the actual bank balance if transactions are uncleared or unreconciled.`,
        };
      }
    }
  } catch {
    // QBO unavailable
  }

  // Fallback: brain_verified entries for known accounts
  try {
    const entries = await searchBrainEntries("financial", "found-banking");
    for (const entry of entries) {
      if (entry.raw_text.toLowerCase().includes(accountName.toLowerCase())) {
        // Best effort — we found a reference but no structured balance
        return {
          value: 0,
          source: "brain_verified",
          verified: false,
          asOf: `${BRAIN_VERIFIED.DATA_THROUGH}T00:00:00.000Z`,
          note: `Account "${accountName}" found in brain_verified entries but no structured balance available. Check QBO directly. Data through ${BRAIN_VERIFIED.DATA_THROUGH}.`,
        };
      }
    }
  } catch {
    // Brain unavailable
  }

  return {
    value: 0,
    source: "qbo",
    verified: false,
    asOf: nowISO(),
    note: `Account "${accountName}" not found in QBO Balance Sheet or verified entries. Verify account name spelling.`,
  };
}

// ---------------------------------------------------------------------------
// getVerifiedCOGS
// ---------------------------------------------------------------------------

/**
 * Returns the go-forward COGS per unit from the new supply chain
 * (Albanese + Belmark + Powers). This is the number to use for margin
 * calculations, deal pricing, and financial projections.
 *
 * The $3.11 figure from Dutch Valley Run #1 is historical (small initial batch).
 * The $1.35 in Supabase product_config is WRONG (ingredient-only).
 *
 * NOTE: Powers co-packing rate ($0.35/bag) is a QUOTE, not a final contract.
 */
export async function getVerifiedCOGS(): Promise<VerifiedAmount> {
  return {
    value: BRAIN_VERIFIED.COGS_PER_UNIT_FORWARD,
    source: "brain_verified",
    verified: true,
    asOf: "2026-03-19T00:00:00.000Z",
    note: `Forward COGS: $1.522/unit (Albanese candy $0.919 + Belmark film $0.144 + Powers co-packing $0.350 [QUOTE] + freight $0.109). Historical Run #1 COGS was $3.11/unit (Dutch Valley, 2,500 units, Sept 2025) — do not use for forward projections.`,
  };
}

/**
 * Returns the historical COGS from Dutch Valley Run #1 for P&L lookback.
 */
export async function getHistoricalCOGS(): Promise<VerifiedAmount> {
  return {
    value: BRAIN_VERIFIED.COGS_PER_UNIT_RUN1,
    source: "brain_verified",
    verified: true,
    asOf: "2025-09-10T00:00:00.000Z",
    note: `Dutch Valley Foods Run #1 (Sept 2025): $7,762.60 for 2,500 units = $3.11/unit. Initial small batch — not representative of go-forward economics.`,
  };
}

// ---------------------------------------------------------------------------
// crossCheckFinancials
// ---------------------------------------------------------------------------

/**
 * Fetches revenue and expense figures from multiple sources for the given
 * period (ISO YYYY-MM) and returns any discrepancies exceeding thresholds.
 *
 * Severity:
 *   info     — delta < 5%
 *   warning  — delta 5–20%
 *   critical — delta > 20%
 */
export async function crossCheckFinancials(
  period: string,
): Promise<FinanceDiscrepancy[]> {
  // Parse period — accept "YYYY-MM" or "YYYY"
  let start: string;
  let end: string;

  if (/^\d{4}-\d{2}$/.test(period)) {
    const [year, month] = period.split("-");
    const lastDay = new Date(Number(year), Number(month), 0).getDate();
    start = `${period}-01`;
    end = `${period}-${String(lastDay).padStart(2, "0")}`;
  } else if (/^\d{4}$/.test(period)) {
    start = `${period}-01-01`;
    end = `${period}-12-31`;
  } else {
    start = period;
    end = todayISO();
  }

  const discrepancies: FinanceDiscrepancy[] = [];
  const asOf = nowISO();

  // --- Revenue cross-check ---
  const revenueSources: Array<{ source: FinanceSource; value: number; asOf: string }> = [];

  // brain_verified revenue
  const year = start.slice(0, 4);
  if (year === "2025") {
    revenueSources.push({
      source: "brain_verified",
      value: BRAIN_VERIFIED.REVENUE_2025,
      asOf: `${BRAIN_VERIFIED.DATA_THROUGH}T00:00:00.000Z`,
    });
  } else if (year === "2026") {
    revenueSources.push({
      source: "brain_verified",
      value: BRAIN_VERIFIED.REVENUE_2026_YTD,
      asOf: `${BRAIN_VERIFIED.DATA_THROUGH}T00:00:00.000Z`,
    });
  }

  // kpi_timeseries — try calendar month snapshot
  try {
    const calMonth = await getCalendarMonthRevenue();
    const calMonthYear = calMonth.month.slice(0, 4);
    if (calMonthYear === year && calMonth.days_with_data > 0) {
      revenueSources.push({
        source: "kpi_timeseries",
        value: calMonth.total_revenue,
        asOf,
      });
    }
  } catch {
    // unavailable
  }

  // shopify_live — sum orders for date range
  try {
    const daysDiff = Math.ceil(
      (new Date(end).getTime() - new Date(start).getTime()) / 86400000,
    );
    const clamped = Math.max(1, Math.min(daysDiff + 5, 90));
    const orders = await queryRecentOrders({ days: clamped, limit: 100 });
    const shopifyRevenue = orders
      .filter((o) => {
        const d = o.createdAt.slice(0, 10);
        return d >= start && d <= end;
      })
      .reduce((sum, o) => sum + o.totalAmount, 0);
    if (shopifyRevenue > 0) {
      revenueSources.push({
        source: "shopify_live",
        value: Math.round(shopifyRevenue * 100) / 100,
        asOf,
      });
    }
  } catch {
    // unavailable
  }

  if (revenueSources.length >= 2) {
    const values = revenueSources.map((s) => s.value);
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    const delta = maxVal > 0 ? (maxVal - minVal) / maxVal : 0;
    discrepancies.push({
      field: `revenue (${period})`,
      sources: revenueSources,
      delta: Math.round(delta * 10000) / 100, // as percentage, 2dp
      severity: delta > 0.2 ? "critical" : delta > 0.05 ? "warning" : "info",
    });
  }

  // --- Expense cross-check ---
  const expenseSources: Array<{ source: FinanceSource; value: number; asOf: string }> = [];

  if (year === "2025") {
    expenseSources.push({
      source: "brain_verified",
      value: BRAIN_VERIFIED.OPEX_2025,
      asOf: `${BRAIN_VERIFIED.DATA_THROUGH}T00:00:00.000Z`,
    });
  } else if (year === "2026") {
    expenseSources.push({
      source: "brain_verified",
      value: BRAIN_VERIFIED.OPEX_2026_YTD,
      asOf: `${BRAIN_VERIFIED.DATA_THROUGH}T00:00:00.000Z`,
    });
  }

  // notion_ledger
  try {
    const ledger = await queryLedgerSummary({ fiscalYear: `FY${year}` });
    if (ledger.summary.transactionCount > 0) {
      expenseSources.push({
        source: "notion_ledger",
        value: Math.round(ledger.summary.totalExpenses * 100) / 100,
        asOf,
      });
    }
  } catch {
    // unavailable
  }

  if (expenseSources.length >= 2) {
    const values = expenseSources.map((s) => s.value);
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    const delta = maxVal > 0 ? (maxVal - minVal) / maxVal : 0;
    discrepancies.push({
      field: `operating_expenses (${period})`,
      sources: expenseSources,
      delta: Math.round(delta * 10000) / 100,
      severity: delta > 0.2 ? "critical" : delta > 0.05 ? "warning" : "info",
    });
  }

  return discrepancies;
}

// ---------------------------------------------------------------------------
// getFinanceTruthContext
// ---------------------------------------------------------------------------

/**
 * Returns a formatted string suitable for inclusion in LLM system prompts
 * or context windows. Summarises verified vs unverified financial data,
 * current period KPIs, and COGS truth.
 *
 * Designed to be called once per Abra chat request and injected into the
 * financial context block alongside fetchFinancialContext().
 */
export async function getFinanceTruthContext(): Promise<string> {
  const lines: string[] = [];
  const now = new Date();
  const asOf = now.toISOString();

  lines.push("=== FINANCE TRUTH LAYER ===");
  lines.push(`Generated: ${asOf}`);
  lines.push("");

  // --- Brain-verified constants ---
  lines.push("BRAIN-VERIFIED DATA (Source: Found Banking exports, verified 2026-03-13):");
  lines.push(`  Entity: ${BRAIN_VERIFIED.ENTITY}`);
  lines.push(`  COGS per unit (Run #1 historical): $${BRAIN_VERIFIED.COGS_PER_UNIT_RUN1.toFixed(2)} (Dutch Valley Foods, Sept 2025 — small 2,500 unit run)`);
  lines.push(`  COGS per unit (forward/pro forma): $${BRAIN_VERIFIED.COGS_PER_UNIT_FORWARD.toFixed(2)} (Albanese + Belmark + Powers supply chain — Powers rate is QUOTE, not final)`);
  lines.push(`  2025 Full Year Revenue: $${BRAIN_VERIFIED.REVENUE_2025.toFixed(2)}`);
  lines.push(`  2025 Full Year COGS: $${BRAIN_VERIFIED.COGS_2025.toFixed(2)}`);
  lines.push(`  2025 Full Year OpEx: $${BRAIN_VERIFIED.OPEX_2025.toFixed(2)}`);
  lines.push(`  2025 Net Income: $${BRAIN_VERIFIED.NET_INCOME_2025.toFixed(2)}`);
  lines.push(`  2026 YTD Revenue (through Mar 13): $${BRAIN_VERIFIED.REVENUE_2026_YTD.toFixed(2)}`);
  lines.push(`  2026 YTD OpEx (through Mar 13): $${BRAIN_VERIFIED.OPEX_2026_YTD.toFixed(2)}`);
  lines.push(`  2026 YTD Net Income (through Mar 13): $${BRAIN_VERIFIED.NET_INCOME_2026_YTD.toFixed(2)}`);
  lines.push(`  NOTE: Brain-verified data is current through ${BRAIN_VERIFIED.DATA_THROUGH}. For post-Mar-13 figures use live sources.`);
  lines.push("");

  // --- Current period KPIs from kpi_timeseries ---
  lines.push("CURRENT PERIOD (kpi_timeseries — Supabase rolling aggregates):");
  try {
    const [calMonth, weekSnapshot] = await Promise.all([
      getCalendarMonthRevenue(),
      getRevenueSnapshot("week"),
    ]);

    if (calMonth.days_with_data > 0) {
      lines.push(`  ${calMonth.month} MTD Revenue: $${calMonth.total_revenue.toFixed(2)} (Shopify: $${calMonth.shopify_revenue.toFixed(2)}, Amazon: $${calMonth.amazon_revenue.toFixed(2)})`);
      lines.push(`  ${calMonth.month} Orders: ${calMonth.total_orders} (${calMonth.shopify_orders} Shopify, ${calMonth.amazon_orders} Amazon)`);
      lines.push(`  ${calMonth.month} Avg Order Value: $${calMonth.avg_order_value.toFixed(2)}`);
      lines.push(`  Days with data in ${calMonth.month}: ${calMonth.days_with_data}`);
    } else {
      lines.push("  Current month: No kpi_timeseries data available.");
    }

    if (weekSnapshot.order_count > 0) {
      lines.push(`  Last 7 days Revenue: $${weekSnapshot.total_revenue.toFixed(2)} (${weekSnapshot.order_count} orders)`);
      lines.push(`  vs prior week: ${weekSnapshot.vs_prior_period_pct >= 0 ? "+" : ""}${weekSnapshot.vs_prior_period_pct.toFixed(1)}%`);
    }
  } catch (err) {
    lines.push(`  kpi_timeseries unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
  lines.push("");

  // --- COGS authoritative statement ---
  lines.push("COGS TRUTH:");
  lines.push("  ⚠️ TWO COGS FIGURES — context matters:");
  lines.push("  1. HISTORICAL (Run #1): $3.11/unit — Dutch Valley Foods, Sept 2025, 2,500 units");
  lines.push("     - This was the initial small batch. High per-unit cost due to low volume.");
  lines.push("     - Applies to: existing inventory from Run #1 still being sold.");
  lines.push("  2. FORWARD (Pro Forma): $1.522/unit — New supply chain for 50K+ unit runs");
  lines.push("     - Albanese candy: $0.919/unit");
  lines.push("     - Belmark packaging film: $0.144/unit");
  lines.push("     - Powers Confections co-packing: $0.350/unit (QUOTED, not final contract)");
  lines.push("     - Inbound freight: $0.109/unit");
  lines.push("     - This is the go-forward COGS for margin calculations and deal pricing.");
  lines.push("  WRONG values to ignore:");
  lines.push("    - $1.35/unit in Supabase product_config (ingredient-only, not all-in)");
  lines.push("    - $3.50/unit (any old hardcoded estimate — superseded)");
  lines.push("  NOTE: Use $1.522 for all forward-looking margin/pricing analysis. Use $3.11 only when discussing Run #1 historical P&L.");
  lines.push("");

  // --- Source hierarchy reminder ---
  lines.push("SOURCE HIERARCHY (highest confidence first):");
  lines.push("  1. brain_verified  — Found Banking exports (manually verified)");
  lines.push("  2. qbo             — QuickBooks Online (book records; may be incomplete/unreconciled)");
  lines.push("  3. notion_ledger   — Notion Cash & Transactions DB (manually maintained)");
  lines.push("  4. kpi_timeseries  — Supabase daily aggregates (automated, channel-level)");
  lines.push("  5. shopify_live    — Shopify Admin API (DTC only, excludes Amazon)");
  lines.push("  6. amazon_live     — Amazon SP-API (limited access; use with caution)");
  lines.push("");
  lines.push("IMPORTANT: When citing financials, always state the source and its confidence tier.");
  lines.push("For figures after 2026-03-13, brain_verified is stale — prefer QBO or kpi_timeseries.");
  lines.push("=== END FINANCE TRUTH LAYER ===");

  return lines.join("\n");
}
