/**
 * Shopify → OrderIntent normalizer tests.
 *
 * Pins the behavior that feeds the S-08 Sample Order Dispatch classifier.
 * Every skip/error path is explicit so Shopify doesn't retry orders
 * we've chosen to ignore.
 */
import { describe, expect, it } from "vitest";

import {
  normalizeShopifyOrder,
  type ShopifyOrderPayload,
} from "../shopify-order-to-intent";

function basePayload(
  overrides: Partial<ShopifyOrderPayload> = {},
): ShopifyOrderPayload {
  return {
    id: 5550123456,
    name: "#1200",
    email: "fan@example.com",
    total_price: "29.95",
    currency: "USD",
    financial_status: "paid",
    tags: "",
    shipping_address: {
      name: "Jane Fan",
      address1: "123 Main St",
      city: "Austin",
      province_code: "TX",
      zip: "78701",
      country_code: "US",
    },
    line_items: [
      {
        title: "All American Gummy Bears — 7.5 oz Bag",
        sku: "UG-AAGB-6CT",
        quantity: 2,
        grams: 213, // ≈ 7.5 oz × 2 = ~426g total
        requires_shipping: true,
      },
    ],
    ...overrides,
  };
}

describe("normalizeShopifyOrder — happy path", () => {
  it("produces a well-formed OrderIntent from a standard paid order", () => {
    const res = normalizeShopifyOrder(basePayload());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.intent.channel).toBe("shopify");
      expect(res.intent.sourceId).toBe("5550123456");
      expect(res.intent.orderNumber).toBe("#1200");
      expect(res.intent.valueUsd).toBeCloseTo(29.95);
      expect(res.intent.shipTo.state).toBe("TX");
      expect(res.intent.shipTo.postalCode).toBe("78701");
      expect(res.intent.weightLbs).toBeCloseTo((213 * 2) / 453.592, 2);
    }
  });

  it("splits comma-separated tags", () => {
    const res = normalizeShopifyOrder(
      basePayload({ tags: "vip, sample, purpose:sample" }),
    );
    if (res.ok) {
      expect(res.intent.tags).toEqual(["vip", "sample", "purpose:sample"]);
    }
  });

  it("preserves the note (classifier also scans it for sample markers)", () => {
    const res = normalizeShopifyOrder(
      basePayload({ note: "Please mark as sample shipment" }),
    );
    if (res.ok) {
      expect(res.intent.note).toBe("Please mark as sample shipment");
    }
  });

  it("falls back to customer.default_address when shipping_address is null", () => {
    const res = normalizeShopifyOrder(
      basePayload({
        shipping_address: null,
        customer: {
          default_address: {
            name: "Jane Fan",
            address1: "123 Main",
            city: "Austin",
            province_code: "TX",
            zip: "78701",
          },
        },
      }),
    );
    expect(res.ok).toBe(true);
  });
});

describe("normalizeShopifyOrder — skip paths", () => {
  it("skips cancelled orders", () => {
    const res = normalizeShopifyOrder(
      basePayload({ cancelled_at: "2026-04-20T12:00:00Z" }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok && "skipped" in res && res.skipped === true) {
      expect(res.reason).toMatch(/cancelled/i);
    }
  });

  it("skips refunded orders", () => {
    const res = normalizeShopifyOrder(
      basePayload({ financial_status: "refunded" }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok && "skipped" in res) expect(res.skipped).toBe(true);
  });

  it("skips voided orders", () => {
    const res = normalizeShopifyOrder(
      basePayload({ financial_status: "voided" }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok && "skipped" in res) expect(res.skipped).toBe(true);
  });

  it("skips digital-only orders (no shippable line items)", () => {
    const res = normalizeShopifyOrder(
      basePayload({
        line_items: [
          {
            title: "Digital gift card",
            quantity: 1,
            requires_shipping: false,
          },
        ],
      }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok && "skipped" in res && res.skipped === true) {
      expect(res.reason).toMatch(/digital|shippable/i);
    }
  });
});

describe("normalizeShopifyOrder — error paths", () => {
  it("errors when shipping address is missing critical fields", () => {
    const res = normalizeShopifyOrder(
      basePayload({
        shipping_address: {
          name: "Jane",
          // address1 missing
          city: "Austin",
          province_code: "TX",
          zip: "78701",
        },
      }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok && !("skipped" in res && res.skipped)) {
      expect((res as { error: string }).error).toMatch(/address/i);
    }
  });

  it("errors when province_code is missing", () => {
    const res = normalizeShopifyOrder(
      basePayload({
        shipping_address: {
          name: "Jane",
          address1: "123 Main",
          city: "Austin",
          zip: "78701",
        },
      }),
    );
    expect(res.ok).toBe(false);
  });
});

describe("normalizeShopifyOrder — weight handling", () => {
  it("leaves weightLbs undefined when no grams reported", () => {
    const res = normalizeShopifyOrder(
      basePayload({
        line_items: [
          { title: "Mystery item", quantity: 1, requires_shipping: true },
        ],
      }),
    );
    if (res.ok) {
      expect(res.intent.weightLbs).toBeUndefined();
    }
  });

  it("sums grams across multiple line items", () => {
    const res = normalizeShopifyOrder(
      basePayload({
        line_items: [
          { title: "Bag A", quantity: 1, grams: 200, requires_shipping: true },
          { title: "Bag B", quantity: 2, grams: 150, requires_shipping: true },
        ],
      }),
    );
    if (res.ok) {
      expect(res.intent.weightLbs).toBeCloseTo(
        (200 + 150 * 2) / 453.592,
        2,
      );
    }
  });
});
