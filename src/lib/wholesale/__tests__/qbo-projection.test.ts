/**
 * Phase 35.f.6 — wholesale → QBO projection tests.
 *
 * Locked contracts:
 *   - projectQboCustomer maps prospect + shippingAddress + apInfo
 *     to the customer master payload, with payment terms keyed on
 *     paymentPath.
 *   - projectQboCustomer throws on missing required fields
 *     (prospect, companyName, contactName, contactEmail,
 *     shippingAddress).
 *   - billingAddress falls back to shippingAddress when AP info
 *     didn't capture a separate billing address.
 *   - projectQboInvoice produces one line per OrderLineSummary,
 *     with B-tier designator embedded in description.
 *   - projectQboInvoice throws on empty orderLines.
 *   - subtotalUsd sums correctly across multi-line invoices.
 *   - requiresCustomFreightQuote flips true when ANY line has
 *     customFreightRequired (e.g. B4 × 3+ pallets).
 *   - formatInvoiceLineText embeds tier + unit count + bag total.
 *   - Stable externalRef.flowId binds projection back to the flow.
 *   - Payment terms default to "Net 15" when paymentPath unset.
 *   - Customer notes embed the storeType + paymentPath + AP details.
 */
import { describe, expect, it } from "vitest";

import {
  __INTERNAL,
  formatInvoiceLineText,
  projectQboCustomer,
  projectQboInvoice,
} from "../qbo-projection";
import { summarizeOrderLine } from "../pricing-tiers";
import type {
  OnboardingState,
  ShippingAddress,
} from "../onboarding-flow";

const ADDR: ShippingAddress = {
  street1: "123 Main St",
  city: "Austin",
  state: "TX",
  postalCode: "78701",
  country: "US",
};

function buildState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return {
    flowId: "wf_qbo_001",
    currentStep: "qbo-customer-staged",
    stepsCompleted: [
      "info",
      "store-type",
      "pricing-shown",
      "order-type",
      "payment-path",
      "ap-info",
      "order-captured",
      "shipping-info",
    ],
    orderLines: [summarizeOrderLine("B2", 3)],
    timestamps: {},
    prospect: {
      companyName: "Acme Co",
      contactName: "Jane Doe",
      contactEmail: "jane@acme.test",
      contactPhone: "555-1212",
    },
    storeType: "specialty-retail",
    paymentPath: "accounts-payable",
    apInfo: { apEmail: "ap@acme.test" },
    shippingAddress: ADDR,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// projectQboCustomer
// ---------------------------------------------------------------------------

describe("projectQboCustomer — happy path", () => {
  it("maps every required field from state", () => {
    const r = projectQboCustomer(buildState());
    expect(r.displayName).toBe("Acme Co");
    expect(r.companyName).toBe("Acme Co");
    expect(r.contactName).toBe("Jane Doe");
    expect(r.primaryEmail).toBe("jane@acme.test");
    expect(r.primaryPhone).toBe("555-1212");
    expect(r.shippingAddress).toEqual(ADDR);
    expect(r.externalRef.source).toBe("wholesale-onboarding");
    expect(r.externalRef.flowId).toBe("wf_qbo_001");
  });

  it("payment terms default to 'Net 15' for accounts-payable path", () => {
    const r = projectQboCustomer(buildState({ paymentPath: "accounts-payable" }));
    expect(r.paymentTerms).toBe("Net 15");
  });

  it("payment terms 'Paid on order' for credit-card path", () => {
    const r = projectQboCustomer(buildState({ paymentPath: "credit-card" }));
    expect(r.paymentTerms).toBe("Paid on order");
  });

  it("payment terms default to 'Net 15' when paymentPath unset", () => {
    const r = projectQboCustomer(buildState({ paymentPath: undefined }));
    expect(r.paymentTerms).toBe("Net 15");
  });

  it("billingAddress falls back to shippingAddress when no separate billing", () => {
    const r = projectQboCustomer(buildState());
    expect(r.billingAddress).toEqual(ADDR);
  });

  it("billingAddress uses apInfo.billingAddress when present (separate billing)", () => {
    const billingAddr: ShippingAddress = {
      street1: "456 Billing Way",
      city: "Houston",
      state: "TX",
      postalCode: "77001",
      country: "US",
    };
    const r = projectQboCustomer(
      buildState({
        apInfo: { apEmail: "ap@acme.test", billingAddress: billingAddr },
      }),
    );
    expect(r.billingAddress).toEqual(billingAddr);
    expect(r.shippingAddress).toEqual(ADDR);
  });

  it("notes include storeType, paymentPath, AP email", () => {
    const r = projectQboCustomer(buildState());
    expect(r.notes).toContain("wf_qbo_001");
    expect(r.notes).toContain("specialty-retail");
    expect(r.notes).toContain("accounts-payable");
    expect(r.notes).toContain("ap@acme.test");
  });

  it("notes include taxId when self-fill captured one", () => {
    const r = projectQboCustomer(
      buildState({
        apInfo: { apContactName: "Bob AP", taxId: "12-3456789" },
      }),
    );
    expect(r.notes).toContain("12-3456789");
  });
});

describe("projectQboCustomer — defensive errors", () => {
  it("throws when prospect missing", () => {
    expect(() =>
      projectQboCustomer(buildState({ prospect: undefined })),
    ).toThrow(/prospect missing/);
  });

  it("throws when companyName empty", () => {
    expect(() =>
      projectQboCustomer(
        buildState({
          prospect: {
            companyName: "  ",
            contactName: "Jane",
            contactEmail: "x@y.com",
          },
        }),
      ),
    ).toThrow(/companyName required/);
  });

  it("throws when contactName empty", () => {
    expect(() =>
      projectQboCustomer(
        buildState({
          prospect: {
            companyName: "Acme",
            contactName: "",
            contactEmail: "x@y.com",
          },
        }),
      ),
    ).toThrow(/contactName required/);
  });

  it("throws when contactEmail empty", () => {
    expect(() =>
      projectQboCustomer(
        buildState({
          prospect: {
            companyName: "Acme",
            contactName: "Jane",
            contactEmail: "",
          },
        }),
      ),
    ).toThrow(/contactEmail required/);
  });

  it("throws when shippingAddress missing", () => {
    expect(() =>
      projectQboCustomer(buildState({ shippingAddress: undefined })),
    ).toThrow(/shippingAddress required/);
  });
});

// ---------------------------------------------------------------------------
// projectQboInvoice
// ---------------------------------------------------------------------------

describe("projectQboInvoice — happy path", () => {
  it("creates one line per OrderLineSummary", () => {
    const r = projectQboInvoice(
      buildState({
        orderLines: [
          summarizeOrderLine("B2", 3),
          summarizeOrderLine("B4", 1),
        ],
      }),
    );
    expect(r.lines.length).toBe(2);
    expect(r.lines[0].tier).toBe("B2");
    expect(r.lines[1].tier).toBe("B4");
    expect(r.lines[0].lineNumber).toBe(1);
    expect(r.lines[1].lineNumber).toBe(2);
  });

  it("description embeds clean prose (no B-tier prefix per Rene 2026-04-28) + unit count + bag total", () => {
    const r = projectQboInvoice(
      buildState({ orderLines: [summarizeOrderLine("B2", 3)] }),
    );
    // Description must NOT include the B-tier prefix (Rene's lock).
    expect(r.lines[0].description).not.toMatch(/^B2/);
    expect(r.lines[0].description).toContain("36-Bag Master Carton");
    expect(r.lines[0].description).toContain("Freight Included");
    expect(r.lines[0].description).toContain("3 master cartons");
    expect(r.lines[0].description).toContain("108 bags total");
  });

  it("description handles 1-unit (singular) correctly", () => {
    const r = projectQboInvoice(
      buildState({ orderLines: [summarizeOrderLine("B4", 1)] }),
    );
    expect(r.lines[0].description).toContain("1 pallet");
    expect(r.lines[0].description).not.toMatch(/1 pallets/); // no over-pluralization
  });

  it("subtotalUsd sums multi-line correctly", () => {
    const r = projectQboInvoice(
      buildState({
        orderLines: [
          summarizeOrderLine("B2", 2), // 72 × $3.49 = $251.28
          summarizeOrderLine("B4", 1), // 900 × $3.25 = $2925.00
        ],
      }),
    );
    expect(r.subtotalUsd).toBeCloseTo(3176.28, 2);
  });

  it("requiresCustomFreightQuote false for sub-3-pallet B4/B5 orders", () => {
    const r = projectQboInvoice(
      buildState({
        orderLines: [
          summarizeOrderLine("B2", 100), // master carton, never custom freight
          summarizeOrderLine("B4", 2), // 2 pallets, under threshold
        ],
      }),
    );
    expect(r.requiresCustomFreightQuote).toBe(false);
  });

  it("requiresCustomFreightQuote true when ANY line crosses 3+ pallet threshold", () => {
    const r = projectQboInvoice(
      buildState({
        orderLines: [
          summarizeOrderLine("B2", 5), // master carton
          summarizeOrderLine("B5", 4), // 4 pallets — custom freight
        ],
      }),
    );
    expect(r.requiresCustomFreightQuote).toBe(true);
    // The custom-freight-flagged line surfaces it for Rene.
    const customLine = r.lines.find((l) => l.customFreightOverride);
    expect(customLine?.tier).toBe("B5");
  });

  it("memo embeds flowId + customer + ship-to city,state", () => {
    const r = projectQboInvoice(buildState());
    expect(r.memo).toContain("wf_qbo_001");
    expect(r.memo).toContain("Acme Co");
    expect(r.memo).toContain("Austin, TX");
  });

  it("externalRef.flowId binds projection to the flow", () => {
    const r = projectQboInvoice(buildState());
    expect(r.externalRef.source).toBe("wholesale-onboarding");
    expect(r.externalRef.flowId).toBe("wf_qbo_001");
  });

  it("payment terms mirror the customer projection", () => {
    const r1 = projectQboInvoice(
      buildState({ paymentPath: "accounts-payable" }),
    );
    expect(r1.paymentTerms).toBe("Net 15");
    const r2 = projectQboInvoice(buildState({ paymentPath: "credit-card" }));
    expect(r2.paymentTerms).toBe("Paid on order");
  });
});

describe("projectQboInvoice — defensive errors", () => {
  it("throws when orderLines is empty", () => {
    expect(() => projectQboInvoice(buildState({ orderLines: [] }))).toThrow(
      /orderLines is empty/,
    );
  });
});

// ---------------------------------------------------------------------------
// formatInvoiceLineText
// ---------------------------------------------------------------------------

describe("formatInvoiceLineText", () => {
  it("formats B2 × 3 master cartons (clean prose, no tier prefix)", () => {
    const text = formatInvoiceLineText(summarizeOrderLine("B2", 3));
    expect(text).toMatch(/^All American Gummy Bears/);
    expect(text).not.toMatch(/^B2/);
    expect(text).toContain("3 master cartons");
    expect(text).toContain("108 bags total");
  });

  it("formats B4 × 1 pallet (singular)", () => {
    const text = formatInvoiceLineText(summarizeOrderLine("B4", 1));
    expect(text).toContain("1 pallet ");
    expect(text).toContain("900 bags total");
  });

  it("formats B5 × 5 pallets", () => {
    const text = formatInvoiceLineText(summarizeOrderLine("B5", 5));
    expect(text).toContain("5 pallets");
    expect(text).toContain("4500 bags total"); // 5 × 900
  });

  it("formats B3 × 2 master cartons", () => {
    const text = formatInvoiceLineText(summarizeOrderLine("B3", 2));
    expect(text).toContain("2 master cartons");
    expect(text).toContain("72 bags total"); // 2 × 36
  });
});

describe("__INTERNAL constants", () => {
  it("payment terms map matches Rene-call-recap §13 defaults", () => {
    expect(__INTERNAL.PAYMENT_TERMS_BY_PATH["accounts-payable"]).toBe("Net 15");
    expect(__INTERNAL.PAYMENT_TERMS_BY_PATH["credit-card"]).toBe("Paid on order");
  });
});
