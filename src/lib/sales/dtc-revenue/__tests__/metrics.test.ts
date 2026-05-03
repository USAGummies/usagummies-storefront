import { describe, expect, it } from "vitest";

import {
  aggregateDtcRevenue,
  type DtcDailyMetric,
} from "../metrics";

const ASOF = new Date("2026-05-03T15:00:00.000Z");
const YESTERDAY = "2026-05-02";
const DAY_BEFORE = "2026-05-01";
const SAME_DAY_LAST_WEEK = "2026-04-25";

function metric(date: string, overrides: Partial<DtcDailyMetric> = {}): DtcDailyMetric {
  return {
    date,
    shopifyRevenue: overrides.shopifyRevenue ?? null,
    shopifyOrders: overrides.shopifyOrders ?? null,
    amazonRevenue: overrides.amazonRevenue ?? null,
    amazonOrders: overrides.amazonOrders ?? null,
  };
}

describe("aggregateDtcRevenue — yesterday rollup", () => {
  it("computes AOV from revenue + orders", () => {
    const result = aggregateDtcRevenue(
      [
        metric(YESTERDAY, {
          shopifyRevenue: 200,
          shopifyOrders: 4,
          amazonRevenue: 60,
          amazonOrders: 10,
        }),
      ],
      ASOF,
    );
    expect(result.yesterday.date).toBe(YESTERDAY);
    expect(result.yesterday.shopifyRevenue).toBe(200);
    expect(result.yesterday.shopifyAov).toBe(50);
    expect(result.yesterday.amazonAov).toBe(6);
    expect(result.yesterday.totalRevenue).toBe(260);
  });

  it("returns null AOV when orders is 0", () => {
    const result = aggregateDtcRevenue(
      [metric(YESTERDAY, { shopifyRevenue: 100, shopifyOrders: 0 })],
      ASOF,
    );
    expect(result.yesterday.shopifyAov).toBeNull();
  });

  it("returns nulls when no data for yesterday", () => {
    const result = aggregateDtcRevenue([], ASOF);
    expect(result.yesterday.shopifyRevenue).toBeNull();
    expect(result.yesterday.totalRevenue).toBeNull();
    expect(result.degraded.length).toBeGreaterThan(0);
  });
});

describe("aggregateDtcRevenue — comparison deltas", () => {
  it("computes day-over-day percentage delta", () => {
    const result = aggregateDtcRevenue(
      [
        metric(YESTERDAY, { shopifyRevenue: 150 }),
        metric(DAY_BEFORE, { shopifyRevenue: 100 }),
      ],
      ASOF,
    );
    expect(result.shopifyDeltas.dayOverDayPct).toBe(50);
  });

  it("computes week-over-week percentage delta", () => {
    const result = aggregateDtcRevenue(
      [
        metric(YESTERDAY, { shopifyRevenue: 80 }),
        metric(SAME_DAY_LAST_WEEK, { shopifyRevenue: 100 }),
      ],
      ASOF,
    );
    expect(result.shopifyDeltas.weekOverWeekPct).toBe(-20);
  });

  it("returns null delta when base is missing", () => {
    const result = aggregateDtcRevenue(
      [metric(YESTERDAY, { shopifyRevenue: 100 })],
      ASOF,
    );
    expect(result.shopifyDeltas.dayOverDayPct).toBeNull();
    expect(result.shopifyDeltas.weekOverWeekPct).toBeNull();
  });

  it("returns null delta when base is 0 (no division-by-zero fabrication)", () => {
    const result = aggregateDtcRevenue(
      [
        metric(YESTERDAY, { shopifyRevenue: 100 }),
        metric(DAY_BEFORE, { shopifyRevenue: 0 }),
      ],
      ASOF,
    );
    expect(result.shopifyDeltas.dayOverDayPct).toBeNull();
  });
});

describe("aggregateDtcRevenue — last 7 days", () => {
  it("sums Shopify revenue across 7 days", () => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(ASOF.getTime() - (i + 1) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      return metric(date, {
        shopifyRevenue: 100,
        shopifyOrders: 2,
      });
    });
    const result = aggregateDtcRevenue(days, ASOF);
    expect(result.last7Days.shopifyRevenue).toBe(700);
    expect(result.last7Days.shopifyOrders).toBe(14);
    expect(result.last7Days.shopifyAvgPerDay).toBe(100);
  });

  it("returns null totals when window has no data", () => {
    const result = aggregateDtcRevenue([], ASOF);
    expect(result.last7Days.shopifyRevenue).toBeNull();
    expect(result.last7Days.shopifyAvgPerDay).toBeNull();
  });

  it("avgPerDay only divides by days that had data (not by 7)", () => {
    // Only 3 days with data
    const days = [
      metric(YESTERDAY, { shopifyRevenue: 100 }),
      metric(DAY_BEFORE, { shopifyRevenue: 100 }),
      metric("2026-04-30", { shopifyRevenue: 100 }),
    ];
    const result = aggregateDtcRevenue(days, ASOF);
    expect(result.last7Days.shopifyRevenue).toBe(300);
    expect(result.last7Days.shopifyAvgPerDay).toBe(100);
  });
});

describe("aggregateDtcRevenue — MTD", () => {
  it("sums revenue from start-of-month through yesterday", () => {
    // May 1, 2 — both data points
    const rows = [
      metric("2026-05-01", { shopifyRevenue: 50 }),
      metric("2026-05-02", { shopifyRevenue: 75 }),
    ];
    const result = aggregateDtcRevenue(rows, ASOF);
    expect(result.mtd.shopifyRevenue).toBe(125);
  });

  it("returns null when no MTD data", () => {
    const result = aggregateDtcRevenue([], ASOF);
    expect(result.mtd.shopifyRevenue).toBeNull();
  });
});

describe("aggregateDtcRevenue — degraded flagging", () => {
  it("flags missing yesterday Shopify row", () => {
    const result = aggregateDtcRevenue([], ASOF);
    expect(
      result.degraded.some((d) => d.includes("No Shopify revenue row for 2026-05-02")),
    ).toBe(true);
  });

  it("flags missing day-before-yesterday row", () => {
    const result = aggregateDtcRevenue(
      [metric(YESTERDAY, { shopifyRevenue: 100 })],
      ASOF,
    );
    expect(
      result.degraded.some((d) => d.includes("2026-05-01")),
    ).toBe(true);
  });

  it("does not flag when both bases are present", () => {
    const result = aggregateDtcRevenue(
      [
        metric(YESTERDAY, { shopifyRevenue: 100 }),
        metric(DAY_BEFORE, { shopifyRevenue: 100 }),
        metric(SAME_DAY_LAST_WEEK, { shopifyRevenue: 100 }),
      ],
      ASOF,
    );
    expect(result.degraded).toEqual([]);
  });
});
