import { describe, expect, it } from "vitest";

import type { BoothVisitIntent } from "@/lib/sales-tour/booth-visit-types";
import { classifyBoothTier } from "@/lib/sales-tour/classify-booth-tier";

function intent(overrides: Partial<BoothVisitIntent> = {}): BoothVisitIntent {
  return {
    rawText: "test",
    prospectName: "Test Prospect",
    state: "UT",
    city: null,
    scale: "master-carton",
    count: 1,
    totalBags: 36,
    freightAsk: "landed",
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    notes: null,
    confidence: 0.9,
    ...overrides,
  };
}

describe("classifyBoothTier — pricing-route-governance §1 truth table", () => {
  it("3 pallets + landed → C-ANCH route-anchor at $3.00/bag (Class C)", () => {
    const r = classifyBoothTier(intent({ scale: "pallet", count: 3, totalBags: 2700, freightAsk: "landed" }));
    expect(r.pricingClass).toBe("C-ANCH");
    expect(r.lines[0].pricingClass).toBe("C-ANCH");
    expect(r.lines[0].pricePerBag).toBe(3.0);
    expect(r.lines[0].freightStance).toBe("landed");
    expect(r.approval).toBe("class-c");
    expect(r.dealCheckRequired).toBe(true);
  });

  it("3 pallets + anchor → also C-ANCH (same path)", () => {
    const r = classifyBoothTier(intent({ scale: "pallet", count: 3, totalBags: 2700, freightAsk: "anchor" }));
    expect(r.pricingClass).toBe("C-ANCH");
    expect(r.approval).toBe("class-c");
  });

  it("3 pallets + pickup → B5 buyer-pays $3.00/bag (Class A on-grid)", () => {
    const r = classifyBoothTier(intent({ scale: "pallet", count: 3, totalBags: 2700, freightAsk: "pickup" }));
    expect(r.pricingClass).toBe("C-STD");
    expect(r.lines[0].bGridDesignator).toBe("B5");
    expect(r.lines[0].pricePerBag).toBe(3.0);
    expect(r.lines[0].freightStance).toBe("buyer-paid");
    expect(r.approval).toBe("none");
    expect(r.dealCheckRequired).toBe(false);
  });

  it("1 pallet + landed → B4 landed pallet $3.25/bag (Class A on-grid)", () => {
    const r = classifyBoothTier(intent({ scale: "pallet", count: 1, totalBags: 900, freightAsk: "landed" }));
    expect(r.pricingClass).toBe("C-STD");
    expect(r.lines[0].bGridDesignator).toBe("B4");
    expect(r.lines[0].pricePerBag).toBe(3.25);
    expect(r.approval).toBe("none");
  });

  it("36 bags master-carton + landed → B2 $3.49/bag landed (Class A)", () => {
    const r = classifyBoothTier(intent({ scale: "master-carton", count: 1, totalBags: 36, freightAsk: "landed" }));
    expect(r.pricingClass).toBe("C-STD");
    expect(r.lines[0].bGridDesignator).toBe("B2");
    expect(r.lines[0].pricePerBag).toBe(3.49);
    expect(r.approval).toBe("none");
  });

  it("36 bags master-carton + pickup → B3 $3.25/bag buyer-pays + C-PU pickup floor (Class C)", () => {
    const r = classifyBoothTier(intent({ scale: "master-carton", count: 1, totalBags: 36, freightAsk: "pickup" }));
    expect(r.pricingClass).toBe("C-PU");
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0].pricingClass).toBe("C-PU");
    expect(r.lines[0].pricePerBag).toBe(2.0);
    expect(r.lines[1].bGridDesignator).toBe("B3");
    expect(r.lines[1].pricePerBag).toBe(3.25);
    expect(r.approval).toBe("class-c");
    expect(r.dealCheckRequired).toBe(true);
  });

  it("36 bags master-carton + unsure → quotes BOTH B2 landed and B3 buyer-pays", () => {
    const r = classifyBoothTier(intent({ scale: "master-carton", count: 1, totalBags: 36, freightAsk: "unsure" }));
    expect(r.lines).toHaveLength(2);
    const designators = r.lines.map((l) => l.bGridDesignator);
    expect(designators).toContain("B2");
    expect(designators).toContain("B3");
    expect(r.approval).toBe("none");
  });

  it("1 sample drop → C-EXC free at $0/bag, Class A audit only", () => {
    const r = classifyBoothTier(intent({ scale: "sample", count: 1, totalBags: 1, freightAsk: "unsure" }));
    expect(r.pricingClass).toBe("C-EXC");
    expect(r.lines[0].pricePerBag).toBe(0);
    expect(r.approval).toBe("none");
  });

  it("6-bag case sample drop → C-EXC free", () => {
    const r = classifyBoothTier(intent({ scale: "case", count: 1, totalBags: 6, freightAsk: "unsure" }));
    expect(r.pricingClass).toBe("C-EXC");
    expect(r.lines[0].pricePerBag).toBe(0);
  });

  it("8 cases (48 bags) → master-carton-equivalent quote at B2/B3", () => {
    const r = classifyBoothTier(intent({ scale: "case", count: 8, totalBags: 48, freightAsk: "landed" }));
    expect(r.pricingClass).toBe("C-STD");
    expect(r.lines[0].bGridDesignator).toBe("B2");
    expect(r.lines[0].pricePerBag).toBe(3.49);
  });

  it("`fill` ask on a 1-pallet landed → C-FILL framing on B4 grid price", () => {
    const r = classifyBoothTier(intent({ scale: "pallet", count: 1, totalBags: 900, freightAsk: "fill" }));
    expect(r.pricingClass).toBe("C-FILL");
    expect(r.lines[0].pricingClass).toBe("C-FILL");
    expect(r.lines[0].bGridDesignator).toBe("B4");
    expect(r.lines[0].pricePerBag).toBe(3.25);
    expect(r.approval).toBe("none");
  });

  it("totalUsd is rounded to 2 decimals", () => {
    const r = classifyBoothTier(intent({ scale: "master-carton", count: 1, totalBags: 36, freightAsk: "landed" }));
    expect(r.lines[0].totalUsd).toBe(125.64); // 36 * 3.49
  });

  it("approvalReasons is non-empty for every classification (audit-grade)", () => {
    const cases: Array<Partial<BoothVisitIntent>> = [
      { scale: "pallet", count: 3, totalBags: 2700, freightAsk: "landed" },
      { scale: "pallet", count: 1, totalBags: 900, freightAsk: "pickup" },
      { scale: "master-carton", count: 1, totalBags: 36, freightAsk: "unsure" },
      { scale: "sample", count: 1, totalBags: 1, freightAsk: "unsure" },
    ];
    for (const c of cases) {
      const r = classifyBoothTier(intent(c));
      expect(r.approvalReasons.length).toBeGreaterThan(0);
    }
  });
});
