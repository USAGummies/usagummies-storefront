import { readState, writeState } from "@/lib/ops/state";
import {
  ABRA_CONTROL_CHANNEL_ID,
  BEN_SLACK_ID,
  currentPtDateParts,
  fetchPlaidCurrentBalance,
  findSummaryValue,
  formatCurrency,
  getPreviousMonthRange,
  postSlackMessage,
  qboQueryJson,
  round2,
  uploadWorkbook,
} from "@/lib/ops/operator/reports/shared";

const STATE_KEY = "abra-operator-investor-update-last-run" as never;

type PnlResponse = { summary?: Record<string, string | number> };
type BalanceSheetResponse = { summary?: Record<string, string | number> };
type MetricsResponse = { cashPosition?: number };

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Supabase not configured");
  return { baseUrl, serviceKey };
}

async function sbFetch<T>(path: string): Promise<T> {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const res = await fetch(`${baseUrl}${path}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`Supabase ${path} failed (${res.status})`);
  return json as T;
}

type DealRow = { company_name?: string | null; stage?: string | null; amount?: number | null };
type BrainRow = { title?: string | null; raw_text?: string | null; created_at?: string | null };

export type InvestorUpdatePackageResult = {
  ran: boolean;
  monthLabel: string;
  revenue: number;
  cash: number;
  liabilities: number;
};

async function collectOperationalHighlights(): Promise<string[]> {
  const rows = await sbFetch<BrainRow[]>(
    `/rest/v1/open_brain_entries?select=title,raw_text,created_at&or=(title.ilike.*production*,raw_text.ilike.*powers*,raw_text.ilike.*sample*,raw_text.ilike.*distributor*)&order=created_at.desc&limit=10`,
  ).catch(() => []);
  return (Array.isArray(rows) ? rows : [])
    .slice(0, 5)
    .map((row) => `${String(row.title || "").trim()}: ${String(row.raw_text || "").replace(/\s+/g, " ").slice(0, 180)}`)
    .filter(Boolean);
}

export async function runInvestorUpdatePackage(force = false): Promise<InvestorUpdatePackageResult> {
  const { isoDate, dayOfMonth } = currentPtDateParts();
  if (!force && dayOfMonth !== 1) {
    return { ran: false, monthLabel: "", revenue: 0, cash: 0, liabilities: 0 };
  }
  const lastRun = await readState<{ date?: string } | null>(STATE_KEY, null);
  if (!force && lastRun?.date === isoDate) {
    return { ran: false, monthLabel: "", revenue: 0, cash: 0, liabilities: 0 };
  }

  const { label, start, end } = getPreviousMonthRange();
  const [pnl, balanceSheet, metrics, plaidCash, deals, highlights] = await Promise.all([
    qboQueryJson<PnlResponse>("pnl", { start, end }),
    qboQueryJson<BalanceSheetResponse>("balance_sheet"),
    qboQueryJson<MetricsResponse>("metrics").catch(() => ({ cashPosition: 0 })),
    fetchPlaidCurrentBalance(),
    sbFetch<DealRow[]>(`/rest/v1/abra_deals?select=company_name,stage,amount&order=updated_at.desc&limit=50`).catch(() => []),
    collectOperationalHighlights(),
  ]);

  const pnlSummary = pnl.summary || {};
  const bsSummary = balanceSheet.summary || {};
  const revenue = findSummaryValue(pnlSummary, [/^Total Income$/i]);
  const cogs = Math.abs(findSummaryValue(pnlSummary, [/^Total Cost of Goods Sold$/i, /^Total Cost of Sales$/i]));
  const expenses = Math.abs(findSummaryValue(pnlSummary, [/^Total Expenses$/i]));
  const netIncome = findSummaryValue(pnlSummary, [/^Net Income$/i]);
  const assets = findSummaryValue(bsSummary, [/^Total Assets$/i]);
  const liabilities = findSummaryValue(bsSummary, [/^Total Liabilities$/i]);
  const equity = findSummaryValue(bsSummary, [/^Total Equity$/i]);
  const loanBalance = findSummaryValue(bsSummary, [/2300/i, /investor loan/i, /\brene\b/i]);
  const paymentsMade = round2(Math.max(0, 100000 - loanBalance));
  const activeDeals = (Array.isArray(deals) ? deals : []).filter((row) => !/won|lost/i.test(String(row.stage || "")));
  const pipelineValue = round2(activeDeals.reduce((sum, row) => sum + Number(row.amount || 0), 0));
  const cash = plaidCash || Number(metrics.cashPosition || 0) || 0;

  await uploadWorkbook({
    channelId: ABRA_CONTROL_CHANNEL_ID,
    filename: `investor-update-${start.slice(0, 7)}.xlsx`,
    comment: `<@${BEN_SLACK_ID}> Investor update package ready for review for ${label}.`,
    sheets: [
      {
        sheetName: "Summary",
        headers: ["Metric", "Value"],
        rows: [
          ["Month", label],
          ["Cash Position", cash],
          ["Revenue", revenue],
          ["COGS", cogs],
          ["Expenses", expenses],
          ["Net Income", netIncome],
          ["Total Assets", assets],
          ["Total Liabilities", liabilities],
          ["Total Equity", equity],
          ["Investor Loan Balance", loanBalance],
          ["Payments Made", paymentsMade],
          ["Active Pipeline Value", pipelineValue],
          ["Active Deals", activeDeals.length],
        ],
      },
      {
        sheetName: "Revenue by Channel",
        headers: ["Channel", "Amount"],
        rows: [
          ["Amazon", findSummaryValue(pnlSummary, [/4100/i, /amazon/i])],
          ["Shopify", findSummaryValue(pnlSummary, [/4200/i, /shopify/i])],
          ["Wholesale", findSummaryValue(pnlSummary, [/4300/i, /wholesale/i, /inderbitzin/i])],
          ["Faire", findSummaryValue(pnlSummary, [/4400/i, /faire/i])],
        ],
      },
      {
        sheetName: "Pipeline",
        headers: ["Company", "Stage", "Amount"],
        rows: activeDeals.map((row) => [row.company_name || "(unknown)", row.stage || "", round2(Number(row.amount || 0))]),
      },
      {
        sheetName: "Operational Highlights",
        headers: ["Highlight"],
        rows: highlights.map((line) => [line]),
      },
    ],
  });

  await postSlackMessage(
    ABRA_CONTROL_CHANNEL_ID,
    `📦 Investor update package ready for review — ${label}. Cash ${formatCurrency(cash)}, revenue ${formatCurrency(revenue)}, loan balance ${formatCurrency(loanBalance)}.`,
  );

  await writeState(STATE_KEY, { date: isoDate });
  return { ran: true, monthLabel: label, revenue, cash, liabilities };
}
