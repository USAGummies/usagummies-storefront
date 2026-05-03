import { describe, expect, it } from "vitest";

import { composeReorderOfferDraft } from "../draft";

describe("composeReorderOfferDraft — Shopify DTC", () => {
  it("renders subject + body with greeting and 15% discount when code provided", () => {
    const r = composeReorderOfferDraft({
      channel: "shopify-dtc",
      buyerFirstName: "Vicki",
      displayName: "Vicki Williams",
      daysSinceLastOrder: 95,
      discountCode: "WELCOMEBACK15",
    });
    expect(r.subject).toContain("USA Gummies");
    expect(r.subject).toContain("15%");
    expect(r.body).toContain("Hi Vicki,");
    expect(r.body).toContain("95 days since your last order");
    expect(r.body).toContain("WELCOMEBACK15");
    expect(r.body).toContain("15% off");
    expect(r.body).toContain("https://www.usagummies.com/shop");
    expect(r.body).toContain("ben@usagummies.com");
    expect(r.template).toBe("reorder-offer:shopify-dtc");
  });

  it("renders without discount block when no code is provided", () => {
    const r = composeReorderOfferDraft({
      channel: "shopify-dtc",
      buyerFirstName: "Gary",
      displayName: "Gary Rabosky",
      daysSinceLastOrder: 91,
    });
    expect(r.body).toContain("Hi Gary,");
    expect(r.body).not.toContain("Use code");
    expect(r.body).toContain("https://www.usagummies.com/shop");
  });

  it("falls back to 'there' when buyerFirstName is absent", () => {
    const r = composeReorderOfferDraft({
      channel: "shopify-dtc",
      displayName: "Anonymous Buyer",
      daysSinceLastOrder: 95,
    });
    expect(r.body).toContain("Hi there,");
  });

  it("respects custom discountPct override", () => {
    const r = composeReorderOfferDraft({
      channel: "shopify-dtc",
      buyerFirstName: "Vicki",
      displayName: "Vicki Williams",
      daysSinceLastOrder: 95,
      discountCode: "SUMMER25",
      discountPct: 25,
    });
    expect(r.body).toContain("25% off");
    expect(r.body).toContain("SUMMER25");
  });
});

describe("composeReorderOfferDraft — Wholesale", () => {
  it("renders subject + body with no discount mention", () => {
    const r = composeReorderOfferDraft({
      channel: "wholesale",
      buyerFirstName: "Eric",
      displayName: "Red Dog Saloon",
      daysSinceLastOrder: 92,
    });
    expect(r.subject).toContain("USA Gummies");
    expect(r.subject).toContain("Red Dog Saloon");
    expect(r.body).toContain("Hi Eric,");
    expect(r.body).toContain("92 days");
    // No DTC code language in the wholesale variant.
    expect(r.body).not.toContain("Use code");
    expect(r.body).not.toContain("% off");
    expect(r.template).toBe("reorder-offer:wholesale");
  });

  it("includes a graceful 'not the right fit' off-ramp for wholesale", () => {
    const r = composeReorderOfferDraft({
      channel: "wholesale",
      buyerFirstName: "Eric",
      displayName: "Red Dog Saloon",
      daysSinceLastOrder: 95,
    });
    expect(r.body).toContain("not the right fit");
  });
});

describe("composeReorderOfferDraft — Amazon FBM", () => {
  it("returns a defensive fallback (caller should not route Amazon here)", () => {
    const r = composeReorderOfferDraft({
      channel: "amazon-fbm",
      buyerFirstName: "Test",
      displayName: "Amazon Buyer",
      daysSinceLastOrder: 65,
    });
    expect(r.template).toBe("reorder-offer:amazon-fbm-defensive");
    expect(r.body).toContain("amazon.com/dp/B0FFD2D29G");
  });
});
