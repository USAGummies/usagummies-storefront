/**
 * Unit tests for the customer-account display helpers.
 *
 * Every helper is pure. These tests pin the no-fabrication contract:
 *   - missing data → "—" or honest fallback, never a fabricated zero
 *   - unknown Shopify enums surface as lowercased + spaced raw values,
 *     not a generic "Unknown"
 *   - greeting always returns a non-empty string
 *   - shouldQueryB2BStatus skips the obvious DTC domains and
 *     returns false on malformed input
 */
import { describe, expect, it } from "vitest";

import {
  formatFinancialStatus,
  formatFulfillmentStatus,
  formatOrderDate,
  formatOrderTotal,
  greetingFor,
  shouldQueryB2BStatus,
} from "../display";

describe("formatOrderDate", () => {
  it("formats valid ISO timestamps", () => {
    expect(formatOrderDate("2026-04-24T12:00:00Z")).toBe("Apr 24, 2026");
  });
  it("returns '—' for missing / invalid input (no fabrication)", () => {
    expect(formatOrderDate(null)).toBe("—");
    expect(formatOrderDate(undefined)).toBe("—");
    expect(formatOrderDate("")).toBe("—");
    expect(formatOrderDate("not-a-date")).toBe("—");
  });
});

describe("formatOrderTotal", () => {
  it("formats USD by default", () => {
    expect(formatOrderTotal({ amount: "24.99", currencyCode: "USD" })).toBe(
      "$24.99",
    );
  });
  it("respects non-USD currency codes", () => {
    expect(formatOrderTotal({ amount: "10", currencyCode: "EUR" })).toMatch(
      /€10\.00/,
    );
  });
  it("falls back to USD when currencyCode is missing", () => {
    expect(formatOrderTotal({ amount: "5", currencyCode: "" })).toBe("$5.00");
  });
  it("returns '—' on missing / unparseable", () => {
    expect(formatOrderTotal(null)).toBe("—");
    expect(
      formatOrderTotal({ amount: "", currencyCode: "USD" }),
    ).toBe("—");
    expect(
      formatOrderTotal({ amount: "garbage", currencyCode: "USD" }),
    ).toBe("—");
  });
});

describe("formatFinancialStatus", () => {
  it("maps known enums to friendly labels", () => {
    expect(formatFinancialStatus("PAID")).toBe("Paid");
    expect(formatFinancialStatus("PARTIALLY_REFUNDED")).toBe(
      "Partially refunded",
    );
    expect(formatFinancialStatus("VOIDED")).toBe("Voided");
  });
  it("'—' for empty / null / undefined", () => {
    expect(formatFinancialStatus(null)).toBe("—");
    expect(formatFinancialStatus(undefined)).toBe("—");
    expect(formatFinancialStatus("")).toBe("—");
  });
  it("unknown enum surfaces honestly (lowercased + spaces)", () => {
    expect(formatFinancialStatus("FUTURE_CHARGE_TYPE")).toBe(
      "future charge type",
    );
  });
});

describe("formatFulfillmentStatus", () => {
  it("FULFILLED → Fulfilled", () => {
    expect(formatFulfillmentStatus("FULFILLED")).toBe("Fulfilled");
  });
  it("missing/null/empty → 'Unfulfilled' (the customer-facing default)", () => {
    expect(formatFulfillmentStatus(null)).toBe("Unfulfilled");
    expect(formatFulfillmentStatus("")).toBe("Unfulfilled");
    expect(formatFulfillmentStatus("UNFULFILLED")).toBe("Unfulfilled");
  });
  it("PARTIAL → 'Partially fulfilled'", () => {
    expect(formatFulfillmentStatus("PARTIAL")).toBe("Partially fulfilled");
  });
});

describe("greetingFor", () => {
  it("uses first + last when both set", () => {
    expect(
      greetingFor({ firstName: "Sarah", lastName: "Smith", email: null }),
    ).toBe("Hi, Sarah Smith.");
  });
  it("uses first only when last is missing", () => {
    expect(
      greetingFor({ firstName: "Sarah", lastName: null, email: "x@y.com" }),
    ).toBe("Hi, Sarah.");
  });
  it("falls back to email when no name fields", () => {
    expect(
      greetingFor({ firstName: null, lastName: null, email: "x@y.com" }),
    ).toBe("Hi, x@y.com.");
  });
  it("never returns empty — final fallback is 'Hi.'", () => {
    expect(
      greetingFor({ firstName: null, lastName: null, email: null }),
    ).toBe("Hi.");
    expect(
      greetingFor({ firstName: "  ", lastName: "  ", email: "" }),
    ).toBe("Hi.");
  });
});

describe("shouldQueryB2BStatus", () => {
  it("returns true for plausible business domains", () => {
    expect(shouldQueryB2BStatus("ap@wholefoods.com")).toBe(true);
    expect(shouldQueryB2BStatus("buyer@junglejims.com")).toBe(true);
    expect(shouldQueryB2BStatus("rene@usagummies.com")).toBe(true);
  });
  it("returns false for common consumer mailboxes (DTC noise filter)", () => {
    expect(shouldQueryB2BStatus("shopper@gmail.com")).toBe(false);
    expect(shouldQueryB2BStatus("user@yahoo.com")).toBe(false);
    expect(shouldQueryB2BStatus("user@icloud.com")).toBe(false);
    expect(shouldQueryB2BStatus("user@outlook.com")).toBe(false);
  });
  it("returns false for missing / malformed input", () => {
    expect(shouldQueryB2BStatus(null)).toBe(false);
    expect(shouldQueryB2BStatus(undefined)).toBe(false);
    expect(shouldQueryB2BStatus("")).toBe(false);
    expect(shouldQueryB2BStatus("not-an-email")).toBe(false);
    expect(shouldQueryB2BStatus("a@b")).toBe(false);
  });
});
