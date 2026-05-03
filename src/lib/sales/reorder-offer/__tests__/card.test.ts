import { describe, expect, it } from "vitest";

import { renderReorderOfferCard } from "../card";

const baseInput = {
  channel: "shopify-dtc" as const,
  candidateId: "shopify-customer:123",
  displayName: "Vicki Williams",
  buyerEmail: "vicki@example.com",
  daysSinceLastOrder: 95,
  windowDays: 90,
  subject: "USA Gummies — quick check-in (and 15% off if you'd like a refill)",
  body: "Hi Vicki,\n\nIt's been about 95 days since your last order — we wanted to check in.\n\nUse code WELCOMEBACK15 at checkout for 15% off your next order. Good for 14 days.\nShop: https://www.usagummies.com/shop\n\nBest,\nBen",
  template: "reorder-offer:shopify-dtc",
};

describe("renderReorderOfferCard", () => {
  it("includes channel label, buyer, days, window, subject", () => {
    const card = renderReorderOfferCard(baseInput);
    expect(card).toContain("Reorder offer — Shopify DTC");
    expect(card).toContain("Vicki Williams");
    expect(card).toContain("vicki@example.com");
    expect(card).toContain("95 (window: 90d)");
    expect(card).toContain("USA Gummies — quick check-in");
  });

  it("renders discount code when provided", () => {
    const card = renderReorderOfferCard({
      ...baseInput,
      discountCode: "WELCOMEBACK15",
    });
    expect(card).toContain("Discount code:");
    expect(card).toContain("WELCOMEBACK15");
  });

  it("omits discount code line when absent", () => {
    const card = renderReorderOfferCard({ ...baseInput });
    expect(card).not.toContain("Discount code:");
  });

  it("renders body preview in a code block", () => {
    const card = renderReorderOfferCard(baseInput);
    expect(card).toContain("Body preview:");
    expect(card).toContain("```");
    expect(card).toContain("Hi Vicki,");
  });

  it("truncates long bodies with ellipsis", () => {
    const long = "A".repeat(500);
    const card = renderReorderOfferCard({ ...baseInput, body: long });
    expect(card).toContain("…");
  });

  it("renders sources as Slack links when url present", () => {
    const card = renderReorderOfferCard({
      ...baseInput,
      sources: [
        {
          system: "shopify-admin:customer",
          id: "123",
          url: "https://shop.example/admin/customers/123",
        },
      ],
    });
    expect(card).toContain(
      "<https://shop.example/admin/customers/123|123>",
    );
  });

  it("renders the Class B gmail.send footer", () => {
    const card = renderReorderOfferCard(baseInput);
    expect(card).toContain("Class B `gmail.send`");
    expect(card).toContain("ops-approvals");
    expect(card).toContain("HubSpot");
  });

  it("escapes backticks in subject + body", () => {
    const card = renderReorderOfferCard({
      ...baseInput,
      subject: "Subject with `backticks` in it",
    });
    expect(card).not.toContain("Subject with `backticks` in it");
    expect(card).toContain("Subject with ʹbackticksʹ in it");
  });

  it("renders wholesale channel label correctly", () => {
    const card = renderReorderOfferCard({
      ...baseInput,
      channel: "wholesale",
      displayName: "Red Dog Saloon",
      subject: "USA Gummies — checking in on a reorder for Red Dog Saloon",
    });
    expect(card).toContain("Reorder offer — Wholesale");
    expect(card).toContain("Red Dog Saloon");
  });
});
