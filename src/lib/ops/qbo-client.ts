/**
 * QuickBooks Online API Client — USA Gummies
 *
 * QBO is the accounting platform providing real-time financial visibility
 * (P&L, balance sheet, cash flow, transactions). We use it as the single
 * source of truth for financial reporting in the ops dashboard and for
 * Abra's financial intelligence layer.
 *
 * Auth: OAuth 2.0 Bearer tokens, managed by qbo-auth.ts
 * Tokens are stored in Vercel KV and auto-refreshed.
 *
 * API docs: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities
 * Production base: https://quickbooks.api.intuit.com/v3/company/{realmId}
 * Sandbox base: https://sandbox-quickbooks.api.intuit.com/v3/company/{realmId}
 */

import {
  getValidAccessToken,
  getRealmId,
  isQBOConnected,
} from "./qbo-auth";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const QBO_SANDBOX = process.env.QBO_SANDBOX === "true";

function getBaseUrl(realmId: string): string {
  const host = QBO_SANDBOX
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
  return `${host}/v3/company/${realmId}`;
}

/** Check whether QBO credentials are configured and tokens exist. */
export async function isQBOConfigured(): Promise<boolean> {
  return isQBOConnected();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QBOReport = {
  Header: Record<string, unknown>;
  Columns: Record<string, unknown>;
  Rows: Record<string, unknown>;
};

export type QBOQueryResponse = {
  QueryResponse: Record<string, unknown>;
  time: string;
};

export type QBOEntity = Record<string, unknown>;

export type QBOJournalEntryLine = {
  DetailType: "JournalEntryLineDetail";
  Amount: number;
  Description?: string;
  JournalEntryLineDetail: {
    PostingType: "Debit" | "Credit";
    AccountRef: { value: string; name?: string };
  };
};

export type QBOJournalEntryInput = {
  TxnDate?: string;
  PrivateNote?: string;
  Line: QBOJournalEntryLine[];
};

export type QBOMetrics = {
  cashPosition: number;
  burnRate: number; // monthly
  runway: number; // months
  accountsReceivable: number;
  accountsPayable: number;
  netIncome: number;
  totalRevenue: number;
  totalExpenses: number;
  currency: string;
  asOfDate: string;
};

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

async function qboFetch<T>(
  path: string,
  init?: RequestInit,
  retried = false,
): Promise<T | null> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    console.warn(
      "[qbo] No valid access token — is QBO connected? Visit /api/ops/qbo/authorize",
    );
    return null;
  }

  const realmId = await getRealmId();
  if (!realmId) {
    console.warn("[qbo] No realm ID stored — reconnect QBO");
    return null;
  }

  const baseUrl = getBaseUrl(realmId);
  const url = `${baseUrl}${path}`;

  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(init?.headers || {}),
      },
      signal: init?.signal ?? AbortSignal.timeout(30000),
    });

    // Retry once on 401 (token may have just expired)
    if (res.status === 401 && !retried) {
      console.log("[qbo] Got 401, retrying with fresh token...");
      return qboFetch<T>(path, init, true);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(
        `[qbo] ${init?.method || "GET"} ${path} failed: ${res.status} — ${text.slice(0, 300)}`,
      );
      return null;
    }

    return (await res.json()) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[qbo] ${init?.method || "GET"} ${path} error: ${message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Financial Reports
// ---------------------------------------------------------------------------

/**
 * Fetch Profit & Loss (Income Statement) for a date range.
 * GET /reports/ProfitAndLoss?start_date=X&end_date=Y
 */
export async function getQBOProfitAndLoss(
  startDate: string,
  endDate: string,
): Promise<QBOReport | null> {
  return qboFetch<QBOReport>(
    `/reports/ProfitAndLoss?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`,
  );
}

/**
 * Fetch Balance Sheet as of a specific date.
 * GET /reports/BalanceSheet?as_of_date=X
 */
export async function getQBOBalanceSheet(
  asOfDate?: string,
): Promise<QBOReport | null> {
  const param = asOfDate
    ? `as_of_date=${encodeURIComponent(asOfDate)}`
    : "date_macro=Today";
  return qboFetch<QBOReport>(`/reports/BalanceSheet?${param}`);
}

/**
 * Fetch Cash Flow Statement for a date range.
 * GET /reports/CashFlow?start_date=X&end_date=Y
 */
export async function getQBOCashFlow(
  startDate: string,
  endDate: string,
): Promise<QBOReport | null> {
  return qboFetch<QBOReport>(
    `/reports/CashFlow?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`,
  );
}

// ---------------------------------------------------------------------------
// Query-based reads
// ---------------------------------------------------------------------------

/**
 * Fetch transactions (Purchases) with optional date filter.
 * Uses QBO SQL-like query API.
 */
export async function getQBOTransactions(
  startDate?: string,
  endDate?: string,
  limit?: number,
): Promise<QBOQueryResponse | null> {
  let query = "SELECT * FROM Purchase";
  const conditions: string[] = [];

  if (startDate) conditions.push(`TxnDate >= '${startDate}'`);
  if (endDate) conditions.push(`TxnDate <= '${endDate}'`);

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }

  query += " ORDERBY TxnDate DESC";
  if (limit) query += ` MAXRESULTS ${limit}`;

  return qboFetch<QBOQueryResponse>(
    `/query?query=${encodeURIComponent(query)}`,
  );
}

/**
 * Fetch all accounts (Chart of Accounts).
 * GET /query?query=SELECT * FROM Account ORDERBY Name
 */
export async function getQBOAccounts(): Promise<QBOQueryResponse | null> {
  return qboFetch<QBOQueryResponse>(
    `/query?query=${encodeURIComponent("SELECT * FROM Account ORDERBY Name")}`,
  );
}

/**
 * Fetch all vendors.
 * GET /query?query=SELECT * FROM Vendor ORDERBY DisplayName
 */
export async function getQBOVendors(): Promise<QBOQueryResponse | null> {
  return qboFetch<QBOQueryResponse>(
    `/query?query=${encodeURIComponent("SELECT * FROM Vendor ORDERBY DisplayName")}`,
  );
}

/**
 * Fetch all customers.
 * GET /query?query=SELECT * FROM Customer ORDERBY DisplayName
 */
export async function getQBOCustomers(): Promise<QBOQueryResponse | null> {
  return qboFetch<QBOQueryResponse>(
    `/query?query=${encodeURIComponent("SELECT * FROM Customer ORDERBY DisplayName")}`,
  );
}

/**
 * Fetch invoices with optional date filter.
 */
export async function getQBOInvoices(
  startDate?: string,
  endDate?: string,
): Promise<QBOQueryResponse | null> {
  let query = "SELECT * FROM Invoice";
  const conditions: string[] = [];

  if (startDate) conditions.push(`TxnDate >= '${startDate}'`);
  if (endDate) conditions.push(`TxnDate <= '${endDate}'`);

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }

  return qboFetch<QBOQueryResponse>(
    `/query?query=${encodeURIComponent(query)}`,
  );
}

/**
 * Fetch bills with optional date filter.
 */
export async function getQBOBills(
  startDate?: string,
  endDate?: string,
): Promise<QBOQueryResponse | null> {
  let query = "SELECT * FROM Bill";
  const conditions: string[] = [];

  if (startDate) conditions.push(`TxnDate >= '${startDate}'`);
  if (endDate) conditions.push(`TxnDate <= '${endDate}'`);

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }

  return qboFetch<QBOQueryResponse>(
    `/query?query=${encodeURIComponent(query)}`,
  );
}

// ---------------------------------------------------------------------------
// Write functions
// ---------------------------------------------------------------------------

/**
 * Create a journal entry in QBO.
 * POST /journalentry
 */
export async function createQBOJournalEntry(
  entry: QBOJournalEntryInput,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/journalentry", {
    method: "POST",
    body: JSON.stringify(entry),
  });
}

// ---------------------------------------------------------------------------
// Company Info
// ---------------------------------------------------------------------------

/**
 * Get company info for the connected QBO account.
 * GET /companyinfo/{realmId}
 */
export async function getQBOCompanyInfo(): Promise<QBOEntity | null> {
  const realmId = await getRealmId();
  if (!realmId) return null;
  return qboFetch<QBOEntity>(`/companyinfo/${realmId}`);
}

// ---------------------------------------------------------------------------
// Composite Metrics
// ---------------------------------------------------------------------------

/**
 * Fetch combined key financial metrics from P&L + Balance Sheet.
 * Computes burn rate, runway, cash position.
 */
export async function getQBOMetrics(): Promise<QBOMetrics | null> {
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const [pnl, balanceSheet] = await Promise.all([
    getQBOProfitAndLoss(thirtyDaysAgo, today),
    getQBOBalanceSheet(today),
  ]);

  if (!pnl && !balanceSheet) return null;

  // Extract totals from QBO report structures
  // QBO reports use nested Row structures; extract conservatively
  const cashPosition = extractReportTotal(balanceSheet, "Bank") ?? 0;
  const accountsReceivable =
    extractReportTotal(balanceSheet, "Accounts Receivable") ?? 0;
  const accountsPayable =
    extractReportTotal(balanceSheet, "Accounts Payable") ?? 0;
  const totalRevenue = extractReportTotal(pnl, "Total Income") ?? 0;
  const totalExpenses = extractReportTotal(pnl, "Total Expenses") ?? 0;
  const netIncome = extractReportTotal(pnl, "Net Income") ?? 0;

  // Burn rate = total expenses over 30 days, annualized to monthly
  const burnRate = totalExpenses;
  const runway = burnRate > 0 ? cashPosition / burnRate : Infinity;

  return {
    cashPosition,
    burnRate,
    runway: Math.round(runway * 10) / 10,
    accountsReceivable,
    accountsPayable,
    netIncome,
    totalRevenue,
    totalExpenses,
    currency: "USD",
    asOfDate: today,
  };
}

/**
 * Attempt to extract a total value from a QBO report by searching for
 * a row with a matching group label. Returns null if not found.
 */
function extractReportTotal(
  report: QBOReport | null,
  label: string,
): number | null {
  const rows = report?.Rows?.Row as unknown[] | undefined;
  if (!rows) return null;

  function searchRows(rows: unknown[]): number | null {
    for (const rawRow of rows) {
      const row = rawRow as Record<string, Record<string, unknown>>;

      // Check Summary rows
      const summary = row.Summary as Record<string, unknown> | undefined;
      const header = row.Header as Record<string, unknown> | undefined;
      const colData = summary?.ColData as Array<{ value: string }> | undefined;
      const headerColData = header?.ColData as Array<{ value: string }> | undefined;

      if (colData) {
        const headerVal = headerColData?.[0]?.value ?? "";
        const summaryLabel = colData[0]?.value ?? "";
        if (headerVal.includes(label) || summaryLabel.includes(label)) {
          const val = parseFloat(colData[colData.length - 1]?.value);
          if (!isNaN(val)) return val;
        }
      }

      // Check direct ColData rows
      const directColData = row.ColData as unknown as Array<{ value: string }> | undefined;
      if (directColData) {
        const rowLabel = directColData[0]?.value ?? "";
        if (rowLabel.includes(label)) {
          const val = parseFloat(directColData[directColData.length - 1]?.value);
          if (!isNaN(val)) return val;
        }
      }

      // Recurse into nested rows
      const nestedRows = row.Rows as Record<string, unknown> | undefined;
      if (nestedRows?.Row) {
        const found = searchRows(nestedRows.Row as unknown[]);
        if (found !== null) return found;
      }
    }
    return null;
  }

  return searchRows(rows);
}
