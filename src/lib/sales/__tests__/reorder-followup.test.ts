import { describe, expect, it } from "vitest";

import { HUBSPOT } from "@/lib/ops/hubspot-client";
import {
  REORDER_WINDOW_DAYS,
  classifyAmazonReorderCandidates,
  classifyShopifyReorderCandidates,
  classifyWholesaleReorderCandidates,
  summarizeReorderFollowUps,
  type AmazonReorderInput,
  type ShopifyReorderInput,
} from "@/lib/sales/reorder-followup";
import type { HubSpotDealForStaleness } from "@/lib/sales/stale-buyer";

const NOW = new Date("2026-04-30T15:00:00.000Z");

function amazon(overrides: Partial<AmazonReorderInput> = {}): AmazonReorderInput {
  return {
    fingerprint: "amy-44094",
    shipToName: "Amy Catalano",
    shipToCity: "WILOUGHBY HLS",
    shipToState: "OH",
    lastSeenAt: "2026-02-01T15:00:00.000Z", // 88d
    orderCount: 1,
    ...overrides,
  };
}

function deal(overrides: Partial<HubSpotDealForStaleness> = {}): HubSpotDealForStaleness {
  return {
    id: "deal-1",
    dealname: "Mike Hippler — Thanksgiving Point",
    pipelineId: HUBSPOT.PIPELINE_B2B_WHOLESALE,
    stageId: HUBSPOT.STAGE_SHIPPED,
    lastActivityAt: "2026-01-15T15:00:00.000Z", // 105d
    primaryContactId: "contact-1",
    primaryCompanyName: "Thanksgiving Point",
    ...overrides,
  };
}

describe("REORDER_WINDOW_DAYS — locked thresholds", () => {
  it("Amazon FBM = 60d, Shopify DTC = 90d, wholesale = 90d", () => {
    expect(REORDER_WINDOW_DAYS["amazon-fbm"]).toBe(60);
    expect(REORDER_WINDOW_DAYS["shopify-dtc"]).toBe(90);
    expect(REORDER_WINDOW_DAYS.wholesale).toBe(90);
  });
});

describe("classifyAmazonReorderCandidates", () => {
  it("returns customers past the 60d window", () => {
    const r = classifyAmazonReorderCandidates([amazon({ lastSeenAt: "2026-02-01T15:00:00.000Z" })], NOW);
    expect(r).toHaveLength(1);
    expect(r[0].channel).toBe("amazon-fbm");
    expect(r[0].id).toBe("amazon:amy-44094");
    expect(r[0].displayName).toBe("Amy Catalano");
    expect(r[0].daysSinceLastOrder).toBeGreaterThanOrEqual(60);
    expect(r[0].windowDays).toBe(60);
    expect(r[0].meta.priorOrders).toBe(1);
    expect(r[0].meta.extra).toBe("WILOUGHBY HLS, OH");
  });

  it("excludes customers within the 60d window", () => {
    const r = classifyAmazonReorderCandidates(
      [amazon({ lastSeenAt: "2026-04-01T15:00:00.000Z" })], // 29d
      NOW,
    );
    expect(r).toHaveLength(0);
  });

  it("emits a different next-action for orderCount > 1 vs orderCount = 1", () => {
    const repeat = classifyAmazonReorderCandidates(
      [amazon({ orderCount: 4 })],
      NOW,
    );
    const oneTime = classifyAmazonReorderCandidates(
      [amazon({ orderCount: 1 })],
      NOW,
    );
    expect(repeat[0].nextAction).toMatch(/repeat-buyer thank-you/);
    expect(repeat[0].nextAction).toMatch(/orderCount=4/);
    expect(oneTime[0].nextAction).toMatch(/first-time-buyer reorder offer/);
  });

  it("skips records with invalid lastSeenAt (no fabrication)", () => {
    const r = classifyAmazonReorderCandidates(
      [amazon({ lastSeenAt: "not-a-date" })],
      NOW,
    );
    expect(r).toHaveLength(0);
  });

  it("formats unknown city/state gracefully", () => {
    const r = classifyAmazonReorderCandidates(
      [amazon({ shipToCity: null, shipToState: null })],
      NOW,
    );
    expect(r[0].meta.extra).toBe("(unknown loc)");
  });
});

describe("classifyWholesaleReorderCandidates", () => {
  it("returns Shipped deals past the 90d window", () => {
    const r = classifyWholesaleReorderCandidates([deal()], NOW);
    expect(r).toHaveLength(1);
    expect(r[0].channel).toBe("wholesale");
    expect(r[0].id).toBe("hubspot-deal:deal-1");
    expect(r[0].displayName).toBe("Thanksgiving Point");
    expect(r[0].daysSinceLastOrder).toBeGreaterThanOrEqual(90);
    expect(r[0].windowDays).toBe(90);
  });

  it("excludes deals NOT in STAGE_SHIPPED (Reorder, Closed, Lead, etc.)", () => {
    const stages = [
      HUBSPOT.STAGE_REORDER,
      HUBSPOT.STAGE_CLOSED_WON,
      HUBSPOT.STAGE_LEAD,
      HUBSPOT.STAGE_SAMPLE_SHIPPED,
      HUBSPOT.STAGE_VENDOR_SETUP,
    ];
    for (const stageId of stages) {
      const r = classifyWholesaleReorderCandidates([deal({ stageId })], NOW);
      expect(r).toHaveLength(0);
    }
  });

  it("excludes deals from other pipelines (defense in depth)", () => {
    const r = classifyWholesaleReorderCandidates(
      [deal({ pipelineId: "different-pipeline" })],
      NOW,
    );
    expect(r).toHaveLength(0);
  });

  it("falls back to dealname when primaryCompanyName is null", () => {
    const r = classifyWholesaleReorderCandidates(
      [deal({ primaryCompanyName: null })],
      NOW,
    );
    expect(r[0].displayName).toBe("Mike Hippler — Thanksgiving Point");
  });
});

describe("summarizeReorderFollowUps", () => {
  it("empty input → zero summary with empty topCandidates", () => {
    const r = summarizeReorderFollowUps({
      amazonCandidates: [],
      wholesaleCandidates: [],
      now: NOW,
      sources: [],
    });
    expect(r.total).toBe(0);
    expect(r.topCandidates).toEqual([]);
    expect(r.byChannel).toEqual([]);
  });

  it("prioritizes wholesale before amazon-fbm in the topCandidates sort", () => {
    const amazonR = classifyAmazonReorderCandidates([amazon()], NOW);
    const wholesaleR = classifyWholesaleReorderCandidates([deal()], NOW);
    const r = summarizeReorderFollowUps({
      amazonCandidates: amazonR,
      wholesaleCandidates: wholesaleR,
      now: NOW,
      sources: [],
    });
    expect(r.total).toBe(2);
    expect(r.topCandidates[0].channel).toBe("wholesale");
    expect(r.topCandidates[1].channel).toBe("amazon-fbm");
  });

  it("within same channel, sorts by daysSinceLastOrder desc", () => {
    const amz = classifyAmazonReorderCandidates(
      [
        amazon({ fingerprint: "younger", lastSeenAt: "2026-02-15T15:00:00.000Z" }), // ~74d
        amazon({ fingerprint: "older", lastSeenAt: "2025-12-15T15:00:00.000Z" }), // ~136d
      ],
      NOW,
    );
    const r = summarizeReorderFollowUps({
      amazonCandidates: amz,
      wholesaleCandidates: [],
      now: NOW,
      sources: [],
    });
    expect(r.topCandidates[0].id).toBe("amazon:older");
    expect(r.topCandidates[1].id).toBe("amazon:younger");
  });

  it("respects topN limit", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      amazon({
        fingerprint: `c${i}`,
        lastSeenAt: "2026-01-15T15:00:00.000Z",
      }),
    );
    const r = summarizeReorderFollowUps({
      amazonCandidates: classifyAmazonReorderCandidates(many, NOW),
      wholesaleCandidates: [],
      now: NOW,
      sources: [],
      topN: 5,
    });
    expect(r.topCandidates).toHaveLength(5);
    expect(r.total).toBe(20);
  });

  it("byChannel reports counts only for channels with candidates", () => {
    const amazonR = classifyAmazonReorderCandidates([amazon()], NOW);
    const r = summarizeReorderFollowUps({
      amazonCandidates: amazonR,
      wholesaleCandidates: [],
      now: NOW,
      sources: [],
    });
    expect(r.byChannel).toHaveLength(1);
    expect(r.byChannel[0].channel).toBe("amazon-fbm");
    expect(r.byChannel[0].count).toBe(1);
    expect(r.byChannel[0].windowDays).toBe(60);
  });

  it("preserves source citations in output", () => {
    const r = summarizeReorderFollowUps({
      amazonCandidates: [],
      wholesaleCandidates: [],
      now: NOW,
      sources: [
        { system: "amazon-fbm-registry", retrievedAt: "2026-04-30T14:00:00.000Z" },
        { system: "hubspot", retrievedAt: "2026-04-30T14:00:01.000Z" },
      ],
    });
    expect(r.sources).toHaveLength(2);
    expect(r.sources[0].system).toBe("amazon-fbm-registry");
  });
});

// ---------------------------------------------------------------------------
// Phase D4 v0.2 — Shopify DTC reorder slot
// ---------------------------------------------------------------------------

function shopify(overrides: Partial<ShopifyReorderInput> = {}): ShopifyReorderInput {
  return {
    numericId: "100",
    email: "buyer@example.com",
    firstName: "Sarah",
    lastName: "McGowan",
    lastOrderAt: "2026-01-15T15:00:00.000Z", // ~105d ago vs NOW (2026-04-30)
    ordersCount: 1,
    totalSpentUsd: 5.99,
    ...overrides,
  };
}

describe("classifyShopifyReorderCandidates", () => {
  it("returns customers past the 90d window", () => {
    const r = classifyShopifyReorderCandidates([shopify()], NOW);
    expect(r).toHaveLength(1);
    expect(r[0].channel).toBe("shopify-dtc");
    expect(r[0].id).toBe("shopify:100");
    expect(r[0].displayName).toBe("Sarah McGowan");
    expect(r[0].daysSinceLastOrder).toBeGreaterThanOrEqual(90);
    expect(r[0].windowDays).toBe(90);
  });

  it("excludes customers within the 90d window", () => {
    const r = classifyShopifyReorderCandidates(
      [shopify({ lastOrderAt: "2026-03-01T15:00:00.000Z" })], // ~60d
      NOW,
    );
    expect(r).toHaveLength(0);
  });

  it("excludes customers without an email (no follow-up channel)", () => {
    const r = classifyShopifyReorderCandidates([shopify({ email: null })], NOW);
    expect(r).toHaveLength(0);
  });

  it("excludes customers with zero orders (browse-only accounts)", () => {
    const r = classifyShopifyReorderCandidates(
      [shopify({ ordersCount: 0, lastOrderAt: null })],
      NOW,
    );
    expect(r).toHaveLength(0);
  });

  it("emits a different next-action for repeat vs first-time buyer", () => {
    const repeat = classifyShopifyReorderCandidates(
      [shopify({ ordersCount: 4, totalSpentUsd: 250 })],
      NOW,
    );
    const oneTime = classifyShopifyReorderCandidates(
      [shopify({ ordersCount: 1, totalSpentUsd: 5.99 })],
      NOW,
    );
    expect(repeat[0].nextAction).toMatch(/repeat-buyer reorder/);
    expect(repeat[0].nextAction).toMatch(/orderCount=4/);
    expect(oneTime[0].nextAction).toMatch(/first-time-buyer reorder offer/);
  });

  it("falls back to email when first/last names are missing", () => {
    const r = classifyShopifyReorderCandidates(
      [shopify({ firstName: null, lastName: null })],
      NOW,
    );
    expect(r[0].displayName).toBe("buyer@example.com");
  });

  it("formats lifetime spend in next-action / extra meta", () => {
    const r = classifyShopifyReorderCandidates(
      [shopify({ totalSpentUsd: 124.5 })],
      NOW,
    );
    expect(r[0].meta.extra).toBe("$125 lifetime");
    const noSpend = classifyShopifyReorderCandidates(
      [shopify({ totalSpentUsd: null })],
      NOW,
    );
    expect(noSpend[0].meta.extra).toBe("unknown lifetime spend");
  });

  it("skips records with invalid lastOrderAt (no fabrication)", () => {
    const r = classifyShopifyReorderCandidates(
      [shopify({ lastOrderAt: "not-a-date" })],
      NOW,
    );
    expect(r).toHaveLength(0);
  });
});

describe("summarizeReorderFollowUps — Shopify alongside Amazon + wholesale", () => {
  it("includes Shopify candidates in topCandidates + byChannel", () => {
    const r = summarizeReorderFollowUps({
      amazonCandidates: classifyAmazonReorderCandidates([amazon()], NOW),
      wholesaleCandidates: classifyWholesaleReorderCandidates([deal()], NOW),
      shopifyCandidates: classifyShopifyReorderCandidates([shopify()], NOW),
      now: NOW,
      sources: [],
    });
    expect(r.total).toBe(3);
    expect(r.byChannel.map((b) => b.channel).sort()).toEqual([
      "amazon-fbm",
      "shopify-dtc",
      "wholesale",
    ]);
    // Channel priority: wholesale > amazon-fbm > shopify-dtc
    expect(r.topCandidates[0].channel).toBe("wholesale");
    expect(r.topCandidates[1].channel).toBe("amazon-fbm");
    expect(r.topCandidates[2].channel).toBe("shopify-dtc");
  });

  it("REORDER_WINDOW_DAYS still locks Shopify DTC at 90d", () => {
    expect(REORDER_WINDOW_DAYS["shopify-dtc"]).toBe(90);
  });
});
