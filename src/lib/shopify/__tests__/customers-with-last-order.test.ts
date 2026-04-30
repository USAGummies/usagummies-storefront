import { describe, expect, it } from "vitest";

import {
  __internal,
  numericIdFromGid,
} from "@/lib/shopify/customers-with-last-order";

describe("numericIdFromGid", () => {
  it("extracts numeric id from a customer gid", () => {
    expect(numericIdFromGid("gid://shopify/Customer/12345")).toBe("12345");
  });

  it("returns the original string when the format doesn't match", () => {
    expect(numericIdFromGid("not-a-gid")).toBe("not-a-gid");
  });

  it("handles long numeric ids", () => {
    expect(numericIdFromGid("gid://shopify/Customer/99999999999")).toBe("99999999999");
  });
});

describe("projectNode — pure projection", () => {
  it("projects a populated node with lastOrder + amountSpent", () => {
    const r = __internal.projectNode({
      id: "gid://shopify/Customer/100",
      email: "buyer@example.com",
      firstName: "Sarah",
      lastName: "McGowan",
      phone: "+15551234567",
      numberOfOrders: "3",
      createdAt: "2025-12-01T00:00:00Z",
      amountSpent: { amount: "82.50", currencyCode: "USD" },
      lastOrder: {
        id: "gid://shopify/Order/4444",
        createdAt: "2026-01-15T15:00:00Z",
      },
    });
    expect(r).not.toBeNull();
    expect(r!.id).toBe("gid://shopify/Customer/100");
    expect(r!.numericId).toBe("100");
    expect(r!.email).toBe("buyer@example.com");
    expect(r!.firstName).toBe("Sarah");
    expect(r!.lastName).toBe("McGowan");
    expect(r!.phone).toBe("+15551234567");
    expect(r!.lastOrderAt).toBe("2026-01-15T15:00:00Z");
    expect(r!.ordersCount).toBe(3);
    expect(r!.totalSpentUsd).toBe(82.5);
    expect(r!.customerCreatedAt).toBe("2025-12-01T00:00:00Z");
  });

  it("returns null when id is missing (defense in depth)", () => {
    expect(__internal.projectNode({ email: "x@y.com" })).toBeNull();
  });

  it("treats missing/null lastOrder as lastOrderAt=null (browse-only customer)", () => {
    const r = __internal.projectNode({
      id: "gid://shopify/Customer/200",
      email: "browser@example.com",
      numberOfOrders: "0",
      lastOrder: null,
    });
    expect(r!.lastOrderAt).toBeNull();
    expect(r!.ordersCount).toBe(0);
  });

  it("treats missing amountSpent as totalSpentUsd=null (no fabrication)", () => {
    const r = __internal.projectNode({
      id: "gid://shopify/Customer/300",
      numberOfOrders: "1",
      amountSpent: null,
    });
    expect(r!.totalSpentUsd).toBeNull();
  });

  it("handles non-numeric numberOfOrders gracefully (edge case)", () => {
    const r = __internal.projectNode({
      id: "gid://shopify/Customer/400",
      numberOfOrders: "not-a-number",
    });
    expect(r!.ordersCount).toBe(0);
  });
});
