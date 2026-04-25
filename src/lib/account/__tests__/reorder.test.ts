/**
 * Tests for the pure reorder helper.
 *
 * Locked contracts (every one is a bullet from the build spec):
 *   - All items mappable → all in `addable`, none in `skipped`.
 *   - Partial unavailable items → mappable ones in `addable`, others
 *     in `skipped` with the right reason.
 *   - No mappable items → `hasAnyAddable === false` (UI hides the
 *     button).
 *   - Duplicate quantities (same variant on two lines) sum into one
 *     addable entry.
 *   - The intent NEVER carries any historical price field. The output
 *     shape is `{ variantId, quantity, title }` only.
 *   - Skipped reasons are stable codes the UI maps to copy.
 */
import { describe, expect, it } from "vitest";

import { SINGLE_BAG_VARIANT_ID } from "@/lib/bundles/atomic";
import type { CustomerOrderShape } from "../display";
import {
  copyForSkipReason,
  intentFromOrder as buildIntent,
} from "../reorder";

function order(
  lines: CustomerOrderShape["lineItems"],
  overrides: Partial<CustomerOrderShape> = {},
): CustomerOrderShape {
  return {
    id: "gid://shopify/Order/1",
    orderNumber: 1001,
    processedAt: "2026-04-01T00:00:00Z",
    financialStatus: "PAID",
    fulfillmentStatus: "FULFILLED",
    currentTotalPrice: { amount: "24.99", currencyCode: "USD" },
    lineItems: lines,
    ...overrides,
  };
}

const SINGLE_BAG_AVAILABLE = {
  id: SINGLE_BAG_VARIANT_ID,
  sku: "199284624702",
  availableForSale: true,
};
const SINGLE_BAG_SOLD_OUT = {
  ...SINGLE_BAG_AVAILABLE,
  availableForSale: false,
};

describe("intentFromOrder — happy path", () => {
  it("all items mappable → every line in addable, nothing skipped", () => {
    const intent = buildIntent(
      order([
        {
          title: "All American Gummy Bears",
          quantity: 2,
          variant: SINGLE_BAG_AVAILABLE,
        },
      ]),
    );
    expect(intent.hasAnyAddable).toBe(true);
    expect(intent.addable).toHaveLength(1);
    expect(intent.addable[0]).toEqual({
      variantId: SINGLE_BAG_VARIANT_ID,
      quantity: 2,
      title: "All American Gummy Bears",
    });
    expect(intent.skipped).toHaveLength(0);
  });
});

describe("intentFromOrder — partial unavailable", () => {
  it("mixes addable + skipped with stable reason codes", () => {
    const intent = buildIntent(
      order([
        {
          title: "All American Gummy Bears",
          quantity: 1,
          variant: SINGLE_BAG_AVAILABLE,
        },
        {
          title: "Limited Edition Star-Spangled Tin",
          quantity: 1,
          variant: {
            id: "gid://shopify/ProductVariant/9999999",
            sku: "TIN-001",
            availableForSale: true,
          },
        },
        {
          title: "Sold-out Halloween Mix",
          quantity: 3,
          variant: {
            id: SINGLE_BAG_VARIANT_ID,
            sku: "199284624702",
            availableForSale: false,
          },
        },
        {
          title: "Deleted product",
          quantity: 1,
          variant: null,
        },
      ]),
    );
    expect(intent.hasAnyAddable).toBe(true);
    expect(intent.addable).toHaveLength(1);
    expect(intent.addable[0].variantId).toBe(SINGLE_BAG_VARIANT_ID);
    expect(intent.addable[0].quantity).toBe(1);
    const reasons = intent.skipped.map((s) => s.reason).sort();
    expect(reasons).toEqual([
      "different_product",
      "no_variant_resolved",
      "out_of_stock",
    ]);
    for (const item of intent.skipped) {
      expect(copyForSkipReason(item.reason)).toBeTruthy();
    }
  });
});

describe("intentFromOrder — no mappable items", () => {
  it("hasAnyAddable is false → UI hides the button", () => {
    const intent = buildIntent(
      order([
        {
          title: "Custom corporate gift box",
          quantity: 1,
          variant: {
            id: "gid://shopify/ProductVariant/CUSTOM-1",
            sku: "GIFT-CORP-1",
            availableForSale: true,
          },
        },
        {
          title: "Retired flavor pack",
          quantity: 2,
          variant: null,
        },
      ]),
    );
    expect(intent.hasAnyAddable).toBe(false);
    expect(intent.addable).toHaveLength(0);
    expect(intent.skipped).toHaveLength(2);
  });

  it("empty order → empty intent", () => {
    const intent = buildIntent(order([]));
    expect(intent.hasAnyAddable).toBe(false);
    expect(intent.addable).toHaveLength(0);
    expect(intent.skipped).toHaveLength(0);
  });
});

describe("intentFromOrder — duplicate quantities", () => {
  it("two lines with the same variant → single addable with summed qty", () => {
    const intent = buildIntent(
      order([
        {
          title: "All American Gummy Bears",
          quantity: 2,
          variant: SINGLE_BAG_AVAILABLE,
        },
        {
          title: "All American Gummy Bears",
          quantity: 3,
          variant: SINGLE_BAG_AVAILABLE,
        },
      ]),
    );
    expect(intent.addable).toHaveLength(1);
    expect(intent.addable[0].quantity).toBe(5);
  });

  it("zero quantity collapses to no addable", () => {
    const intent = buildIntent(
      order([
        {
          title: "Bears",
          quantity: 0,
          variant: SINGLE_BAG_AVAILABLE,
        },
      ]),
    );
    expect(intent.hasAnyAddable).toBe(false);
    expect(intent.addable).toHaveLength(0);
  });
});

describe("intentFromOrder — never reuses historical prices", () => {
  it("output shape contains only variantId/quantity/title — no price field anywhere", () => {
    const intent = buildIntent(
      order(
        [
          {
            title: "Bears",
            quantity: 2,
            variant: SINGLE_BAG_AVAILABLE,
          },
        ],
        {
          currentTotalPrice: { amount: "999.99", currencyCode: "USD" },
        },
      ),
    );
    const serialized = JSON.stringify(intent);
    expect(serialized).not.toContain("999.99");
    expect(serialized).not.toContain("price");
    expect(serialized).not.toContain("currencyCode");
    expect(serialized).not.toContain("amount");
    for (const item of intent.addable) {
      expect(Object.keys(item).sort()).toEqual([
        "quantity",
        "title",
        "variantId",
      ]);
    }
  });
});

describe("intentFromOrder — out-of-stock single-bag is skipped, not added", () => {
  it("out-of-stock single bag → skipped with reason=out_of_stock", () => {
    const intent = buildIntent(
      order([
        {
          title: "Bears (sold out)",
          quantity: 1,
          variant: SINGLE_BAG_SOLD_OUT,
        },
      ]),
    );
    expect(intent.addable).toHaveLength(0);
    expect(intent.skipped).toHaveLength(1);
    expect(intent.skipped[0].reason).toBe("out_of_stock");
  });
});

describe("copyForSkipReason returns stable customer-facing strings", () => {
  it("each reason maps to a non-empty label", () => {
    expect(copyForSkipReason("no_variant_resolved")).toMatch(/no longer/);
    expect(copyForSkipReason("variant_not_purchasable")).toMatch(/reorderable/);
    expect(copyForSkipReason("different_product")).toMatch(/reorderable/);
    expect(copyForSkipReason("out_of_stock")).toMatch(/out of stock/);
  });
});
