/**
 * Puzzle.io Accounting API Client — USA Gummies
 *
 * Puzzle is a modern accounting platform that provides real-time financial
 * visibility (P&L, balance sheet, cash flow, transactions). We use it as
 * the single source of truth for financial reporting in the ops dashboard
 * and for Abra's financial intelligence layer.
 *
 * PUZZLE_API_KEY must be set in Vercel env vars (and .env.local for local dev).
 *
 * API docs: https://puzzle-api.readme.io/docs/welcome
 *
 * NOTE: The actual API paths below are best-guess based on standard accounting
 * API conventions. They may need adjustment once Ben has an account and we can
 * verify the exact endpoints against Puzzle's live API reference.
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PUZZLE_BASE_URL = "https://api.puzzle.io/v1";

function getApiKey(): string {
  return (process.env.PUZZLE_API_KEY || "").trim();
}

/** Check whether Puzzle credentials are configured. */
export function isPuzzleConfigured(): boolean {
  return !!getApiKey();
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
  const apiKey = getApiKey();
  if (!apiKey) {
    return null;
  }

  const url = `${PUZZLE_BASE_URL}${path}`;

  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
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
// Read functions (for dashboard)
// ---------------------------------------------------------------------------

/**
 * Fetch Profit & Loss report for a date range.
 * Dates should be YYYY-MM-DD strings.
 */
export async function getPuzzlePnL(
  startDate: string,
  endDate: string,
): Promise<PuzzlePnL | null> {
  return puzzleFetch<PuzzlePnL>(
    `/reports/profit-and-loss?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
  );
}

/**
 * Fetch Balance Sheet as of a specific date.
 * Date should be YYYY-MM-DD string.
 */
export async function getPuzzleBalanceSheet(
  asOfDate: string,
): Promise<PuzzleBalanceSheet | null> {
  return puzzleFetch<PuzzleBalanceSheet>(
    `/reports/balance-sheet?asOfDate=${encodeURIComponent(asOfDate)}`,
  );
}

/**
 * Fetch Cash Flow Statement for a date range.
 * Dates should be YYYY-MM-DD strings.
 */
export async function getPuzzleCashFlow(
  startDate: string,
  endDate: string,
): Promise<PuzzleCashFlow | null> {
  return puzzleFetch<PuzzleCashFlow>(
    `/reports/cash-flow?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
  );
}

/**
 * List transactions with optional filters.
 */
export async function getPuzzleTransactions(params: {
  startDate?: string;
  endDate?: string;
  limit?: number;
}): Promise<PuzzleTransactionList | null> {
  const qs = new URLSearchParams();
  if (params.startDate) qs.set("startDate", params.startDate);
  if (params.endDate) qs.set("endDate", params.endDate);
  if (params.limit) qs.set("limit", String(params.limit));

  const query = qs.toString();
  return puzzleFetch<PuzzleTransactionList>(
    `/transactions${query ? `?${query}` : ""}`,
  );
}

/**
 * Fetch key financial metrics: burn rate, runway, cash position.
 */
export async function getPuzzleMetrics(): Promise<PuzzleMetrics | null> {
  return puzzleFetch<PuzzleMetrics>("/metrics");
}

/**
 * List all accounts in the chart of accounts.
 */
export async function getPuzzleAccounts(): Promise<PuzzleAccount[] | null> {
  const result = await puzzleFetch<{ accounts: PuzzleAccount[] }>("/accounts");
  return result?.accounts ?? null;
}

// ---------------------------------------------------------------------------
// Write functions (for Abra sync)
// ---------------------------------------------------------------------------

/**
 * Create a transaction / journal entry in Puzzle.
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
 * Update a transaction's category.
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
