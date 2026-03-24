import { readState, writeState } from "@/lib/ops/state";
import {
  FINANCIALS_CHANNEL_ID,
  RENE_SLACK_ID,
  currentPtDateParts,
  findSummaryValue,
  formatCurrency,
  qboQueryJson,
  summarizeRowsByPrefix,
  uploadWorkbook,
} from "@/lib/ops/operator/reports/shared";

const STATE_KEY = "abra-operator-monthly-balance-sheet-last-run" as never;

type QboBalanceSheetResponse = {
  summary?: Record<string, string | number>;
};

export type MonthlyBalanceSheetReportResult = {
  ran: boolean;
  assets: number;
  liabilities: number;
  equity: number;
};

export async function runMonthlyBalanceSheetReport(force = false): Promise<MonthlyBalanceSheetReportResult> {
  const { isoDate, dayOfMonth } = currentPtDateParts();
  if (!force && dayOfMonth !== 1) {
    return { ran: false, assets: 0, liabilities: 0, equity: 0 };
  }
  const lastRun = await readState<{ date?: string } | null>(STATE_KEY, null);
  if (!force && lastRun?.date === isoDate) {
    return { ran: false, assets: 0, liabilities: 0, equity: 0 };
  }

  const report = await qboQueryJson<QboBalanceSheetResponse>("balance_sheet");
  const summary = report.summary || {};
  const assets = findSummaryValue(summary, [/^Total Assets$/i]);
  const liabilities = findSummaryValue(summary, [/^Total Liabilities$/i]);
  const equity = findSummaryValue(summary, [/^Total Equity$/i]);

  const assetRows = summarizeRowsByPrefix(summary, /asset/i, [/^Total Assets$/i]).slice(0, 50);
  const liabilityRows = summarizeRowsByPrefix(summary, /liabilit|loan|payable/i, [/^Total Liabilities$/i]).slice(0, 50);
  const equityRows = summarizeRowsByPrefix(summary, /equity|retained/i, [/^Total Equity$/i]).slice(0, 50);

  await uploadWorkbook({
    channelId: FINANCIALS_CHANNEL_ID,
    filename: `monthly-balance-sheet-${isoDate.slice(0, 7)}.xlsx`,
    comment:
      `<@${RENE_SLACK_ID}> Monthly Balance Sheet — Total Assets ${formatCurrency(assets)}, ` +
      `Total Liabilities ${formatCurrency(liabilities)}, Equity ${formatCurrency(equity)}`,
    sheets: [
      {
        sheetName: "Summary",
        headers: ["Metric", "Value"],
        rows: [
          ["Total Assets", assets],
          ["Total Liabilities", liabilities],
          ["Total Equity", equity],
          ["Investor Loan Balance", findSummaryValue(summary, [/2300/i, /investor loan/i, /\brene\b/i])],
        ],
      },
      {
        sheetName: "Assets",
        headers: ["Line", "Amount"],
        rows: assetRows.map((row) => [row.label, row.value]),
      },
      {
        sheetName: "Liabilities",
        headers: ["Line", "Amount"],
        rows: liabilityRows.map((row) => [row.label, row.value]),
      },
      {
        sheetName: "Equity",
        headers: ["Line", "Amount"],
        rows: equityRows.map((row) => [row.label, row.value]),
      },
    ],
  });

  await writeState(STATE_KEY, { date: isoDate });
  return { ran: true, assets, liabilities, equity };
}
