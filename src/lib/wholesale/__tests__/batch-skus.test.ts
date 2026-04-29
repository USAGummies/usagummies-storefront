/**
 * Phase 35.g — batch SKU format tests.
 *
 * Locks the canonical scheme `UG-B[NNNN]-[YYMMDD]-[FT]` per
 * Rene + Viktor 2026-04-28 working session in `#financials` thread:
 *   - 4-digit zero-padded batch number (B0001..B9999)
 *   - YYMMDD pickup date (UTC, no timezone surprises)
 *   - FT = LCD / MCL / MCBF / PL / PBF (from pricing-tiers.ts)
 *
 * Doctrinal hard rules tested:
 *   1. format ↔ parse round-trip is identity
 *   2. Batch numbers below 1 or above 9999 throw on format / null on parse
 *   3. Invalid FT codes throw on format / null on parse
 *   4. Malformed input never throws on parse — always returns null
 *   5. canonicalizeBatchSku normalizes hand-typed SKUs
 */
import { describe, expect, it } from "vitest";

import {
  __INTERNAL,
  canonicalizeBatchSku,
  formatBatchSku,
  isBatchSku,
  parseBatchSku,
} from "../batch-skus";

describe("formatBatchSku — happy path", () => {
  it("formats Apr 15 2026 batch #1 MCL", () => {
    expect(
      formatBatchSku({
        batchNumber: 1,
        pickupDate: new Date(Date.UTC(2026, 3, 15)),
        fulfillmentType: "MCL",
      }),
    ).toBe("UG-B0001-260415-MCL");
  });

  it("formats batch #47 PBF (Sept 1 2026)", () => {
    expect(
      formatBatchSku({
        batchNumber: 47,
        pickupDate: new Date(Date.UTC(2026, 8, 1)),
        fulfillmentType: "PBF",
      }),
    ).toBe("UG-B0047-260901-PBF");
  });

  it("formats max batch #9999 PL (Dec 31 2099)", () => {
    expect(
      formatBatchSku({
        batchNumber: 9999,
        pickupDate: new Date(Date.UTC(2099, 11, 31)),
        fulfillmentType: "PL",
      }),
    ).toBe("UG-B9999-991231-PL");
  });

  it("accepts pre-formatted YYMMDD string for pickupDate", () => {
    expect(
      formatBatchSku({
        batchNumber: 12,
        pickupDate: "260415",
        fulfillmentType: "MCBF",
      }),
    ).toBe("UG-B0012-260415-MCBF");
  });

  it("zero-pads batch numbers correctly", () => {
    expect(
      formatBatchSku({
        batchNumber: 5,
        pickupDate: "260101",
        fulfillmentType: "LCD",
      }),
    ).toBe("UG-B0005-260101-LCD");
  });

  it("supports all 5 fulfillment-type codes", () => {
    for (const ft of ["LCD", "MCL", "MCBF", "PL", "PBF"] as const) {
      const sku = formatBatchSku({
        batchNumber: 1,
        pickupDate: "260101",
        fulfillmentType: ft,
      });
      expect(sku).toContain(`-${ft}`);
    }
  });
});

describe("formatBatchSku — defensive errors", () => {
  it("throws on batch number 0 (below min)", () => {
    expect(() =>
      formatBatchSku({
        batchNumber: 0,
        pickupDate: "260101",
        fulfillmentType: "MCL",
      }),
    ).toThrow(/batchNumber must be in/);
  });

  it("throws on batch number 10000 (above max)", () => {
    expect(() =>
      formatBatchSku({
        batchNumber: 10000,
        pickupDate: "260101",
        fulfillmentType: "MCL",
      }),
    ).toThrow(/upgrade the spec to 5-digit/);
  });

  it("throws on negative batch numbers", () => {
    expect(() =>
      formatBatchSku({
        batchNumber: -1,
        pickupDate: "260101",
        fulfillmentType: "MCL",
      }),
    ).toThrow();
  });

  it("throws on non-integer batch numbers", () => {
    expect(() =>
      formatBatchSku({
        batchNumber: 1.5,
        pickupDate: "260101",
        fulfillmentType: "MCL",
      }),
    ).toThrow(/positive integer/);
  });

  it("throws on invalid fulfillmentType", () => {
    expect(() =>
      formatBatchSku({
        batchNumber: 1,
        pickupDate: "260101",
        // @ts-expect-error — testing runtime defense
        fulfillmentType: "XYZ",
      }),
    ).toThrow(/invalid fulfillmentType/);
  });

  it("throws on malformed YYMMDD string", () => {
    expect(() =>
      formatBatchSku({
        batchNumber: 1,
        pickupDate: "26041",
        fulfillmentType: "MCL",
      }),
    ).toThrow(/6 digits/);
    expect(() =>
      formatBatchSku({
        batchNumber: 1,
        pickupDate: "2026-04-15",
        fulfillmentType: "MCL",
      }),
    ).toThrow(/6 digits/);
  });

  it("throws on invalid Date", () => {
    expect(() =>
      formatBatchSku({
        batchNumber: 1,
        pickupDate: new Date("not a date"),
        fulfillmentType: "MCL",
      }),
    ).toThrow(/invalid Date/);
  });
});

describe("parseBatchSku — happy path", () => {
  it("parses canonical SKU", () => {
    const r = parseBatchSku("UG-B0001-260415-MCL");
    expect(r).toEqual({
      batchNumber: 1,
      pickupDate: "260415",
      fulfillmentType: "MCL",
    });
  });

  it("parses MCBF", () => {
    expect(parseBatchSku("UG-B0042-260901-MCBF")).toEqual({
      batchNumber: 42,
      pickupDate: "260901",
      fulfillmentType: "MCBF",
    });
  });

  it("parses LCD (2-char FT)", () => {
    const r = parseBatchSku("UG-B0001-260101-LCD");
    expect(r?.fulfillmentType).toBe("LCD");
  });

  it("parses PL (2-char FT) and PBF (3-char FT)", () => {
    expect(parseBatchSku("UG-B0001-260101-PL")?.fulfillmentType).toBe("PL");
    expect(parseBatchSku("UG-B0001-260101-PBF")?.fulfillmentType).toBe("PBF");
  });
});

describe("parseBatchSku — returns null (never throws) on malformed", () => {
  it("non-string input → null", () => {
    expect(parseBatchSku(null as unknown as string)).toBeNull();
    expect(parseBatchSku(undefined as unknown as string)).toBeNull();
    expect(parseBatchSku(42 as unknown as string)).toBeNull();
  });

  it("missing UG prefix → null", () => {
    expect(parseBatchSku("B0001-260415-MCL")).toBeNull();
  });

  it("3-digit batch number → null", () => {
    expect(parseBatchSku("UG-B001-260415-MCL")).toBeNull();
  });

  it("5-digit batch number → null", () => {
    expect(parseBatchSku("UG-B00001-260415-MCL")).toBeNull();
  });

  it("missing date segment → null", () => {
    expect(parseBatchSku("UG-B0001-MCL")).toBeNull();
  });

  it("malformed date (non-numeric) → null", () => {
    expect(parseBatchSku("UG-B0001-AB0415-MCL")).toBeNull();
  });

  it("invalid FT → null", () => {
    expect(parseBatchSku("UG-B0001-260415-XYZ")).toBeNull();
    expect(parseBatchSku("UG-B0001-260415-mcl")).toBeNull(); // case-sensitive
  });

  it("trailing garbage → null", () => {
    expect(parseBatchSku("UG-B0001-260415-MCL-extra")).toBeNull();
  });

  it("leading garbage → null", () => {
    expect(parseBatchSku("X-UG-B0001-260415-MCL")).toBeNull();
  });

  it("empty string → null", () => {
    expect(parseBatchSku("")).toBeNull();
  });
});

describe("format ↔ parse round-trip", () => {
  it("Mike's hypothetical batch SKU survives round-trip", () => {
    const original = formatBatchSku({
      batchNumber: 1,
      pickupDate: new Date(Date.UTC(2026, 3, 15)),
      fulfillmentType: "MCBF",
    });
    const parsed = parseBatchSku(original);
    expect(parsed?.batchNumber).toBe(1);
    expect(parsed?.pickupDate).toBe("260415");
    expect(parsed?.fulfillmentType).toBe("MCBF");
    // Re-format the parsed result and confirm identity.
    expect(formatBatchSku(parsed!)).toBe(original);
  });

  it("Round-trip is identity for every fulfillment-type code", () => {
    for (const ft of ["LCD", "MCL", "MCBF", "PL", "PBF"] as const) {
      const original = formatBatchSku({
        batchNumber: 7,
        pickupDate: "260415",
        fulfillmentType: ft,
      });
      const parsed = parseBatchSku(original);
      expect(parsed).not.toBeNull();
      expect(formatBatchSku(parsed!)).toBe(original);
    }
  });
});

describe("isBatchSku type guard", () => {
  it("accepts canonical SKUs", () => {
    expect(isBatchSku("UG-B0001-260415-MCL")).toBe(true);
    expect(isBatchSku("UG-B0099-260901-PBF")).toBe(true);
  });

  it("rejects invalid + non-string inputs", () => {
    expect(isBatchSku("garbage")).toBe(false);
    expect(isBatchSku("UG-B001-260415-MCL")).toBe(false); // 3-digit batch
    expect(isBatchSku(null)).toBe(false);
    expect(isBatchSku(undefined)).toBe(false);
    expect(isBatchSku(42)).toBe(false);
    expect(isBatchSku({})).toBe(false);
  });
});

describe("canonicalizeBatchSku", () => {
  it("returns canonical form for valid SKU", () => {
    expect(canonicalizeBatchSku("UG-B0001-260415-MCL")).toBe(
      "UG-B0001-260415-MCL",
    );
  });

  it("returns null for invalid SKU", () => {
    expect(canonicalizeBatchSku("garbage")).toBeNull();
    expect(canonicalizeBatchSku("UG-B001-260415-MCL")).toBeNull();
  });
});

describe("formatPickupDate — UTC + zero-padding", () => {
  it("Apr 15 2026 → '260415'", () => {
    expect(__INTERNAL.formatPickupDate(new Date(Date.UTC(2026, 3, 15)))).toBe(
      "260415",
    );
  });

  it("Jan 1 2026 → '260101' (zero-padded month + day)", () => {
    expect(__INTERNAL.formatPickupDate(new Date(Date.UTC(2026, 0, 1)))).toBe(
      "260101",
    );
  });

  it("Dec 31 2099 → '991231'", () => {
    expect(__INTERNAL.formatPickupDate(new Date(Date.UTC(2099, 11, 31)))).toBe(
      "991231",
    );
  });

  it("pre-formatted YYMMDD passes through", () => {
    expect(__INTERNAL.formatPickupDate("260415")).toBe("260415");
  });
});

describe("constants (sanity)", () => {
  it("min batch = 1, max = 9999, width = 4", () => {
    expect(__INTERNAL.MIN_BATCH_NUMBER).toBe(1);
    expect(__INTERNAL.MAX_BATCH_NUMBER).toBe(9999);
    expect(__INTERNAL.BATCH_NUMBER_WIDTH).toBe(4);
  });

  it("SKU prefix is 'UG'", () => {
    expect(__INTERNAL.SKU_PREFIX).toBe("UG");
  });
});
