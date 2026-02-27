/**
 * GET /api/ops/transactions — Recent bank transactions from Plaid (Found.com)
 *
 * Returns recent transactions with spending analysis for the Finance page.
 * Includes category breakdown, daily spending trend, and large transaction alerts.
 *
 * Query params:
 *   ?days=14  — number of days to look back (default: 30, max: 90)
 *
 * Protected by middleware (requires JWT session).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  isPlaidConfigured,
  isPlaidConnected,
  getTransactions,
} from "@/lib/finance/plaid";
import { readState, writeState } from "@/lib/ops/state";
import type { CacheEnvelope } from "@/lib/amazon/types";
import type { PlaidTransaction } from "@/lib/finance/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CategoryBreakdown = {
  category: string;
  totalSpent: number;
  count: number;
  pctOfTotal: number;
};

type DailySpending = {
  date: string;
  label: string;
  expenses: number;
  income: number;
  net: number;
};

type TransactionsResponse = {
  transactions: PlaidTransaction[];
  categories: CategoryBreakdown[];
  dailySpending: DailySpending[];
  summary: {
    totalExpenses: number;
    totalIncome: number;
    netCashFlow: number;
    avgDailySpend: number;
    largestExpense: { name: string; amount: number; date: string } | null;
    transactionCount: number;
  };
  generatedAt: string;
  /** Budget-ready: null until post-funding */
  budget: null;
};

type TransactionsCachePayload = {
  days: number;
  response: TransactionsResponse;
};

// ---------------------------------------------------------------------------
// Analysis helpers
// ---------------------------------------------------------------------------

function buildCategoryBreakdown(txns: PlaidTransaction[]): CategoryBreakdown[] {
  const catMap = new Map<string, { spent: number; count: number }>();

  for (const tx of txns) {
    // Plaid: positive amount = expense/debit, negative = income/credit
    if (tx.amount <= 0) continue; // skip income for category breakdown
    const cat = tx.category?.[0] || "Uncategorized";
    const existing = catMap.get(cat) || { spent: 0, count: 0 };
    existing.spent += tx.amount;
    existing.count += 1;
    catMap.set(cat, existing);
  }

  const totalSpent = Array.from(catMap.values()).reduce(
    (sum, c) => sum + c.spent,
    0,
  );

  return Array.from(catMap.entries())
    .map(([category, { spent, count }]) => ({
      category,
      totalSpent: Math.round(spent * 100) / 100,
      count,
      pctOfTotal:
        totalSpent > 0 ? Math.round((spent / totalSpent) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.totalSpent - a.totalSpent);
}

function buildDailySpending(
  txns: PlaidTransaction[],
  days: number,
): DailySpending[] {
  const dailyMap = new Map<string, { expenses: number; income: number }>();

  for (const tx of txns) {
    const date = tx.date;
    const existing = dailyMap.get(date) || { expenses: 0, income: 0 };
    if (tx.amount > 0) {
      existing.expenses += tx.amount;
    } else {
      existing.income += Math.abs(tx.amount);
    }
    dailyMap.set(date, existing);
  }

  // Fill all days
  const result: DailySpending[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const entry = dailyMap.get(dateStr) || { expenses: 0, income: 0 };
    result.push({
      date: dateStr,
      label: d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      expenses: Math.round(entry.expenses * 100) / 100,
      income: Math.round(entry.income * 100) / 100,
      net: Math.round((entry.income - entry.expenses) * 100) / 100,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  if (!isPlaidConfigured()) {
    return NextResponse.json({
      transactions: [],
      categories: [],
      dailySpending: [],
      summary: {
        totalExpenses: 0,
        totalIncome: 0,
        netCashFlow: 0,
        avgDailySpend: 0,
        largestExpense: null,
        transactionCount: 0,
      },
      generatedAt: new Date().toISOString(),
      budget: null,
      error: "Plaid not configured",
    });
  }

  const connected = await isPlaidConnected();
  if (!connected) {
    return NextResponse.json({
      transactions: [],
      categories: [],
      dailySpending: [],
      summary: {
        totalExpenses: 0,
        totalIncome: 0,
        netCashFlow: 0,
        avgDailySpend: 0,
        largestExpense: null,
        transactionCount: 0,
      },
      generatedAt: new Date().toISOString(),
      budget: null,
      error: "Plaid not connected — complete Link flow first",
    });
  }

  const { searchParams } = new URL(request.url);
  const days = Math.min(
    Math.max(parseInt(searchParams.get("days") || "30", 10) || 30, 1),
    90,
  );

  const cacheKey = "transactions-cache";
  const cached = await readState<CacheEnvelope<TransactionsCachePayload> | null>(
    cacheKey,
    null,
  );
  if (
    cached &&
    Date.now() - cached.cachedAt < CACHE_TTL &&
    cached.data.days === days
  ) {
    return NextResponse.json(cached.data.response);
  }

  try {
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const txns = await getTransactions(startDate, endDate);

    // Build analysis
    const categories = buildCategoryBreakdown(txns);
    const dailySpending = buildDailySpending(txns, days);

    // Summary
    const totalExpenses = txns
      .filter((t) => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);
    const totalIncome = txns
      .filter((t) => t.amount < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const expenses = txns.filter((t) => t.amount > 0);
    const largestExpense =
      expenses.length > 0
        ? expenses.sort((a, b) => b.amount - a.amount)[0]
        : null;

    const result: TransactionsResponse = {
      transactions: txns.slice(0, 100), // Cap at 100
      categories,
      dailySpending,
      summary: {
        totalExpenses: Math.round(totalExpenses * 100) / 100,
        totalIncome: Math.round(totalIncome * 100) / 100,
        netCashFlow: Math.round((totalIncome - totalExpenses) * 100) / 100,
        avgDailySpend:
          days > 0
            ? Math.round((totalExpenses / days) * 100) / 100
            : 0,
        largestExpense: largestExpense
          ? {
              name: largestExpense.merchantName || largestExpense.name,
              amount: Math.round(largestExpense.amount * 100) / 100,
              date: largestExpense.date,
            }
          : null,
        transactionCount: txns.length,
      },
      generatedAt: new Date().toISOString(),
      budget: null,
    };

    // Cache
    await writeState(cacheKey, {
      data: {
        days,
        response: result,
      },
      cachedAt: Date.now(),
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[transactions] Failed:", err);
    return NextResponse.json(
      {
        transactions: [],
        categories: [],
        dailySpending: [],
        summary: {
          totalExpenses: 0,
          totalIncome: 0,
          netCashFlow: 0,
          avgDailySpend: 0,
          largestExpense: null,
          transactionCount: 0,
        },
        generatedAt: new Date().toISOString(),
        budget: null,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
