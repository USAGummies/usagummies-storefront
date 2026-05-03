import { describe, expect, it } from "vitest";

import { composeDtcRevenueDigest } from "../summarizer";
import {
  aggregateDtcRevenue,
  type DtcDailyMetric,
} from "../metrics";

const ASOF = new Date("2026-05-03T15:00:00.000Z");

function metric(date: string, overrides: Partial<DtcDailyMetric> = {}): DtcDailyMetric {
  return {
    date,
    shopifyRevenue: overrides.shopifyRevenue ?? null,
    shopifyOrders: overrides.shopifyOrders ?? null,
    amazonRevenue: overrides.amazonRevenue ?? null,
    amazonOrders: overrides.amazonOrders ?? null,
  };
}

describe("composeDtcRevenueDigest — quiet collapse", () => {
  it("returns null when every Shopify data point is null", () => {
    const digest = aggregateDtcRevenue([], ASOF);
    expect(composeDtcRevenueDigest(digest)).toBeNull();
  });

  it("returns null when only Amazon data exists (DTC = Shopify focus)", () => {
    const digest = aggregateDtcRevenue(
      [metric("2026-05-02", { amazonRevenue: 100, amazonOrders: 20 })],
      ASOF,
    );
    expect(composeDtcRevenueDigest(digest)).toBeNull();
  });
});

describe("composeDtcRevenueDigest — happy path", () => {
  it("renders yesterday Shopify line with revenue + orders + AOV", () => {
    const digest = aggregateDtcRevenue(
      [metric("2026-05-02", { shopifyRevenue: 240, shopifyOrders: 4 })],
      ASOF,
    );
    const text = composeDtcRevenueDigest(digest);
    expect(text).not.toBeNull();
    expect(text).toContain("$240.00");
    expect(text).toContain("4 orders");
    expect(text).toContain("AOV $60.00");
  });

  it("renders deltas with both bases", () => {
    const digest = aggregateDtcRevenue(
      [
        metric("2026-05-02", { shopifyRevenue: 150 }),
        metric("2026-05-01", { shopifyRevenue: 100 }),
        metric("2026-04-25", { shopifyRevenue: 75 }),
      ],
      ASOF,
    );
    const text = composeDtcRevenueDigest(digest);
    expect(text).toContain("Day-over-day");
    expect(text).toContain("+50.0%");
    expect(text).toContain("Week-over-week");
    expect(text).toContain("+100.0%");
  });

  it("uses — for missing comparison bases", () => {
    const digest = aggregateDtcRevenue(
      [metric("2026-05-02", { shopifyRevenue: 100 })],
      ASOF,
    );
    const text = composeDtcRevenueDigest(digest);
    expect(text).toContain("Day-over-day:* —");
    expect(text).toContain("Week-over-week:* —");
  });

  it("includes 7-day rolling line when window has any data", () => {
    const digest = aggregateDtcRevenue(
      [
        metric("2026-05-02", { shopifyRevenue: 100 }),
        metric("2026-05-01", { shopifyRevenue: 100 }),
      ],
      ASOF,
    );
    const text = composeDtcRevenueDigest(digest);
    expect(text).toContain("7-day rolling");
  });

  it("includes MTD line", () => {
    const digest = aggregateDtcRevenue(
      [
        metric("2026-05-01", { shopifyRevenue: 50 }),
        metric("2026-05-02", { shopifyRevenue: 75 }),
      ],
      ASOF,
    );
    const text = composeDtcRevenueDigest(digest);
    expect(text).toContain("MTD Shopify");
    expect(text).toContain("$125.00");
  });

  it("renders Amazon comparison line when Amazon data present", () => {
    const digest = aggregateDtcRevenue(
      [
        metric("2026-05-02", {
          shopifyRevenue: 100,
          amazonRevenue: 60,
          amazonOrders: 10,
        }),
      ],
      ASOF,
    );
    const text = composeDtcRevenueDigest(digest);
    expect(text).toContain("Amazon yesterday for comparison");
    expect(text).toContain("$60.00");
    expect(text).toContain("AOV $6.00");
  });

  it("omits Amazon line when no Amazon data", () => {
    const digest = aggregateDtcRevenue(
      [metric("2026-05-02", { shopifyRevenue: 100 })],
      ASOF,
    );
    const text = composeDtcRevenueDigest(digest);
    expect(text).not.toContain("Amazon yesterday for comparison");
  });

  it("includes the GA4-not-wired honest unavailable footer", () => {
    const digest = aggregateDtcRevenue(
      [metric("2026-05-02", { shopifyRevenue: 100 })],
      ASOF,
    );
    const text = composeDtcRevenueDigest(digest);
    expect(text).toContain("Conversion rate");
    expect(text).toContain("GA4 server-side not wired");
  });

  it("appends degraded warnings when present", () => {
    const digest = aggregateDtcRevenue(
      [metric("2026-05-02", { shopifyRevenue: 100 })],
      ASOF,
    );
    const text = composeDtcRevenueDigest(digest);
    expect(text).toContain(":warning:");
    expect(text).toContain("2026-05-01"); // missing day-before flagged
  });
});
