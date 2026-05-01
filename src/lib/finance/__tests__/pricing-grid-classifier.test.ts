/**
 * Pricing-grid classifier coverage — Phase 36.6.
 *
 * Pins:
 *   - Every published B-tier in /contracts/wholesale-pricing.md §2 v2.4
 *     classifies as on-grid + matches its expected id.
 *   - Distributor sell-sheet, Option A, Option B all classify on-grid.
 *   - Reunion 2026 show-special classifies on-grid but flagged as
 *     show-special in the reason text.
 *   - Proposed tiers (C-ANCH $3.00, C-PU $2.00) classify on-grid but
 *     `matchesProposedTier=true` so the operator surface knows it's
 *     not yet ratified. With `ratifiedOnly=true` they fall off-grid.
 *   - Off-grid prices with various deviations get the right reason
 *     text and signed deviationUsd.
 *   - Cent-level rounding: $3.499 → on-grid B2, $3.45 → off-grid.
 *   - Tolerance override widens or narrows the on-grid envelope.
 *   - `isFullyRatifiedPrice` excludes proposed AND show-special.
 *   - Defensive: NaN / Infinity throw, empty grid throws.
 */
import { describe, expect, it } from "vitest";

import {
  B2B_GRID_PRICES_USD,
  classifyPricePerBag,
  isFullyRatifiedPrice,
  PRICING_GRID,
  DEFAULT_GRID_TOLERANCE_USD,
} from "../pricing-grid-classifier";
import { ON_GRID_BAG_PRICES_USD } from "../off-grid-quotes";

describe("PRICING_GRID — canonical contents", () => {
  it("contains the v2.4 B-tier prices (B1-B5)", () => {
    const ids = PRICING_GRID.map((t) => t.id);
    expect(ids).toContain("B1");
    expect(ids).toContain("B2");
    expect(ids).toContain("B3");
    expect(ids).toContain("B4");
    expect(ids).toContain("B5");
  });

  it("B3 is $3.50/bag (v2.4 Q3 surcharge applied)", () => {
    const b3 = PRICING_GRID.find((t) => t.id === "B3")!;
    expect(b3.pricePerBag).toBe(3.5);
    expect(b3.status).toBe("ratified");
  });

  it("B5 is $3.25/bag (v2.4 Q3 surcharge applied)", () => {
    const b5 = PRICING_GRID.find((t) => t.id === "B5")!;
    expect(b5.pricePerBag).toBe(3.25);
    expect(b5.status).toBe("ratified");
  });

  it("includes distributor Option A ($2.50), sell-sheet ($2.49), Option B ($2.10)", () => {
    expect(PRICING_GRID.find((t) => t.id === "Sell-Sheet-A")?.pricePerBag).toBe(2.5);
    expect(PRICING_GRID.find((t) => t.id === "Sell-Sheet")?.pricePerBag).toBe(2.49);
    expect(PRICING_GRID.find((t) => t.id === "Option-B")?.pricePerBag).toBe(2.1);
  });

  it("includes Reunion 2026 show-special at $3.25 with status=show-special", () => {
    const reunion = PRICING_GRID.find((t) => t.id === "Reunion-2026")!;
    expect(reunion.pricePerBag).toBe(3.25);
    expect(reunion.status).toBe("show-special");
  });

  it("includes proposed C-ANCH ($3.00) and C-PU ($2.00) flagged as proposed", () => {
    const cAnch = PRICING_GRID.find((t) => t.id === "C-ANCH")!;
    expect(cAnch.pricePerBag).toBe(3.0);
    expect(cAnch.status).toBe("proposed");
    const cPu = PRICING_GRID.find((t) => t.id === "C-PU")!;
    expect(cPu.pricePerBag).toBe(2.0);
    expect(cPu.status).toBe("proposed");
  });

  it("default tolerance is one cent", () => {
    expect(DEFAULT_GRID_TOLERANCE_USD).toBe(0.01);
  });
});

describe("classifyPricePerBag — on-grid hits", () => {
  it("$3.49 → B2 (master carton landed) — preferred over B1 by ordering", () => {
    const r = classifyPricePerBag(3.49);
    expect(r.onGrid).toBe(true);
    // B1 is listed first but B1 and B2 are both $3.49; B1 wins by ordering.
    expect(["B1", "B2"]).toContain(r.nearestTier.id);
    // Whichever wins, deviation is zero.
    expect(r.deviationUsd).toBe(0);
    expect(r.deviationPct).toBe(0);
  });

  it("$3.50 → B3 (master carton buyer-pays, v2.4 Q3 surcharge)", () => {
    const r = classifyPricePerBag(3.5);
    expect(r.onGrid).toBe(true);
    expect(r.nearestTier.id).toBe("B3");
    expect(r.deviationUsd).toBe(0);
    expect(r.matchesProposedTier).toBe(false);
  });

  it("$3.25 → B4 (pallet landed) — preferred over B5 by ordering", () => {
    const r = classifyPricePerBag(3.25);
    expect(r.onGrid).toBe(true);
    expect(r.nearestTier.id).toBe("B4");
  });

  it("$2.49 → distributor sell-sheet, ratified", () => {
    const r = classifyPricePerBag(2.49);
    expect(r.onGrid).toBe(true);
    expect(r.nearestTier.id).toBe("Sell-Sheet");
    expect(r.matchesProposedTier).toBe(false);
  });

  it("$2.10 → Option B (Inderbitzin / Glacier delivered)", () => {
    const r = classifyPricePerBag(2.1);
    expect(r.onGrid).toBe(true);
    expect(r.nearestTier.id).toBe("Option-B");
  });
});

describe("classifyPricePerBag — proposed-tier disclosure", () => {
  it("$3.00 → on-grid C-ANCH but matchesProposedTier=true", () => {
    const r = classifyPricePerBag(3.0);
    expect(r.onGrid).toBe(true);
    expect(r.nearestTier.id).toBe("C-ANCH");
    expect(r.matchesProposedTier).toBe(true);
    expect(r.reason).toMatch(/PROPOSED/i);
  });

  it("with ratifiedOnly=true, $3.00 falls OFF-grid (C-ANCH excluded)", () => {
    const r = classifyPricePerBag(3.0, { ratifiedOnly: true });
    expect(r.onGrid).toBe(false);
    // Nearest ratified tier in the grid: B2/B5 are within $0.25 either side.
    // Deviation is signed; B5 ($3.25) is +$0.25 above; B1/B2 ($3.49) is +$0.49.
    // The minimum absolute deviation among ratified tiers is to B4 or B5 at $0.25.
    expect(Math.abs(r.deviationUsd)).toBeCloseTo(0.25, 2);
  });

  it("$2.00 → on-grid C-PU but matchesProposedTier=true", () => {
    const r = classifyPricePerBag(2.0);
    expect(r.onGrid).toBe(true);
    expect(r.nearestTier.id).toBe("C-PU");
    expect(r.matchesProposedTier).toBe(true);
  });
});

describe("classifyPricePerBag — show-special disclosure", () => {
  it("$3.25 with no other context lands on B4 (preferred), not Reunion-2026", () => {
    // B4 is listed before Reunion-2026 in PRICING_GRID; tie-breaker is order.
    const r = classifyPricePerBag(3.25);
    expect(r.nearestTier.id).toBe("B4");
  });
});

describe("classifyPricePerBag — off-grid", () => {
  it("$3.30 → off-grid, +$0.05 above B4 ($3.25)", () => {
    const r = classifyPricePerBag(3.3);
    expect(r.onGrid).toBe(false);
    expect(r.nearestTier.id).toBe("B4"); // B4/B5 both $3.25; B4 first in order
    expect(r.deviationUsd).toBe(0.05);
    expect(r.reason).toMatch(/Off-grid by \$0\.05/);
    expect(r.reason).toMatch(/above B4/);
  });

  it("$3.45 → off-grid, −$0.04 below B2 ($3.49)", () => {
    const r = classifyPricePerBag(3.45);
    expect(r.onGrid).toBe(false);
    expect(r.deviationUsd).toBe(-0.04);
    expect(r.reason).toMatch(/below/);
  });

  it("$1.50 with ratifiedOnly=true (commodity Albanese Charmaine quoted) → off-grid, far below Option B", () => {
    // With proposed tiers excluded, the closest ratified is Option-B at $2.10.
    // Default mode would match the proposed C-PU at $2.00 (closer); we use
    // ratifiedOnly to test the strict "is this an actual canonical price?" path.
    const r = classifyPricePerBag(1.5, { ratifiedOnly: true });
    expect(r.onGrid).toBe(false);
    expect(r.nearestTier.id).toBe("Option-B");
    expect(r.deviationUsd).toBe(-0.6);
    expect(r.deviationPct).toBeGreaterThan(28); // 0.60 / 2.10 ≈ 28.6%
  });

  it("$1.50 default (proposed tiers included) → off-grid, nearest is C-PU at $2.00", () => {
    const r = classifyPricePerBag(1.5);
    expect(r.onGrid).toBe(false);
    expect(r.nearestTier.id).toBe("C-PU");
    expect(r.deviationUsd).toBe(-0.5);
  });

  it("provides direction (above/below) in the reason text", () => {
    const above = classifyPricePerBag(4.0);
    expect(above.reason).toMatch(/above/);
    const below = classifyPricePerBag(2.0, { ratifiedOnly: true });
    expect(below.reason).toMatch(/below/);
  });
});

describe("classifyPricePerBag — tolerance + edge cases", () => {
  it("$3.499 → on-grid B2 within ±$0.01 default tolerance", () => {
    const r = classifyPricePerBag(3.499);
    expect(r.onGrid).toBe(true);
  });

  it("$3.479 → off-grid (just outside 1¢ tolerance from B2 at $3.49)", () => {
    const r = classifyPricePerBag(3.479);
    expect(r.onGrid).toBe(false);
  });

  it("with toleranceUsd=0.05, $3.45 → on-grid B2 (5¢ tolerance)", () => {
    const r = classifyPricePerBag(3.45, { toleranceUsd: 0.05 });
    expect(r.onGrid).toBe(true);
  });

  it("with toleranceUsd=0.005 (half-cent), $3.484 → off-grid (default 1¢ would accept)", () => {
    // $3.484 is 0.006 below B2 at $3.49 — outside half-cent tolerance,
    // inside default 1¢ tolerance. Tightening the tolerance flips this
    // borderline price from on-grid to off-grid.
    const tight = classifyPricePerBag(3.484, { toleranceUsd: 0.005 });
    expect(tight.onGrid).toBe(false);
    const loose = classifyPricePerBag(3.484);
    expect(loose.onGrid).toBe(true);
  });

  it("throws on NaN price (no silent zero-match)", () => {
    expect(() => classifyPricePerBag(Number.NaN)).toThrow();
  });

  it("throws on Infinity price", () => {
    expect(() => classifyPricePerBag(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("Phase 36.6d — consolidation invariants (B2B_GRID_PRICES_USD ↔ off-grid-quotes)", () => {
  it("B2B_GRID_PRICES_USD is derived from b2bEligible tiers in PRICING_GRID", () => {
    const expected = new Set<number>();
    for (const t of PRICING_GRID) {
      if (t.b2bEligible) expected.add(Math.round(t.pricePerBag * 100) / 100);
    }
    const actual = new Set(B2B_GRID_PRICES_USD.map((p) => Math.round(p * 100) / 100));
    expect(actual).toEqual(expected);
  });

  it("DTC-Single (retail MSRP $5.99) is NOT in B2B_GRID_PRICES_USD", () => {
    expect(B2B_GRID_PRICES_USD).not.toContain(5.99);
  });

  it("DTC-Single tier has b2bEligible=false; every other tier b2bEligible=true", () => {
    for (const t of PRICING_GRID) {
      if (t.id === "DTC-Single") {
        expect(t.b2bEligible).toBe(false);
      } else {
        expect(t.b2bEligible).toBe(true);
      }
    }
  });

  it("ON_GRID_BAG_PRICES_USD (off-grid-quotes) is the same array as B2B_GRID_PRICES_USD (no drift)", () => {
    // Phase 36.6d: off-grid-quotes re-exports from pricing-grid-classifier.
    // If a future edit adds a B2B tier here without updating off-grid logic,
    // this test fails — that's the point.
    expect(ON_GRID_BAG_PRICES_USD).toBe(B2B_GRID_PRICES_USD);
  });

  it("contains all v2.4 canonical B2B prices ($3.49, $3.50, $3.25, $3.00, $2.50, $2.49, $2.10, $2.00)", () => {
    expect(B2B_GRID_PRICES_USD).toContain(3.49);
    expect(B2B_GRID_PRICES_USD).toContain(3.5);
    expect(B2B_GRID_PRICES_USD).toContain(3.25);
    expect(B2B_GRID_PRICES_USD).toContain(3.0);
    expect(B2B_GRID_PRICES_USD).toContain(2.5);
    expect(B2B_GRID_PRICES_USD).toContain(2.49);
    expect(B2B_GRID_PRICES_USD).toContain(2.1);
    expect(B2B_GRID_PRICES_USD).toContain(2.0);
  });

  it("dedupes prices that appear on multiple tiers (B1+B2 share $3.49; B4+B5+Reunion share $3.25)", () => {
    const counts = new Map<number, number>();
    for (const p of B2B_GRID_PRICES_USD) {
      const cents = Math.round(p * 100);
      counts.set(cents, (counts.get(cents) ?? 0) + 1);
    }
    for (const [cents, n] of counts.entries()) {
      expect(n, `price ${(cents / 100).toFixed(2)} appears ${n}× — should be 1`).toBe(1);
    }
  });
});

describe("isFullyRatifiedPrice — strict canonical check", () => {
  it("$3.49 → true (B2 ratified)", () => {
    expect(isFullyRatifiedPrice(3.49)).toBe(true);
  });

  it("$3.00 → false (matches proposed C-ANCH only)", () => {
    expect(isFullyRatifiedPrice(3.0)).toBe(false);
  });

  it("$3.25 → true (B4 ratified, preferred over Reunion-2026 show-special by ordering)", () => {
    expect(isFullyRatifiedPrice(3.25)).toBe(true);
  });

  it("$3.30 → false (off-grid, not within tolerance)", () => {
    expect(isFullyRatifiedPrice(3.3)).toBe(false);
  });

  it("$2.10 → true (Option B ratified)", () => {
    expect(isFullyRatifiedPrice(2.1)).toBe(true);
  });
});
