/**
 * Inventory Snapshot — USA Gummies
 *
 * Persistent on-hand cache. The Ops Agent calls Shopify every morning
 * at 09:00 PT; downstream consumers (Shipping Hub ATP gate, ad-hoc
 * status queries, over-promise prevention) need fresh on-hand data
 * without re-hitting Shopify every time.
 *
 * This module owns the shape + KV key. Writers: `/api/ops/inventory/snapshot`.
 * Readers: Shipping Hub, Ops Agent, ad-hoc agent queries.
 *
 * Canonical location: Ashford (primary), per
 * /contracts/integrations/shipstation.md §1. Low-stock threshold
 * defaults to 24 units but is env-overridable per-SKU (future work).
 */

import type { OnHandRow } from "./shopify-admin-actions";

export const KV_INVENTORY_SNAPSHOT = "inventory:snapshot:v1";

/** Default low-stock trigger. Matches Ops Agent today. */
export const DEFAULT_INVENTORY_LOW_THRESHOLD = 24;

/**
 * Compact per-SKU row stored in the snapshot. Smaller than `OnHandRow`
 * so KV round-trips stay cheap.
 */
export interface InventorySnapshotRow {
  sku: string;
  productTitle: string;
  variantTitle: string;
  variantId: string;
  onHand: number;
  /** Per-location breakdown — identifies which warehouse holds stock. */
  byLocation: Array<{ locationId: string; locationName: string; onHand: number }>;
  /** Set when onHand < threshold at snapshot time. */
  low: boolean;
  /** Threshold used for `low` — lets callers know if it was overridden. */
  threshold: number;
}

export interface InventorySnapshot {
  generatedAt: string;
  lowThreshold: number;
  totalRows: number;
  lowCount: number;
  rows: InventorySnapshotRow[];
}

/**
 * Compute the snapshot shape from a fresh Shopify on-hand fetch.
 * Pure function — safe to unit-test. Does NOT touch KV.
 */
export function buildSnapshotFromOnHand(
  rows: OnHandRow[],
  opts?: { lowThreshold?: number },
): InventorySnapshot {
  const threshold = opts?.lowThreshold ?? DEFAULT_INVENTORY_LOW_THRESHOLD;
  const generatedAt = new Date().toISOString();

  // Only include SKUs that are actually stocked — skip variants Shopify
  // returned with no inventoryLevels (those have onHand 0 by default but
  // aren't tracked, so flagging them as "low" is noise).
  const snapshotRows: InventorySnapshotRow[] = rows
    .filter((r) => r.byLocation.length > 0)
    .map((r) => ({
      sku: r.sku,
      productTitle: r.productTitle,
      variantTitle: r.variantTitle,
      variantId: r.variantId,
      onHand: r.onHand,
      byLocation: r.byLocation,
      low: r.onHand < threshold,
      threshold,
    }));

  return {
    generatedAt,
    lowThreshold: threshold,
    totalRows: snapshotRows.length,
    lowCount: snapshotRows.filter((r) => r.low).length,
    rows: snapshotRows,
  };
}

/**
 * Look up on-hand + low-flag for a specific SKU in a snapshot.
 * Useful for the Shipping Hub ATP gate.
 */
export function lookupSkuInSnapshot(
  snap: InventorySnapshot | null | undefined,
  sku: string,
): InventorySnapshotRow | null {
  if (!snap) return null;
  const needle = sku.trim().toLowerCase();
  if (!needle) return null;
  return (
    snap.rows.find((r) => r.sku.trim().toLowerCase() === needle) ?? null
  );
}

/**
 * Decrement the snapshot by a fixed bag count after a label buy.
 *
 * Problem: the snapshot only refreshes once a day (Ops Agent cron at
 * 10:00 PT). If Ben ships 144 bags today at 11:00 PT, the cached
 * snapshot still shows the pre-ship on-hand until tomorrow's run.
 * The ATP gate + Slack preflight would read stale numbers all day.
 *
 * Fix: after every successful buy-label call, mutate the snapshot in
 * place, subtracting the outbound bags proportionally across rows
 * (largest-onHand row first → avoids negative balances on small SKUs).
 * The next Ops Agent refresh at 10:00 PT next day reconciles from
 * Shopify ground truth, so any drift is self-healing.
 *
 * Pure function — returns a new snapshot. Callers persist to KV.
 * Returns the original snapshot unchanged when `decrementBags` ≤ 0
 * or the snapshot is missing/empty.
 */
export function decrementSnapshot(
  snap: InventorySnapshot | null,
  decrementBags: number,
): InventorySnapshot | null {
  if (!snap) return null;
  if (!(decrementBags > 0)) return snap;
  if (snap.rows.length === 0) return snap;

  // Sort rows by onHand desc so we drain the fullest SKU first — this
  // matches the real-world order-picker pattern (pull from whichever
  // has inventory) and keeps smaller SKUs from going negative.
  const rows = [...snap.rows].sort((a, b) => b.onHand - a.onHand);
  let remaining = decrementBags;
  const newRows = rows.map((r) => {
    if (remaining <= 0) return r;
    const take = Math.min(r.onHand, remaining);
    remaining -= take;
    const newOnHand = Math.max(0, r.onHand - take);
    return {
      ...r,
      onHand: newOnHand,
      low: newOnHand < r.threshold,
      byLocation:
        r.byLocation.length > 0
          ? r.byLocation.map((loc, idx) =>
              idx === 0 ? { ...loc, onHand: Math.max(0, loc.onHand - take) } : loc,
            )
          : r.byLocation,
    };
  });

  // If remaining > 0 after draining every row, the caller over-promised
  // in KV. We floor at zero (no negative on-hand) — the next real
  // snapshot refresh reconciles.
  const preservedOrder = snap.rows.map(
    (orig) =>
      newRows.find((r) => r.variantId === orig.variantId) ?? orig,
  );
  return {
    ...snap,
    rows: preservedOrder,
    lowCount: preservedOrder.filter((r) => r.low).length,
  };
}
