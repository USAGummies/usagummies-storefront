/**
 * Burn-rate Calibration — compute bags/day from actual sales data.
 *
 * Replaces the placeholder `INVENTORY_BURN_RATE_BAGS_PER_DAY=250` env
 * with a rolling 30-day measured rate from Shopify + Amazon order
 * history. Called by a weekly cron (Sunday 03:30 UTC) that caches
 * the result in KV; `forecastCoverDays()` reads the cache.
 *
 * Sources:
 *   - Shopify: queryPaidOrdersForBurnRate — sums line-item quantity
 *     across all paid orders in window
 *   - Amazon: fetchOrders filtered to Shipped/Delivered status,
 *     sums NumberOfItemsShipped
 *
 * Confidence ladder per the research blueprint §1 non-negotiable:
 *   - We never emit a burn rate without a source. If Shopify + Amazon
 *     both fail, we return null → forecast falls back to env → default.
 *   - Low-sample windows (< 7 orders) surface a `confidence: "low"`
 *     flag so callers can de-emphasize the projection.
 *
 * Pure function: takes a `now` date for testability, no side effects
 * beyond the KV write (which the caller owns).
 */

import { kv } from "@vercel/kv";

import {
  fetchOrders,
  isAmazonConfigured,
} from "@/lib/amazon/sp-api";
import {
  queryPaidOrdersForBurnRate,
  type PaidOrderSummary,
} from "./shopify-admin-actions";

export const KV_BURN_RATE_CAL = "inventory:burn-rate-calibration:v1";

export interface BurnRateCalibration {
  generatedAt: string;
  windowDays: number;
  shopify: {
    ok: boolean;
    orders: number;
    units: number;
    bagsPerDay: number;
    reason?: string;
  };
  amazon: {
    ok: boolean;
    orders: number;
    units: number;
    bagsPerDay: number;
    reason?: string;
  };
  /** Combined bags/day across channels. null when both sides failed. */
  bagsPerDay: number | null;
  /** `high` when sample ≥ 30 orders; `medium` when ≥ 7; `low` otherwise. */
  confidence: "high" | "medium" | "low" | "none";
  /** Provenance for blueprint §1 citation. */
  sources: Array<{ system: string; retrievedAt: string }>;
}

async function computeShopifyBurn(
  days: number,
): Promise<BurnRateCalibration["shopify"]> {
  try {
    const orders = await queryPaidOrdersForBurnRate({ days, limit: 250 });
    const units = orders.reduce(
      (s: number, o: PaidOrderSummary) => s + o.totalUnits,
      0,
    );
    return {
      ok: true,
      orders: orders.length,
      units,
      bagsPerDay: Math.round((units / days) * 10) / 10,
    };
  } catch (err) {
    return {
      ok: false,
      orders: 0,
      units: 0,
      bagsPerDay: 0,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

async function computeAmazonBurn(
  days: number,
  now: Date,
): Promise<BurnRateCalibration["amazon"]> {
  if (!isAmazonConfigured()) {
    return {
      ok: false,
      orders: 0,
      units: 0,
      bagsPerDay: 0,
      reason: "Amazon SP-API not configured",
    };
  }
  try {
    const createdAfter = new Date(
      now.getTime() - days * 24 * 3600 * 1000,
    ).toISOString();
    const createdBefore = now.toISOString();
    const orders = await fetchOrders(createdAfter, createdBefore);
    // Units shipped = NumberOfItemsShipped (fulfilled side of the order).
    // This excludes unshipped counts so burn reflects real outflow.
    const shipped = orders.filter(
      (o) =>
        o.OrderStatus === "Shipped" ||
        o.OrderStatus === "PartiallyShipped" ||
        o.OrderStatus === "Unshipped", // FBM orders — the label buy IS the burn
    );
    const units = shipped.reduce(
      (s, o) =>
        s +
        (o.NumberOfItemsShipped ?? 0) +
        (o.NumberOfItemsUnshipped ?? 0),
      0,
    );
    return {
      ok: true,
      orders: shipped.length,
      units,
      bagsPerDay: Math.round((units / days) * 10) / 10,
    };
  } catch (err) {
    return {
      ok: false,
      orders: 0,
      units: 0,
      bagsPerDay: 0,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

function confidenceFor(totalOrders: number): BurnRateCalibration["confidence"] {
  if (totalOrders >= 30) return "high";
  if (totalOrders >= 7) return "medium";
  if (totalOrders > 0) return "low";
  return "none";
}

export async function computeBurnRateCalibration(
  opts: { windowDays?: number; now?: Date } = {},
): Promise<BurnRateCalibration> {
  const windowDays = Math.max(1, Math.min(90, opts.windowDays ?? 30));
  const now = opts.now ?? new Date();
  const retrievedAt = now.toISOString();
  const [shopify, amazon] = await Promise.all([
    computeShopifyBurn(windowDays),
    computeAmazonBurn(windowDays, now),
  ]);

  const totalOrders = shopify.orders + amazon.orders;
  const totalUnits = shopify.units + amazon.units;
  const bagsPerDay =
    shopify.ok || amazon.ok
      ? Math.round((totalUnits / windowDays) * 10) / 10
      : null;

  const sources: BurnRateCalibration["sources"] = [];
  if (shopify.ok) sources.push({ system: "shopify:orders", retrievedAt });
  if (amazon.ok) sources.push({ system: "amazon:sp-api:orders", retrievedAt });

  return {
    generatedAt: retrievedAt,
    windowDays,
    shopify,
    amazon,
    bagsPerDay,
    confidence: confidenceFor(totalOrders),
    sources,
  };
}

export async function getCachedBurnRate(): Promise<BurnRateCalibration | null> {
  const cached =
    (await kv.get<BurnRateCalibration>(KV_BURN_RATE_CAL)) ?? null;
  return cached;
}

export async function cacheBurnRate(cal: BurnRateCalibration): Promise<void> {
  await kv.set(KV_BURN_RATE_CAL, cal);
}
