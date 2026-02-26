/**
 * GET /api/ops/balances — Unified balance across all accounts
 *
 * Parallel fetch from Found.com (Plaid), Shopify Payments, and Amazon Settlements.
 * Returns combined cash position.
 */

import { NextResponse } from "next/server";
import {
  isPlaidConfigured,
  isPlaidConnected,
  getBalances,
  getTransactions,
} from "@/lib/finance/plaid";
import {
  isShopifyPaymentsConfigured,
  fetchShopifyPaymentsBalance,
} from "@/lib/finance/shopify-payments";
import {
  isAmazonConfigured,
  fetchFinancialEventGroups,
} from "@/lib/amazon/sp-api";
import { readState, writeState } from "@/lib/ops/state";
import type { CacheEnvelope } from "@/lib/amazon/types";
import type { UnifiedBalances, AmazonFinancials } from "@/lib/finance/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function GET() {
  // Check cache first
  const cached = await readState<CacheEnvelope<UnifiedBalances> | null>(
    "plaid-balance-cache",
    null,
  );
  // Only use cache if it's keyed as unified (has totalCash)
  if (
    cached &&
    Date.now() - cached.cachedAt < CACHE_TTL &&
    "totalCash" in (cached.data || {})
  ) {
    return NextResponse.json(cached.data);
  }

  // Parallel fetch from all sources
  const [foundResult, shopifyResult, amazonResult] = await Promise.allSettled([
    fetchFoundBalance(),
    fetchShopifyBalance(),
    fetchAmazonFinance(),
  ]);

  const found = foundResult.status === "fulfilled" ? foundResult.value : null;
  const shopify = shopifyResult.status === "fulfilled" ? shopifyResult.value : null;
  const amazon = amazonResult.status === "fulfilled" ? amazonResult.value : null;

  // Sum up total cash
  let totalCash = 0;
  if (found) totalCash += found.available;
  if (shopify) totalCash += shopify.balance;
  if (amazon) totalCash += amazon.pendingBalance;

  const result: UnifiedBalances = {
    found,
    shopify,
    amazon,
    totalCash: Math.round(totalCash * 100) / 100,
    lastUpdated: new Date().toISOString(),
  };

  return NextResponse.json(result);
}

// ---------------------------------------------------------------------------
// Individual source fetchers
// ---------------------------------------------------------------------------

async function fetchFoundBalance(): Promise<UnifiedBalances["found"]> {
  if (!isPlaidConfigured()) return null;
  const connected = await isPlaidConnected();
  if (!connected) return null;

  const accounts = await getBalances();
  if (accounts.length === 0) return null;

  // Sum across all accounts (typically just one checking account)
  const balance = accounts.reduce((sum, a) => sum + (a.balances.current || 0), 0);
  const available = accounts.reduce((sum, a) => sum + (a.balances.available || a.balances.current || 0), 0);

  // Recent transactions (last 14 days)
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const transactions = await getTransactions(
    fourteenDaysAgo.toISOString().slice(0, 10),
    new Date().toISOString().slice(0, 10),
  );

  return {
    balance,
    available,
    lastUpdated: new Date().toISOString(),
    recentTransactions: transactions.slice(0, 20),
  };
}

async function fetchShopifyBalance() {
  if (!isShopifyPaymentsConfigured()) return null;
  return fetchShopifyPaymentsBalance();
}

async function fetchAmazonFinance(): Promise<AmazonFinancials | null> {
  if (!isAmazonConfigured()) return null;

  try {
    // Check cache
    const cached = await readState<CacheEnvelope<AmazonFinancials> | null>(
      "amazon-finance-cache",
      null,
    );
    if (cached && Date.now() - cached.cachedAt < 30 * 60 * 1000) {
      return cached.data;
    }

    // Fetch last 90 days of financial event groups
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const eventGroups = await fetchFinancialEventGroups(
      ninetyDaysAgo.toISOString(),
    );

    if (!eventGroups.length) return null;

    // Find pending (not yet transferred) groups
    const pendingGroups = eventGroups.filter(
      (g) => g.ProcessingStatus === "Open" || g.FundTransferStatus === "Pending",
    );
    const pendingBalance = pendingGroups.reduce(
      (sum, g) => sum + (g.ConvertedTotal?.CurrencyAmount || g.OriginalTotal?.CurrencyAmount || 0),
      0,
    );

    // Last completed settlement
    const completedGroups = eventGroups
      .filter((g) => g.FundTransferStatus === "Successful" && g.FundTransferDate)
      .sort((a, b) => (b.FundTransferDate || "").localeCompare(a.FundTransferDate || ""));

    const lastSettlement = completedGroups[0]
      ? {
          amount: completedGroups[0].ConvertedTotal?.CurrencyAmount || 0,
          date: completedGroups[0].FundTransferDate || "",
          status: completedGroups[0].FundTransferStatus,
        }
      : null;

    // Estimate next settlement (Amazon settles ~every 14 days)
    const nextSettlementEstimate = pendingBalance > 0
      ? {
          estimatedAmount: pendingBalance,
          estimatedDate: new Date(
            Date.now() + 14 * 24 * 60 * 60 * 1000,
          ).toISOString().slice(0, 10),
        }
      : null;

    const result: AmazonFinancials = {
      pendingBalance: Math.round(pendingBalance * 100) / 100,
      lastSettlement,
      nextSettlementEstimate,
      recentEventGroups: eventGroups.slice(0, 5).map((g) => ({
        financialEventGroupId: g.FinancialEventGroupId,
        processingStatus: g.ProcessingStatus,
        fundTransferStatus: g.FundTransferStatus,
        originalTotal: g.OriginalTotal || null,
        convertedTotal: g.ConvertedTotal || null,
        fundTransferDate: g.FundTransferDate || null,
        traceId: g.TraceId || null,
        accountTail: g.AccountTail || null,
        beginningBalance: g.BeginningBalance || null,
        financialEventGroupStart: g.FinancialEventGroupStart || null,
        financialEventGroupEnd: g.FinancialEventGroupEnd || null,
      })),
    };

    // Cache
    await writeState("amazon-finance-cache", { data: result, cachedAt: Date.now() });

    return result;
  } catch (err) {
    console.error("[amazon] Finance fetch failed:", err);
    return null;
  }
}
