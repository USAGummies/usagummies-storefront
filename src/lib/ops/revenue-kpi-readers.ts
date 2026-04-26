/**
 * Read-only revenue readers for the Weekly KPI Scorecard.
 *
 * Each reader returns a `ChannelRevenueState`:
 *   - `wired` with a finite `amountUsd` and a source attribution
 *     when the underlying API returned data
 *   - `not_wired` with a reason when the integration isn't
 *     configured (env var missing, no helper exists)
 *   - `error` with a reason when the call threw or timed out
 *
 * Hard rules:
 *   - **Read-only.** No KV / Gmail / HubSpot / QBO / Shopify / Faire /
 *     Slack / Drive mutation. Each helper used here is an `await`-only
 *     query. The aggregator at `/api/ops/sales` is the only caller.
 *   - **Never fabricates a number.** A reader either returns a real
 *     amount (sourced) or sets `amountUsd: null` with a reason.
 *   - **Bounded latency.** Amazon SP-API can paginate at 5s/page; we
 *     race the call against a 6s timeout so a slow Amazon response
 *     never blocks the dashboard. On timeout the channel is marked
 *     `error` (truthful) — never silently zero.
 */
import { fetchOrders } from "@/lib/amazon/sp-api";
import { getRecentFaireOrders, isFaireConfigured } from "@/lib/ops/faire-client";
import { queryPaidOrdersForBurnRate } from "@/lib/ops/shopify-admin-actions";
import type { ChannelRevenueState } from "@/lib/ops/revenue-kpi";

const SEVEN_DAYS_MS = 7 * 24 * 3_600_000;
const AMAZON_TIMEOUT_MS = 6000;

/**
 * Race a promise against a timeout. On timeout the returned promise
 * rejects with a typed error so the caller can distinguish "slow
 * upstream" from a real failure.
 */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function readShopifyLast7d(now: Date): Promise<ChannelRevenueState> {
  if (!process.env.SHOPIFY_ADMIN_API_TOKEN?.trim()) {
    return {
      channel: "shopify",
      status: "not_wired",
      amountUsd: null,
      reason: "SHOPIFY_ADMIN_API_TOKEN not configured.",
    };
  }
  try {
    const orders = await queryPaidOrdersForBurnRate({ days: 7, limit: 250 });
    const cutoff = now.getTime() - SEVEN_DAYS_MS;
    const sum = orders
      .filter((o) => Date.parse(o.createdAt) >= cutoff)
      .reduce((s, o) => s + (Number.isFinite(o.totalAmount) ? o.totalAmount : 0), 0);
    return {
      channel: "shopify",
      status: "wired",
      amountUsd: Math.round(sum * 100) / 100,
      source: { system: "shopify-admin-graphql", retrievedAt: now.toISOString() },
    };
  } catch (err) {
    return {
      channel: "shopify",
      status: "error",
      amountUsd: null,
      reason: `Shopify paid-orders query failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function readAmazonLast7d(now: Date): Promise<ChannelRevenueState> {
  if (!process.env.AMAZON_REFRESH_TOKEN?.trim()) {
    return {
      channel: "amazon",
      status: "not_wired",
      amountUsd: null,
      reason: "AMAZON_REFRESH_TOKEN not configured (LWA credentials missing).",
    };
  }
  const after = new Date(now.getTime() - SEVEN_DAYS_MS).toISOString();
  const before = now.toISOString();
  try {
    const orders = await withTimeout(
      fetchOrders(after, before),
      AMAZON_TIMEOUT_MS,
      "Amazon SP-API",
    );
    const sum = orders
      .filter((o) => o.OrderStatus !== "Canceled" && o.OrderStatus !== "Pending")
      .reduce((s, o) => {
        const amt = Number.parseFloat(o.OrderTotal?.Amount ?? "0");
        return s + (Number.isFinite(amt) ? amt : 0);
      }, 0);
    return {
      channel: "amazon",
      status: "wired",
      amountUsd: Math.round(sum * 100) / 100,
      source: { system: "amazon-sp-api", retrievedAt: now.toISOString() },
    };
  } catch (err) {
    return {
      channel: "amazon",
      status: "error",
      amountUsd: null,
      reason: `Amazon SP-API last-7d fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function readFaireLast7d(now: Date): Promise<ChannelRevenueState> {
  if (!isFaireConfigured()) {
    return {
      channel: "faire",
      status: "not_wired",
      amountUsd: null,
      reason: "FAIRE_ACCESS_TOKEN not configured.",
    };
  }
  try {
    const orders = await getRecentFaireOrders(7);
    if (orders === null) {
      return {
        channel: "faire",
        status: "error",
        amountUsd: null,
        reason: "Faire /orders returned no payload (token rejected or upstream error).",
      };
    }
    const cutoff = now.getTime() - SEVEN_DAYS_MS;
    const sum = orders
      .filter((o) => {
        // We only count orders that actually progressed past
        // CART/PENDING. Faire's `state` includes CART, NEW, ACCEPTED,
        // CANCELED, etc. — we filter the obvious non-revenue rows.
        const s = (o.state || "").toUpperCase();
        if (s === "CART" || s === "CANCELED" || s === "CANCELLED") return false;
        if (!o.createdAt) return false;
        return Date.parse(o.createdAt) >= cutoff;
      })
      .reduce((acc, o) => acc + (typeof o.subtotal === "number" ? o.subtotal : 0), 0);
    return {
      channel: "faire",
      status: "wired",
      amountUsd: Math.round(sum * 100) / 100,
      source: { system: "faire-direct-api", retrievedAt: now.toISOString() },
    };
  } catch (err) {
    return {
      channel: "faire",
      status: "error",
      amountUsd: null,
      reason: `Faire /orders fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * B2B (wholesale outside Faire) — there is NO direct revenue source
 * wired today. Invoiced wholesale revenue lives in QBO; HubSpot
 * holds deal stages but not a queryable revenue join. Surface this
 * honestly rather than guessing.
 */
export function readB2BLast7d(): ChannelRevenueState {
  return {
    channel: "b2b",
    status: "not_wired",
    amountUsd: null,
    reason:
      "B2B (wholesale outside Faire) revenue read not wired. QBO sent-invoice query + HubSpot deal-amount join would land here. Until then, KPI scorecard treats B2B as zero with confidence=partial.",
  };
}

/**
 * "Unknown" channel — permanent placeholder for revenue that can't
 * be attributed to any of the four primary channels. Always
 * `not_wired`; surfaces honestly so the dashboard can never imply
 * "every dollar is accounted for."
 */
export function readUnknownChannelLast7d(): ChannelRevenueState {
  return {
    channel: "unknown",
    status: "not_wired",
    amountUsd: null,
    reason:
      "Unattributed revenue placeholder. Catch-all for dollars that don't map to Shopify/Amazon/Faire/B2B. Always not_wired by design.",
  };
}

/**
 * Read every channel in parallel with per-reader error isolation.
 * Returns a tuple of `ChannelRevenueState`s in a stable order so the
 * dashboard can render them deterministically.
 */
export async function readAllChannelsLast7d(now: Date): Promise<ChannelRevenueState[]> {
  const [shopify, amazon, faire] = await Promise.all([
    readShopifyLast7d(now),
    readAmazonLast7d(now),
    readFaireLast7d(now),
  ]);
  return [shopify, amazon, faire, readB2BLast7d(), readUnknownChannelLast7d()];
}
