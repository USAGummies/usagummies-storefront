/**
 * GET /api/ops/plaid/balance — Fetch Plaid balance and recent transactions
 *
 * Returns current balance + last 30 days of transactions from Bank of America.
 */

import { NextResponse } from "next/server";
import {
  isPlaidConfigured,
  isPlaidConnected,
  getBalances,
  getTransactions,
} from "@/lib/finance/plaid";
import { readState, writeState } from "@/lib/ops/state";
import type { CacheEnvelope } from "@/lib/amazon/types";
import type { PlaidAccount, PlaidTransaction } from "@/lib/finance/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

type PlaidBalanceCache = {
  accounts: PlaidAccount[];
  recentTransactions: PlaidTransaction[];
  lastUpdated: string;
};

export async function GET() {
  if (!isPlaidConfigured()) {
    return NextResponse.json({ connected: false, error: "Plaid not configured" });
  }

  const connected = await isPlaidConnected();
  if (!connected) {
    return NextResponse.json({ connected: false, message: "Bank not connected. Use Plaid Link to connect." });
  }

  // Check cache
  const cached = await readState<CacheEnvelope<PlaidBalanceCache> | null>(
    "plaid-balance-cache",
    null,
  );
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return NextResponse.json({ connected: true, ...cached.data });
  }

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const startDate = thirtyDaysAgo.toISOString().slice(0, 10);
    const endDate = new Date().toISOString().slice(0, 10);

    const [accounts, transactions] = await Promise.all([
      getBalances(),
      getTransactions(startDate, endDate),
    ]);

    const result: PlaidBalanceCache = {
      accounts,
      recentTransactions: transactions.slice(0, 50),
      lastUpdated: new Date().toISOString(),
    };

    // Cache
    await writeState("plaid-balance-cache", { data: result, cachedAt: Date.now() });

    return NextResponse.json({ connected: true, ...result });
  } catch (err) {
    console.error("[plaid] Balance fetch failed:", err);
    return NextResponse.json(
      { connected: true, error: err instanceof Error ? err.message : "Balance fetch failed" },
      { status: 500 },
    );
  }
}
