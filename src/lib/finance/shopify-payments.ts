/**
 * Shopify Payments Balance — USA Gummies
 *
 * Fetches Shopify Payments balance and pending payouts via Admin API.
 * Uses existing SHOPIFY_ADMIN_TOKEN and SHOPIFY_STORE_DOMAIN env vars.
 */

import { readState, writeState } from "@/lib/ops/state";
import type { CacheEnvelope } from "@/lib/amazon/types";
import type { ShopifyPaymentsBalance } from "./types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SHOPIFY_ADMIN_TOKEN = () => process.env.SHOPIFY_ADMIN_TOKEN || "";
const SHOPIFY_STORE_DOMAIN = () =>
  (process.env.SHOPIFY_STORE_DOMAIN || process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

export function isShopifyPaymentsConfigured(): boolean {
  return !!(SHOPIFY_ADMIN_TOKEN() && SHOPIFY_STORE_DOMAIN());
}

// ---------------------------------------------------------------------------
// GraphQL query for Shopify Payments
// ---------------------------------------------------------------------------

const PAYMENTS_QUERY = `
  query {
    shopifyPaymentsAccount {
      balance {
        amount
        currencyCode
      }
      payoutSchedule {
        interval
      }
    }
    shop {
      paymentSettings {
        supportedDigitalWallets
      }
    }
  }
`;

const PAYOUTS_QUERY = `
  query {
    shopifyPaymentsAccount {
      payouts(first: 5, reverse: true) {
        edges {
          node {
            id
            net { amount currencyCode }
            status
            issuedAt
            summary {
              adjustmentsGross { amount }
              chargesGross { amount }
              refundsGross { amount }
              reservedFundsGross { amount }
            }
          }
        }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function shopifyAdminGql<T>(query: string): Promise<T | null> {
  const token = SHOPIFY_ADMIN_TOKEN();
  const domain = SHOPIFY_STORE_DOMAIN();
  if (!token || !domain) return null;

  try {
    const res = await fetch(`https://${domain}/admin/api/2025-01/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;
    const json = await res.json();
    return json.data as T;
  } catch {
    return null;
  }
}

type BalanceQueryResult = {
  shopifyPaymentsAccount: {
    balance: { amount: string; currencyCode: string }[];
    payoutSchedule: { interval: string } | null;
  } | null;
};

type PayoutsQueryResult = {
  shopifyPaymentsAccount: {
    payouts: {
      edges: {
        node: {
          id: string;
          net: { amount: string; currencyCode: string };
          status: string;
          issuedAt: string;
          summary: {
            adjustmentsGross: { amount: string };
            chargesGross: { amount: string };
            refundsGross: { amount: string };
            reservedFundsGross: { amount: string };
          } | null;
        };
      }[];
    } | null;
  } | null;
};

export async function fetchShopifyPaymentsBalance(): Promise<ShopifyPaymentsBalance | null> {
  // Check cache first
  const cached = await readState<CacheEnvelope<ShopifyPaymentsBalance> | null>(
    "shopify-payments-cache",
    null,
  );
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.data;
  }

  const [balanceData, payoutsData] = await Promise.all([
    shopifyAdminGql<BalanceQueryResult>(PAYMENTS_QUERY),
    shopifyAdminGql<PayoutsQueryResult>(PAYOUTS_QUERY),
  ]);

  if (!balanceData?.shopifyPaymentsAccount) return null;

  const balances = balanceData.shopifyPaymentsAccount.balance || [];
  const totalBalance = balances.reduce(
    (sum, b) => sum + parseFloat(b.amount || "0"),
    0,
  );
  const currency = balances[0]?.currencyCode || "USD";

  // Parse payouts
  const payoutEdges = payoutsData?.shopifyPaymentsAccount?.payouts?.edges || [];
  const pendingPayouts = payoutEdges
    .filter((e) => e.node.status === "SCHEDULED" || e.node.status === "IN_TRANSIT")
    .map((e) => ({
      amount: parseFloat(e.node.net.amount),
      expectedDate: e.node.issuedAt,
    }));

  const lastCompletedPayout = payoutEdges.find(
    (e) => e.node.status === "PAID" || e.node.status === "COMPLETED",
  );

  const result: ShopifyPaymentsBalance = {
    balance: totalBalance,
    currency,
    pendingPayouts,
    lastPayout: lastCompletedPayout
      ? {
          amount: parseFloat(lastCompletedPayout.node.net.amount),
          date: lastCompletedPayout.node.issuedAt,
          status: lastCompletedPayout.node.status,
        }
      : null,
  };

  // Cache result
  await writeState("shopify-payments-cache", {
    data: result,
    cachedAt: Date.now(),
  });

  return result;
}
