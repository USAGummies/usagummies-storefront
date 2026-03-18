/**
 * Puzzle.io Accounting API Client — USA Gummies
 *
 * Puzzle is a modern accounting platform that provides real-time financial
 * visibility (P&L, balance sheet, cash flow, transactions). We use it as
 * the single source of truth for financial reporting in the ops dashboard
 * and for Abra's financial intelligence layer.
 *
 * Auth: OAuth 2.0 Bearer tokens, managed by puzzle-auth.ts
 * Tokens are stored in Vercel KV and auto-refreshed.
 *
 * API docs: https://puzzle-api.readme.io/reference/getting-started
 * Production base: https://api.puzzle.io/rest/v0
 * Sandbox base: https://staging.southparkdata.com/rest/v0
 */

import { getValidAccessToken, isPuzzleConnected } from "./puzzle-auth";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PUZZLE_BASE_URL =
  process.env.PUZZLE_API_BASE_URL || "https://api.puzzle.io/rest/v0";

/** Check whether Puzzle credentials are configured and tokens exist. */
export async function isPuzzleConfigured(): Promise<boolean> {
  return isPuzzleConnected();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PuzzleAccount = {
  id: string;
  name: string;
  number: string;
  type: string; // e.g. "asset", "liability", "equity", "revenue", "expense"
  subType: string | null;
  balance: number;
  currency: string;
  isActive: boolean;
};

export type PuzzleTransaction = {
  id: string;
  date: string;
  description: string;
  amount: number;
  accountId: string;
  accountName: string | null;
  category: string | null;
  categoryId: string | null;
  type: string; // e.g. "debit", "credit"
  status: string; // e.g. "posted", "pending"
  currency: string;
  createdAt: string;
  updatedAt: string;
};

export type PuzzleLineItem = {
  accountId: string;
  accountName: string;
  amount: number;
};

export type PuzzlePnL = {
  startDate: string;
  endDate: string;
  revenue: PuzzleLineItem[];
  costOfGoodsSold: PuzzleLineItem[];
  operatingExpenses: PuzzleLineItem[];
  otherIncome: PuzzleLineItem[];
  otherExpenses: PuzzleLineItem[];
  totalRevenue: number;
  totalCOGS: number;
  grossProfit: number;
  totalOperatingExpenses: number;
  operatingIncome: number;
  netIncome: number;
  currency: string;
};

export type PuzzleBalanceSheet = {
  asOfDate: string;
  assets: PuzzleLineItem[];
  liabilities: PuzzleLineItem[];
  equity: PuzzleLineItem[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  currency: string;
};

export type PuzzleCashFlow = {
  startDate: string;
  endDate: string;
  operatingActivities: PuzzleLineItem[];
  investingActivities: PuzzleLineItem[];
  financingActivities: PuzzleLineItem[];
  netCashFromOperations: number;
  netCashFromInvesting: number;
  netCashFromFinancing: number;
  netChangeInCash: number;
  beginningCashBalance: number;
  endingCashBalance: number;
  currency: string;
};

export type PuzzleMetrics = {
  cashPosition: number;
  burnRate: number; // monthly
  runway: number; // months
  accountsReceivable: number;
  accountsPayable: number;
  currency: string;
  asOfDate: string;
};

export type PuzzleTransactionList = {
  transactions: PuzzleTransaction[];
  total: number;
  hasMore: boolean;
};

export type PuzzleCreateTransactionParams = {
  date: string;
  description: string;
  amount: number;
  accountId: string;
  category?: string;
};

export type PuzzleCreateTransactionResult = {
  id: string;
  date: string;
  description: string;
  amount: number;
  accountId: string;
  status: string;
};

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

async function puzzleFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T | null> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    console.warn("[puzzle] No valid access token — is Puzzle connected? Visit /api/ops/puzzle/authorize");
    return null;
  }

  const url = `${PUZZLE_BASE_URL}${path}`;

  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(init?.headers || {}),
      },
      signal: init?.signal ?? AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(
        `[puzzle] ${init?.method || "GET"} ${path} failed: ${res.status} — ${text.slice(0, 300)}`,
      );
      return null;
    }

    return (await res.json()) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[puzzle] ${init?.method || "GET"} ${path} error: ${message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Read functions — Financial Reports
// ---------------------------------------------------------------------------

/**
 * Fetch Income Statement (P&L) for a date range.
 * Endpoint: GET /reports/income-statement
 */
export async function getPuzzlePnL(
  startDate: string,
  endDate: string,
): Promise<PuzzlePnL | null> {
  return puzzleFetch<PuzzlePnL>(
    `/reports/income-statement?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
  );
}

/**
 * Fetch Balance Sheet as of a specific date.
 * Endpoint: GET /reports/balance-sheet
 */
export async function getPuzzleBalanceSheet(
  asOfDate: string,
): Promise<PuzzleBalanceSheet | null> {
  return puzzleFetch<PuzzleBalanceSheet>(
    `/reports/balance-sheet?asOfDate=${encodeURIComponent(asOfDate)}`,
  );
}

/**
 * Fetch Cash Activity Statement for a date range.
 * Endpoint: GET /reports/cash-activity
 */
export async function getPuzzleCashFlow(
  startDate: string,
  endDate: string,
): Promise<PuzzleCashFlow | null> {
  return puzzleFetch<PuzzleCashFlow>(
    `/reports/cash-activity?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
  );
}

/**
 * Fetch Vendor Spending Report.
 * Endpoint: GET /reports/vendor-spending
 */
export async function getPuzzleVendorSpending(
  startDate: string,
  endDate: string,
): Promise<unknown | null> {
  return puzzleFetch(
    `/reports/vendor-spending?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
  );
}

// ---------------------------------------------------------------------------
// Read functions — Transactions
// ---------------------------------------------------------------------------

/**
 * List transactions with optional filters.
 * Endpoint: GET /transactions
 */
export async function getPuzzleTransactions(params: {
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}): Promise<PuzzleTransactionList | null> {
  const qs = new URLSearchParams();
  if (params.startDate) qs.set("startDate", params.startDate);
  if (params.endDate) qs.set("endDate", params.endDate);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));

  const query = qs.toString();
  return puzzleFetch<PuzzleTransactionList>(
    `/transactions${query ? `?${query}` : ""}`,
  );
}

/**
 * Get a single transaction by ID.
 * Endpoint: GET /transactions/:id
 */
export async function getPuzzleTransaction(
  transactionId: string,
): Promise<PuzzleTransaction | null> {
  return puzzleFetch<PuzzleTransaction>(
    `/transactions/${encodeURIComponent(transactionId)}`,
  );
}

/**
 * Get Puzzle transaction categories.
 * Endpoint: GET /transactions/categories
 */
export async function getPuzzleCategories(): Promise<unknown[] | null> {
  return puzzleFetch<unknown[]>("/transactions/categories");
}

// ---------------------------------------------------------------------------
// Read functions — Metrics
// ---------------------------------------------------------------------------

/**
 * Fetch expense metrics.
 * Endpoint: GET /metrics/expenses
 */
export async function getPuzzleExpenseMetrics(): Promise<unknown | null> {
  return puzzleFetch("/metrics/expenses");
}

/**
 * Fetch revenue metrics.
 * Endpoint: GET /metrics/revenue
 */
export async function getPuzzleRevenueMetrics(): Promise<unknown | null> {
  return puzzleFetch("/metrics/revenue");
}

/**
 * Fetch spending metrics.
 * Endpoint: GET /metrics/spending
 */
export async function getPuzzleSpendingMetrics(): Promise<unknown | null> {
  return puzzleFetch("/metrics/spending");
}

/**
 * Fetch combined key financial metrics (convenience wrapper).
 */
export async function getPuzzleMetrics(): Promise<PuzzleMetrics | null> {
  // Puzzle doesn't have a single /metrics endpoint — we combine from sub-endpoints
  const [expense, revenue] = await Promise.all([
    getPuzzleExpenseMetrics(),
    getPuzzleRevenueMetrics(),
  ]);

  if (!expense && !revenue) return null;

  // Return raw data — caller can shape as needed
  return {
    cashPosition: 0,
    burnRate: 0,
    runway: 0,
    accountsReceivable: 0,
    accountsPayable: 0,
    currency: "USD",
    asOfDate: new Date().toISOString().split("T")[0],
    ...(expense as Record<string, unknown>),
    ...(revenue as Record<string, unknown>),
  } as PuzzleMetrics;
}

// ---------------------------------------------------------------------------
// Read functions — Accounts
// ---------------------------------------------------------------------------

/**
 * List all financial accounts.
 * Endpoint: GET /accounts
 */
export async function getPuzzleAccounts(): Promise<PuzzleAccount[] | null> {
  const result = await puzzleFetch<{ accounts: PuzzleAccount[] }>("/accounts");
  return result?.accounts ?? null;
}

/**
 * Get Chart of Accounts.
 * Endpoint: GET /chart-of-accounts
 */
export async function getPuzzleChartOfAccounts(): Promise<unknown | null> {
  return puzzleFetch("/chart-of-accounts");
}

/**
 * Get financial account balances.
 * Endpoint: GET /accounts/balances
 */
export async function getPuzzleAccountBalances(): Promise<unknown | null> {
  return puzzleFetch("/accounts/balances");
}

// ---------------------------------------------------------------------------
// Read functions — Other
// ---------------------------------------------------------------------------

/**
 * Get companies (list companies the token has access to).
 * Endpoint: GET /companies
 */
export async function getPuzzleCompanies(): Promise<unknown | null> {
  return puzzleFetch("/companies");
}

/**
 * Get current user info.
 * Endpoint: GET /me
 */
export async function getPuzzleCurrentUser(): Promise<unknown | null> {
  return puzzleFetch("/me");
}

/**
 * Get vendors.
 * Endpoint: GET /vendors
 */
export async function getPuzzleVendors(): Promise<unknown | null> {
  return puzzleFetch("/vendors");
}

/**
 * Get journal entries.
 * Endpoint: GET /journal-entries
 */
export async function getPuzzleJournalEntries(params?: {
  startDate?: string;
  endDate?: string;
  limit?: number;
}): Promise<unknown | null> {
  const qs = new URLSearchParams();
  if (params?.startDate) qs.set("startDate", params.startDate);
  if (params?.endDate) qs.set("endDate", params.endDate);
  if (params?.limit) qs.set("limit", String(params.limit));
  const query = qs.toString();
  return puzzleFetch(`/journal-entries${query ? `?${query}` : ""}`);
}

// ---------------------------------------------------------------------------
// Write functions (for Abra sync)
// ---------------------------------------------------------------------------

/**
 * Create transaction(s) in Puzzle.
 * Endpoint: POST /transactions
 */
export async function createPuzzleTransaction(
  params: PuzzleCreateTransactionParams,
): Promise<PuzzleCreateTransactionResult | null> {
  return puzzleFetch<PuzzleCreateTransactionResult>("/transactions", {
    method: "POST",
    body: JSON.stringify({
      date: params.date,
      description: params.description,
      amount: params.amount,
      accountId: params.accountId,
      ...(params.category ? { category: params.category } : {}),
    }),
  });
}

/**
 * Update a transaction (e.g. categorize it).
 * Endpoint: PATCH /transactions/:id
 */
export async function categorizeTransaction(
  transactionId: string,
  categoryId: string,
): Promise<PuzzleTransaction | null> {
  return puzzleFetch<PuzzleTransaction>(
    `/transactions/${encodeURIComponent(transactionId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ categoryId }),
    },
  );
}

/**
 * Create a journal entry.
 * Endpoint: POST /journal-entries
 */
export async function createPuzzleJournalEntry(params: {
  date: string;
  memo: string;
  lines: Array<{
    accountId: string;
    amount: number;
    type: "debit" | "credit";
  }>;
}): Promise<unknown | null> {
  return puzzleFetch("/journal-entries", {
    method: "POST",
    body: JSON.stringify(params),
  });
}
