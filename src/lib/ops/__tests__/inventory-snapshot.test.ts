/**
 * inventory-snapshot tests — buildSnapshotFromOnHand, lookupSku,
 * decrementSnapshot.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_INVENTORY_LOW_THRESHOLD,
  buildSnapshotFromOnHand,
  decrementSnapshot,
  lookupSkuInSnapshot,
  type InventorySnapshot,
} from "../inventory-snapshot";
import type { OnHandRow } from "../shopify-admin-actions";

function onHandRows(rows: Array<{ sku: string; onHand: number }>): OnHandRow[] {
  return rows.map((r) => ({
    sku: r.sku,
    productTitle: `Product ${r.sku}`,
    variantTitle: "Default",
    variantId: `gid://shopify/ProductVariant/${r.sku}`,
    onHand: r.onHand,
    byLocation: [
      { locationId: "loc-1", locationName: "Ashford", onHand: r.onHand },
    ],
  }));
}

function baseSnapshot(): InventorySnapshot {
  return buildSnapshotFromOnHand(
    onHandRows([
      { sku: "UG-AAGB-6CT", onHand: 500 },
      { sku: "UG-AAGB-MAILER", onHand: 200 },
      { sku: "UG-LOW", onHand: 10 },
    ]),
    { lowThreshold: 50 },
  );
}

describe("buildSnapshotFromOnHand", () => {
  it("skips untracked rows (no byLocation entries)", () => {
    const snap = buildSnapshotFromOnHand([
      ...onHandRows([{ sku: "A", onHand: 100 }]),
      {
        sku: "B",
        productTitle: "B",
        variantTitle: "x",
        variantId: "gid:B",
        onHand: 0,
        byLocation: [], // untracked
      },
    ]);
    expect(snap.rows.find((r) => r.sku === "A")).toBeDefined();
    expect(snap.rows.find((r) => r.sku === "B")).toBeUndefined();
  });

  it("flags low when onHand < threshold", () => {
    const snap = buildSnapshotFromOnHand(
      onHandRows([
        { sku: "A", onHand: 100 },
        { sku: "B", onHand: 10 },
      ]),
      { lowThreshold: 50 },
    );
    expect(snap.rows.find((r) => r.sku === "A")?.low).toBe(false);
    expect(snap.rows.find((r) => r.sku === "B")?.low).toBe(true);
    expect(snap.lowCount).toBe(1);
  });

  it("defaults threshold to DEFAULT_INVENTORY_LOW_THRESHOLD when opts omitted", () => {
    const snap = buildSnapshotFromOnHand(onHandRows([{ sku: "A", onHand: 100 }]));
    expect(snap.lowThreshold).toBe(DEFAULT_INVENTORY_LOW_THRESHOLD);
  });
});

describe("lookupSkuInSnapshot", () => {
  it("finds a matching SKU case-insensitive", () => {
    const snap = baseSnapshot();
    expect(lookupSkuInSnapshot(snap, "ug-aagb-6ct")?.onHand).toBe(500);
    expect(lookupSkuInSnapshot(snap, "UG-AAGB-6CT")?.onHand).toBe(500);
  });

  it("returns null on missing SKU or empty input", () => {
    const snap = baseSnapshot();
    expect(lookupSkuInSnapshot(snap, "missing")).toBeNull();
    expect(lookupSkuInSnapshot(null, "UG-AAGB-6CT")).toBeNull();
    expect(lookupSkuInSnapshot(snap, "")).toBeNull();
  });
});

describe("decrementSnapshot", () => {
  it("returns input unchanged for decrementBags ≤ 0", () => {
    const snap = baseSnapshot();
    expect(decrementSnapshot(snap, 0)).toBe(snap);
    expect(decrementSnapshot(snap, -5)).toBe(snap);
  });

  it("returns null when input is null", () => {
    expect(decrementSnapshot(null, 10)).toBeNull();
  });

  it("drains from largest-onHand row first", () => {
    const snap = baseSnapshot(); // 500, 200, 10
    const result = decrementSnapshot(snap, 100);
    // 100 drained from the 500 row (largest).
    expect(result!.rows.find((r) => r.sku === "UG-AAGB-6CT")?.onHand).toBe(
      400,
    );
    expect(result!.rows.find((r) => r.sku === "UG-AAGB-MAILER")?.onHand).toBe(
      200,
    );
    expect(result!.rows.find((r) => r.sku === "UG-LOW")?.onHand).toBe(10);
  });

  it("continues to next row when first is exhausted", () => {
    const snap = baseSnapshot(); // 500, 200, 10
    const result = decrementSnapshot(snap, 550); // takes 500 from largest, 50 from next
    expect(result!.rows.find((r) => r.sku === "UG-AAGB-6CT")?.onHand).toBe(0);
    expect(result!.rows.find((r) => r.sku === "UG-AAGB-MAILER")?.onHand).toBe(
      150,
    );
    expect(result!.rows.find((r) => r.sku === "UG-LOW")?.onHand).toBe(10);
  });

  it("floors at 0 when decrement exceeds total on-hand", () => {
    const snap = baseSnapshot(); // total = 710
    const result = decrementSnapshot(snap, 9999);
    for (const r of result!.rows) {
      expect(r.onHand).toBeGreaterThanOrEqual(0);
    }
  });

  it("updates low-flag after decrement", () => {
    const snap = baseSnapshot(); // threshold 50, rows [500, 200, 10]
    const result = decrementSnapshot(snap, 490); // 500 row → 10 → should go low
    const aagb6 = result!.rows.find((r) => r.sku === "UG-AAGB-6CT");
    expect(aagb6?.onHand).toBe(10);
    expect(aagb6?.low).toBe(true);
  });

  it("preserves original row order in the output", () => {
    const snap = baseSnapshot();
    const originalOrder = snap.rows.map((r) => r.sku);
    const result = decrementSnapshot(snap, 100);
    expect(result!.rows.map((r) => r.sku)).toEqual(originalOrder);
  });
});
