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
  if (!token || !domain) {
    console.error("[shopify-payments] Missing token or domain", { hasToken: !!token, domain });
    return null;
  }

  try {
    const res = await fetch(`https://${domain}/admin/api/2024-10/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.error("[shopify-payments] API error:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const json = await res.json();
    if (json.errors) {
      console.error("[shopify-payments] GraphQL errors:", JSON.stringify(json.errors));
    }
    return json.data as T;
  } catch (err) {
    console.error("[shopify-payments] Exception:", err);
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

  if (!balanceData?.shopifyPaymentsAccount) {
    console.error("[shopify-payments] No shopifyPaymentsAccount in response. This usually means the Shopify Payments scope is missing from the Admin API token, or the store doesn't use Shopify Payments.", { balanceData });
    return null;
  }

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

// ---------------------------------------------------------------------------
// Recent payouts (for reconciliation specialist)
// ---------------------------------------------------------------------------

/**
 * Compact shape used by the reconciliation agent. Returns ONE entry per
 * Shopify Payments payout in the requested window so Rene can tag each
 * with CoA codes. Distinct from `fetchShopifyPaymentsBalance()` which
 * returns aggregate balance + the single latest payout.
 */
export interface ShopifyPayoutLine {
  /** Stable Shopify GraphQL gid. */
  id: string;
  /** ISO 8601 issued timestamp. */
  issuedAt: string;
  /** Net amount in the payout currency (Shopify's `net.amount`, parsed). */
  amount: number;
  /** Currency from Shopify (typically `USD`). */
  currency: string;
  /** Shopify status: PAID | COMPLETED | SCHEDULED | IN_TRANSIT | FAILED | CANCELED. */
  status: string;
}

const PAYOUTS_WINDOW_QUERY = `
  query Payouts($first: Int!) {
    shopifyPaymentsAccount {
      payouts(first: $first, reverse: true) {
        edges {
          node {
            id
            net { amount currencyCode }
            status
            issuedAt
          }
        }
      }
    }
  }
`;

type PayoutsWindowResult = {
  shopifyPaymentsAccount: {
    payouts: {
      edges: {
        node: {
          id: string;
          net: { amount: string; currencyCode: string };
          status: string;
          issuedAt: string;
        };
      }[];
    } | null;
  } | null;
};

async function shopifyAdminGqlVars<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T | null> {
  const token = SHOPIFY_ADMIN_TOKEN();
  const domain = SHOPIFY_STORE_DOMAIN();
  if (!token || !domain) return null;
  try {
    const res = await fetch(`https://${domain}/admin/api/2024-10/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.errors) {
      console.error(
        "[shopify-payments] GraphQL errors (payouts window):",
        JSON.stringify(json.errors).slice(0, 300),
      );
    }
    return json.data as T;
  } catch (err) {
    console.error("[shopify-payments] Exception (payouts window):", err);
    return null;
  }
}

/**
 * Fetch all Shopify Payments payouts within the last `daysWindow` days.
 *
 * Returns `null` ONLY when the integration is unreachable / unconfigured —
 * the caller renders that as a degraded-mode line ("Shopify Payments scope
 * missing" or "API unreachable"). An empty array means the API responded
 * with zero payouts in the window — that's the canonical "no payouts to
 * reconcile" state, not a failure.
 *
 * NEVER posts to QBO; this is a read-only feeder for the reconciliation
 * specialist's prep digest. Class A surface only.
 */
export async function fetchRecentShopifyPayouts(
  daysWindow: number,
): Promise<ShopifyPayoutLine[] | null> {
  if (!isShopifyPaymentsConfigured()) return null;
  // Shopify GraphQL pagination requires `first: <int>`; we cap at 50 to
  // bound cost. A 14-day window with a daily Shopify Payments cadence
  // produces ≤ 14 payouts, so 50 is comfortable headroom.
  const data = await shopifyAdminGqlVars<PayoutsWindowResult>(
    PAYOUTS_WINDOW_QUERY,
    { first: 50 },
  );
  if (!data?.shopifyPaymentsAccount) return null;

  const cutoff = Date.now() - daysWindow * 86_400_000;
  const out: ShopifyPayoutLine[] = [];
  for (const edge of data.shopifyPaymentsAccount.payouts?.edges ?? []) {
    const issuedMs = new Date(edge.node.issuedAt).getTime();
    if (!Number.isFinite(issuedMs) || issuedMs < cutoff) continue;
    const amount = Number.parseFloat(edge.node.net.amount);
    if (!Number.isFinite(amount)) continue;
    out.push({
      id: edge.node.id,
      issuedAt: edge.node.issuedAt,
      amount,
      currency: edge.node.net.currencyCode,
      status: edge.node.status,
    });
  }
  return out;
}
