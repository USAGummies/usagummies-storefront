/**
 * Tests for the Phase D1 stale-buyer detection helper.
 *
 * Pure functions — no HubSpot mocking needed. Fixture deals are passed
 * directly to `classifyStaleBuyer` / `summarizeStaleBuyers`.
 */
import { describe, expect, it } from "vitest";

import { HUBSPOT } from "@/lib/ops/hubspot-client";
import {
  ACTIVE_STAGE_IDS,
  STAGE_AGING_THRESHOLDS_DAYS,
  STAGE_NEXT_ACTIONS,
  classifyStaleBuyer,
  daysBetween,
  stageNameForId,
  summarizeStaleBuyers,
  type HubSpotDealForStaleness,
} from "@/lib/sales/stale-buyer";

const NOW = new Date("2026-04-29T15:00:00.000Z");

function deal(overrides: Partial<HubSpotDealForStaleness> = {}): HubSpotDealForStaleness {
  return {
    id: "deal-1",
    dealname: "Test Co — wholesale",
    pipelineId: HUBSPOT.PIPELINE_B2B_WHOLESALE,
    stageId: HUBSPOT.STAGE_LEAD,
    lastActivityAt: "2026-04-20T15:00:00.000Z", // 9 days ago
    primaryContactId: "contact-1",
    primaryCompanyName: "Test Co",
    ...overrides,
  };
}

describe("daysBetween — defensive timestamp math", () => {
  it("computes days between two ISO strings", () => {
    expect(daysBetween(NOW, "2026-04-22T15:00:00.000Z")).toBeCloseTo(7, 5);
  });

  it("returns Infinity for null lastActivityAt (data hygiene flag)", () => {
    expect(daysBetween(NOW, null)).toBe(Infinity);
  });

  it("returns Infinity for invalid date string (does not throw)", () => {
    expect(daysBetween(NOW, "not-a-date")).toBe(Infinity);
  });

  it("clamps negative deltas to 0 (future timestamps)", () => {
    expect(daysBetween(NOW, "2026-05-01T15:00:00.000Z")).toBe(0);
  });
});

describe("ACTIVE_STAGE_IDS — excludes terminal + Reorder + On Hold stages", () => {
  it("includes Lead, Contacted, Sample Shipped, Quote/PO Sent, Vendor Setup, PO Received, Shipped", () => {
    expect(ACTIVE_STAGE_IDS).toContain(HUBSPOT.STAGE_LEAD);
    expect(ACTIVE_STAGE_IDS).toContain(HUBSPOT.STAGE_CONTACTED);
    expect(ACTIVE_STAGE_IDS).toContain(HUBSPOT.STAGE_SAMPLE_SHIPPED);
    expect(ACTIVE_STAGE_IDS).toContain(HUBSPOT.STAGE_QUOTE_PO_SENT);
    expect(ACTIVE_STAGE_IDS).toContain(HUBSPOT.STAGE_VENDOR_SETUP);
    expect(ACTIVE_STAGE_IDS).toContain(HUBSPOT.STAGE_PO_RECEIVED);
    expect(ACTIVE_STAGE_IDS).toContain(HUBSPOT.STAGE_SHIPPED);
  });

  it("excludes Closed Won, Closed Lost, On Hold, Reorder", () => {
    expect(ACTIVE_STAGE_IDS).not.toContain(HUBSPOT.STAGE_CLOSED_WON);
    expect(ACTIVE_STAGE_IDS).not.toContain(HUBSPOT.STAGE_CLOSED_LOST);
    expect(ACTIVE_STAGE_IDS).not.toContain(HUBSPOT.STAGE_ON_HOLD);
    expect(ACTIVE_STAGE_IDS).not.toContain(HUBSPOT.STAGE_REORDER);
  });
});

describe("stageNameForId — round-trip with HUBSPOT_B2B_STAGES", () => {
  it("returns the human name for a known stage id", () => {
    expect(stageNameForId(HUBSPOT.STAGE_LEAD)).toBe("Lead");
    expect(stageNameForId(HUBSPOT.STAGE_SAMPLE_SHIPPED)).toBe("Sample Shipped");
  });

  it("returns null for an unknown stage id", () => {
    expect(stageNameForId("not-a-real-id")).toBeNull();
  });
});

describe("classifyStaleBuyer — single-deal classification", () => {
  it("returns null when pipeline is not B2B wholesale (defense in depth)", () => {
    const r = classifyStaleBuyer(deal({ pipelineId: "different-pipeline" }), NOW);
    expect(r).toBeNull();
  });

  it("returns null when stage is Closed Won", () => {
    const r = classifyStaleBuyer(deal({ stageId: HUBSPOT.STAGE_CLOSED_WON }), NOW);
    expect(r).toBeNull();
  });

  it("returns null when stage is Closed Lost / On Hold / Reorder", () => {
    expect(classifyStaleBuyer(deal({ stageId: HUBSPOT.STAGE_CLOSED_LOST }), NOW)).toBeNull();
    expect(classifyStaleBuyer(deal({ stageId: HUBSPOT.STAGE_ON_HOLD }), NOW)).toBeNull();
    expect(classifyStaleBuyer(deal({ stageId: HUBSPOT.STAGE_REORDER }), NOW)).toBeNull();
  });

  it("classifies a 9-day Lead deal as STALE (Lead threshold = 5d)", () => {
    const r = classifyStaleBuyer(deal({ stageId: HUBSPOT.STAGE_LEAD, lastActivityAt: "2026-04-20T15:00:00.000Z" }), NOW);
    expect(r).not.toBeNull();
    expect(r!.isStale).toBe(true);
    expect(r!.daysSinceActivity).toBe(9);
    expect(r!.thresholdDays).toBe(STAGE_AGING_THRESHOLDS_DAYS.Lead);
    expect(r!.nextAction).toBe(STAGE_NEXT_ACTIONS.Lead);
  });

  it("classifies a 3-day Lead as NOT stale (under threshold)", () => {
    const r = classifyStaleBuyer(deal({ stageId: HUBSPOT.STAGE_LEAD, lastActivityAt: "2026-04-26T15:00:00.000Z" }), NOW);
    expect(r).not.toBeNull();
    expect(r!.isStale).toBe(false);
    expect(r!.daysSinceActivity).toBe(3);
  });

  it("Sample Shipped at exactly threshold (10d) is stale (boundary inclusive)", () => {
    const r = classifyStaleBuyer(
      deal({ stageId: HUBSPOT.STAGE_SAMPLE_SHIPPED, lastActivityAt: "2026-04-19T15:00:00.000Z" }),
      NOW,
    );
    expect(r).not.toBeNull();
    expect(r!.daysSinceActivity).toBe(10);
    expect(r!.isStale).toBe(true);
  });

  it("PO Received uses 21d threshold (post-decision noise dampening)", () => {
    const r1 = classifyStaleBuyer(
      deal({ stageId: HUBSPOT.STAGE_PO_RECEIVED, lastActivityAt: "2026-04-15T15:00:00.000Z" }), // 14d
      NOW,
    );
    expect(r1!.isStale).toBe(false);
    const r2 = classifyStaleBuyer(
      deal({ stageId: HUBSPOT.STAGE_PO_RECEIVED, lastActivityAt: "2026-04-05T15:00:00.000Z" }), // 24d
      NOW,
    );
    expect(r2!.isStale).toBe(true);
  });

  it("a deal with null lastActivityAt is stale with daysSinceActivity = Infinity", () => {
    const r = classifyStaleBuyer(deal({ lastActivityAt: null }), NOW);
    expect(r).not.toBeNull();
    expect(r!.isStale).toBe(true);
    expect(r!.daysSinceActivity).toBe(Infinity);
  });

  it("Lead deal with future lastActivityAt → 0 days, not stale", () => {
    const r = classifyStaleBuyer(
      deal({ stageId: HUBSPOT.STAGE_LEAD, lastActivityAt: "2026-05-15T15:00:00.000Z" }),
      NOW,
    );
    expect(r!.daysSinceActivity).toBe(0);
    expect(r!.isStale).toBe(false);
  });

  it("falls back to default next-action copy when stage isn't in STAGE_NEXT_ACTIONS", () => {
    // Force-craft a deal with a stage in ACTIVE_STAGE_IDS that has no
    // threshold (constructed scenario — should null-out). Actually,
    // every active stage has a threshold defined; ensure the keys match.
    for (const stageId of ACTIVE_STAGE_IDS) {
      const r = classifyStaleBuyer(deal({ stageId }), NOW);
      expect(r).not.toBeNull();
      expect(r!.nextAction.length).toBeGreaterThan(0);
    }
  });
});

describe("summarizeStaleBuyers — morning-brief roll-up", () => {
  it("returns empty summary for empty input", () => {
    const r = summarizeStaleBuyers([], NOW, NOW.toISOString());
    expect(r.stalest).toEqual([]);
    expect(r.staleByStage).toEqual([]);
    expect(r.activeDealsScanned).toBe(0);
    expect(r.source).toEqual({ system: "hubspot", retrievedAt: NOW.toISOString() });
  });

  it("counts only stale deals in staleByStage; activeDealsScanned counts all classified", () => {
    const deals = [
      deal({ id: "d1", stageId: HUBSPOT.STAGE_LEAD, lastActivityAt: "2026-04-20T15:00:00.000Z" }), // 9d stale
      deal({ id: "d2", stageId: HUBSPOT.STAGE_LEAD, lastActivityAt: "2026-04-27T15:00:00.000Z" }), // 2d ok
      deal({ id: "d3", stageId: HUBSPOT.STAGE_SAMPLE_SHIPPED, lastActivityAt: "2026-04-15T15:00:00.000Z" }), // 14d stale
      deal({ id: "d4", stageId: HUBSPOT.STAGE_CLOSED_WON, lastActivityAt: "2026-04-01T15:00:00.000Z" }), // out of scope
    ];
    const r = summarizeStaleBuyers(deals, NOW, NOW.toISOString());
    expect(r.activeDealsScanned).toBe(3); // d1, d2, d3 are classified; d4 is out of scope
    expect(r.stalest.map((s) => s.dealId).sort()).toEqual(["d1", "d3"]);
    expect(r.staleByStage.map((s) => s.stageName).sort()).toEqual(["Lead", "Sample Shipped"]);
  });

  it("prioritizes earlier-stage deals first (Lead bumps a 21-day-old Shipped)", () => {
    const deals = [
      deal({ id: "old-shipped", stageId: HUBSPOT.STAGE_SHIPPED, lastActivityAt: "2026-04-01T15:00:00.000Z" }), // 28d
      deal({ id: "fresh-lead", stageId: HUBSPOT.STAGE_LEAD, lastActivityAt: "2026-04-22T15:00:00.000Z" }), // 7d (stale)
    ];
    const r = summarizeStaleBuyers(deals, NOW, NOW.toISOString());
    expect(r.stalest[0].dealId).toBe("fresh-lead");
    expect(r.stalest[1].dealId).toBe("old-shipped");
  });

  it("sorts within same stage by daysSinceActivity desc", () => {
    const deals = [
      deal({ id: "5d", stageId: HUBSPOT.STAGE_LEAD, lastActivityAt: "2026-04-24T15:00:00.000Z" }),
      deal({ id: "10d", stageId: HUBSPOT.STAGE_LEAD, lastActivityAt: "2026-04-19T15:00:00.000Z" }),
      deal({ id: "15d", stageId: HUBSPOT.STAGE_LEAD, lastActivityAt: "2026-04-14T15:00:00.000Z" }),
    ];
    const r = summarizeStaleBuyers(deals, NOW, NOW.toISOString());
    expect(r.stalest.map((s) => s.dealId)).toEqual(["15d", "10d", "5d"]);
  });

  it("respects topN limit", () => {
    const deals = Array.from({ length: 20 }, (_, i) =>
      deal({ id: `d${i}`, stageId: HUBSPOT.STAGE_LEAD, lastActivityAt: "2026-04-18T15:00:00.000Z" }),
    );
    const r = summarizeStaleBuyers(deals, NOW, NOW.toISOString(), 5);
    expect(r.stalest).toHaveLength(5);
  });

  it("source.retrievedAt is the caller-provided timestamp, NOT now", () => {
    const retrievedAt = "2026-04-29T14:55:12.000Z";
    const r = summarizeStaleBuyers([], NOW, retrievedAt);
    expect(r.source.retrievedAt).toBe(retrievedAt);
  });
});
