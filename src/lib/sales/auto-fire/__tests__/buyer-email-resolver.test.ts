/**
 * Tests for the buyer-email resolver. External clients are mocked so
 * the resolver's branches (valid email, missing email, malformed
 * email, missing record) all exercise without network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock HubSpot deal-with-contact lookup.
const mockGetDealWithContact = vi.fn();
vi.mock("@/lib/ops/hubspot-client", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/ops/hubspot-client")
  >("@/lib/ops/hubspot-client");
  return {
    ...actual,
    getDealWithContact: (id: string) => mockGetDealWithContact(id),
  };
});

// Mock Shopify customers list.
const mockListShopify = vi.fn();
vi.mock("@/lib/shopify/customers-with-last-order", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/shopify/customers-with-last-order")
  >("@/lib/shopify/customers-with-last-order");
  return {
    ...actual,
    listShopifyCustomersWithLastOrder: () => mockListShopify(),
  };
});

// Mock onboarding-store loadOnboardingState.
const mockLoadOnboarding = vi.fn();
vi.mock("@/lib/wholesale/onboarding-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/wholesale/onboarding-store")
  >("@/lib/wholesale/onboarding-store");
  return {
    ...actual,
    loadOnboardingState: (id: string) => mockLoadOnboarding(id),
  };
});

import {
  loadShopifyCustomerLookup,
  resolveHubSpotDealBuyer,
  resolveOnboardingFlowBuyer,
  resolveShopifyCustomerBuyer,
} from "../buyer-email-resolver";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveHubSpotDealBuyer", () => {
  it("returns email + firstName + dealname displayName for a healthy deal", async () => {
    mockGetDealWithContact.mockResolvedValueOnce({
      dealId: "d1",
      dealname: "USA Gummies — Old Mill Gift Shop",
      contactId: "c1",
      contact: {
        firstname: "Kelly",
        lastname: "Cross",
        email: "kelly@oldmill.example",
        phone: null,
        company: "Old Mill Gift Shop",
        address: null,
        address2: null,
        city: null,
        state: null,
        zip: null,
        country: null,
      },
    });
    const r = await resolveHubSpotDealBuyer("d1");
    expect(r).not.toBeNull();
    expect(r?.email).toBe("kelly@oldmill.example");
    expect(r?.firstName).toBe("Kelly");
    expect(r?.displayName).toBe("USA Gummies — Old Mill Gift Shop");
  });

  it("falls back to company when dealname is empty", async () => {
    mockGetDealWithContact.mockResolvedValueOnce({
      dealId: "d2",
      dealname: "",
      contactId: "c2",
      contact: {
        firstname: "Eric",
        email: "eric@reddog.example",
        company: "Red Dog Saloon",
      },
    });
    const r = await resolveHubSpotDealBuyer("d2");
    expect(r?.displayName).toBe("Red Dog Saloon");
  });

  it("returns null when deal not found", async () => {
    mockGetDealWithContact.mockResolvedValueOnce(null);
    const r = await resolveHubSpotDealBuyer("missing");
    expect(r).toBeNull();
  });

  it("returns null when contact is missing", async () => {
    mockGetDealWithContact.mockResolvedValueOnce({
      dealId: "d3",
      dealname: "X",
      contactId: null,
      contact: null,
    });
    expect(await resolveHubSpotDealBuyer("d3")).toBeNull();
  });

  it("returns null when email is missing or malformed", async () => {
    for (const badEmail of [null, "", "  ", "no-at-sign", "missing@dot"]) {
      mockGetDealWithContact.mockResolvedValueOnce({
        dealId: "d-bad",
        dealname: "X",
        contactId: "c",
        contact: { firstname: "A", email: badEmail, company: "Co" },
      });
      const r = await resolveHubSpotDealBuyer("d-bad");
      expect(r).toBeNull();
    }
  });
});

describe("resolveShopifyCustomerBuyer", () => {
  function buildLookup() {
    const lookup = new Map();
    const cust = {
      id: "gid://shopify/Customer/123",
      numericId: "123",
      email: "vicki@example.com",
      firstName: "Vicki",
      lastName: "Williams",
      phone: null,
      lastOrderAt: "2026-02-01T00:00:00Z",
      ordersCount: 1,
      totalSpentUsd: 51,
      customerCreatedAt: "2026-01-01T00:00:00Z",
    };
    lookup.set(cust.id, cust);
    lookup.set(cust.numericId, cust);
    return lookup;
  }

  it("resolves a customer by gid", () => {
    const lookup = buildLookup();
    const r = resolveShopifyCustomerBuyer(
      "gid://shopify/Customer/123",
      lookup,
    );
    expect(r?.email).toBe("vicki@example.com");
    expect(r?.firstName).toBe("Vicki");
    expect(r?.displayName).toBe("Vicki Williams");
  });

  it("resolves the same customer by numeric id", () => {
    const lookup = buildLookup();
    const r = resolveShopifyCustomerBuyer("123", lookup);
    expect(r?.email).toBe("vicki@example.com");
  });

  it("returns null when not in lookup", () => {
    expect(resolveShopifyCustomerBuyer("missing", new Map())).toBeNull();
  });

  it("returns null on missing email even when found", () => {
    const lookup = new Map();
    lookup.set("gid://shopify/Customer/9", {
      id: "gid://shopify/Customer/9",
      numericId: "9",
      email: null,
      firstName: "X",
      lastName: null,
      phone: null,
      lastOrderAt: null,
      ordersCount: 0,
      totalSpentUsd: 0,
      customerCreatedAt: null,
    });
    expect(
      resolveShopifyCustomerBuyer("gid://shopify/Customer/9", lookup),
    ).toBeNull();
  });

  it("loadShopifyCustomerLookup populates by gid + numeric id", async () => {
    mockListShopify.mockResolvedValueOnce([
      {
        id: "gid://shopify/Customer/123",
        numericId: "123",
        email: "vicki@example.com",
        firstName: "Vicki",
        lastName: "Williams",
        phone: null,
        lastOrderAt: "2026-02-01T00:00:00Z",
        ordersCount: 1,
        totalSpentUsd: 51,
        customerCreatedAt: null,
      },
    ]);
    const lookup = await loadShopifyCustomerLookup();
    expect(lookup.get("gid://shopify/Customer/123")?.email).toBe(
      "vicki@example.com",
    );
    expect(lookup.get("123")?.email).toBe("vicki@example.com");
  });
});

describe("resolveOnboardingFlowBuyer", () => {
  it("resolves a healthy onboarding flow", async () => {
    mockLoadOnboarding.mockResolvedValueOnce({
      flowId: "wp_t",
      currentStep: "store-type",
      timestamps: {},
      prospect: {
        companyName: "Thanksgiving Point",
        contactName: "Mike Hippler",
        contactEmail: "mike@thanksgivingpoint.org",
      },
    });
    const r = await resolveOnboardingFlowBuyer("wp_t");
    expect(r?.email).toBe("mike@thanksgivingpoint.org");
    expect(r?.firstName).toBe("Mike");
    expect(r?.displayName).toBe("Thanksgiving Point");
  });

  it("returns null when flow is missing", async () => {
    mockLoadOnboarding.mockResolvedValueOnce(null);
    expect(await resolveOnboardingFlowBuyer("missing")).toBeNull();
  });

  it("returns null when prospect block is unpopulated", async () => {
    mockLoadOnboarding.mockResolvedValueOnce({
      flowId: "wp_t",
      currentStep: "info",
      timestamps: {},
      prospect: undefined,
    });
    expect(await resolveOnboardingFlowBuyer("wp_t")).toBeNull();
  });

  it("falls back to contactName when companyName is empty", async () => {
    mockLoadOnboarding.mockResolvedValueOnce({
      flowId: "wp_t",
      currentStep: "info",
      timestamps: {},
      prospect: {
        companyName: "",
        contactName: "Solo Buyer",
        contactEmail: "solo@example.com",
      },
    });
    const r = await resolveOnboardingFlowBuyer("wp_t");
    expect(r?.displayName).toBe("Solo Buyer");
  });
});
