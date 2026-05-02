/**
 * Marketing Today aggregator coverage — Build 7.
 *
 * Pins:
 *   - Platform status: not_configured / error / configured_no_campaigns / active.
 *   - Totals roll up across platforms with spend-weighted ROAS.
 *   - Marketing-class approvals filtered to marketing-{brand,paid} divisions.
 *   - Blockers: error platforms + configured-but-zero-campaigns.
 *   - Posture: red on fetch error or stale approval; yellow on work waiting; green clean.
 *   - Degraded passthrough.
 */
import { describe, expect, it } from "vitest";

import {
  summarizeMarketingToday,
  type MarketingPlatformInput,
  type MarketingCampaignInput,
} from "../marketing-today";
import type { ApprovalRequest, DivisionId } from "../control-plane/types";

const NOW = new Date("2026-05-02T18:00:00Z");

function platform(
  overrides: Partial<MarketingPlatformInput> = {},
): MarketingPlatformInput {
  return {
    platform: "meta",
    configured: true,
    campaigns: [],
    fetchError: null,
    ...overrides,
  };
}

function campaign(
  overrides: Partial<MarketingCampaignInput> = {},
): MarketingCampaignInput {
  return {
    id: "c-1",
    name: "Test Campaign",
    status: "ACTIVE",
    spend: 100,
    impressions: 5000,
    clicks: 100,
    conversions: 5,
    revenue: 200,
    roas: 2,
    ...overrides,
  };
}

function approval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "a-1",
    runId: "run-1",
    division: "marketing-paid" as DivisionId,
    actorAgentId: "ops",
    class: "B",
    action: "ads.spend.change",
    targetSystem: "meta",
    payloadPreview: "x",
    evidence: { claim: "x", sources: [], confidence: 0.9 },
    rollbackPlan: "x",
    requiredApprovers: ["Ben"] as never,
    status: "pending" as never,
    createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
    decisions: [],
    escalateAt: new Date(NOW.getTime() + 22 * 3600 * 1000).toISOString(),
    expiresAt: new Date(NOW.getTime() + 70 * 3600 * 1000).toISOString(),
    ...overrides,
  };
}

describe("summarizeMarketingToday — platform projection", () => {
  it("not_configured platforms report status=not_configured + zeros", () => {
    const r = summarizeMarketingToday({
      platforms: [platform({ platform: "google", configured: false })],
      pendingApprovals: [],
      now: NOW,
    });
    expect(r.platforms[0].status).toBe("not_configured");
    expect(r.platforms[0].activeCampaignCount).toBe(0);
    expect(r.platforms[0].spend30d).toBe(0);
  });

  it("configured + fetchError → status=error + reason in blockers", () => {
    const r = summarizeMarketingToday({
      platforms: [
        platform({
          platform: "meta",
          fetchError: "graph 500",
        }),
      ],
      pendingApprovals: [],
      now: NOW,
    });
    expect(r.platforms[0].status).toBe("error");
    expect(r.platforms[0].fetchError).toBe("graph 500");
    expect(r.blockers).toHaveLength(1);
    expect(r.blockers[0].reason).toBe("graph 500");
  });

  it("configured + zero campaigns → status=configured_no_campaigns + blocker", () => {
    const r = summarizeMarketingToday({
      platforms: [platform({ campaigns: [] })],
      pendingApprovals: [],
      now: NOW,
    });
    expect(r.platforms[0].status).toBe("configured_no_campaigns");
    expect(r.blockers[0].reason).toMatch(/no active campaigns/);
  });

  it("configured + active campaigns → status=active + activeCampaignCount", () => {
    const r = summarizeMarketingToday({
      platforms: [
        platform({
          campaigns: [
            campaign({ id: "active-1", status: "ACTIVE" }),
            campaign({ id: "paused-1", status: "PAUSED" }),
          ],
        }),
      ],
      pendingApprovals: [],
      now: NOW,
    });
    expect(r.platforms[0].status).toBe("active");
    expect(r.platforms[0].activeCampaignCount).toBe(1);
    expect(r.platforms[0].campaignCount).toBe(2);
  });

  it("active-status check is case-insensitive", () => {
    const r = summarizeMarketingToday({
      platforms: [
        platform({
          campaigns: [
            campaign({ id: "lower", status: "active" }),
            campaign({ id: "mixed", status: "Active" }),
          ],
        }),
      ],
      pendingApprovals: [],
      now: NOW,
    });
    expect(r.platforms[0].activeCampaignCount).toBe(2);
  });
});

describe("summarizeMarketingToday — totals", () => {
  it("rolls up spend / revenue / conversions across all platforms", () => {
    const r = summarizeMarketingToday({
      platforms: [
        platform({
          platform: "meta",
          campaigns: [
            campaign({ spend: 100, revenue: 300, conversions: 3 }),
            campaign({ id: "c-2", spend: 50, revenue: 150, conversions: 2 }),
          ],
        }),
        platform({
          platform: "google",
          campaigns: [campaign({ spend: 200, revenue: 250, conversions: 5 })],
        }),
      ],
      pendingApprovals: [],
      now: NOW,
    });
    expect(r.totals.spend30d).toBe(350);
    expect(r.totals.revenue30d).toBe(700);
    expect(r.totals.conversions30d).toBe(10);
    // 700 / 350 = 2.0 spend-weighted
    expect(r.totals.roas30d).toBe(2);
    expect(r.totals.activeCampaigns).toBe(3);
    expect(r.totals.configuredPlatforms).toBe(2);
  });

  it("zero spend → ROAS 0 (no division-by-zero)", () => {
    const r = summarizeMarketingToday({
      platforms: [platform({ campaigns: [] })],
      pendingApprovals: [],
      now: NOW,
    });
    expect(r.totals.roas30d).toBe(0);
  });
});

describe("summarizeMarketingToday — pending approvals", () => {
  it("filters to marketing-brand + marketing-paid divisions", () => {
    const r = summarizeMarketingToday({
      platforms: [],
      pendingApprovals: [
        approval({ id: "paid", division: "marketing-paid" as DivisionId }),
        approval({ id: "brand", division: "marketing-brand" as DivisionId }),
        approval({ id: "fin", division: "financials" as DivisionId }),
      ],
      now: NOW,
    });
    expect(r.pendingApprovals).toBe(2);
    expect(r.oldestPendingApprovals.map((a) => a.id).sort()).toEqual([
      "brand",
      "paid",
    ]);
  });

  it("returns ageDays for each oldest pending", () => {
    const r = summarizeMarketingToday({
      platforms: [],
      pendingApprovals: [
        approval({
          id: "old",
          createdAt: new Date(
            NOW.getTime() - 5 * 24 * 3600 * 1000,
          ).toISOString(),
        }),
      ],
      now: NOW,
    });
    expect(r.oldestPendingApprovals[0].ageDays).toBe(5);
  });
});

describe("summarizeMarketingToday — posture", () => {
  it("green when no work + no blockers", () => {
    const r = summarizeMarketingToday({
      platforms: [
        platform({ campaigns: [campaign({ status: "ACTIVE" })] }),
      ],
      pendingApprovals: [],
      now: NOW,
    });
    expect(r.posture).toBe("green");
  });

  it("red when a configured platform errored", () => {
    const r = summarizeMarketingToday({
      platforms: [platform({ fetchError: "500" })],
      pendingApprovals: [],
      now: NOW,
    });
    expect(r.posture).toBe("red");
  });

  it("red when an approval is ≥3 days old", () => {
    const r = summarizeMarketingToday({
      platforms: [
        platform({ campaigns: [campaign({ status: "ACTIVE" })] }),
      ],
      pendingApprovals: [
        approval({
          createdAt: new Date(
            NOW.getTime() - 4 * 24 * 3600 * 1000,
          ).toISOString(),
        }),
      ],
      now: NOW,
    });
    expect(r.posture).toBe("red");
  });

  it("yellow when configured platform has zero campaigns (but no errors)", () => {
    const r = summarizeMarketingToday({
      platforms: [platform({ campaigns: [] })],
      pendingApprovals: [],
      now: NOW,
    });
    expect(r.posture).toBe("yellow");
  });

  it("yellow when a recent approval is pending", () => {
    const r = summarizeMarketingToday({
      platforms: [
        platform({ campaigns: [campaign({ status: "ACTIVE" })] }),
      ],
      pendingApprovals: [approval({})],
      now: NOW,
    });
    expect(r.posture).toBe("yellow");
  });
});

describe("summarizeMarketingToday — degraded passthrough", () => {
  it("forwards degraded list", () => {
    const r = summarizeMarketingToday({
      platforms: [],
      pendingApprovals: [],
      degraded: ["meta-fetch: 500"],
      now: NOW,
    });
    expect(r.degraded).toEqual(["meta-fetch: 500"]);
  });
});
