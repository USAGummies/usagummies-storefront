/**
 * ATP gate tests — lock down the over-promise logic.
 */
import { describe, expect, it } from "vitest";

import { evaluateAtp, BAGS_PER_CARTON } from "../atp-gate";
import type { InventorySnapshot } from "../inventory-snapshot";

function snapshot(totalOnHand: number): InventorySnapshot {
  return {
    generatedAt: new Date().toISOString(),
    lowThreshold: 100,
    totalRows: 1,
    lowCount: totalOnHand < 100 ? 1 : 0,
    rows: [
      {
        sku: "UG-AAGB-6CT",
        productTitle: "All American Gummy Bears",
        variantTitle: "7.5 oz Bag",
        variantId: "gid://shopify/ProductVariant/1",
        onHand: totalOnHand,
        byLocation: [
          { locationId: "loc-1", locationName: "Ashford", onHand: totalOnHand },
        ],
        low: totalOnHand < 100,
        threshold: 100,
      },
    ],
  };
}

describe("BAGS_PER_CARTON constants", () => {
  it("mailer = 1, case = 6, master_carton = 36", () => {
    expect(BAGS_PER_CARTON.mailer).toBe(1);
    expect(BAGS_PER_CARTON.case).toBe(6);
    expect(BAGS_PER_CARTON.master_carton).toBe(36);
  });
});

describe("evaluateAtp — happy path", () => {
  it("returns ok when projected balance ≥ 0", () => {
    const r = evaluateAtp({
      snapshot: snapshot(1000),
      stages: {},
      excludeKeys: [],
      newCartons: 2,
      newPackagingType: "master_carton",
    });
    expect(r.risk).toBe("ok");
    expect(r.projectedDeficit).toBe(0);
    expect(r.totalBagsOnHand).toBe(1000);
    expect(r.newOutboundBags).toBe(72);
  });

  it("counts pending-outbound from non-shipped stages", () => {
    const r = evaluateAtp({
      snapshot: snapshot(500),
      stages: {
        "inv:1": {
          stage: "packed",
          cartonsRequired: 2,
          packagingType: "master_carton",
        },
        "inv:2": {
          stage: "shipped",
          cartonsRequired: 5,
          packagingType: "master_carton",
        },
      },
      excludeKeys: [],
      newCartons: 1,
      newPackagingType: "master_carton",
    });
    // 500 - 72 (pending from inv:1) - 36 (new) = 392. shipped keys excluded.
    expect(r.pendingOutboundBags).toBe(72);
    expect(r.newOutboundBags).toBe(36);
    expect(r.risk).toBe("ok");
  });

  it("excludes keys in excludeKeys from pending sum", () => {
    const r = evaluateAtp({
      snapshot: snapshot(200),
      stages: {
        "inv:1": {
          stage: "packed",
          cartonsRequired: 3,
          packagingType: "master_carton",
        },
      },
      excludeKeys: ["inv:1"],
      newCartons: 3,
      newPackagingType: "master_carton",
    });
    // inv:1 excluded so pending=0; new=108. 200-0-108=92. ok.
    expect(r.pendingOutboundBags).toBe(0);
    expect(r.risk).toBe("ok");
  });
});

describe("evaluateAtp — risk thresholds", () => {
  it("warns when deficit ≤ 24 bags", () => {
    const r = evaluateAtp({
      snapshot: snapshot(36),
      stages: {},
      excludeKeys: [],
      newCartons: 2, // 72 bags
      newPackagingType: "master_carton",
    });
    // 36 - 0 - 72 = -36. deficit=36, > 24 → block.
    expect(r.risk).toBe("block");

    const r2 = evaluateAtp({
      snapshot: snapshot(60),
      stages: {},
      excludeKeys: [],
      newCartons: 2, // 72 bags
      newPackagingType: "master_carton",
    });
    // 60 - 0 - 72 = -12. deficit=12, ≤ 24 → warn.
    expect(r2.risk).toBe("warn");
  });

  it("blocks when deficit > 24 bags", () => {
    const r = evaluateAtp({
      snapshot: snapshot(10),
      stages: {},
      excludeKeys: [],
      newCartons: 2,
      newPackagingType: "master_carton",
    });
    expect(r.risk).toBe("block");
    expect(r.projectedDeficit).toBeGreaterThan(24);
  });

  it("computes safeMaxCartons correctly", () => {
    const r = evaluateAtp({
      snapshot: snapshot(250),
      stages: {},
      excludeKeys: [],
      newCartons: 10, // intentional over-request
      newPackagingType: "master_carton",
    });
    // 250 / 36 = 6 (floor)
    expect(r.safeMaxCartons).toBe(6);
  });
});

describe("evaluateAtp — mailer packaging", () => {
  it("scales with mailer = 1 bag", () => {
    const r = evaluateAtp({
      snapshot: snapshot(100),
      stages: {},
      excludeKeys: [],
      newCartons: 5,
      newPackagingType: "mailer",
    });
    expect(r.newOutboundBags).toBe(5);
    expect(r.risk).toBe("ok");
    expect(r.safeMaxCartons).toBe(100);
  });
});

describe("evaluateAtp — unknown snapshot", () => {
  it("returns ok (short-circuit) when snapshot is null", () => {
    const r = evaluateAtp({
      snapshot: null,
      stages: {},
      excludeKeys: [],
      newCartons: 100,
      newPackagingType: "master_carton",
    });
    expect(r.risk).toBe("ok");
    expect(r.totalBagsOnHand).toBeNull();
    expect(r.safeMaxCartons).toBeNull();
    expect(r.reason).toMatch(/unavailable/i);
  });
});
