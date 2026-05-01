import { describe, expect, it } from "vitest";

import {
  formatPercentRange,
  formatUsdRange,
  formatUsdValue,
  labelForAlert,
  sortCommittedVendorsForReview,
  summarizeVendorMarginLedger,
  toneForAlert,
} from "../data";

import type {
  CommittedVendorMargin,
  PerVendorMarginLedger,
} from "@/lib/finance/per-vendor-margin";

function vendor(
  name: string,
  marginAlert: CommittedVendorMargin["marginAlert"],
  gpMin: number | null,
  options: Partial<CommittedVendorMargin> = {},
): CommittedVendorMargin {
  return {
    section: "1.1",
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    fields: {},
    pricePerBagUsd: null,
    operatingCogsUsd: null,
    freightPerBagUsd: null,
    gpPerBagUsd: gpMin == null ? null : { min: gpMin, max: gpMin },
    gpPct: null,
    statusLabel: null,
    marginAlert,
    ...options,
  };
}

function ledger(
  committedVendors: CommittedVendorMargin[],
): PerVendorMarginLedger {
  return {
    status: "Active",
    version: "v0.1",
    committedVendors,
    channelRows: [
      {
        channel: "Amazon",
        pricePerBag: "$5.99",
        effectiveCogs: "$1.79",
        freight: "TBD",
        gpPerBag: "TBD",
        gpPct: "TBD",
        see: "source",
        marginAlert: "unknown",
      },
    ],
    pendingVendors: [
      {
        vendor: "Pending Co",
        stage: "Vendor setup",
        lastTouch: "2026-04-30",
        hubSpotDeal: "deal-1",
        likelyTierOnCommit: "B2",
      },
    ],
  };
}

describe("vendor-margin view data helpers", () => {
  it("summarizes committed vendors by alert without fabricating rows", () => {
    const row = vendor("Needs QBO", "unknown", null, {
      fields: {
        freight: {
          label: "Per-bag freight",
          value: "[needs QBO actual]",
          source: "ledger",
          needsActual: true,
        },
      },
    });
    const summary = summarizeVendorMarginLedger(
      ledger([
        vendor("Below", "below_floor", -0.1),
        vendor("Thin", "thin", 0.15),
        vendor("Healthy", "healthy", 1.1),
        row,
      ]),
    );

    expect(summary).toEqual({
      totalCommitted: 4,
      totalPending: 1,
      totalChannels: 1,
      belowFloor: 1,
      thin: 1,
      unknown: 1,
      healthy: 1,
      needsActual: 1,
    });
  });

  it("returns zero counts for missing ledger input", () => {
    expect(summarizeVendorMarginLedger(null)).toEqual({
      totalCommitted: 0,
      totalPending: 0,
      totalChannels: 0,
      belowFloor: 0,
      thin: 0,
      unknown: 0,
      healthy: 0,
      needsActual: 0,
    });
  });

  it("sorts vendors by risk, then lowest GP, then name", () => {
    const sorted = sortCommittedVendorsForReview([
      vendor("Zulu Healthy", "healthy", 1),
      vendor("Bravo Below", "below_floor", -0.05),
      vendor("Alpha Below", "below_floor", -0.05),
      vendor("Thin", "thin", 0.2),
      vendor("Unknown", "unknown", null),
      vendor("Critical", "below_floor", -0.5),
    ]);

    expect(sorted.map((row) => row.name)).toEqual([
      "Critical",
      "Alpha Below",
      "Bravo Below",
      "Thin",
      "Unknown",
      "Zulu Healthy",
    ]);
  });

  it("does not mutate the vendor array while sorting", () => {
    const input = [vendor("Healthy", "healthy", 1), vendor("Below", "below_floor", 0)];
    const before = input.map((row) => row.name);
    sortCommittedVendorsForReview(input);
    expect(input.map((row) => row.name)).toEqual(before);
  });

  it("formats money ranges defensively", () => {
    expect(formatUsdRange({ min: 1.25, max: 1.25 })).toBe("$1.25");
    expect(formatUsdRange({ min: 0.5, max: 1.75 })).toBe("$0.50-$1.75");
    expect(formatUsdRange(null)).toBe("TBD");
    expect(formatUsdRange({ min: Number.NaN, max: 1 })).toBe("TBD");
  });

  it("formats percent ranges defensively", () => {
    expect(formatPercentRange({ min: 12.4, max: 12.4 })).toBe("12%");
    expect(formatPercentRange({ min: 6, max: 18 })).toBe("6%-18%");
    expect(formatPercentRange(undefined)).toBe("TBD");
    expect(formatPercentRange({ min: 10, max: Number.POSITIVE_INFINITY })).toBe("TBD");
  });

  it("formats nullable money values as TBD instead of zero", () => {
    expect(formatUsdValue(2.1)).toBe("$2.10");
    expect(formatUsdValue(0)).toBe("$0.00");
    expect(formatUsdValue(null)).toBe("TBD");
    expect(formatUsdValue(Number.NaN)).toBe("TBD");
  });

  it("maps alert labels and tones", () => {
    expect(labelForAlert("below_floor")).toBe("Below floor");
    expect(labelForAlert("thin")).toBe("Thin");
    expect(labelForAlert("unknown")).toBe("Needs actuals");
    expect(labelForAlert("healthy")).toBe("Healthy");
    expect(toneForAlert("below_floor")).toBe("red");
    expect(toneForAlert("thin")).toBe("amber");
    expect(toneForAlert("unknown")).toBe("blue");
    expect(toneForAlert("healthy")).toBe("green");
  });
});
