import { getVerifiedBalance } from "@/lib/ops/finance-truth";
import { readState, writeState } from "@/lib/ops/state";
import {
  FINANCIALS_CHANNEL_ID,
  RENE_SLACK_ID,
  currentPtDateParts,
  daysOutstanding,
  fetchPlaidCurrentBalance,
  findSummaryValue,
  formatCurrency,
  qboQueryJson,
  round2,
  uploadWorkbook,
  type QBOBillRow,
  type QBOInvoiceRow,
} from "@/lib/ops/operator/reports/shared";

const STATE_KEY = "abra-operator-weekly-ar-ap-last-run" as never;

type QboInvoicesResponse = { invoices?: QBOInvoiceRow[] };
type QboBillsResponse = { bills?: QBOBillRow[] };
type QboPnlResponse = { summary?: Record<string, string | number> };

export type WeeklyArApReportResult = {
  ran: boolean;
  invoiceCount: number;
  invoiceTotal: number;
  billCount: number;
  billTotal: number;
  runwayMonths: number | null;
  burnRate: number;
  warning: boolean;
};

async function calculateAverageMonthlyBurn(): Promise<number> {
  const now = new Date();
  const totals: number[] = [];
  for (let offset = 1; offset <= 3; offset += 1) {
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset + 1, 0));
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    const pnl = await qboQueryJson<QboPnlResponse>("pnl", {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    }).catch(() => ({ summary: {} }));
    const expenses = Math.abs(findSummaryValue(pnl.summary || {}, [/^Total Expenses$/i]));
    if (expenses > 0) totals.push(expenses);
  }
  if (!totals.length) return 0;
  return round2(totals.reduce((sum, value) => sum + value, 0) / totals.length);
}

export async function runWeeklyArApReport(force = false): Promise<WeeklyArApReportResult> {
  const { isoDate, dayOfWeek } = currentPtDateParts();
  if (!force && dayOfWeek !== 1) {
    return { ran: false, invoiceCount: 0, invoiceTotal: 0, billCount: 0, billTotal: 0, runwayMonths: null, burnRate: 0, warning: false };
  }

  const lastRun = await readState<{ date?: string } | null>(STATE_KEY, null);
  if (!force && lastRun?.date === isoDate) {
    return { ran: false, invoiceCount: 0, invoiceTotal: 0, billCount: 0, billTotal: 0, runwayMonths: null, burnRate: 0, warning: false };
  }

  const [invoiceData, billData, plaidBalance, qboBookBalance, burnRate] = await Promise.all([
    qboQueryJson<QboInvoicesResponse>("invoices").catch(() => ({ invoices: [] })),
    qboQueryJson<QboBillsResponse>("bills").catch(() => ({ bills: [] })),
    fetchPlaidCurrentBalance(),
    getVerifiedBalance("Bank").catch(() => ({ value: 0 })),
    calculateAverageMonthlyBurn(),
  ]);

  const invoices = (invoiceData.invoices || []).filter((row) => Number(row.Balance || 0) > 0);
  const bills = (billData.bills || []).filter((row) => Number(row.Balance || 0) > 0);
  const invoiceTotal = round2(invoices.reduce((sum, row) => sum + Number(row.Balance || row.Amount || 0), 0));
  const billTotal = round2(bills.reduce((sum, row) => sum + Number(row.Balance || row.Amount || 0), 0));
  const runwayMonths = burnRate > 0 ? round2(plaidBalance / burnRate) : null;
  const warning = runwayMonths !== null && runwayMonths < 3;

  await uploadWorkbook({
    channelId: FINANCIALS_CHANNEL_ID,
    filename: `weekly-ar-ap-${isoDate}.xlsx`,
    comment:
      `<@${RENE_SLACK_ID}> Weekly AR/AP report — ${invoices.length} invoices outstanding (${formatCurrency(invoiceTotal)} total), ` +
      `${bills.length} bills unpaid (${formatCurrency(billTotal)} total). ` +
      `Cash runway: ${runwayMonths === null ? "n/a" : `${runwayMonths.toFixed(1)} months`} at current burn rate (${formatCurrency(burnRate)}/month)` +
      `${warning ? " — CRITICAL: runway below 3 months." : ""}`,
    sheets: [
      {
        sheetName: "Summary",
        headers: ["Metric", "Value"],
        rows: [
          ["Outstanding AR", invoiceTotal],
          ["Outstanding AP", billTotal],
          ["Plaid Cash", plaidBalance],
          ["QBO Book Cash", round2(Number(qboBookBalance.value || 0))],
          ["Runway Months", runwayMonths ?? 0],
          ["Average Monthly Burn", burnRate],
        ],
      },
      {
        sheetName: "Accounts Receivable",
        headers: ["Customer", "Invoice #", "Amount", "Due Date", "Days Outstanding", "Status"],
        rows: invoices.map((row) => [
          row.Customer || "(unknown)",
          row.DocNumber || row.Id,
          round2(Number(row.Balance || row.Amount || 0)),
          row.DueDate || row.Date || "",
          daysOutstanding(row.DueDate || row.Date || null, isoDate),
          row.DueDate && row.DueDate < isoDate ? `[OVERDUE] ${row.Status || "outstanding"}` : row.Status || "outstanding",
        ]),
      },
      {
        sheetName: "Accounts Payable",
        headers: ["Vendor", "Bill #", "Amount", "Due Date", "Days Outstanding", "Status"],
        rows: bills.map((row) => [
          row.Vendor || "(unknown)",
          row.Id,
          round2(Number(row.Balance || row.Amount || 0)),
          row.DueDate || row.Date || "",
          daysOutstanding(row.DueDate || row.Date || null, isoDate),
          row.DueDate && row.DueDate < isoDate ? `[OVERDUE] ${row.Status || "unpaid"}` : row.Status || "unpaid",
        ]),
      },
    ],
  });

  await writeState(STATE_KEY, { date: isoDate });
  return {
    ran: true,
    invoiceCount: invoices.length,
    invoiceTotal,
    billCount: bills.length,
    billTotal,
    runwayMonths,
    burnRate,
    warning,
  };
}
