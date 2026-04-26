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

/** Shopify orders carrying this tag are wholesale / B2B and are
 *  attributed to the B2B channel, NOT to Shopify DTC. The booth-order
 *  route applies it consistently. Future wholesale order paths must
 *  either apply the same tag or extend the B2B reader's filter. */
export const B2B_SHOPIFY_TAG = "wholesale";

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
    // Exclude `tag:wholesale` so wholesale Shopify orders flow into
    // the B2B channel (`readB2BLast7d`) instead of inflating Shopify
    // DTC. This is the no-double-count contract — locked by tests.
    const orders = await queryPaidOrdersForBurnRate({
      days: 7,
      limit: 250,
      tagFilter: { exclude: [B2B_SHOPIFY_TAG] },
    });
    const cutoff = now.getTime() - SEVEN_DAYS_MS;
    const sum = orders
      .filter((o) => Date.parse(o.createdAt) >= cutoff)
      .reduce((s, o) => s + (Number.isFinite(o.totalAmount) ? o.totalAmount : 0), 0);
    return {
      channel: "shopify",
      status: "wired",
      amountUsd: Math.round(sum * 100) / 100,
      source: { system: "shopify-admin-graphql (DTC; -tag:wholesale)", retrievedAt: now.toISOString() },
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
 * B2B (wholesale outside Faire) — Phase 1 source: paid Shopify
 * orders carrying `tag:wholesale`. The booth-order route at
 * `/api/booth-order` applies that tag to every wholesale order
 * (pay-now and invoice-me). `financial_status:paid` excludes
 * unpaid invoice-me holds and drafts naturally.
 *
 * Hard contract:
 *   - Reads ONLY Shopify (no QBO, no HubSpot, no AP packets, no
 *     manual ledger). The KPI scorecard's no-fabrication and
 *     no-pipeline-as-revenue rules forbid HubSpot Closed-Won deal
 *     values and unattributed QBO invoices.
 *   - Sums `financial_status:paid` only. Drafts and on-hold
 *     invoice-me orders are NEVER counted.
 *   - Pairs with `readShopifyLast7d` which excludes the same tag,
 *     so a wholesale order appears in B2B and ONLY B2B (no double-
 *     count with Shopify DTC).
 *
 * Known Phase 1 gap (documented, not papered over): wholesale
 * orders created in Shopify Admin without `tag:wholesale` will be
 * counted in Shopify DTC instead of B2B. Future Phase 2: add a
 * QBO Class-attribution path or a Shopify customer-tag fallback.
 */
export async function readB2BLast7d(now: Date): Promise<ChannelRevenueState> {
  if (!process.env.SHOPIFY_ADMIN_API_TOKEN?.trim()) {
    return {
      channel: "b2b",
      status: "not_wired",
      amountUsd: null,
      reason:
        "SHOPIFY_ADMIN_API_TOKEN not configured. Phase 1 B2B revenue source is paid Shopify orders with `tag:wholesale`; without an admin token the read can't run.",
    };
  }
  try {
    const orders = await queryPaidOrdersForBurnRate({
      days: 7,
      limit: 250,
      tagFilter: { include: [B2B_SHOPIFY_TAG] },
    });
    const cutoff = now.getTime() - SEVEN_DAYS_MS;
    const filtered = orders.filter((o) => Date.parse(o.createdAt) >= cutoff);
    const sum = filtered.reduce(
      (s, o) => s + (Number.isFinite(o.totalAmount) ? o.totalAmount : 0),
      0,
    );
    return {
      channel: "b2b",
      status: "wired",
      amountUsd: Math.round(sum * 100) / 100,
      source: {
        system: "shopify-admin-graphql (B2B; tag:wholesale, financial_status:paid)",
        retrievedAt: now.toISOString(),
      },
    };
  } catch (err) {
    return {
      channel: "b2b",
      status: "error",
      amountUsd: null,
      reason: `B2B Shopify wholesale-tagged paid-orders query failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
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
  const [shopify, amazon, faire, b2b] = await Promise.all([
    readShopifyLast7d(now),
    readAmazonLast7d(now),
    readFaireLast7d(now),
    readB2BLast7d(now),
  ]);
  return [shopify, amazon, faire, b2b, readUnknownChannelLast7d()];
}
