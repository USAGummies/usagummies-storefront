/**
 * delivered-pricing-guard.ts tests — doctrine enforcement for
 * absorbed-freight customers (Inderbitzin, Glacier, Bryce, etc.).
 */
import { describe, expect, it } from "vitest";

import {
  lookupDeliveredPricing,
  validateInvoiceAgainstPricingDoctrine,
} from "../delivered-pricing-guard";

describe("lookupDeliveredPricing", () => {
  it("matches Inderbitzin variants case-insensitive", () => {
    expect(lookupDeliveredPricing("Inderbitzin Distributors")).not.toBeNull();
    expect(lookupDeliveredPricing("inderbitzin confectionery")).not.toBeNull();
    expect(lookupDeliveredPricing("INDERBITZIN")).not.toBeNull();
  });

  it("matches Glacier Wholesalers", () => {
    const res = lookupDeliveredPricing("Glacier Wholesalers, Inc.");
    expect(res).not.toBeNull();
    expect(res?.freightAbsorbed).toBe(true);
  });

  it("matches Bryce Glamp & Camp", () => {
    expect(lookupDeliveredPricing("Bryce Glamp & Camp")).not.toBeNull();
  });

  it("returns null for unknown customers", () => {
    expect(lookupDeliveredPricing("Random Retailer LLC")).toBeNull();
    expect(lookupDeliveredPricing("")).toBeNull();
  });
});

describe("validateInvoiceAgainstPricingDoctrine", () => {
  it("allows invoices without freight lines", () => {
    const r = validateInvoiceAgainstPricingDoctrine({
      customer: "Inderbitzin Distributors",
      hasFreightLine: false,
      freightAmount: 0,
    });
    expect(r.ok).toBe(true);
  });

  it("allows invoices to non-delivered-pricing customers with freight lines", () => {
    const r = validateInvoiceAgainstPricingDoctrine({
      customer: "Random Retailer LLC",
      hasFreightLine: true,
      freightAmount: 45,
    });
    expect(r.ok).toBe(true);
  });

  it("refuses invoices to delivered-pricing customers with freight lines", () => {
    const r = validateInvoiceAgainstPricingDoctrine({
      customer: "Inderbitzin Distributors",
      hasFreightLine: true,
      freightAmount: 45,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/delivered/i);
    }
  });

  it("allows override with approver + reason + timestamp", () => {
    const r = validateInvoiceAgainstPricingDoctrine({
      customer: "Inderbitzin Distributors",
      hasFreightLine: true,
      freightAmount: 45,
      overrideApprovedBy: {
        approver: "Ben",
        reason: "Customer agreed to add-on shipping charge per 2026-04-20 email",
        documentedAt: new Date().toISOString(),
      },
    });
    expect(r.ok).toBe(true);
  });

  it("refuses override with too-short reason (guard enforces ≥8 chars)", () => {
    const r = validateInvoiceAgainstPricingDoctrine({
      customer: "Inderbitzin Distributors",
      hasFreightLine: true,
      freightAmount: 45,
      overrideApprovedBy: {
        approver: "Ben",
        reason: "ok",
        documentedAt: new Date().toISOString(),
      },
    });
    // Guard itself validates reason length — rejects short reasons
    // even if the route-level validation is bypassed.
    expect(r.ok).toBe(false);
  });

  it("refuses override with missing approver", () => {
    const r = validateInvoiceAgainstPricingDoctrine({
      customer: "Inderbitzin Distributors",
      hasFreightLine: true,
      freightAmount: 45,
      overrideApprovedBy: {
        approver: "" as "Ben",
        reason: "Valid long enough reason here",
        documentedAt: new Date().toISOString(),
      },
    });
    expect(r.ok).toBe(false);
  });
});
