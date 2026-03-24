import { readState, writeState } from "@/lib/ops/state";
import {
  FINANCIALS_CHANNEL_ID,
  RENE_SLACK_ID,
  currentPtDateParts,
  findSummaryValue,
  formatCurrency,
  getPreviousMonthRange,
  qboQueryJson,
  summarizeRowsByPrefix,
  uploadWorkbook,
} from "@/lib/ops/operator/reports/shared";

const STATE_KEY = "abra-operator-monthly-pnl-last-run" as never;

type QboPnlResponse = {
  summary?: Record<string, string | number>;
};

export type MonthlyPnlReportResult = {
  ran: boolean;
  monthLabel: string;
  revenue: number;
  cogs: number;
  expenses: number;
  netIncome: number;
};

export async function runMonthlyPnlReport(force = false): Promise<MonthlyPnlReportResult> {
  const { isoDate, dayOfMonth } = currentPtDateParts();
  if (!force && dayOfMonth !== 1) {
    return { ran: false, monthLabel: "", revenue: 0, cogs: 0, expenses: 0, netIncome: 0 };
  }
  const lastRun = await readState<{ date?: string } | null>(STATE_KEY, null);
  if (!force && lastRun?.date === isoDate) {
    return { ran: false, monthLabel: "", revenue: 0, cogs: 0, expenses: 0, netIncome: 0 };
  }

  const { label, start, end } = getPreviousMonthRange();
  const report = await qboQueryJson<QboPnlResponse>("pnl", { start, end });
  const summary = report.summary || {};

  const revenueRows = [
    { name: "4100 Amazon", value: findSummaryValue(summary, [/4100/i, /amazon/i]) },
    { name: "4200 Shopify", value: findSummaryValue(summary, [/4200/i, /shopify/i]) },
    { name: "4300 Wholesale", value: findSummaryValue(summary, [/4300/i, /wholesale/i, /inderbitzin/i]) },
    { name: "4400 Faire", value: findSummaryValue(summary, [/4400/i, /faire/i]) },
  ];
  const cogsRows = [
    { name: "5100 Albanese", value: findSummaryValue(summary, [/5100/i, /albanese/i]) },
    { name: "5200 Belmark", value: findSummaryValue(summary, [/5200/i, /belmark/i]) },
    { name: "5300 Powers", value: findSummaryValue(summary, [/5300/i, /powers/i]) },
    { name: "5400 Inbound Freight", value: findSummaryValue(summary, [/5400/i, /freight/i]) },
  ];
  const revenue = findSummaryValue(summary, [/^Total Income$/i]);
  const cogs = Math.abs(
    findSummaryValue(summary, [/^Total Cost of Goods Sold$/i, /^Total Cost of Sales$/i]) ||
      cogsRows.reduce((sum, row) => sum + row.value, 0),
  );
  const expenses = Math.abs(findSummaryValue(summary, [/^Total Expenses$/i]));
  const netIncome = findSummaryValue(summary, [/^Net Income$/i]);
  const grossMargin = revenue - cogs;

  const expenseRows = summarizeRowsByPrefix(
    summary,
    /expense/i,
    [/^Total Expenses$/i, /^Total Cost of Goods Sold$/i, /5100/i, /5200/i, /5300/i, /5400/i],
  ).slice(0, 50);

  await uploadWorkbook({
    channelId: FINANCIALS_CHANNEL_ID,
    filename: `monthly-pnl-${start.slice(0, 7)}.xlsx`,
    comment:
      `<@${RENE_SLACK_ID}> Monthly P&L for ${label} — Revenue ${formatCurrency(revenue)}, ` +
      `COGS ${formatCurrency(cogs)}, Expenses ${formatCurrency(expenses)}, Net Income ${formatCurrency(netIncome)}`,
    sheets: [
      {
        sheetName: "Summary",
        headers: ["Metric", "Value"],
        rows: [
          ["Revenue", revenue],
          ["COGS", cogs],
          ["Gross Margin", grossMargin],
          ["Expenses", expenses],
          ["Net Income", netIncome],
        ],
      },
      {
        sheetName: "Revenue by Account",
        headers: ["Account", "Amount"],
        rows: revenueRows.map((row) => [row.name, row.value]),
      },
      {
        sheetName: "COGS by Vendor",
        headers: ["Account", "Amount"],
        rows: cogsRows.map((row) => [row.name, row.value]),
      },
      {
        sheetName: "Expenses",
        headers: ["Category", "Amount"],
        rows: expenseRows.map((row) => [row.label, row.value]),
      },
    ],
  });

  await writeState(STATE_KEY, { date: isoDate });
  return { ran: true, monthLabel: label, revenue, cogs, expenses, netIncome };
}
