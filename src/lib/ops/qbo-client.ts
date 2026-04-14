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
  forceRefreshTokens,
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
  // Always include minorversion to ensure newer fields (AcctNum, etc.) are accepted
  const separator = path.includes("?") ? "&" : "?";
  const url = `${baseUrl}${path}${separator}minorversion=73`;

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

    // Retry once on 401 — force a token refresh before retrying.
    // qboFetch retries by calling getValidAccessToken() which only refreshes
    // when expiresAt has passed. But Intuit can invalidate tokens early, so
    // we must force a refresh regardless of what expiresAt says.
    if (res.status === 401 && !retried) {
      console.log("[qbo] Got 401, force-refreshing token before retry...");
      await forceRefreshTokens();
      return qboFetch<T>(path, init, true);
    }

    // Handle rate limiting — wait and retry once
    if (res.status === 429 && !retried) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
      console.warn(`[qbo] Rate limited (429), waiting ${retryAfter}s before retry...`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
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

// ---------------------------------------------------------------------------
// WRITE: Vendor Management
// ---------------------------------------------------------------------------

export type QBOVendorInput = {
  DisplayName: string;
  CompanyName?: string;
  PrimaryEmailAddr?: { Address: string };
  PrimaryPhone?: { FreeFormNumber: string };
  BillAddr?: {
    Line1?: string;
    City?: string;
    CountrySubDivisionCode?: string;
    PostalCode?: string;
  };
  PrintOnCheckName?: string;
};

/**
 * Create a vendor in QBO.
 * POST /vendor
 */
export async function createQBOVendor(
  vendor: QBOVendorInput,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/vendor", {
    method: "POST",
    body: JSON.stringify(vendor),
  });
}

/**
 * Update an existing vendor in QBO.
 * POST /vendor (with Id and SyncToken)
 */
export async function updateQBOVendor(
  vendor: QBOEntity,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/vendor", {
    method: "POST",
    body: JSON.stringify(vendor),
  });
}

// ---------------------------------------------------------------------------
// WRITE: Account (Chart of Accounts) Management
// ---------------------------------------------------------------------------

export type QBOAccountInput = {
  Name: string;
  AccountType: string;
  AccountSubType?: string;
  AcctNum?: string;
  Description?: string;
  ParentRef?: { value: string };
  SubAccount?: boolean;
};

const VALID_QBO_ACCOUNT_TYPES = new Set([
  "Bank", "Other Current Asset", "Fixed Asset", "Other Asset",
  "Accounts Receivable", "Equity", "Expense", "Other Expense",
  "Cost of Goods Sold", "Accounts Payable", "Credit Card",
  "Long Term Liability", "Other Current Liability", "Income",
  "Other Income",
]);

/**
 * Create an account in QBO Chart of Accounts.
 * POST /account
 */
export async function createQBOAccount(
  account: QBOAccountInput,
): Promise<QBOEntity | null> {
  if (!VALID_QBO_ACCOUNT_TYPES.has(account.AccountType)) {
    throw new Error(`Invalid QBO AccountType: "${account.AccountType}". Valid: ${[...VALID_QBO_ACCOUNT_TYPES].join(", ")}`);
  }
  return qboFetch<QBOEntity>("/account", {
    method: "POST",
    body: JSON.stringify(account),
  });
}

/**
 * Update an existing account in QBO.
 * POST /account (with Id and SyncToken — fetch first to get SyncToken)
 */
export async function updateQBOAccount(
  account: QBOEntity,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/account", {
    method: "POST",
    body: JSON.stringify(account),
  });
}

// ---------------------------------------------------------------------------
// WRITE: Invoice
// ---------------------------------------------------------------------------

export type QBOInvoiceLineInput = {
  Description: string;
  Amount: number;
  Qty?: number;
  UnitPrice?: number;
  ItemRef?: { value: string; name?: string };
};

export type QBOInvoiceInput = {
  CustomerRef: { value: string };
  Line: Array<{
    Amount: number;
    DetailType: "SalesItemLineDetail";
    SalesItemLineDetail: {
      ItemRef?: { value: string; name?: string };
      Qty?: number;
      UnitPrice?: number;
    };
    Description?: string;
  }>;
  DueDate?: string;
  DocNumber?: string;
  CustomerMemo?: { value: string };
  BillEmail?: { Address: string };
};

/**
 * Create an invoice in QBO.
 * POST /invoice
 */
export async function createQBOInvoice(
  invoice: QBOInvoiceInput,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/invoice", {
    method: "POST",
    body: JSON.stringify(invoice),
  });
}

export async function deleteQBOInvoice(
  invoiceId: string,
  syncToken: string,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/invoice?operation=delete&minorversion=73", {
    method: "POST",
    body: JSON.stringify({
      Id: invoiceId,
      SyncToken: syncToken,
    }),
  });
}

// ---------------------------------------------------------------------------
// WRITE: Bill (record a vendor bill / AP)
// ---------------------------------------------------------------------------

export type QBOBillInput = {
  VendorRef: { value: string };
  Line: Array<{
    Amount: number;
    DetailType: "AccountBasedExpenseLineDetail";
    AccountBasedExpenseLineDetail: {
      AccountRef: { value: string };
    };
    Description?: string;
  }>;
  DueDate?: string;
  DocNumber?: string;
  TxnDate?: string;
};

/**
 * Create a bill (AP entry) in QBO.
 * POST /bill
 */
export async function createQBOBill(
  bill: QBOBillInput,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/bill", {
    method: "POST",
    body: JSON.stringify(bill),
  });
}

// ---------------------------------------------------------------------------
// WRITE: Purchase Order
// ---------------------------------------------------------------------------

export type QBOPurchaseOrderLine = {
  Amount: number;
  DetailType: "ItemBasedExpenseLineDetail";
  ItemBasedExpenseLineDetail: {
    ItemRef: { value: string; name?: string };
    Qty?: number;
    UnitPrice?: number;
    CustomerRef?: { value: string };
  };
  Description?: string;
};

export type QBOPurchaseOrderInput = {
  VendorRef: { value: string };
  APAccountRef?: { value: string };
  Line: QBOPurchaseOrderLine[];
  TxnDate?: string;
  DueDate?: string;
  DocNumber?: string;
  Memo?: string;
  ShipAddr?: {
    Line1?: string;
    City?: string;
    CountrySubDivisionCode?: string;
    PostalCode?: string;
  };
};

/**
 * Create a Purchase Order in QBO.
 * POST /purchaseorder
 */
export async function createQBOPurchaseOrder(
  po: QBOPurchaseOrderInput,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/purchaseorder", {
    method: "POST",
    body: JSON.stringify(po),
  });
}

/**
 * Read a Purchase Order by ID.
 * GET /purchaseorder/{id}
 */
export async function getQBOPurchaseOrder(
  id: string,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>(`/purchaseorder/${id}`);
}

/**
 * Update a Purchase Order (sparse update).
 * POST /purchaseorder (with Id and SyncToken)
 */
export async function updateQBOPurchaseOrder(
  po: QBOEntity,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/purchaseorder", {
    method: "POST",
    body: JSON.stringify(po),
  });
}

/**
 * Delete a Purchase Order in QBO.
 * POST /purchaseorder?operation=delete
 */
export async function deleteQBOPurchaseOrder(
  id: string,
  syncToken: string,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/purchaseorder?operation=delete", {
    method: "POST",
    body: JSON.stringify({ Id: id, SyncToken: syncToken }),
  });
}

/**
 * Query Purchase Orders.
 * GET /query?query=SELECT * FROM PurchaseOrder ...
 */
export async function getQBOPurchaseOrders(
  startDate?: string,
  endDate?: string,
): Promise<QBOEntity[]> {
  let sql = "SELECT * FROM PurchaseOrder";
  const conditions: string[] = [];
  if (startDate) conditions.push(`TxnDate >= '${startDate}'`);
  if (endDate) conditions.push(`TxnDate <= '${endDate}'`);
  if (conditions.length > 0) sql += ` WHERE ${conditions.join(" AND ")}`;
  sql += " MAXRESULTS 100";

  const res = await qboFetch<{ QueryResponse?: { PurchaseOrder?: QBOEntity[] } }>(
    `/query?query=${encodeURIComponent(sql)}`,
  );
  return res?.QueryResponse?.PurchaseOrder || [];
}

// ---------------------------------------------------------------------------
// WRITE: Customer Management
// ---------------------------------------------------------------------------

export type QBOCustomerInput = {
  DisplayName: string;
  CompanyName?: string;
  PrimaryEmailAddr?: { Address: string };
  PrimaryPhone?: { FreeFormNumber: string };
  Notes?: string;
  BillAddr?: {
    Line1?: string;
    City?: string;
    CountrySubDivisionCode?: string;
    PostalCode?: string;
  };
  ShipAddr?: {
    Line1?: string;
    City?: string;
    CountrySubDivisionCode?: string;
    PostalCode?: string;
  };
};

/**
 * Create a customer in QBO.
 * POST /customer
 */
export async function createQBOCustomer(
  customer: QBOCustomerInput,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/customer", {
    method: "POST",
    body: JSON.stringify(customer),
  });
}

// ---------------------------------------------------------------------------
// WRITE: Deposit (bank deposit)
// ---------------------------------------------------------------------------

export type QBODepositInput = {
  DepositToAccountRef: { value: string };
  TxnDate?: string;
  PrivateNote?: string;
  Line: Array<{
    Amount: number;
    DetailType: "DepositLineDetail";
    DepositLineDetail: {
      AccountRef: { value: string };
      Entity?: { value: string; type?: string };
    };
    Description?: string;
  }>;
};

export async function createQBODeposit(
  deposit: QBODepositInput,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/deposit", {
    method: "POST",
    body: JSON.stringify(deposit),
  });
}

// ---------------------------------------------------------------------------
// WRITE: Purchase (expense / check / credit card charge)
// ---------------------------------------------------------------------------

export type QBOPurchaseInput = {
  AccountRef: { value: string };
  PaymentType: "Cash" | "Check" | "CreditCard";
  TxnDate?: string;
  DocNumber?: string;
  PrivateNote?: string;
  EntityRef?: { value: string; type?: string };
  Line: Array<{
    Amount: number;
    DetailType: "AccountBasedExpenseLineDetail";
    AccountBasedExpenseLineDetail: {
      AccountRef: { value: string };
    };
    Description?: string;
  }>;
};

export async function createQBOPurchase(
  purchase: QBOPurchaseInput,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/purchase", {
    method: "POST",
    body: JSON.stringify(purchase),
  });
}

// ---------------------------------------------------------------------------
// WRITE: Transfer (bank-to-bank transfer)
// ---------------------------------------------------------------------------

export type QBOTransferInput = {
  FromAccountRef: { value: string };
  ToAccountRef: { value: string };
  Amount: number;
  TxnDate?: string;
  PrivateNote?: string;
};

export async function createQBOTransfer(
  transfer: QBOTransferInput,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/transfer", {
    method: "POST",
    body: JSON.stringify(transfer),
  });
}

// ---------------------------------------------------------------------------
// WRITE: Bill Payment
// ---------------------------------------------------------------------------

export type QBOBillPaymentInput = {
  VendorRef: { value: string };
  TotalAmt: number;
  PayType: "Check" | "CreditCard";
  CheckPayment?: {
    BankAccountRef: { value: string };
  };
  CreditCardPayment?: {
    CCAccountRef: { value: string };
  };
  Line: Array<{
    Amount: number;
    LinkedTxn: Array<{ TxnId: string; TxnType: "Bill" }>;
  }>;
  TxnDate?: string;
  PrivateNote?: string;
};

export async function createQBOBillPayment(
  payment: QBOBillPaymentInput,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/billpayment", {
    method: "POST",
    body: JSON.stringify(payment),
  });
}

// ---------------------------------------------------------------------------
// WRITE: Receive Payment (customer payment against invoices)
// ---------------------------------------------------------------------------

export type QBOPaymentInput = {
  TotalAmt: number;
  CustomerRef: { value: string; name?: string };
  DepositToAccountRef?: { value: string };
  PaymentMethodRef?: { value: string };
  TxnDate?: string;
  PrivateNote?: string;
  Line?: {
    Amount: number;
    LinkedTxn: { TxnId: string; TxnType: "Invoice" }[];
  }[];
};

export async function createQBOPayment(
  payment: QBOPaymentInput,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/payment", {
    method: "POST",
    body: JSON.stringify(payment),
  });
}

/**
 * Void a payment in QBO.
 * POST /payment?operation=void (requires Id + SyncToken)
 */
export async function voidQBOPayment(
  id: string,
  syncToken: string,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/payment?operation=void", {
    method: "POST",
    body: JSON.stringify({ Id: id, SyncToken: syncToken, sparse: true }),
  });
}

/**
 * Delete a payment in QBO.
 * POST /payment?operation=delete (requires Id + SyncToken)
 */
export async function deleteQBOPayment(
  id: string,
  syncToken: string,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/payment?operation=delete", {
    method: "POST",
    body: JSON.stringify({ Id: id, SyncToken: syncToken }),
  });
}

/**
 * Void a bill payment in QBO.
 * POST /billpayment?operation=void
 */
export async function voidQBOBillPayment(
  id: string,
  syncToken: string,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/billpayment?operation=void", {
    method: "POST",
    body: JSON.stringify({ Id: id, SyncToken: syncToken, sparse: true }),
  });
}

/**
 * Delete a bill in QBO.
 * POST /bill?operation=delete
 */
export async function deleteQBOBill(
  id: string,
  syncToken: string,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/bill?operation=delete", {
    method: "POST",
    body: JSON.stringify({ Id: id, SyncToken: syncToken }),
  });
}

// ---------------------------------------------------------------------------
// WRITE: Sales Receipt (point-of-sale / settlement receipts)
// ---------------------------------------------------------------------------

export type QBOSalesReceiptLineInput = {
  Amount: number;
  DetailType: "SalesItemLineDetail";
  SalesItemLineDetail: {
    ItemRef: { value: string; name?: string };
    Qty?: number;
    UnitPrice?: number;
  };
  Description?: string;
};

export type QBOSalesReceiptInput = {
  CustomerRef: { value: string; name?: string };
  Line: QBOSalesReceiptLineInput[];
  TxnDate?: string;
  DocNumber?: string;
  PrivateNote?: string;
  DepositToAccountRef?: { value: string }; // bank account to deposit to
  PaymentMethodRef?: { value: string };
  CustomerMemo?: { value: string };
};

/**
 * Create a Sales Receipt in QBO.
 * POST /salesreceipt
 *
 * Sales Receipts record point-of-sale transactions where payment is received
 * immediately. For USA Gummies, these are used to decompose marketplace
 * settlement deposits (Amazon, Shopify, Faire) into gross revenue, fees,
 * and refunds per COA structure.
 */
export async function createQBOSalesReceipt(
  receipt: QBOSalesReceiptInput,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/salesreceipt", {
    method: "POST",
    body: JSON.stringify(receipt),
  });
}

/**
 * Read a Sales Receipt by ID.
 * GET /salesreceipt/{id}
 */
export async function getQBOSalesReceipt(
  id: string,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>(`/salesreceipt/${id}`);
}

/**
 * Update a Sales Receipt (sparse update).
 * POST /salesreceipt (with Id and SyncToken)
 */
export async function updateQBOSalesReceipt(
  receipt: QBOEntity,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/salesreceipt", {
    method: "POST",
    body: JSON.stringify(receipt),
  });
}

/**
 * Delete a Sales Receipt.
 * POST /salesreceipt?operation=delete
 */
export async function deleteQBOSalesReceipt(
  id: string,
  syncToken: string,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/salesreceipt?operation=delete", {
    method: "POST",
    body: JSON.stringify({ Id: id, SyncToken: syncToken }),
  });
}

/**
 * Query Sales Receipts with optional date filter.
 */
export async function getQBOSalesReceipts(
  startDate?: string,
  endDate?: string,
): Promise<QBOEntity[]> {
  let sql = "SELECT * FROM SalesReceipt";
  const conditions: string[] = [];
  if (startDate) conditions.push(`TxnDate >= '${startDate}'`);
  if (endDate) conditions.push(`TxnDate <= '${endDate}'`);
  if (conditions.length > 0) sql += ` WHERE ${conditions.join(" AND ")}`;
  sql += " MAXRESULTS 200";

  const res = await qboFetch<{ QueryResponse?: { SalesReceipt?: QBOEntity[] } }>(
    `/query?query=${encodeURIComponent(sql)}`,
  );
  return res?.QueryResponse?.SalesReceipt || [];
}

// ---------------------------------------------------------------------------
// WRITE: Estimate (QBO's Sales Order equivalent)
// ---------------------------------------------------------------------------

export type QBOEstimateInput = {
  CustomerRef: { value: string; name?: string };
  Line: Array<{
    Amount: number;
    DetailType: "SalesItemLineDetail";
    SalesItemLineDetail: {
      ItemRef: { value: string; name?: string };
      Qty?: number;
      UnitPrice?: number;
    };
    Description?: string;
  }>;
  TxnDate?: string;
  ExpirationDate?: string;
  DocNumber?: string;
  CustomerMemo?: { value: string };
  BillEmail?: { Address: string };
  PrivateNote?: string;
  TxnStatus?: "Pending" | "Accepted" | "Closed" | "Rejected";
};

/**
 * Create an Estimate (Sales Order) in QBO.
 * POST /estimate
 */
export async function createQBOEstimate(
  estimate: QBOEstimateInput,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/estimate", {
    method: "POST",
    body: JSON.stringify(estimate),
  });
}

/**
 * Read an Estimate by ID.
 * GET /estimate/{id}
 */
export async function getQBOEstimate(
  id: string,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>(`/estimate/${id}`);
}

/**
 * Update an Estimate (sparse update).
 * POST /estimate (with Id and SyncToken)
 */
export async function updateQBOEstimate(
  estimate: QBOEntity,
): Promise<QBOEntity | null> {
  return qboFetch<QBOEntity>("/estimate", {
    method: "POST",
    body: JSON.stringify(estimate),
  });
}

/**
 * Query Estimates.
 */
export async function getQBOEstimates(
  startDate?: string,
  endDate?: string,
): Promise<QBOEntity[]> {
  let sql = "SELECT * FROM Estimate";
  const conditions: string[] = [];
  if (startDate) conditions.push(`TxnDate >= '${startDate}'`);
  if (endDate) conditions.push(`TxnDate <= '${endDate}'`);
  if (conditions.length > 0) sql += ` WHERE ${conditions.join(" AND ")}`;
  sql += " MAXRESULTS 100";

  const res = await qboFetch<{ QueryResponse?: { Estimate?: QBOEntity[] } }>(
    `/query?query=${encodeURIComponent(sql)}`,
  );
  return res?.QueryResponse?.Estimate || [];
}
