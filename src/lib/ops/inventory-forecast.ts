/**
 * Inventory Cover-Day Forecast (S-07 MVP)
 *
 * Pure helper: given a snapshot + burn-rate config, returns cover-
 * days per SKU + a rollup. Consumed by `/api/ops/inventory/cover-days`
 * and the weekly fulfillment summary.
 *
 * MVP burn model:
 *   - Env `INVENTORY_BURN_RATE_BAGS_PER_DAY` sets a single global
 *     burn rate (default 250 bags/day — placeholder; Ben tunes as
 *     volume stabilizes).
 *   - Per-SKU burn overrides via `INVENTORY_BURN_RATE_<SKU>` envs.
 *   - Cover days = onHand / burnPerDay.
 *   - Reorder urgency: cover ≤ 14d = urgent, ≤ 30d = soon, > 30d = ok.
 *
 * When Shopify order-history-based burn-rate calibration lands, this
 * module swaps out the env-driven rate for a rolling 30-day mean
 * computed from `orders.lineItems`. The shape here stays stable so
 * consumers don't break.
 */

import type { InventorySnapshot, InventorySnapshotRow } from "./inventory-snapshot";

export type CoverUrgency = "urgent" | "soon" | "ok" | "unknown";

export interface CoverDaysRow {
  sku: string;
  productTitle: string;
  variantTitle: string;
  onHand: number;
  burnRatePerDay: number;
  coverDays: number | null;
  urgency: CoverUrgency;
  expectedStockoutDate: string | null;
}

export interface CoverDaysForecast {
  generatedAt: string;
  defaultBurnRate: number;
  totalOnHand: number;
  totalBurnRate: number;
  fleetCoverDays: number | null;
  rows: CoverDaysRow[];
  reorderRecommended: CoverDaysRow[];
}

const DEFAULT_BURN = Number.parseFloat(
  process.env.INVENTORY_BURN_RATE_BAGS_PER_DAY ?? "",
);

function defaultBurn(): number {
  return Number.isFinite(DEFAULT_BURN) && DEFAULT_BURN > 0 ? DEFAULT_BURN : 250;
}

function burnFor(sku: string): number {
  if (!sku) return defaultBurn();
  const envKey = `INVENTORY_BURN_RATE_${sku.replace(/[^A-Z0-9]/gi, "_").toUpperCase()}`;
  const raw = process.env[envKey];
  if (raw) {
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return defaultBurn();
}

function urgencyFor(coverDays: number | null): CoverUrgency {
  if (coverDays === null) return "unknown";
  if (coverDays <= 14) return "urgent";
  if (coverDays <= 30) return "soon";
  return "ok";
}

function projectStockout(onHand: number, burn: number): string | null {
  if (burn <= 0) return null;
  const days = onHand / burn;
  const ms = Date.now() + days * 24 * 3600 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function forecastCoverDays(
  snap: InventorySnapshot | null,
): CoverDaysForecast {
  const now = new Date().toISOString();
  const dflt = defaultBurn();
  if (!snap || snap.rows.length === 0) {
    return {
      generatedAt: now,
      defaultBurnRate: dflt,
      totalOnHand: 0,
      totalBurnRate: 0,
      fleetCoverDays: null,
      rows: [],
      reorderRecommended: [],
    };
  }

  const rows: CoverDaysRow[] = snap.rows.map((r: InventorySnapshotRow) => {
    const burn = burnFor(r.sku);
    const coverDays =
      burn > 0 ? Math.round((r.onHand / burn) * 10) / 10 : null;
    return {
      sku: r.sku,
      productTitle: r.productTitle,
      variantTitle: r.variantTitle,
      onHand: r.onHand,
      burnRatePerDay: burn,
      coverDays,
      urgency: urgencyFor(coverDays),
      expectedStockoutDate: projectStockout(r.onHand, burn),
    };
  });

  const totalOnHand = rows.reduce((s, r) => s + r.onHand, 0);
  const totalBurnRate = rows.reduce((s, r) => s + r.burnRatePerDay, 0);
  const fleetCoverDays =
    totalBurnRate > 0
      ? Math.round((totalOnHand / totalBurnRate) * 10) / 10
      : null;

  const reorderRecommended = rows
    .filter((r) => r.urgency === "urgent" || r.urgency === "soon")
    .sort((a, b) => (a.coverDays ?? Infinity) - (b.coverDays ?? Infinity));

  return {
    generatedAt: now,
    defaultBurnRate: dflt,
    totalOnHand,
    totalBurnRate,
    fleetCoverDays,
    rows,
    reorderRecommended,
  };
}
