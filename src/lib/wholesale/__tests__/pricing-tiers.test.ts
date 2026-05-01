/**
 * Phase 35.a — Wholesale pricing tiers (B1-B5).
 *
 * Locks the contract from `/contracts/wholesale-pricing.md` v1.0:
 *   - Five stable designators only; ids unchanged.
 *   - Per-bag prices: B1=$3.49, B2=$3.49, B3=$3.50, B4=$3.25, B5=$3.25.
 *     (B3 + B5 bumped +$0.25 in v2.4 — Rene's 2026-04-30 PM Class C
 *      `pricing.change`: buyer-pays surcharge across both buyer-freight
 *      tiers; price-gap collapse nudges buyers to landed.)
 *   - Bags per unit: B1=6, B2=36, B3=36, B4=900, B5=900.
 *   - Freight modes: B2/B4 landed, B3/B5 buyer-paid, B1 custom (Ben delivers).
 *   - Online exposure: B1 INTERNAL only; B2-B5 online.
 *   - Custom freight only at 3+ pallets (B4/B5 only); never on master carton.
 *   - bagsForOrderLine / lineSubtotalUsd math is exact + non-fabricated.
 *   - isPricingTier acts as a strict closed-enum type guard.
 */
import { describe, expect, it } from "vitest";

import {
  BAG_PRICE_USD,
  BAGS_PER_UNIT,
  FREIGHT_MODE,
  FULFILLMENT_TYPE,
  FULFILLMENT_TYPES,
  ONLINE_AVAILABLE,
  PRICING_TIERS,
  TIER_DISPLAY,
  TIER_INVOICE_LABEL,
  availableInOnlineFlow,
  bagPriceUsd,
  bagsForOrderLine,
  bagsPerUnit,
  freightMode,
  fulfillmentTypeToTier,
  isFulfillmentType,
  isPricingTier,
  lineSubtotalUsd,
  onlineTiers,
  shouldUseCustomFreightQuote,
  summarizeOrderLine,
  tierDisplay,
  tierInvoiceLabel,
  tierToFulfillmentType,
  unitNoun,
} from "../pricing-tiers";

describe("PRICING_TIERS canonical enum", () => {
  it("contains exactly B1-B5 in canonical order", () => {
    expect(PRICING_TIERS).toEqual(["B1", "B2", "B3", "B4", "B5"]);
  });
});

describe("BAG_PRICE_USD per-tier prices (v2.4 — Q3 surcharge ratified 2026-04-30 PM)", () => {
  it("B1 = $3.49 (local case, Ben delivers)", () => {
    expect(BAG_PRICE_USD.B1).toBe(3.49);
  });
  it("B2 = $3.49 (master carton, landed)", () => {
    expect(BAG_PRICE_USD.B2).toBe(3.49);
  });
  it("B3 = $3.50 (master carton + buyer freight, v2.4 +$0.25 surcharge)", () => {
    expect(BAG_PRICE_USD.B3).toBe(3.5);
  });
  it("B4 = $3.25 (pallet, landed)", () => {
    expect(BAG_PRICE_USD.B4).toBe(3.25);
  });
  it("B5 = $3.25 (pallet + buyer freight, v2.4 +$0.25 surcharge → matches B4 landed)", () => {
    expect(BAG_PRICE_USD.B5).toBe(3.25);
  });
});

describe("BAGS_PER_UNIT canonical case-pack math", () => {
  it("B1 = 6 bags (1 inner case)", () => {
    expect(BAGS_PER_UNIT.B1).toBe(6);
  });
  it("B2 / B3 = 36 bags (1 master carton, 6 cases × 6 bags)", () => {
    expect(BAGS_PER_UNIT.B2).toBe(36);
    expect(BAGS_PER_UNIT.B3).toBe(36);
  });
  it("B4 / B5 = 900 bags (1 pallet, 25 master cartons × 36 bags)", () => {
    expect(BAGS_PER_UNIT.B4).toBe(900);
    expect(BAGS_PER_UNIT.B5).toBe(900);
  });
});

describe("FREIGHT_MODE classification per tier", () => {
  it("B2 + B4 are landed (USA Gummies ships, freight in price)", () => {
    expect(FREIGHT_MODE.B2).toBe("landed");
    expect(FREIGHT_MODE.B4).toBe("landed");
  });
  it("B3 + B5 are buyer-paid (lower price, customer arranges freight)", () => {
    expect(FREIGHT_MODE.B3).toBe("buyer-paid");
    expect(FREIGHT_MODE.B5).toBe("buyer-paid");
  });
  it("B1 is custom (Ben delivers locally)", () => {
    expect(FREIGHT_MODE.B1).toBe("custom");
  });
});

describe("ONLINE_AVAILABLE — B1 is INTERNAL only (locked doctrine)", () => {
  it("B1 is NOT available in the online flow", () => {
    expect(ONLINE_AVAILABLE.B1).toBe(false);
    expect(availableInOnlineFlow("B1")).toBe(false);
  });
  it("B2, B3, B4, B5 are available in the online flow", () => {
    for (const tier of ["B2", "B3", "B4", "B5"] as const) {
      expect(ONLINE_AVAILABLE[tier]).toBe(true);
      expect(availableInOnlineFlow(tier)).toBe(true);
    }
  });
  it("onlineTiers() returns exactly B2-B5 in canonical order", () => {
    expect(onlineTiers()).toEqual(["B2", "B3", "B4", "B5"]);
  });
});

describe("isPricingTier — strict closed-enum type guard", () => {
  it("accepts B1-B5 strings", () => {
    expect(isPricingTier("B1")).toBe(true);
    expect(isPricingTier("B5")).toBe(true);
  });

  it("rejects unknown strings (no fabrication of new tiers)", () => {
    expect(isPricingTier("B6")).toBe(false);
    expect(isPricingTier("b1")).toBe(false); // case-sensitive
    expect(isPricingTier("")).toBe(false);
    expect(isPricingTier("B0")).toBe(false);
  });

  it("rejects non-string inputs (defense at API boundary)", () => {
    expect(isPricingTier(undefined)).toBe(false);
    expect(isPricingTier(null)).toBe(false);
    expect(isPricingTier(2)).toBe(false);
    expect(isPricingTier({})).toBe(false);
    expect(isPricingTier(["B2"])).toBe(false);
  });
});

describe("bagsForOrderLine — atomic-bag math is exact", () => {
  it("1 master carton (B2) → 36 bags", () => {
    expect(bagsForOrderLine("B2", 1)).toBe(36);
  });
  it("3 master cartons (B2) → 108 bags", () => {
    expect(bagsForOrderLine("B2", 3)).toBe(108);
  });
  it("1 pallet (B4) → 900 bags", () => {
    expect(bagsForOrderLine("B4", 1)).toBe(900);
  });
  it("2 pallets (B5) → 1800 bags", () => {
    expect(bagsForOrderLine("B5", 2)).toBe(1800);
  });
  it("1 case (B1) → 6 bags", () => {
    expect(bagsForOrderLine("B1", 1)).toBe(6);
  });

  it("zero unitCount → 0 bags (legal but empty)", () => {
    expect(bagsForOrderLine("B2", 0)).toBe(0);
  });

  it("floors fractional unitCount (defensive — order units are integer-only)", () => {
    expect(bagsForOrderLine("B2", 2.7)).toBe(72); // Math.floor(2.7) * 36 = 2 * 36
    expect(bagsForOrderLine("B4", 1.99)).toBe(900); // 1 * 900
  });

  it("throws on negative unitCount (never sign a negative-bag invoice)", () => {
    expect(() => bagsForOrderLine("B2", -1)).toThrow(/non-negative/i);
  });

  it("throws on non-finite unitCount (NaN / Infinity)", () => {
    expect(() => bagsForOrderLine("B2", Number.NaN)).toThrow();
    expect(() => bagsForOrderLine("B2", Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("lineSubtotalUsd — invoice-grade rounding", () => {
  it("3 master cartons B2 = 108 × $3.49 = $376.92", () => {
    expect(lineSubtotalUsd("B2", 3)).toBe(376.92);
  });

  it("1 master carton B3 = 36 × $3.50 = $126.00 (v2.4 Q3 surcharge)", () => {
    expect(lineSubtotalUsd("B3", 1)).toBe(126.0);
  });

  it("1 pallet B4 = 900 × $3.25 = $2925.00", () => {
    expect(lineSubtotalUsd("B4", 1)).toBe(2925.0);
  });

  it("1 pallet B5 = 900 × $3.25 = $2925.00 (v2.4 Q3 surcharge — was $2700 at $3.00/bag)", () => {
    expect(lineSubtotalUsd("B5", 1)).toBe(2925.0);
  });

  it("zero unitCount → $0", () => {
    expect(lineSubtotalUsd("B2", 0)).toBe(0);
  });

  it("rounds to 2 decimals (no float-precision drift in invoices)", () => {
    // Synthetic case where IEEE-754 might drift; we round to cents.
    // v2.4 surcharge: 7 × 900 × $3.25 = $20,475.00
    const result = lineSubtotalUsd("B5", 7);
    expect(result).toBe(20475);
    expect(Number.isInteger(result * 100)).toBe(true);
  });
});

describe("shouldUseCustomFreightQuote — locked doctrine", () => {
  it("B4 with 1-2 pallets uses canonical landed price (NOT custom)", () => {
    expect(shouldUseCustomFreightQuote("B4", 1)).toBe(false);
    expect(shouldUseCustomFreightQuote("B4", 2)).toBe(false);
  });

  it("B4 with 3+ pallets escalates to custom quote", () => {
    expect(shouldUseCustomFreightQuote("B4", 3)).toBe(true);
    expect(shouldUseCustomFreightQuote("B4", 10)).toBe(true);
  });

  it("B5 with 1-2 pallets stays buyer-paid (NOT custom)", () => {
    expect(shouldUseCustomFreightQuote("B5", 1)).toBe(false);
    expect(shouldUseCustomFreightQuote("B5", 2)).toBe(false);
  });

  it("B5 with 3+ pallets escalates to custom quote", () => {
    expect(shouldUseCustomFreightQuote("B5", 3)).toBe(true);
  });

  it("master carton tiers (B2, B3) NEVER hit custom regardless of count", () => {
    expect(shouldUseCustomFreightQuote("B2", 100)).toBe(false);
    expect(shouldUseCustomFreightQuote("B3", 100)).toBe(false);
  });

  it("B1 (local case, internal) NEVER hits the standard custom path", () => {
    expect(shouldUseCustomFreightQuote("B1", 1)).toBe(false);
    expect(shouldUseCustomFreightQuote("B1", 99)).toBe(false);
  });

  it("invalid unitCount → false (defensive — no false-positive escalation)", () => {
    expect(shouldUseCustomFreightQuote("B4", -1)).toBe(false);
    expect(shouldUseCustomFreightQuote("B4", Number.NaN)).toBe(false);
  });
});

describe("Lookup helpers (single-tier accessors)", () => {
  it("bagsPerUnit returns canonical bag count", () => {
    expect(bagsPerUnit("B2")).toBe(36);
    expect(bagsPerUnit("B4")).toBe(900);
  });

  it("bagPriceUsd returns canonical price (v2.4: B5 raised $3.00 → $3.25 via Q3 surcharge)", () => {
    expect(bagPriceUsd("B2")).toBe(3.49);
    expect(bagPriceUsd("B5")).toBe(3.25);
  });

  it("freightMode returns canonical mode", () => {
    expect(freightMode("B2")).toBe("landed");
    expect(freightMode("B5")).toBe("buyer-paid");
  });

  it("tierDisplay returns the human-readable label", () => {
    expect(tierDisplay("B2")).toContain("Master carton");
    expect(tierDisplay("B2")).toContain("landed");
  });

  it("tierInvoiceLabel is clean wholesale prose (Rene 2026-04-28 lock; no tier prefix)", () => {
    // Per Rene 2026-04-28: tier code lives in SKU column, NOT in description.
    // Description must be customer-facing prose (catalog-style).
    expect(tierInvoiceLabel("B2")).not.toContain("B2");
    expect(tierInvoiceLabel("B2")).toContain("36-Bag Master Carton");
    expect(tierInvoiceLabel("B2")).toContain("Freight Included");
    expect(tierInvoiceLabel("B5")).not.toContain("B5");
    expect(tierInvoiceLabel("B5")).toContain("Pallet");
    expect(tierInvoiceLabel("B5")).toContain("Buyer Freight");
  });
});

describe("summarizeOrderLine — full structured projection", () => {
  it("B2 × 3 — master carton landed", () => {
    const s = summarizeOrderLine("B2", 3);
    expect(s).toEqual({
      tier: "B2",
      unitCount: 3,
      unitLabel: TIER_DISPLAY.B2,
      bags: 108,
      bagPriceUsd: 3.49,
      subtotalUsd: 376.92,
      freightMode: "landed",
      invoiceLabel: TIER_INVOICE_LABEL.B2,
      customFreightRequired: false,
    });
  });

  it("B5 × 4 — pallet buyer-paid, hits custom freight (3+ pallets)", () => {
    const s = summarizeOrderLine("B5", 4);
    expect(s.tier).toBe("B5");
    expect(s.bags).toBe(3600); // 4 × 900
    expect(s.subtotalUsd).toBe(11700); // 3600 × $3.25 (v2.4 Q3 surcharge)
    expect(s.freightMode).toBe("buyer-paid"); // tier-level mode
    expect(s.customFreightRequired).toBe(true); // 3+ pallet escalation
  });

  it("B4 × 1 — pallet landed, NOT custom freight", () => {
    const s = summarizeOrderLine("B4", 1);
    expect(s.bags).toBe(900);
    expect(s.subtotalUsd).toBe(2925);
    expect(s.customFreightRequired).toBe(false);
  });

  it("floors fractional unitCount in the projection", () => {
    expect(summarizeOrderLine("B2", 2.9).unitCount).toBe(2);
  });
});

describe("Designator stability invariant", () => {
  it("All five tiers appear in PRICING_TIERS", () => {
    expect(PRICING_TIERS).toHaveLength(5);
    expect(PRICING_TIERS).toContain("B1");
    expect(PRICING_TIERS).toContain("B2");
    expect(PRICING_TIERS).toContain("B3");
    expect(PRICING_TIERS).toContain("B4");
    expect(PRICING_TIERS).toContain("B5");
  });

  it("Every tier has price + bag-count + freight + online-flag + display + invoice label", () => {
    for (const tier of PRICING_TIERS) {
      expect(typeof BAG_PRICE_USD[tier]).toBe("number");
      expect(typeof BAGS_PER_UNIT[tier]).toBe("number");
      expect(typeof FREIGHT_MODE[tier]).toBe("string");
      expect(typeof ONLINE_AVAILABLE[tier]).toBe("boolean");
      expect(typeof TIER_DISPLAY[tier]).toBe("string");
      expect(typeof TIER_INVOICE_LABEL[tier]).toBe("string");
      expect(BAG_PRICE_USD[tier]).toBeGreaterThan(0);
      expect(BAGS_PER_UNIT[tier]).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 35.g — additive doctrine 2026-04-28 (Rene + Viktor batch SKU session)
// ---------------------------------------------------------------------------

describe("TIER_INVOICE_LABEL — Rene 2026-04-28 lock (no tier-code prefix)", () => {
  it("B3 description has NO 'B3 —' prefix (was 'B3 — Master carton...' pre-2026-04-28)", () => {
    expect(TIER_INVOICE_LABEL.B3).not.toMatch(/^B3/);
    expect(TIER_INVOICE_LABEL.B3).not.toMatch(/B3 —/);
  });

  it("MCBF (B3) label is clean wholesale prose", () => {
    expect(TIER_INVOICE_LABEL.B3).toBe(
      "All American Gummy Bears — 7.5 oz, 36-Bag Master Carton, Buyer Freight",
    );
  });

  it("MCL (B2) label is clean wholesale prose", () => {
    expect(TIER_INVOICE_LABEL.B2).toBe(
      "All American Gummy Bears — 7.5 oz, 36-Bag Master Carton, Freight Included",
    );
  });

  it("PL (B4) label is clean wholesale prose", () => {
    expect(TIER_INVOICE_LABEL.B4).toBe(
      "All American Gummy Bears — 7.5 oz, ~900-Bag Pallet, Freight Included",
    );
  });

  it("PBF (B5) label is clean wholesale prose", () => {
    expect(TIER_INVOICE_LABEL.B5).toBe(
      "All American Gummy Bears — 7.5 oz, ~900-Bag Pallet, Buyer Freight",
    );
  });

  it("LCD (B1) label is clean wholesale prose", () => {
    expect(TIER_INVOICE_LABEL.B1).toBe(
      "All American Gummy Bears — 7.5 oz, 6-Bag Case, Local Delivery",
    );
  });

  it("no label has any tier prefix (defense — every tier)", () => {
    for (const tier of PRICING_TIERS) {
      expect(TIER_INVOICE_LABEL[tier]).not.toMatch(/^B[12345]/);
    }
  });
});

describe("FulfillmentType mapping (LCD/MCL/MCBF/PL/PBF)", () => {
  it("FULFILLMENT_TYPES contains exactly 5 codes in canonical order", () => {
    expect(FULFILLMENT_TYPES).toEqual(["LCD", "MCL", "MCBF", "PL", "PBF"]);
  });

  it("B1 → LCD (Local Case, Delivered)", () => {
    expect(FULFILLMENT_TYPE.B1).toBe("LCD");
    expect(tierToFulfillmentType("B1")).toBe("LCD");
  });

  it("B2 → MCL (Master Carton, Landed)", () => {
    expect(FULFILLMENT_TYPE.B2).toBe("MCL");
    expect(tierToFulfillmentType("B2")).toBe("MCL");
  });

  it("B3 → MCBF (Master Carton, Buyer Freight)", () => {
    expect(FULFILLMENT_TYPE.B3).toBe("MCBF");
    expect(tierToFulfillmentType("B3")).toBe("MCBF");
  });

  it("B4 → PL (Pallet, Landed)", () => {
    expect(FULFILLMENT_TYPE.B4).toBe("PL");
    expect(tierToFulfillmentType("B4")).toBe("PL");
  });

  it("B5 → PBF (Pallet, Buyer Freight)", () => {
    expect(FULFILLMENT_TYPE.B5).toBe("PBF");
    expect(tierToFulfillmentType("B5")).toBe("PBF");
  });

  it("isFulfillmentType accepts every canonical code", () => {
    for (const code of FULFILLMENT_TYPES) {
      expect(isFulfillmentType(code)).toBe(true);
    }
  });

  it("isFulfillmentType rejects unknown / lowercase / non-string", () => {
    expect(isFulfillmentType("X")).toBe(false);
    expect(isFulfillmentType("mcl")).toBe(false); // case-sensitive
    expect(isFulfillmentType("B3")).toBe(false); // legacy code is NOT a fulfillment type
    expect(isFulfillmentType("")).toBe(false);
    expect(isFulfillmentType(null)).toBe(false);
    expect(isFulfillmentType(undefined)).toBe(false);
    expect(isFulfillmentType(42)).toBe(false);
  });

  it("fulfillmentTypeToTier reverses the mapping", () => {
    expect(fulfillmentTypeToTier("LCD")).toBe("B1");
    expect(fulfillmentTypeToTier("MCL")).toBe("B2");
    expect(fulfillmentTypeToTier("MCBF")).toBe("B3");
    expect(fulfillmentTypeToTier("PL")).toBe("B4");
    expect(fulfillmentTypeToTier("PBF")).toBe("B5");
  });

  it("tierToFulfillmentType ↔ fulfillmentTypeToTier roundtrip is identity", () => {
    for (const tier of PRICING_TIERS) {
      expect(fulfillmentTypeToTier(tierToFulfillmentType(tier))).toBe(tier);
    }
  });
});

describe("unitNoun (canonical pluralization helper)", () => {
  it("B1 (case): 1 case / N cases", () => {
    expect(unitNoun("B1", 1)).toBe("case");
    expect(unitNoun("B1", 5)).toBe("cases");
  });

  it("B2 / B3 (master carton): 1 master carton / N master cartons", () => {
    expect(unitNoun("B2", 1)).toBe("master carton");
    expect(unitNoun("B3", 3)).toBe("master cartons");
  });

  it("B4 / B5 (pallet): 1 pallet / N pallets", () => {
    expect(unitNoun("B4", 1)).toBe("pallet");
    expect(unitNoun("B5", 5)).toBe("pallets");
  });

  it("0 count is plural", () => {
    expect(unitNoun("B2", 0)).toBe("master cartons");
  });
});
