import "server-only";

import { DB, extractDate, extractNumber, extractText } from "@/lib/notion/client";
import { createNotionPage, queryNotionDatabase } from "@/lib/ops/abra-notion-write";
import { notify } from "@/lib/ops/notify";
import {
  buildMonthlyStatementPeriod,
  formatPnLAsMarkdown,
  formatPnLAsText,
  generatePnL,
  type PnLStatement,
} from "@/lib/ops/abra-financial-statements";

export type MonthlyCloseReport = {
  month: number;
  year: number;
  status: "draft" | "review" | "closed";
  transactionSummary: {
    totalTransactions: number;
    categorized: number;
    uncategorized: number;
    totalDebits: number;
    totalCredits: number;
  };
  accountBalances: Array<{
    accountCode: string;
    accountName: string;
    openingBalance: number;
    debits: number;
    credits: number;
    closingBalance: number;
  }>;
  openAP: Array<{
    vendor: string;
    amount: number;
    dueDate: string;
    status: string;
  }>;
  openAR: Array<{
    customer: string;
    amount: number;
    invoiceDate: string;
    status: string;
  }>;
  pnl: PnLStatement;
  actionItems: string[];
  warnings: string[];
};

type NotionPage = Record<string, unknown>;

type ParsedTransaction = {
  accountCode: string | null;
  accountName: string;
  amount: number;
};

const MONTHLY_CLOSE_CHECKLIST_DB = "72dd43a214434a57b25fba87b51b00c0";
const ACCOUNTS_PAYABLE_DB = "c0adc90330694fcbba761fd5ce5d9802";
const ACCOUNTS_RECEIVABLE_DB = "707fad73b7cb431192a917e60a683476";

const ACCOUNT_NAMES: Record<string, string> = {
  "4100": "Shopify DTC Revenue",
  "4200": "Amazon Revenue",
  "4300": "Wholesale Revenue",
  "4400": "Faire Revenue",
  "5100": "Ingredients",
  "5200": "Co-Packing",
  "5300": "Packaging",
  "5400": "Freight-In",
  "5500": "Amazon Fees",
  "6100": "Marketing",
  "6200": "Software",
  "6300": "Legal",
  "6400": "Insurance",
  "6500": "Bank Fees",
  "6600": "Shipping",
  "6700": "Meals",
  "6800": "Miscellaneous",
};

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(round2(value));
}

function getProps(page: NotionPage): Record<string, unknown> {
  const props = page.properties;
  return props && typeof props === "object" ? (props as Record<string, unknown>) : {};
}

function readText(props: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const text = extractText(props[name]).trim();
    if (text) return text;
  }
  return "";
}

function readNumber(props: Record<string, unknown>, names: string[]): number {
  for (const name of names) {
    const value = extractNumber(props[name]);
    if (value) return value;
    const text = extractText(props[name]).replace(/[$,]/g, "").trim();
    if (!text) continue;
    const parsed = Number(text);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function readDateValue(props: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const date = extractDate(props[name]).trim();
    if (date) return date.slice(0, 10);
    const text = extractText(props[name]).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  }
  return "";
}

function startAndEndOfMonth(month: number, year: number): { startDate: string; endDate: string } {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { startDate, endDate };
}

function previousDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function fetchTransactionsInRange(startDate: string, endDate: string): Promise<ParsedTransaction[]> {
  const pages = await queryNotionDatabase({
    database_id: DB.CASH_TRANSACTIONS,
    filter: {
      and: [
        { property: "Date", date: { on_or_after: startDate } },
        { property: "Date", date: { on_or_before: endDate } },
      ],
    },
    sorts: [{ property: "Date", direction: "ascending" }],
    page_size: 100,
  });

  return pages.map((page) => {
    const props = getProps(page);
    const accountCode = readText(props, ["Account Code", "GL Code", "Account"]) || null;
    return {
      accountCode,
      accountName: accountCode ? ACCOUNT_NAMES[accountCode] || `Account ${accountCode}` : "Uncategorized",
      amount: readNumber(props, ["Amount", "Net Amount", "Total", "Value"]),
    };
  });
}

function summarizeAccountBalances(
  openingRows: ParsedTransaction[],
  monthRows: ParsedTransaction[],
): MonthlyCloseReport["accountBalances"] {
  const codes = new Set<string>();
  for (const row of openingRows) if (row.accountCode) codes.add(row.accountCode);
  for (const row of monthRows) if (row.accountCode) codes.add(row.accountCode);

  return [...codes]
    .sort((a, b) => a.localeCompare(b))
    .map((accountCode) => {
      const openingBalance = round2(
        openingRows
          .filter((row) => row.accountCode === accountCode)
          .reduce((sum, row) => sum + row.amount, 0),
      );
      const monthEntries = monthRows.filter((row) => row.accountCode === accountCode);
      const debits = round2(
        monthEntries
          .filter((row) => row.amount < 0)
          .reduce((sum, row) => sum + Math.abs(row.amount), 0),
      );
      const credits = round2(
        monthEntries
          .filter((row) => row.amount >= 0)
          .reduce((sum, row) => sum + row.amount, 0),
      );
      return {
        accountCode,
        accountName: ACCOUNT_NAMES[accountCode] || `Account ${accountCode}`,
        openingBalance,
        debits,
        credits,
        closingBalance: round2(openingBalance + credits - debits),
      };
    });
}

async function fetchOpenAP(): Promise<MonthlyCloseReport["openAP"]> {
  const pages = await queryNotionDatabase({
    database_id: ACCOUNTS_PAYABLE_DB,
    page_size: 100,
  });

  return pages
    .map((page) => {
      const props = getProps(page);
      return {
        vendor: readText(props, ["Vendor", "Name", "Payee"]) || "Unknown vendor",
        amount: readNumber(props, ["Amount", "Balance", "Open Amount", "Total"]),
        dueDate: readDateValue(props, ["Due Date", "Date"]) || "",
        status: readText(props, ["Status", "Payment Status"]) || "open",
      };
    })
    .filter((row) => !/paid|closed|complete/i.test(row.status))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

async function fetchOpenAR(): Promise<MonthlyCloseReport["openAR"]> {
  const pages = await queryNotionDatabase({
    database_id: ACCOUNTS_RECEIVABLE_DB,
    page_size: 100,
  });

  return pages
    .map((page) => {
      const props = getProps(page);
      return {
        customer: readText(props, ["Customer", "Name", "Client"]) || "Unknown customer",
        amount: readNumber(props, ["Amount", "Balance", "Open Amount", "Total"]),
        invoiceDate: readDateValue(props, ["Invoice Date", "Date"]) || "",
        status: readText(props, ["Status", "Payment Status"]) || "open",
      };
    })
    .filter((row) => !/paid|closed|collected|complete/i.test(row.status))
    .sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate));
}

function formatCloseMarkdown(report: MonthlyCloseReport): string {
  const monthLabel = new Date(Date.UTC(report.year, report.month - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const lines = [
    `# Monthly Close — ${monthLabel}`,
    `Status: ${report.status}`,
    "",
    "## Transaction Summary",
    `- Total transactions: ${report.transactionSummary.totalTransactions}`,
    `- Categorized: ${report.transactionSummary.categorized}`,
    `- Uncategorized: ${report.transactionSummary.uncategorized}`,
    `- Total debits: ${formatCurrency(report.transactionSummary.totalDebits)}`,
    `- Total credits: ${formatCurrency(report.transactionSummary.totalCredits)}`,
    "",
    "## Account Balances",
    ...report.accountBalances.map(
      (row) => `- ${row.accountCode} ${row.accountName}: opening ${formatCurrency(row.openingBalance)}, debits ${formatCurrency(row.debits)}, credits ${formatCurrency(row.credits)}, closing ${formatCurrency(row.closingBalance)}`,
    ),
    "",
    "## Open AP",
    ...(report.openAP.length
      ? report.openAP.map(
          (row) => `- ${row.vendor}: ${formatCurrency(row.amount)} due ${row.dueDate || "unknown"} (${row.status})`,
        )
      : ["- None"]),
    "",
    "## Open AR",
    ...(report.openAR.length
      ? report.openAR.map(
          (row) => `- ${row.customer}: ${formatCurrency(row.amount)} invoiced ${row.invoiceDate || "unknown"} (${row.status})`,
        )
      : ["- None"]),
    "",
    "## Action Items",
    ...(report.actionItems.length ? report.actionItems.map((item) => `- ${item}`) : ["- No manual action items."]),
    "",
    "## Warnings",
    ...(report.warnings.length ? report.warnings.map((warning) => `- ${warning}`) : ["- No warnings."]),
    "",
    formatPnLAsMarkdown(report.pnl),
  ];

  return lines.join("\n");
}

export async function runMonthlyClose(month: number, year: number): Promise<MonthlyCloseReport> {
  const { startDate, endDate } = startAndEndOfMonth(month, year);
  const [monthRows, openingRows, openAP, openAR, pnl] = await Promise.all([
    fetchTransactionsInRange(startDate, endDate),
    fetchTransactionsInRange("2025-01-01", previousDay(startDate)),
    fetchOpenAP(),
    fetchOpenAR(),
    generatePnL(buildMonthlyStatementPeriod(month, year)),
  ]);

  const uncategorized = monthRows.filter((row) => !row.accountCode).length;
  const totalDebits = round2(
    monthRows.filter((row) => row.amount < 0).reduce((sum, row) => sum + Math.abs(row.amount), 0),
  );
  const totalCredits = round2(
    monthRows.filter((row) => row.amount >= 0).reduce((sum, row) => sum + row.amount, 0),
  );

  const actionItems: string[] = [];
  const warnings = [...pnl.warnings];
  if (uncategorized > 0) {
    actionItems.push(`Categorize ${uncategorized} uncategorized cash transactions before final close.`);
  }
  const overdueAP = openAP.filter((row) => row.dueDate && row.dueDate < endDate);
  if (overdueAP.length > 0) {
    actionItems.push(`Review ${overdueAP.length} overdue AP items before finalizing the close.`);
  }
  const overdueAR = openAR.filter((row) => row.invoiceDate && row.invoiceDate < endDate);
  if (overdueAR.length > 0) {
    actionItems.push(`Follow up on ${overdueAR.length} outstanding AR items carried into the next month.`);
  }
  if (pnl.warnings.length > 0) {
    actionItems.push(`Resolve ${pnl.warnings.length} P&L warning${pnl.warnings.length === 1 ? "" : "s"} before marking the month closed.`);
  }

  const status: MonthlyCloseReport["status"] =
    actionItems.length === 0 ? "closed" : uncategorized > 0 ? "draft" : "review";

  return {
    month,
    year,
    status,
    transactionSummary: {
      totalTransactions: monthRows.length,
      categorized: monthRows.length - uncategorized,
      uncategorized,
      totalDebits,
      totalCredits,
    },
    accountBalances: summarizeAccountBalances(openingRows, monthRows),
    openAP,
    openAR,
    pnl,
    actionItems,
    warnings,
  };
}

export async function postCloseToNotion(report: MonthlyCloseReport): Promise<string> {
  const title = `Monthly Close — ${new Date(Date.UTC(report.year, report.month - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })}`;

  const pageId = await createNotionPage({
    parent_id: MONTHLY_CLOSE_CHECKLIST_DB,
    title,
    content: formatCloseMarkdown(report),
  });

  if (!pageId) {
    throw new Error("Failed to create monthly close page in Notion");
  }

  return pageId;
}

export async function notifyCloseReady(report: MonthlyCloseReport): Promise<void> {
  const summary = [
    `Monthly close prepared for ${String(report.month).padStart(2, "0")}/${report.year}`,
    `Status: ${report.status}`,
    `Transactions: ${report.transactionSummary.totalTransactions}`,
    `Net operating income: ${formatCurrency(report.pnl.netOperatingIncome)}`,
    `Action items: ${report.actionItems.length}`,
    ...report.actionItems.slice(0, 5).map((item) => `- ${item}`),
    "",
    formatPnLAsText(report.pnl),
  ].join("\n");

  await notify({ channel: "daily", text: summary });
}
