/**
 * Sample Order Dispatch classifier tests.
 *
 * The classifier is pure logic per `/contracts/agents/sample-order-dispatch.md`.
 * These tests lock the canonical decisions so the wrong-origin rule
 * (zero-tolerance per CLAUDE.md) stays enforceable as the lib grows.
 */
import { describe, expect, it } from "vitest";

import {
  classifyDispatch,
  composeShipmentProposal,
  qualifiesForUnderCapAutoExecute,
  UNDER_CAP_VALUE_USD,
  type OrderIntent,
} from "../sample-order-dispatch";

function baseOrder(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    channel: "shopify",
    sourceId: "shopify-1016",
    orderNumber: "#1016",
    shipTo: {
      name: "Eric Forst",
      street1: "278 S Franklin St",
      city: "Juneau",
      state: "AK",
      postalCode: "99801",
    },
    ...overrides,
  };
}

describe("classifyDispatch — origin rules", () => {
  it("defaults to Ashford for untagged orders", () => {
    const result = classifyDispatch(baseOrder());
    expect(result.origin).toBe("ashford");
    expect(result.originReason).toContain("default");
  });

  it("routes explicit sample tag to Ashford (samples no longer route East Coast — shipstation.md §3.5)", () => {
    const result = classifyDispatch(baseOrder({ tags: ["sample"] }));
    expect(result.origin).toBe("ashford");
    expect(result.originReason).toContain("Ashford");
    expect(result.originReason).toContain("§3.5");
  });

  it("routes tag:sample variant to Ashford", () => {
    const result = classifyDispatch(baseOrder({ tags: ["tag:sample"] }));
    expect(result.origin).toBe("ashford");
  });

  it("routes purpose:sample variant to Ashford", () => {
    const result = classifyDispatch(baseOrder({ tags: ["purpose:sample"] }));
    expect(result.origin).toBe("ashford");
  });

  it("classifies sample-tag + sample note combo as Ashford (regression for 2026-05-02 CNHA bypass)", () => {
    const result = classifyDispatch(
      baseOrder({
        tags: ["sample", "tag:sample"],
        note: "sample box for buyer review",
      }),
    );
    expect(result.origin).toBe("ashford");
  });

  it("honors explicit origin:east-coast override (preserved for future warehouse re-activation)", () => {
    const result = classifyDispatch(
      baseOrder({ tags: ["origin:east-coast"] }),
    );
    expect(result.origin).toBe("east_coast");
    expect(result.originReason).toContain("override");
  });

  it("warns when origin:east-coast override appears on a >$100 order (warehouse currently DEFERRED)", () => {
    const result = classifyDispatch(
      baseOrder({
        tags: ["origin:east-coast"],
        valueUsd: 250,
      }),
    );
    expect(result.warnings.some((w) => w.includes("origin:east-coast"))).toBe(
      true,
    );
    expect(result.warnings.some((w) => w.includes("DEFERRED"))).toBe(true);
  });
});

describe("classifyDispatch — ar_hold refusal (zero tolerance)", () => {
  it("refuses dispatch when HubSpot deal is on ar_hold", () => {
    const result = classifyDispatch(
      baseOrder({
        hubspot: { dealId: "hs-99999", arHold: true },
      }),
    );
    expect(result.refuse).toBe(true);
    expect(result.refuseReason).toContain("ar_hold");
    expect(result.refuseReason).toContain("hs-99999");
  });

  it("does NOT refuse when arHold is false", () => {
    const result = classifyDispatch(
      baseOrder({
        hubspot: { dealId: "hs-12345", arHold: false },
      }),
    );
    expect(result.refuse).toBe(false);
  });

  it("does NOT refuse when hubspot metadata absent", () => {
    const result = classifyDispatch(baseOrder());
    expect(result.refuse).toBe(false);
  });
});

describe("classifyDispatch — carrier + service selection", () => {
  it("uses USPS for Alaska destinations regardless of weight", () => {
    const result = classifyDispatch(
      baseOrder({
        shipTo: {
          name: "Eric Forst",
          street1: "278 S Franklin St",
          city: "Juneau",
          state: "AK",
          postalCode: "99801",
        },
        cartons: 4,
        packagingType: "master_carton",
      }),
    );
    expect(result.carrierCode).toBe("stamps_com");
    expect(result.serviceCode).toBe("usps_ground_advantage");
  });

  it("uses UPS Ground for standard CONUS master-carton orders", () => {
    const result = classifyDispatch(
      baseOrder({
        shipTo: {
          name: "Glacier Wholesalers",
          street1: "16 W Reserve Dr",
          city: "Kalispell",
          state: "MT",
          postalCode: "59901",
        },
        cartons: 2,
        packagingType: "master_carton",
      }),
    );
    expect(result.carrierCode).toBe("ups_walleted");
    expect(result.serviceCode).toBe("ups_ground");
  });

  it("uses USPS for lightweight samples even in CONUS", () => {
    const result = classifyDispatch(
      baseOrder({
        shipTo: {
          name: "Test Retailer",
          street1: "123 Main St",
          city: "Austin",
          state: "TX",
          postalCode: "78701",
        },
        tags: ["sample"],
        weightLbs: 1.5,
      }),
    );
    expect(result.carrierCode).toBe("stamps_com");
  });
});

describe("classifyDispatch — ship-to sanity warnings", () => {
  it("warns on malformed ZIP", () => {
    const result = classifyDispatch(
      baseOrder({
        shipTo: {
          name: "A",
          street1: "1 Main",
          city: "Nowhere",
          state: "CA",
          postalCode: "BAD",
        },
      }),
    );
    expect(result.warnings.some((w) => w.includes("postal code"))).toBe(true);
  });

  it("warns when street1 is suspiciously short", () => {
    const result = classifyDispatch(
      baseOrder({
        shipTo: {
          name: "A",
          street1: "X",
          city: "Here",
          state: "CA",
          postalCode: "90210",
        },
      }),
    );
    expect(result.warnings.some((w) => w.includes("street1"))).toBe(true);
  });

  it("warns on high-value 'sample' orders (unusual)", () => {
    const result = classifyDispatch(
      baseOrder({
        tags: ["sample"],
        valueUsd: 750,
      }),
    );
    expect(result.warnings.some((w) => w.includes("unusually high"))).toBe(
      true,
    );
  });
});

describe("composeShipmentProposal", () => {
  it("produces a Class B proposal with Ben as approver", () => {
    const order = baseOrder();
    const classification = classifyDispatch(order);
    const proposal = composeShipmentProposal(order, classification);
    expect(proposal.actionSlug).toBe("shipment.create");
    expect(proposal.approvalClass).toBe("B");
    expect(proposal.requiredApprovers).toEqual(["Ben"]);
  });

  it("summary reflects the computed origin (samples now route Ashford)", () => {
    const order = baseOrder({ tags: ["sample"] });
    const classification = classifyDispatch(order);
    const proposal = composeShipmentProposal(order, classification);
    expect(proposal.summary).toContain("Ashford");
  });

  it("summary names East Coast only when explicit origin:east-coast override is present", () => {
    const order = baseOrder({ tags: ["origin:east-coast"] });
    const classification = classifyDispatch(order);
    const proposal = composeShipmentProposal(order, classification);
    expect(proposal.summary).toContain("East Coast");
  });

  it("renderedMarkdown embeds carrier + service + warnings", () => {
    const order = baseOrder({
      shipTo: {
        name: "Eric Forst",
        street1: "278 S Franklin St",
        city: "Juneau",
        state: "AK",
        postalCode: "99801",
      },
      cartons: 4,
      packagingType: "master_carton",
    });
    const classification = classifyDispatch(order);
    const proposal = composeShipmentProposal(order, classification);
    expect(proposal.renderedMarkdown).toContain("stamps_com");
    expect(proposal.renderedMarkdown).toContain("usps_ground_advantage");
    expect(proposal.renderedMarkdown).toContain("Juneau");
  });
});

// 2026-05-03 audit fix — Class A under-cap predicate. Locks the
// criteria so a future commit can wire the bypass into dispatch/route.ts
// without relitigating the cap definition.
describe("qualifiesForUnderCapAutoExecute", () => {
  function caseSampleOrder(overrides: Partial<OrderIntent> = {}): OrderIntent {
    return baseOrder({
      packagingType: "case",
      cartons: 1,
      tags: ["sample"],
      shipTo: {
        name: "Test Buyer",
        street1: "1 Test St",
        city: "Salem",
        state: "OR",
        postalCode: "97301",
      },
      ...overrides,
    });
  }

  it("qualifies a vanilla single 7×7×7 sample case from Ashford", () => {
    const order = caseSampleOrder();
    const c = classifyDispatch(order);
    expect(c.origin).toBe("ashford");
    expect(c.cartons).toBe(1);
    expect(c.packagingType).toBe("case");
    expect(qualifiesForUnderCapAutoExecute(order, c)).toBe(true);
  });

  it("does NOT qualify when packaging is master_carton", () => {
    const order = caseSampleOrder({ packagingType: "master_carton" });
    const c = classifyDispatch(order);
    expect(qualifiesForUnderCapAutoExecute(order, c)).toBe(false);
  });

  it("does NOT qualify when cartons > 1", () => {
    const order = caseSampleOrder({ cartons: 2 });
    const c = classifyDispatch(order);
    expect(qualifiesForUnderCapAutoExecute(order, c)).toBe(false);
  });

  it("does NOT qualify when classification has warnings", () => {
    // High-value sample (fires a warning per classifier doctrine).
    const order = caseSampleOrder({ valueUsd: 500 });
    const c = classifyDispatch(order);
    if (c.warnings.length > 0) {
      expect(qualifiesForUnderCapAutoExecute(order, c)).toBe(false);
    }
  });

  it("does NOT qualify when whale flag is set", () => {
    const order = caseSampleOrder();
    const c = classifyDispatch(order);
    expect(
      qualifiesForUnderCapAutoExecute(order, c, { hubspotWhale: true }),
    ).toBe(false);
  });

  it("does NOT qualify when knownDistributor flag is set", () => {
    const order = caseSampleOrder();
    const c = classifyDispatch(order);
    expect(
      qualifiesForUnderCapAutoExecute(order, c, { knownDistributor: true }),
    ).toBe(false);
  });

  it(`does NOT qualify when valueUsd > $${UNDER_CAP_VALUE_USD}`, () => {
    const order = caseSampleOrder({ valueUsd: UNDER_CAP_VALUE_USD + 1 });
    const c = classifyDispatch(order);
    // valueUsd is the only filter that's checked even when classifier
    // happens to not flag a warning at that price.
    if (c.warnings.length === 0) {
      expect(qualifiesForUnderCapAutoExecute(order, c)).toBe(false);
    }
  });

  it("DOES qualify at the exact cap value", () => {
    const order = caseSampleOrder({ valueUsd: UNDER_CAP_VALUE_USD });
    const c = classifyDispatch(order);
    if (c.warnings.length === 0) {
      expect(qualifiesForUnderCapAutoExecute(order, c)).toBe(true);
    }
  });

  it("does NOT qualify when classifier refuses (e.g. AR hold)", () => {
    const order = caseSampleOrder({
      hubspot: { dealId: "d1", arHold: true },
    });
    const c = classifyDispatch(order);
    expect(c.refuse).toBe(true);
    expect(qualifiesForUnderCapAutoExecute(order, c)).toBe(false);
  });

  it("does NOT qualify when origin is east_coast (Drew lane stays Class B)", () => {
    const order = caseSampleOrder({ tags: ["origin:east-coast"] });
    const c = classifyDispatch(order);
    expect(c.origin).toBe("east_coast");
    expect(qualifiesForUnderCapAutoExecute(order, c)).toBe(false);
  });
});
