/**
 * HubSpot deal → OrderIntent normalizer tests.
 */
import { describe, expect, it } from "vitest";

import { HUBSPOT, type DealWithContact } from "../hubspot-client";
import { normalizeHubSpotDeal } from "../hubspot-deal-to-intent";

function baseDeal(overrides: Partial<DealWithContact> = {}): DealWithContact {
  return {
    dealId: "hs-99001",
    dealname: "Inderbitzin Wholesale Q2",
    dealstage: HUBSPOT.STAGE_PO_RECEIVED,
    amount: 1512,
    closedate: "2026-04-25",
    description: null,
    wholesale_payment_method: "invoice_me",
    wholesale_onboarding_complete: "true",
    wholesale_payment_received: "false",
    contactId: "hs-c-7001",
    contact: {
      firstname: "Brent",
      lastname: "Overman",
      email: "brent@inderbitzin.com",
      phone: "2535551234",
      company: "Inderbitzin Distributors",
      address: "8810 Canyon Rd E",
      address2: null,
      city: "Puyallup",
      state: "WA",
      zip: "98371",
      country: "US",
    },
    ...overrides,
  };
}

describe("normalizeHubSpotDeal — stage gate", () => {
  it("accepts PO Received", () => {
    const res = normalizeHubSpotDeal(baseDeal());
    expect(res.ok).toBe(true);
  });

  it("accepts Closed Won", () => {
    const res = normalizeHubSpotDeal(
      baseDeal({ dealstage: HUBSPOT.STAGE_CLOSED_WON }),
    );
    expect(res.ok).toBe(true);
  });

  it("skips Lead stage", () => {
    const res = normalizeHubSpotDeal(
      baseDeal({ dealstage: HUBSPOT.STAGE_LEAD }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok && "skipped" in res && res.skipped === true) {
      expect(res.reason).toMatch(/dealstage/i);
    }
  });

  it("skips Shipped stage (already dispatched)", () => {
    const res = normalizeHubSpotDeal(
      baseDeal({ dealstage: HUBSPOT.STAGE_SHIPPED }),
    );
    expect(res.ok).toBe(false);
  });
});

describe("normalizeHubSpotDeal — payment gate", () => {
  it("holds pay-now deals with payment_received=false", () => {
    const res = normalizeHubSpotDeal(
      baseDeal({
        wholesale_payment_method: "pay_now",
        wholesale_payment_received: "false",
      }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok && "skipped" in res && res.skipped === true) {
      expect(res.reason).toMatch(/pay-now|payment/i);
    }
  });

  it("releases pay-now deals when payment_received=true", () => {
    const res = normalizeHubSpotDeal(
      baseDeal({
        wholesale_payment_method: "pay_now",
        wholesale_payment_received: "true",
      }),
    );
    expect(res.ok).toBe(true);
  });

  it("releases invoice_me deals regardless of payment_received", () => {
    const res = normalizeHubSpotDeal(
      baseDeal({
        wholesale_payment_method: "invoice_me",
        wholesale_payment_received: "false",
      }),
    );
    expect(res.ok).toBe(true);
  });
});

describe("normalizeHubSpotDeal — ship-to resolution", () => {
  it("errors when contact is null", () => {
    const res = normalizeHubSpotDeal(baseDeal({ contact: null }));
    expect(res.ok).toBe(false);
    if (!res.ok && !(("skipped" in res) && res.skipped === true)) {
      expect((res as { error: string }).error).toMatch(/contact/i);
    }
  });

  it("errors when contact is missing address", () => {
    const res = normalizeHubSpotDeal(
      baseDeal({
        contact: {
          firstname: "A",
          lastname: "B",
          email: null,
          phone: null,
          company: null,
          address: null,
          address2: null,
          city: "X",
          state: "CA",
          zip: "90210",
          country: null,
        },
      }),
    );
    expect(res.ok).toBe(false);
  });

  it("builds intent with wholesale residential=false + master_carton default", () => {
    const res = normalizeHubSpotDeal(baseDeal());
    if (res.ok) {
      expect(res.intent.channel).toBe("hubspot");
      expect(res.intent.shipTo.residential).toBe(false);
      expect(res.intent.packagingType).toBe("master_carton");
    }
  });

  it("uses contact company on the shipTo", () => {
    const res = normalizeHubSpotDeal(baseDeal());
    if (res.ok) {
      expect(res.intent.shipTo.company).toBe("Inderbitzin Distributors");
    }
  });

  it("passes hubspotDealId into intent.hubspot", () => {
    const res = normalizeHubSpotDeal(baseDeal());
    if (res.ok) {
      expect(res.intent.hubspot?.dealId).toBe("hs-99001");
    }
  });
});

describe("normalizeHubSpotDeal — sample tag sniffing", () => {
  it("adds 'sample' tag when description mentions sample", () => {
    const res = normalizeHubSpotDeal(
      baseDeal({ description: "Needs a sample pack first before PO" }),
    );
    if (res.ok) {
      expect(res.intent.tags).toContain("sample");
    }
  });

  it("adds 'sample' tag when dealname mentions sample", () => {
    const res = normalizeHubSpotDeal(
      baseDeal({ dealname: "Sample kit for Reunion 2026 retailer" }),
    );
    if (res.ok) {
      expect(res.intent.tags).toContain("sample");
    }
  });

  it("leaves tags empty when no sample markers", () => {
    const res = normalizeHubSpotDeal(baseDeal());
    if (res.ok) {
      expect(res.intent.tags).toEqual([]);
    }
  });
});
