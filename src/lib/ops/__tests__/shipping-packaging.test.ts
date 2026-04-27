/**
 * Phase 28j — Shipping packaging SKU map + bag-counting helpers.
 *
 * Locks the contract:
 *   - bagsPerUnitForSku returns the correct count for every registered
 *     SKU. This is the math behind the auto-ship slip's quantity
 *     field; if a SKU silently falls through to the default of 1,
 *     a customer who ordered a 3-pack gets 1 bag in the box.
 *   - Unknown SKUs default to 1 + emit a console warning (caller can
 *     monitor logs for new variant launches).
 *   - totalBagsForItems sums quantity × bagsPerUnit per line, ignores
 *     zero / negative / non-finite quantities.
 *   - Case-insensitive SKU matching (Amazon sometimes lowercases).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bagsPerUnitForSku,
  totalBagsForItems,
} from "@/lib/ops/shipping-packaging";

const warnSpy = vi.spyOn(console, "warn");

beforeEach(() => warnSpy.mockClear());
afterEach(() => warnSpy.mockClear());

describe("bagsPerUnitForSku — registered SKU map", () => {
  it.each([
    ["USG-FBM-1PK", 1],
    ["USG-FBM-2PK", 2],
    ["USG-FBM-3PK", 3],
    ["USG-FBM-5PK", 5],
    ["USG-FBM-10PK", 10],
    ["USG-1PK", 1],
    ["USG-3PK", 3],
    ["USG-5PK", 5],
    ["USG-10PK", 10],
    ["USG-CASE-6", 6],
    ["UG-AAGB-6CT", 6],
    ["USG-MC-36", 36],
  ])("%s → %i bags", (sku, expected) => {
    expect(bagsPerUnitForSku(sku)).toBe(expected);
    // Registered SKUs do NOT trip the warning.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("matches case-insensitively (lowercase + mixed)", () => {
    expect(bagsPerUnitForSku("usg-fbm-3pk")).toBe(3);
    expect(bagsPerUnitForSku("Usg-Fbm-3Pk")).toBe(3);
  });

  it("trims whitespace before lookup", () => {
    expect(bagsPerUnitForSku("  USG-FBM-3PK  ")).toBe(3);
  });

  it("unknown SKU defaults to 1 AND emits a warning (so we notice variant launches)", () => {
    expect(bagsPerUnitForSku("USG-FBM-100PK")).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/Unknown SKU/);
  });

  it("null / empty / undefined SKU returns 1 (no warning — that's the auto-ship fallback path)", () => {
    expect(bagsPerUnitForSku(null)).toBe(1);
    expect(bagsPerUnitForSku(undefined)).toBe(1);
    expect(bagsPerUnitForSku("")).toBe(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("totalBagsForItems", () => {
  it("sums quantity × bags-per-unit per line", () => {
    const total = totalBagsForItems([
      { sku: "USG-FBM-1PK", quantity: 3 }, // 3 bags
      { sku: "USG-CASE-6", quantity: 2 }, // 12 bags
    ]);
    expect(total).toBe(15);
  });

  it("matches Amazon FBM today's order shape (qty=1, sku=USG-FBM-1PK → 1 bag)", () => {
    expect(
      totalBagsForItems([{ sku: "USG-FBM-1PK", quantity: 1 }]),
    ).toBe(1);
  });

  it("matches yesterday's qty=3 order (qty=3, sku=USG-FBM-1PK → 3 bags)", () => {
    expect(
      totalBagsForItems([{ sku: "USG-FBM-1PK", quantity: 3 }]),
    ).toBe(3);
  });

  it("3-pack SKU with qty=1 → 3 bags (locks the variant-launch defense)", () => {
    expect(
      totalBagsForItems([{ sku: "USG-FBM-3PK", quantity: 1 }]),
    ).toBe(3);
  });

  it("ignores zero / negative / non-finite quantity lines", () => {
    expect(
      totalBagsForItems([
        { sku: "USG-FBM-1PK", quantity: 0 },
        { sku: "USG-FBM-1PK", quantity: -2 },
        { sku: "USG-FBM-1PK", quantity: Number.NaN },
        { sku: "USG-FBM-1PK", quantity: Number.POSITIVE_INFINITY },
        { sku: "USG-FBM-1PK", quantity: 1 },
      ]),
    ).toBe(1);
  });

  it("empty items array → 0 bags", () => {
    expect(totalBagsForItems([])).toBe(0);
  });

  it("floors fractional quantities (defensive — Amazon never sends fractions, but)", () => {
    expect(
      totalBagsForItems([{ sku: "USG-FBM-1PK", quantity: 2.7 as number }]),
    ).toBe(2);
  });
});
