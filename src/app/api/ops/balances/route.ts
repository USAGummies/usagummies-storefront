/**
 * GET/POST /api/ops/balances — Unified cash position across accounts.
 *
 * GET:
 *  - Plaid (Found), Shopify, Amazon balances
 *  - Supports manual cash override fallback when Plaid is non-production
 *
 * POST:
 *  - Store manual Found.com cash override: { balance, note }
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

type ManualCashOverride = {
  balance: number;
  note: string;
  updatedAt: string;
};

type BalancesResponse = UnifiedBalances & {
  cashSource: "plaid-live" | "manual" | "plaid-nonprod" | "none";
  cashSourceLabel: string;
  manualOverride: ManualCashOverride | null;
};

function isPlaidProductionEnv(): boolean {
  return (process.env.PLAID_ENV || "sandbox").toLowerCase() === "production";
}

function buildManualFoundBalance(manual: ManualCashOverride): NonNullable<UnifiedBalances["found"]> {
  return {
    balance: manual.balance,
    available: manual.balance,
    lastUpdated: manual.updatedAt,
    recentTransactions: [],
  };
}

export async function GET(req: Request) {
  const forceRefresh = new URL(req.url).searchParams.get("force") === "1";
  const manualOverride = await readState<ManualCashOverride | null>(
    "manual-cash-override",
    null,
  );

  const cached = await readState<CacheEnvelope<BalancesResponse> | null>(
    "plaid-balance-cache",
    null,
  );
  if (
    !forceRefresh &&
    cached &&
    Date.now() - cached.cachedAt < CACHE_TTL &&
    typeof cached.data?.totalCash === "number" &&
    (
      (!manualOverride && !cached.data.manualOverride) ||
      (manualOverride &&
        cached.data.manualOverride &&
        manualOverride.updatedAt === cached.data.manualOverride.updatedAt)
    )
  ) {
    return NextResponse.json(cached.data);
  }

  const [foundResult, shopifyResult, amazonResult] = await Promise.allSettled([
    fetchFoundBalance(),
    fetchShopifyBalance(),
    fetchAmazonFinance(),
  ]);

  const plaidFound = foundResult.status === "fulfilled" ? foundResult.value : null;
  const shopify = shopifyResult.status === "fulfilled" ? shopifyResult.value : null;
  const amazon = amazonResult.status === "fulfilled" ? amazonResult.value : null;

  const plaidIsLive = isPlaidProductionEnv() && plaidFound !== null;
  let found: UnifiedBalances["found"] = null;
  let cashSource: BalancesResponse["cashSource"] = "none";
  let cashSourceLabel = "No Found.com source";

  if (plaidIsLive) {
    found = plaidFound;
    cashSource = "plaid-live";
    cashSourceLabel = "Plaid (live)";
  } else if (manualOverride && Number.isFinite(manualOverride.balance)) {
    found = buildManualFoundBalance(manualOverride);
    cashSource = "manual";
    cashSourceLabel = `Manual entry (${manualOverride.updatedAt.slice(0, 10)})`;
  } else if (plaidFound) {
    found = plaidFound;
    cashSource = "plaid-nonprod";
    cashSourceLabel = "Plaid (sandbox/non-prod)";
  }

  let totalCash = 0;
  if (found) totalCash += found.available;
  if (shopify) totalCash += shopify.balance;
  if (amazon) totalCash += amazon.pendingBalance;

  const result: BalancesResponse = {
    found,
    shopify,
    amazon,
    totalCash: Math.round(totalCash * 100) / 100,
    lastUpdated: new Date().toISOString(),
    cashSource,
    cashSourceLabel,
    manualOverride,
  };

  await writeState("plaid-balance-cache", {
    data: result,
    cachedAt: Date.now(),
  });

  return NextResponse.json(result);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { balance?: number; note?: string };
    const balance = Number(body.balance);
    const note = String(body.note || "").trim();

    if (!Number.isFinite(balance) || balance < 0) {
      return NextResponse.json(
        { error: "balance must be a non-negative number" },
        { status: 400 },
      );
    }

    const manual: ManualCashOverride = {
      balance: Math.round(balance * 100) / 100,
      note,
      updatedAt: new Date().toISOString(),
    };

    await writeState("manual-cash-override", manual);
    return NextResponse.json({
      ok: true,
      manualOverride: manual,
      message:
        isPlaidProductionEnv()
          ? "Manual cash stored, but Plaid production data will take precedence while live."
          : "Manual cash override stored and active.",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
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

  const balance = accounts.reduce((sum, a) => sum + (a.balances.current || 0), 0);
  const available = accounts.reduce(
    (sum, a) => sum + (a.balances.available || a.balances.current || 0),
    0,
  );

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
    const cached = await readState<CacheEnvelope<AmazonFinancials> | null>(
      "amazon-finance-cache",
      null,
    );
    if (cached && Date.now() - cached.cachedAt < 30 * 60 * 1000) {
      return cached.data;
    }

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const eventGroups = await fetchFinancialEventGroups(ninetyDaysAgo.toISOString());
    if (!eventGroups.length) return null;

    const pendingGroups = eventGroups.filter(
      (g) => g.ProcessingStatus === "Open" || g.FundTransferStatus === "Pending",
    );
    const pendingBalance = pendingGroups.reduce(
      (sum, g) => sum + (g.ConvertedTotal?.CurrencyAmount || g.OriginalTotal?.CurrencyAmount || 0),
      0,
    );

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

    await writeState("amazon-finance-cache", { data: result, cachedAt: Date.now() });
    return result;
  } catch (err) {
    console.error("[amazon] Finance fetch failed:", err);
    return null;
  }
}
