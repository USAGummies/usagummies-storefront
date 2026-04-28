/**
 * Phase 35.a — Wholesale pricing tiers (B1-B5).
 *
 * Locks the contract from `/contracts/wholesale-pricing.md` v1.0:
 *   - Five stable designators only; ids unchanged.
 *   - Per-bag prices: B1=$3.49, B2=$3.49, B3=$3.25, B4=$3.25, B5=$3.00.
 *   - Bags per unit: B1=6, B2=36, B3=36, B4=432, B5=432.
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
  ONLINE_AVAILABLE,
  PRICING_TIERS,
  TIER_DISPLAY,
  TIER_INVOICE_LABEL,
  availableInOnlineFlow,
  bagPriceUsd,
  bagsForOrderLine,
  bagsPerUnit,
  freightMode,
  isPricingTier,
  lineSubtotalUsd,
  onlineTiers,
  shouldUseCustomFreightQuote,
  summarizeOrderLine,
  tierDisplay,
  tierInvoiceLabel,
} from "../pricing-tiers";

describe("PRICING_TIERS canonical enum", () => {
  it("contains exactly B1-B5 in canonical order", () => {
    expect(PRICING_TIERS).toEqual(["B1", "B2", "B3", "B4", "B5"]);
  });
});

describe("BAG_PRICE_USD per-tier prices (LOCKED 2026-04-27)", () => {
  it("B1 = $3.49 (local case, Ben delivers)", () => {
    expect(BAG_PRICE_USD.B1).toBe(3.49);
  });
  it("B2 = $3.49 (master carton, landed)", () => {
    expect(BAG_PRICE_USD.B2).toBe(3.49);
  });
  it("B3 = $3.25 (master carton + buyer freight)", () => {
    expect(BAG_PRICE_USD.B3).toBe(3.25);
  });
  it("B4 = $3.25 (pallet, landed)", () => {
    expect(BAG_PRICE_USD.B4).toBe(3.25);
  });
  it("B5 = $3.00 (pallet + buyer freight, lowest standard)", () => {
    expect(BAG_PRICE_USD.B5).toBe(3.0);
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
  it("B4 / B5 = 432 bags (1 pallet, 12 master cartons × 36 bags)", () => {
    expect(BAGS_PER_UNIT.B4).toBe(432);
    expect(BAGS_PER_UNIT.B5).toBe(432);
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
  it("1 pallet (B4) → 432 bags", () => {
    expect(bagsForOrderLine("B4", 1)).toBe(432);
  });
  it("2 pallets (B5) → 864 bags", () => {
    expect(bagsForOrderLine("B5", 2)).toBe(864);
  });
  it("1 case (B1) → 6 bags", () => {
    expect(bagsForOrderLine("B1", 1)).toBe(6);
  });

  it("zero unitCount → 0 bags (legal but empty)", () => {
    expect(bagsForOrderLine("B2", 0)).toBe(0);
  });

  it("floors fractional unitCount (defensive — order units are integer-only)", () => {
    expect(bagsForOrderLine("B2", 2.7)).toBe(72); // Math.floor(2.7) * 36 = 2 * 36
    expect(bagsForOrderLine("B4", 1.99)).toBe(432); // 1 * 432
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

  it("1 master carton B3 = 36 × $3.25 = $117.00", () => {
    expect(lineSubtotalUsd("B3", 1)).toBe(117.0);
  });

  it("1 pallet B4 = 432 × $3.25 = $1404.00", () => {
    expect(lineSubtotalUsd("B4", 1)).toBe(1404.0);
  });

  it("1 pallet B5 = 432 × $3.00 = $1296.00", () => {
    expect(lineSubtotalUsd("B5", 1)).toBe(1296.0);
  });

  it("zero unitCount → $0", () => {
    expect(lineSubtotalUsd("B2", 0)).toBe(0);
  });

  it("rounds to 2 decimals (no float-precision drift in invoices)", () => {
    // Synthetic case where IEEE-754 might drift; we round to cents.
    const result = lineSubtotalUsd("B5", 7); // 7 * 432 * 3.00 = 9072
    expect(result).toBe(9072);
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
    expect(bagsPerUnit("B4")).toBe(432);
  });

  it("bagPriceUsd returns canonical price", () => {
    expect(bagPriceUsd("B2")).toBe(3.49);
    expect(bagPriceUsd("B5")).toBe(3.0);
  });

  it("freightMode returns canonical mode", () => {
    expect(freightMode("B2")).toBe("landed");
    expect(freightMode("B5")).toBe("buyer-paid");
  });

  it("tierDisplay returns the human-readable label", () => {
    expect(tierDisplay("B2")).toContain("Master carton");
    expect(tierDisplay("B2")).toContain("landed");
  });

  it("tierInvoiceLabel embeds the designator + unit count + freight mode", () => {
    // QBO line text must trace back to the designator unambiguously.
    expect(tierInvoiceLabel("B2")).toContain("B2");
    expect(tierInvoiceLabel("B2")).toContain("36 bags");
    expect(tierInvoiceLabel("B2")).toContain("landed");
    expect(tierInvoiceLabel("B5")).toContain("B5");
    expect(tierInvoiceLabel("B5")).toContain("432");
    expect(tierInvoiceLabel("B5")).toContain("buyer freight");
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
    expect(s.bags).toBe(1728); // 4 × 432
    expect(s.subtotalUsd).toBe(5184); // 1728 × 3.00
    expect(s.freightMode).toBe("buyer-paid"); // tier-level mode
    expect(s.customFreightRequired).toBe(true); // 3+ pallet escalation
  });

  it("B4 × 1 — pallet landed, NOT custom freight", () => {
    const s = summarizeOrderLine("B4", 1);
    expect(s.bags).toBe(432);
    expect(s.subtotalUsd).toBe(1404);
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
