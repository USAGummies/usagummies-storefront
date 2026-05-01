/**
 * Phase 36.6 — off-grid quote detection tests.
 *
 * Locks the canonical grid prices + severity classification against the
 * v2.4 wholesale-pricing doctrine (B3 = $3.50, B5 = $3.25 after Q3
 * surcharge ratification 2026-04-30 PM).
 */
import { describe, expect, it } from "vitest";

import {
  ON_GRID_BAG_PRICES_USD,
  buildOffGridQuotesBriefSlice,
  detectOffGridQuotes,
  isOnGridPrice,
  nearestOnGridPrice,
  sortOffGridQuotesBySeverity,
  type QuoteCandidate,
} from "../off-grid-quotes";

const baseCandidate: Omit<QuoteCandidate, "pricePerBagUsd"> = {
  id: "deal-001",
  source: "hubspot_deal",
  customerName: "ACME Foods",
  bagCount: 36,
  createdAt: "2026-04-30T18:00:00Z",
};

const c = (price: number, overrides: Partial<QuoteCandidate> = {}): QuoteCandidate => ({
  ...baseCandidate,
  pricePerBagUsd: price,
  ...overrides,
});

describe("ON_GRID_BAG_PRICES_USD canonical grid (v2.4 LOCKED 2026-04-30)", () => {
  it("includes the v2.4 B-tier prices", () => {
    expect(ON_GRID_BAG_PRICES_USD).toContain(3.49); // B1 + B2
    expect(ON_GRID_BAG_PRICES_USD).toContain(3.5); // B3 (v2.4 surcharge)
    expect(ON_GRID_BAG_PRICES_USD).toContain(3.25); // B4 + B5 (v2.4 surcharge)
  });
  it("includes the 3+ pallet free-freight tier $3.00", () => {
    expect(ON_GRID_BAG_PRICES_USD).toContain(3.0);
  });
  it("includes distributor commitments ($2.49 sell-sheet, $2.50 Opt A, $2.10 Opt B)", () => {
    expect(ON_GRID_BAG_PRICES_USD).toContain(2.49);
    expect(ON_GRID_BAG_PRICES_USD).toContain(2.5);
    expect(ON_GRID_BAG_PRICES_USD).toContain(2.1);
  });
  it("includes the $2.00 pickup-only floor (Class C approved)", () => {
    expect(ON_GRID_BAG_PRICES_USD).toContain(2.0);
  });
});

describe("isOnGridPrice — exact grid match within 1¢ tolerance", () => {
  it("returns true for canonical grid prices", () => {
    expect(isOnGridPrice(3.49)).toBe(true);
    expect(isOnGridPrice(3.5)).toBe(true);
    expect(isOnGridPrice(3.25)).toBe(true);
    expect(isOnGridPrice(2.49)).toBe(true);
    expect(isOnGridPrice(2.1)).toBe(true);
  });
  it("returns true within 1¢ tolerance (float-precision drift)", () => {
    expect(isOnGridPrice(3.499)).toBe(true);
    expect(isOnGridPrice(3.501)).toBe(true);
  });
  it("returns false for between-grid prices", () => {
    expect(isOnGridPrice(3.3)).toBe(false);
    expect(isOnGridPrice(3.1)).toBe(false);
    expect(isOnGridPrice(2.75)).toBe(false);
  });
  it("returns false for the legacy v1.0 prices that v2.4 retired", () => {
    // B5 was $3.00 in v1.0; v2.4 it's $3.25. $3.00 IS still on-grid because
    // it's the 3+ pallet free-freight tier — but $2.75 (between B5 and Opt B)
    // is not on grid in any version.
    expect(isOnGridPrice(2.75)).toBe(false);
  });
  it("returns false for 0, negative, NaN, Infinity", () => {
    expect(isOnGridPrice(0)).toBe(false);
    expect(isOnGridPrice(-1)).toBe(false);
    expect(isOnGridPrice(Number.NaN)).toBe(false);
    expect(isOnGridPrice(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("nearestOnGridPrice", () => {
  it("returns exact match when on grid", () => {
    expect(nearestOnGridPrice(3.5)).toBe(3.5);
  });
  it("returns the closest price for between-grid quotes", () => {
    // 3.40 is closer to 3.49 than to 3.25
    expect(nearestOnGridPrice(3.4)).toBe(3.49);
    // 3.10 is closer to 3.00 than to 3.25
    expect(nearestOnGridPrice(3.1)).toBe(3.0);
    // 2.30 is closer to 2.49 than to 2.10
    expect(nearestOnGridPrice(2.3)).toBe(2.49);
  });
  it("returns the bottom of the grid for very low prices", () => {
    expect(nearestOnGridPrice(1.5)).toBe(2.0);
  });
});

describe("detectOffGridQuotes — severity classification", () => {
  it("flags below-floor quotes (< $2.12) as below_floor", () => {
    const flagged = detectOffGridQuotes([c(1.95, { id: "below" })]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].severity).toBe("below_floor");
    expect(flagged[0].reason).toMatch(/BELOW the \$2\.12 minimum-margin floor/);
  });

  it("flags distributor-band off-grid quotes (between $2.10 and $2.49) as below_distributor_floor", () => {
    // $2.30 is in the distributor band but not on a known commit
    const flagged = detectOffGridQuotes([c(2.3, { id: "dist-drift" })]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].severity).toBe("below_distributor_floor");
    expect(flagged[0].reason).toMatch(/distributor band/);
  });

  it("flags between-grid prices as between_grid_lines (e.g. $3.10)", () => {
    const flagged = detectOffGridQuotes([c(3.1, { id: "partial-discount" })]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].severity).toBe("between_grid_lines");
  });

  it("flags above-grid quotes (above $3.50) as above_grid", () => {
    const flagged = detectOffGridQuotes([c(3.99, { id: "premium" })]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].severity).toBe("above_grid");
  });

  it("does NOT flag on-grid quotes", () => {
    const onGrid = [c(3.49), c(3.5), c(3.25), c(2.49), c(2.1), c(2.0)];
    const flagged = detectOffGridQuotes(onGrid);
    expect(flagged).toHaveLength(0);
  });

  it("computes deviation correctly", () => {
    const flagged = detectOffGridQuotes([c(3.1, { bagCount: 100 })]);
    expect(flagged[0].nearestGridPrice).toBe(3.0);
    expect(flagged[0].deviationPerBagUsd).toBe(0.1); // +$0.10/bag above $3.00
    expect(flagged[0].totalDeviationUsd).toBe(10); // 100 bags × $0.10
  });

  it("skips candidates with non-finite or non-positive prices", () => {
    const skipped = [
      c(0, { id: "zero" }),
      c(-1, { id: "neg" }),
      c(Number.NaN, { id: "nan" }),
    ];
    expect(detectOffGridQuotes(skipped)).toHaveLength(0);
  });
});

describe("sortOffGridQuotesBySeverity — most-urgent-first", () => {
  it("sorts below_floor before between_grid_lines before above_grid", () => {
    const flagged = detectOffGridQuotes([
      c(3.99, { id: "above" }),
      c(1.95, { id: "below_floor" }),
      c(3.1, { id: "between" }),
      c(2.3, { id: "dist_floor" }),
    ]);
    const sorted = sortOffGridQuotesBySeverity(flagged);
    expect(sorted.map((q) => q.candidate.id)).toEqual([
      "below_floor",
      "dist_floor",
      "between",
      "above",
    ]);
  });

  it("sorts within a severity bucket by absolute dollar deviation", () => {
    const flagged = detectOffGridQuotes([
      c(3.1, { id: "small", bagCount: 36 }), // dev = $0.10/bag × 36 = $3.60
      c(3.4, { id: "big", bagCount: 900 }), // dev = -$0.09/bag × 900 = -$81 (closer to 3.49)
      c(3.15, { id: "medium", bagCount: 100 }), // dev = $0.15/bag × 100 = $15
    ]);
    const sorted = sortOffGridQuotesBySeverity(flagged);
    // All three are between_grid_lines; sorted by abs(totalDeviationUsd) descending
    expect(sorted[0].candidate.id).toBe("big");
    expect(sorted[1].candidate.id).toBe("medium");
    expect(sorted[2].candidate.id).toBe("small");
  });
});

describe("buildOffGridQuotesBriefSlice", () => {
  it("aggregates counts by severity", () => {
    const slice = buildOffGridQuotesBriefSlice({
      candidates: [
        c(1.95, { id: "below" }),
        c(3.1, { id: "between" }),
        c(3.99, { id: "above" }),
        c(3.49, { id: "on-grid-1" }),
        c(3.25, { id: "on-grid-2" }),
      ],
      windowDescription: "last 24h",
    });
    expect(slice.candidatesEvaluated).toBe(5);
    expect(slice.countsBySeverity.below_floor).toBe(1);
    expect(slice.countsBySeverity.between_grid_lines).toBe(1);
    expect(slice.countsBySeverity.above_grid).toBe(1);
    expect(slice.countsBySeverity.below_distributor_floor).toBe(0);
    expect(slice.hasHardBlock).toBe(true);
  });

  it("hasHardBlock is false when no below_floor quotes", () => {
    const slice = buildOffGridQuotesBriefSlice({
      candidates: [c(3.1, { id: "between" })],
      windowDescription: "last 24h",
    });
    expect(slice.hasHardBlock).toBe(false);
  });

  it("topN cap defaults to 5 and is sortable", () => {
    const candidates: QuoteCandidate[] = [];
    for (let i = 0; i < 10; i++) {
      candidates.push(c(3.1 + i * 0.01, { id: `q-${i}`, bagCount: 100 }));
    }
    const slice = buildOffGridQuotesBriefSlice({
      candidates,
      windowDescription: "last 24h",
    });
    expect(slice.topQuotes).toHaveLength(5);
  });

  it("returns empty top-quotes when nothing flagged", () => {
    const slice = buildOffGridQuotesBriefSlice({
      candidates: [c(3.49), c(3.25)],
      windowDescription: "last 24h",
    });
    expect(slice.topQuotes).toHaveLength(0);
    expect(slice.hasHardBlock).toBe(false);
  });
});
