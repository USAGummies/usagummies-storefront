/**
 * Slack `marketing today` card renderer coverage.
 *
 * Pins:
 *   - Empty queue → no-platforms copy.
 *   - Posture chip (🟢/🟡/🔴) renders in header + brief.
 *   - Stats fields surface spend / revenue / ROAS / active / configured / pending.
 *   - Platform row rendering: 🟢 active / 🟡 zero-campaigns / 🔴 error / ⚪️ not_configured.
 *   - Blockers section appears only when blockers exist.
 *   - Stale approval (red) → "Stale approval" copy.
 *   - Read-only context note present.
 *   - Dashboard URL is /ops/marketing.
 */
import { describe, expect, it } from "vitest";

import { renderMarketingTodayCard } from "../slack-marketing-today-card";
import type {
  MarketingPlatformSummary,
  MarketingTodaySummary,
} from "../marketing-today";

function platform(
  overrides: Partial<MarketingPlatformSummary> = {},
): MarketingPlatformSummary {
  return {
    platform: "meta",
    status: "active",
    configured: true,
    activeCampaignCount: 2,
    campaignCount: 3,
    spend30d: 100,
    revenue30d: 250,
    conversions30d: 10,
    roas30d: 2.5,
    fetchError: null,
    ...overrides,
  };
}

function summary(
  overrides: Partial<MarketingTodaySummary> = {},
): MarketingTodaySummary {
  return {
    generatedAt: "2026-05-02T18:00:00.000Z",
    platforms: [],
    totals: {
      spend30d: 0,
      revenue30d: 0,
      conversions30d: 0,
      roas30d: 0,
      activeCampaigns: 0,
      configuredPlatforms: 0,
    },
    pendingApprovals: 0,
    oldestPendingApprovals: [],
    blockers: [],
    posture: "green",
    degraded: [],
    ...overrides,
  };
}

describe("renderMarketingTodayCard", () => {
  it("zero configured platforms renders no-platforms copy", () => {
    const card = renderMarketingTodayCard({ summary: summary() });
    expect(card.text).toMatch(/no ad platforms configured/);
    expect(JSON.stringify(card.blocks)).toMatch(/No ad platforms configured/);
  });

  it("posture chip renders in header + top text", () => {
    const card = renderMarketingTodayCard({
      summary: summary({ posture: "yellow" }),
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toMatch(/🟡 work waiting/);
  });

  it("stats fields surface every total + pending count", () => {
    const card = renderMarketingTodayCard({
      summary: summary({
        totals: {
          spend30d: 1234.56,
          revenue30d: 4321.99,
          conversions30d: 42,
          roas30d: 3.5,
          activeCampaigns: 4,
          configuredPlatforms: 2,
        },
        pendingApprovals: 5,
      }),
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toContain("$1234.56");
    expect(blob).toContain("$4321.99");
    expect(blob).toContain("3.50x");
    expect(blob).toContain("\\n4");
    expect(blob).toContain("2/3");
    expect(blob).toContain("\\n5");
  });

  it("platform rows render with correct status icon + spend / ROAS", () => {
    const card = renderMarketingTodayCard({
      summary: summary({
        platforms: [
          platform({ platform: "meta", status: "active", spend30d: 100, roas30d: 2.5 }),
          platform({
            platform: "google",
            status: "configured_no_campaigns",
            activeCampaignCount: 0,
            spend30d: 0,
          }),
          platform({
            platform: "tiktok",
            status: "error",
            fetchError: "graph 500",
          }),
        ],
        totals: {
          spend30d: 100,
          revenue30d: 250,
          conversions30d: 10,
          roas30d: 2.5,
          activeCampaigns: 2,
          configuredPlatforms: 3,
        },
      }),
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toContain("🟢");
    expect(blob).toContain("🟡");
    expect(blob).toContain("🔴");
    expect(blob).toContain("$100.00 spend");
    expect(blob).toContain("graph 500");
    expect(blob).toContain("0 active campaigns");
  });

  it("blockers section appears only when blockers exist", () => {
    const without = renderMarketingTodayCard({ summary: summary() });
    expect(JSON.stringify(without.blocks)).not.toMatch(/Blockers/);

    const withBlockers = renderMarketingTodayCard({
      summary: summary({
        blockers: [{ platform: "meta", reason: "graph 500" }],
      }),
    });
    expect(JSON.stringify(withBlockers.blocks)).toMatch(/Blockers/);
    expect(JSON.stringify(withBlockers.blocks)).toMatch(/graph 500/);
  });

  it("stale approval (red posture) renders STALE copy in brief", () => {
    const card = renderMarketingTodayCard({
      summary: summary({
        posture: "red",
        pendingApprovals: 1,
        oldestPendingApprovals: [
          {
            id: "stale",
            actorAgentId: "ops",
            action: "ads.spend.change",
            createdAt: "2026-04-28T18:00:00.000Z",
            ageDays: 4,
          },
        ],
      }),
    });
    expect(JSON.stringify(card.blocks)).toMatch(/Stale approval/i);
  });

  it("dashboard URL is /ops/marketing", () => {
    const card = renderMarketingTodayCard({ summary: summary() });
    expect(JSON.stringify(card.blocks)).toContain("/ops/marketing");
  });

  it("read-only context note present", () => {
    const card = renderMarketingTodayCard({ summary: summary() });
    expect(JSON.stringify(card.blocks)).toMatch(
      /no ad spend.*publish fires from this card/i,
    );
  });

  it("degraded list surfaces in context", () => {
    const card = renderMarketingTodayCard({
      summary: summary({ degraded: ["meta-fetch: 500"] }),
    });
    expect(JSON.stringify(card.blocks)).toContain("meta-fetch: 500");
  });
});
