/**
 * Phase 28k — Amazon FBM customer registry helpers.
 *
 * Locks the contract:
 *   - computeAmazonCustomerFingerprint normalizes case, strips
 *     punctuation, collapses whitespace, takes first 5 ZIP digits.
 *   - Returns null when name OR ZIP missing (won't collide buyers
 *     under a noisy default key).
 *   - recordAmazonOrderShipped upserts: first-time creates; repeat
 *     increments orderCount + totalBags + totalRevenueUsd.
 *   - Same orderNumber called twice doesn't double-count (idempotent).
 *   - recentOrders capped at 10, newest first.
 *   - sortAmazonCustomers + summarizeAmazonCustomers are pure +
 *     deterministic (stable on ties via fingerprint).
 *   - Fail-soft on KV throw: returns ok:false but never throws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory KV mock, mirrors the shipping-artifacts test pattern.
vi.mock("@vercel/kv", () => {
  const map = new Map<string, string>();
  let throwOnNext = false;
  return {
    kv: {
      get: vi.fn(async (k: string) => {
        if (throwOnNext) {
          throwOnNext = false;
          throw new Error("KV down");
        }
        return map.get(k) ?? null;
      }),
      set: vi.fn(async (k: string, v: string) => {
        if (throwOnNext) {
          throwOnNext = false;
          throw new Error("KV down");
        }
        map.set(k, v);
        return "OK";
      }),
      scan: vi.fn(async (_cursor: number, opts: { match?: string }) => {
        const pat = opts.match ?? "*";
        const re = new RegExp(`^${pat.replace(/\*/g, ".*")}$`);
        const keys = Array.from(map.keys()).filter((k) => re.test(k));
        return [0, keys];
      }),
      __store: map,
      __throwNext: () => {
        throwOnNext = true;
      },
    },
  };
});

beforeEach(async () => {
  const { kv } = (await import("@vercel/kv")) as unknown as {
    kv: { __store: Map<string, string> };
  };
  kv.__store.clear();
});

afterEach(() => vi.clearAllMocks());

describe("computeAmazonCustomerFingerprint", () => {
  it("lowercases name and combines with ZIP5", async () => {
    const { computeAmazonCustomerFingerprint } = await import(
      "../amazon-customers"
    );
    expect(
      computeAmazonCustomerFingerprint({
        shipToName: "ann (Molak)",
        shipToPostalCode: "02806-5034",
      }),
    ).toBe("ann molak|02806");
  });

  it("strips punctuation and collapses whitespace", async () => {
    const { computeAmazonCustomerFingerprint } = await import(
      "../amazon-customers"
    );
    expect(
      computeAmazonCustomerFingerprint({
        shipToName: "  Donald   D'Amadio  ",
        shipToPostalCode: "81137",
      }),
    ).toBe("donald damadio|81137");
  });

  it("preserves digits in the name (some real customer names have suffixes)", async () => {
    const { computeAmazonCustomerFingerprint } = await import(
      "../amazon-customers"
    );
    expect(
      computeAmazonCustomerFingerprint({
        shipToName: "Laura Biddle PO2602178",
        shipToPostalCode: "44841-9617",
      }),
    ).toBe("laura biddle po2602178|44841");
  });

  it("returns null when name missing", async () => {
    const { computeAmazonCustomerFingerprint } = await import(
      "../amazon-customers"
    );
    expect(
      computeAmazonCustomerFingerprint({
        shipToName: null,
        shipToPostalCode: "12345",
      }),
    ).toBeNull();
    expect(
      computeAmazonCustomerFingerprint({
        shipToName: "   ",
        shipToPostalCode: "12345",
      }),
    ).toBeNull();
  });

  it("returns null when ZIP missing or non-numeric", async () => {
    const { computeAmazonCustomerFingerprint } = await import(
      "../amazon-customers"
    );
    expect(
      computeAmazonCustomerFingerprint({
        shipToName: "ann",
        shipToPostalCode: null,
      }),
    ).toBeNull();
    expect(
      computeAmazonCustomerFingerprint({
        shipToName: "ann",
        shipToPostalCode: "ABCDE",
      }),
    ).toBeNull();
  });

  it("collapses ZIP+4 to ZIP5 (so the same buyer with reformatted ZIP doesn't fork)", async () => {
    const { computeAmazonCustomerFingerprint } = await import(
      "../amazon-customers"
    );
    const a = computeAmazonCustomerFingerprint({
      shipToName: "ann",
      shipToPostalCode: "02806",
    });
    const b = computeAmazonCustomerFingerprint({
      shipToName: "ann",
      shipToPostalCode: "02806-5034",
    });
    expect(a).toBe(b);
  });
});

describe("recordAmazonOrderShipped", () => {
  it("first-time order creates the record with orderCount=1", async () => {
    const { recordAmazonOrderShipped, getAmazonCustomer } = await import(
      "../amazon-customers"
    );
    const result = await recordAmazonOrderShipped({
      orderNumber: "113-6688403-1140261",
      shippedAt: "2026-04-27T14:00:00.000Z",
      shipToName: "ann (Molak)",
      shipToCity: "Barrington",
      shipToState: "RI",
      shipToPostalCode: "02806-5034",
      bags: 1,
      shippingCostUsd: 6.95,
      revenueUsd: 6.41,
      trackingNumber: "9400150206217662156805",
    });
    expect(result.ok).toBe(true);
    expect(result.fingerprint).toBe("ann molak|02806");
    expect(result.isFirstOrder).toBe(true);

    const stored = await getAmazonCustomer(result.fingerprint!);
    expect(stored).not.toBeNull();
    expect(stored?.orderCount).toBe(1);
    expect(stored?.totalBags).toBe(1);
    expect(stored?.totalRevenueUsd).toBe(6.41);
    expect(stored?.totalShippingCostUsd).toBe(6.95);
    expect(stored?.firstSeenAt).toBe("2026-04-27T14:00:00.000Z");
    expect(stored?.lastSeenAt).toBe("2026-04-27T14:00:00.000Z");
    expect(stored?.shipToCity).toBe("Barrington");
    expect(stored?.shipToState).toBe("RI");
    expect(stored?.recentOrders).toHaveLength(1);
  });

  it("second order from same fingerprint increments aggregates", async () => {
    const { recordAmazonOrderShipped, getAmazonCustomer } = await import(
      "../amazon-customers"
    );
    await recordAmazonOrderShipped({
      orderNumber: "113-1111111-1111111",
      shippedAt: "2026-04-01T12:00:00.000Z",
      shipToName: "ann",
      shipToPostalCode: "02806",
      bags: 1,
      shippingCostUsd: 6.95,
      revenueUsd: 6.41,
    });
    const second = await recordAmazonOrderShipped({
      orderNumber: "113-2222222-2222222",
      shippedAt: "2026-04-27T12:00:00.000Z",
      shipToName: "ann",
      shipToPostalCode: "02806",
      bags: 3,
      shippingCostUsd: 7.85,
      revenueUsd: 18.0,
    });
    expect(second.isFirstOrder).toBe(false);

    const stored = await getAmazonCustomer("ann|02806");
    expect(stored?.orderCount).toBe(2);
    expect(stored?.totalBags).toBe(4);
    expect(stored?.totalRevenueUsd).toBe(24.41);
    expect(stored?.totalShippingCostUsd).toBe(14.8);
    expect(stored?.firstSeenAt).toBe("2026-04-01T12:00:00.000Z");
    expect(stored?.lastSeenAt).toBe("2026-04-27T12:00:00.000Z");
    expect(stored?.recentOrders).toHaveLength(2);
    // Newest first.
    expect(stored?.recentOrders[0].orderNumber).toBe("113-2222222-2222222");
  });

  it("idempotent on the same orderNumber (replay doesn't double-count)", async () => {
    const { recordAmazonOrderShipped, getAmazonCustomer } = await import(
      "../amazon-customers"
    );
    const payload = {
      orderNumber: "113-DUP-DUP",
      shippedAt: "2026-04-01T12:00:00.000Z",
      shipToName: "duplicate",
      shipToPostalCode: "12345",
      bags: 2,
      shippingCostUsd: 5.0,
      revenueUsd: 10.0,
    } as const;
    await recordAmazonOrderShipped(payload);
    await recordAmazonOrderShipped(payload);
    const stored = await getAmazonCustomer("duplicate|12345");
    expect(stored?.orderCount).toBe(1);
    expect(stored?.totalBags).toBe(2);
    expect(stored?.totalRevenueUsd).toBe(10);
  });

  it("recentOrders capped at 10, newest-first", async () => {
    const { recordAmazonOrderShipped, getAmazonCustomer } = await import(
      "../amazon-customers"
    );
    for (let i = 0; i < 15; i++) {
      await recordAmazonOrderShipped({
        orderNumber: `O-${String(i).padStart(3, "0")}`,
        shippedAt: `2026-04-${String((i % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
        shipToName: "highvolume",
        shipToPostalCode: "55555",
        bags: 1,
        shippingCostUsd: 5,
        revenueUsd: 6,
      });
    }
    const stored = await getAmazonCustomer("highvolume|55555");
    expect(stored?.orderCount).toBe(15); // aggregates count all
    expect(stored?.recentOrders).toHaveLength(10); // recent capped
    // Most recent (i=14, day=15) at the top.
    expect(stored?.recentOrders[0].orderNumber).toBe("O-014");
  });

  it("returns ok:true with null fingerprint when shipTo info insufficient (skips silently)", async () => {
    const { recordAmazonOrderShipped } = await import("../amazon-customers");
    const result = await recordAmazonOrderShipped({
      orderNumber: "X",
      shipToName: null,
      shipToPostalCode: "12345",
      bags: 1,
    });
    expect(result.ok).toBe(true);
    expect(result.fingerprint).toBeNull();
    expect(result.isFirstOrder).toBeNull();
  });

  it("ok:false with error when KV.set throws (fail-soft)", async () => {
    const kvMod = (await import("@vercel/kv")) as unknown as {
      kv: { set: ReturnType<typeof vi.fn> };
    };
    kvMod.kv.set.mockRejectedValueOnce(new Error("KV down on set"));
    const { recordAmazonOrderShipped } = await import("../amazon-customers");
    const result = await recordAmazonOrderShipped({
      orderNumber: "X",
      shipToName: "test",
      shipToPostalCode: "00001",
      bags: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/KV down/);
  });
});

describe("sortAmazonCustomers + summarizeAmazonCustomers", () => {
  function rec(over: Partial<{
    fingerprint: string;
    lastSeenAt: string;
    firstSeenAt: string;
    orderCount: number;
    totalBags: number;
    totalRevenueUsd: number;
  }> = {}) {
    return {
      fingerprint: "x|11111",
      shipToName: "X",
      shipToCity: null,
      shipToState: null,
      shipToPostalCode: "11111",
      firstSeenAt: "2026-04-01T00:00:00Z",
      lastSeenAt: "2026-04-01T00:00:00Z",
      orderCount: 1,
      totalBags: 1,
      totalRevenueUsd: 0,
      totalShippingCostUsd: 0,
      recentOrders: [],
      ...over,
    };
  }

  it('sorts by lastSeen DESC by default', async () => {
    const { sortAmazonCustomers } = await import("../amazon-customers");
    const out = sortAmazonCustomers(
      [
        rec({ fingerprint: "a", lastSeenAt: "2026-04-01T00:00:00Z" }),
        rec({ fingerprint: "b", lastSeenAt: "2026-04-26T00:00:00Z" }),
        rec({ fingerprint: "c", lastSeenAt: "2026-04-15T00:00:00Z" }),
      ],
      "lastSeen",
    );
    expect(out.map((r) => r.fingerprint)).toEqual(["b", "c", "a"]);
  });

  it('sorts by orderCount DESC', async () => {
    const { sortAmazonCustomers } = await import("../amazon-customers");
    const out = sortAmazonCustomers(
      [
        rec({ fingerprint: "a", orderCount: 1 }),
        rec({ fingerprint: "b", orderCount: 5 }),
        rec({ fingerprint: "c", orderCount: 3 }),
      ],
      "orderCount",
    );
    expect(out.map((r) => r.fingerprint)).toEqual(["b", "c", "a"]);
  });

  it("uses fingerprint ASC as a stable tie-break", async () => {
    const { sortAmazonCustomers } = await import("../amazon-customers");
    const out = sortAmazonCustomers(
      [
        rec({ fingerprint: "z", orderCount: 3 }),
        rec({ fingerprint: "a", orderCount: 3 }),
      ],
      "orderCount",
    );
    expect(out.map((r) => r.fingerprint)).toEqual(["a", "z"]);
  });

  it("summarizeAmazonCustomers totals correctly + counts repeat", async () => {
    const { summarizeAmazonCustomers } = await import("../amazon-customers");
    const counts = summarizeAmazonCustomers([
      rec({ orderCount: 1, totalBags: 1, totalRevenueUsd: 6.41 }),
      rec({ orderCount: 3, totalBags: 5, totalRevenueUsd: 25 }),
      rec({ orderCount: 2, totalBags: 3, totalRevenueUsd: 18 }),
      rec({ orderCount: 1, totalBags: 1, totalRevenueUsd: 6 }),
    ]);
    expect(counts.total).toBe(4);
    expect(counts.repeat).toBe(2);
    expect(counts.oneAndDone).toBe(2);
    expect(counts.totalOrders).toBe(7);
    expect(counts.totalBags).toBe(10);
    expect(counts.totalRevenueUsd).toBe(55.41);
  });
});
