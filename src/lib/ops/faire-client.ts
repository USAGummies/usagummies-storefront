/**
 * Faire integration — read-only brand portal API client.
 *
 * Faire's public Brand API is at `https://www.faire.com/external-api/v2`
 * and auth is a single `X-FAIRE-OAUTH-ACCESS-TOKEN` header. We use it
 * for weekly reconciliation prep (payouts) + Direct-share tracking
 * (orders with `marketplace_or_direct`=`direct`).
 *
 * Without a token we gracefully surface `unavailable` with an
 * explicit reason — the Faire Specialist then renders a degraded
 * digest rather than fabricating numbers.
 */

function getToken(): string | null {
  return process.env.FAIRE_ACCESS_TOKEN?.trim() || null;
}

export function isFaireConfigured(): boolean {
  return getToken() !== null;
}

const API = "https://www.faire.com/external-api/v2";

interface FaireFetchOpts {
  path: string;
  query?: Record<string, string>;
}

async function faireFetch<T>({ path, query }: FaireFetchOpts): Promise<T | null> {
  const token = getToken();
  if (!token) return null;
  const url = new URL(API + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  }
  try {
    const res = await fetch(url.toString(), {
      headers: {
        "X-FAIRE-OAUTH-ACCESS-TOKEN": token,
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ---- Orders ---------------------------------------------------------------

export interface FaireOrderSummary {
  id: string;
  displayId: string | null;
  state: string;
  createdAt: string;
  subtotal: number | null;
  currency: string;
  isDirect: boolean;
  retailerName: string | null;
}

export async function getRecentFaireOrders(
  daysBack = 14,
): Promise<FaireOrderSummary[] | null> {
  const since = new Date(Date.now() - daysBack * 24 * 3600 * 1000).toISOString();
  const data = await faireFetch<{
    orders?: Array<Record<string, unknown>>;
  }>({
    path: "/orders",
    query: { updated_at_min: since, limit: "100" },
  });
  if (!data) return null;
  const orders = data.orders ?? [];
  return orders.map((o): FaireOrderSummary => {
    const addr = (o.address as Record<string, unknown> | undefined) ?? {};
    const retailer = (o.retailer as Record<string, unknown> | undefined) ?? {};
    const priceCents = Number(
      (o.subtotal_price_cents as number | string | undefined) ?? 0,
    );
    return {
      id: String(o.id ?? ""),
      displayId: (o.display_id as string | undefined) ?? null,
      state: String(o.state ?? "UNKNOWN"),
      createdAt: String(o.created_at ?? ""),
      subtotal: Number.isFinite(priceCents) ? priceCents / 100 : null,
      currency: String(o.currency ?? "USD"),
      isDirect:
        o.marketplace_or_direct === "direct" ||
        o.source === "direct" ||
        Boolean(o.is_direct),
      retailerName:
        (retailer.name as string | undefined) ??
        (addr.company as string | undefined) ??
        null,
    };
  });
}

// ---- Payouts --------------------------------------------------------------

export interface FairePayoutSummary {
  id: string;
  paidAt: string;
  amount: number;
  currency: string;
}

export async function getRecentFairePayouts(
  daysBack = 45,
): Promise<FairePayoutSummary[] | null> {
  const since = new Date(Date.now() - daysBack * 24 * 3600 * 1000).toISOString();
  const data = await faireFetch<{
    payouts?: Array<Record<string, unknown>>;
  }>({
    path: "/payouts",
    query: { updated_at_min: since, limit: "50" },
  });
  if (!data) return null;
  const payouts = data.payouts ?? [];
  return payouts.map((p): FairePayoutSummary => {
    const cents = Number((p.amount_cents as number | string | undefined) ?? 0);
    return {
      id: String(p.id ?? ""),
      paidAt: String(p.paid_at ?? p.created_at ?? ""),
      amount: Number.isFinite(cents) ? cents / 100 : 0,
      currency: String(p.currency ?? "USD"),
    };
  });
}
