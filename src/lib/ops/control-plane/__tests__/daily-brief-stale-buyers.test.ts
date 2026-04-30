/**
 * Tests for the Phase D6 stale-buyer slice rendering in `composeDailyBrief`
 * + `renderStaleBuyersMarkdown`.
 *
 * The stale-buyer detection logic itself is tested in
 * `src/lib/sales/__tests__/stale-buyer.test.ts`. This file verifies the
 * BRIEF-LEVEL contract: morning-only rendering, quiet-collapse on empty,
 * EOD skip, layout invariants.
 */
import { describe, expect, it } from "vitest";

import {
  composeDailyBrief,
  renderReorderFollowUpsMarkdown,
  renderSampleQueueMarkdown,
  renderStaleBuyersMarkdown,
  type BriefInput,
} from "@/lib/ops/control-plane/daily-brief";
import type { ReorderFollowUpSummary } from "@/lib/sales/reorder-followup";
import type { SampleQueueHealth } from "@/lib/sales/sample-queue";
import type { StaleBuyerSummary } from "@/lib/sales/stale-buyer";

const NOW = new Date("2026-04-29T15:00:00.000Z");

function baseInput(): BriefInput {
  return {
    kind: "morning",
    asOf: NOW,
    activeDivisions: [],
    pendingApprovals: [],
    pausedAgents: [],
    recentAudit: [],
  };
}

function summary(overrides: Partial<StaleBuyerSummary> = {}): StaleBuyerSummary {
  return {
    asOf: NOW.toISOString(),
    stalest: [
      {
        dealId: "deal-1",
        dealName: "Indian Pueblo Stores — wholesale",
        stageName: "Lead",
        daysSinceActivity: 12,
        thresholdDays: 5,
        isStale: true,
        nextAction: "Send first-touch outreach via send-and-log.py",
        primaryContactId: "contact-1",
        primaryCompanyName: "Indian Pueblo Stores",
      },
      {
        dealId: "deal-2",
        dealName: "Bryce Glamp and Camp",
        stageName: "Sample Shipped",
        daysSinceActivity: 14,
        thresholdDays: 10,
        isStale: true,
        nextAction: "Sample-followup email — ask for taste reaction + introduce wholesale tiers",
        primaryContactId: null,
        primaryCompanyName: "Bryce Glamp and Camp",
      },
    ],
    staleByStage: [
      { stageName: "Lead", count: 1, thresholdDays: 5 },
      { stageName: "Sample Shipped", count: 1, thresholdDays: 10 },
    ],
    activeDealsScanned: 12,
    source: { system: "hubspot", retrievedAt: NOW.toISOString() },
    ...overrides,
  };
}

describe("renderStaleBuyersMarkdown — pure formatting", () => {
  it("returns empty string for empty stalest list (quiet-collapse)", () => {
    const text = renderStaleBuyersMarkdown(
      summary({ stalest: [], staleByStage: [], activeDealsScanned: 5 }),
    );
    expect(text).toBe("");
  });

  it("renders the header with total stale count + active scan denominator", () => {
    const text = renderStaleBuyersMarkdown(summary());
    expect(text).toContain("FOLLOW-UP HIT LIST — 2 deal(s) waiting on you");
    expect(text).toContain("scanned 12 active");
  });

  it("renders one bullet per stalest deal with stage + days + company + next-action", () => {
    const text = renderStaleBuyersMarkdown(summary());
    expect(text).toContain("`Lead` — 12d — Indian Pueblo Stores");
    expect(text).toContain("Send first-touch outreach");
    expect(text).toContain("`Sample Shipped` — 14d — Bryce Glamp and Camp");
    expect(text).toContain("Sample-followup email");
  });

  it("renders 'no activity' for Infinity daysSinceActivity (data hygiene)", () => {
    const text = renderStaleBuyersMarkdown(
      summary({
        stalest: [
          {
            dealId: "d1",
            dealName: "Mystery Co",
            stageName: "Lead",
            daysSinceActivity: Infinity,
            thresholdDays: 5,
            isStale: true,
            nextAction: "Review this deal manually",
            primaryContactId: null,
            primaryCompanyName: "Mystery Co",
          },
        ],
        staleByStage: [{ stageName: "Lead", count: 1, thresholdDays: 5 }],
      }),
    );
    expect(text).toContain("no activity");
  });

  it("renders the per-stage roll-up footer", () => {
    const text = renderStaleBuyersMarkdown(summary());
    expect(text).toContain("Per-stage: Lead 1, Sample Shipped 1");
  });

  it("falls back to dealName when primaryCompanyName is null", () => {
    const text = renderStaleBuyersMarkdown(
      summary({
        stalest: [
          {
            dealId: "d1",
            dealName: "Some Long Deal Name Here Wholesale",
            stageName: "Lead",
            daysSinceActivity: 12,
            thresholdDays: 5,
            isStale: true,
            nextAction: "Review this deal manually",
            primaryContactId: null,
            primaryCompanyName: null,
          },
        ],
        staleByStage: [{ stageName: "Lead", count: 1, thresholdDays: 5 }],
      }),
    );
    expect(text).toContain("Some Long Deal Name Here Wholesale");
  });
});

describe("composeDailyBrief — staleBuyers slice rendering", () => {
  it("includes the stale-buyers section in morning brief when present + non-empty", () => {
    const out = composeDailyBrief({ ...baseInput(), staleBuyers: summary() });
    const json = JSON.stringify(out.blocks);
    expect(json).toContain("FOLLOW-UP HIT LIST");
    expect(json).toContain("Indian Pueblo Stores");
  });

  it("OMITS the section when staleBuyers slice is undefined", () => {
    const out = composeDailyBrief(baseInput());
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain("FOLLOW-UP HIT LIST");
  });

  it("OMITS the section when staleBuyers.stalest is empty (quiet-collapse)", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      staleBuyers: summary({
        stalest: [],
        staleByStage: [],
        activeDealsScanned: 8,
      }),
    });
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain("FOLLOW-UP HIT LIST");
  });

  it("OMITS the section on EOD even when slice is provided", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      kind: "eod",
      staleBuyers: summary(),
    });
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain("FOLLOW-UP HIT LIST");
  });
});

// ---------------------------------------------------------------------------
// Phase D2 — sample queue health
// ---------------------------------------------------------------------------

function sampleQueue(overrides: Partial<SampleQueueHealth> = {}): SampleQueueHealth {
  return {
    asOf: NOW.toISOString(),
    awaitingShip: 2,
    awaitingShipBehind: 1,
    shippedAwaitingResponse: 4,
    oldestRequestedDays: 5,
    oldestShippedDays: 12,
    behindThresholdDays: 3,
    source: { system: "hubspot", retrievedAt: NOW.toISOString() },
    ...overrides,
  };
}

describe("renderSampleQueueMarkdown — D2 formatting", () => {
  it("returns empty string when both buckets are zero (quiet-collapse)", () => {
    const text = renderSampleQueueMarkdown(
      sampleQueue({ awaitingShip: 0, shippedAwaitingResponse: 0 }),
    );
    expect(text).toBe("");
  });

  it("renders both buckets with the rotating-light flag for behind-queue", () => {
    const text = renderSampleQueueMarkdown(sampleQueue());
    expect(text).toContain("2 awaiting ship");
    expect(text).toContain(":rotating_light: 1 > 3d");
    expect(text).toContain("4 shipped, waiting on buyer");
    expect(text).toContain("Oldest requested: 5d");
    expect(text).toContain("Oldest shipped: 12d");
  });

  it("omits awaiting-ship section when count is zero", () => {
    const text = renderSampleQueueMarkdown(
      sampleQueue({ awaitingShip: 0, awaitingShipBehind: 0, oldestRequestedDays: Infinity }),
    );
    expect(text).not.toContain("awaiting ship");
    expect(text).toContain("4 shipped, waiting on buyer");
    expect(text).not.toContain("Oldest requested");
  });

  it("renders '—' when oldestShippedDays is Infinity (data hygiene)", () => {
    const text = renderSampleQueueMarkdown(
      sampleQueue({ shippedAwaitingResponse: 1, oldestShippedDays: Infinity }),
    );
    expect(text).toContain("Oldest shipped: —");
  });
});

describe("composeDailyBrief — sampleQueue slice rendering", () => {
  it("renders the sample-queue section in morning brief when non-zero", () => {
    const out = composeDailyBrief({ ...baseInput(), sampleQueue: sampleQueue() });
    const json = JSON.stringify(out.blocks);
    expect(json).toContain("SAMPLE PIPELINE:");
    expect(json).toContain("awaiting ship");
  });

  it("OMITS the section when sampleQueue is undefined", () => {
    const out = composeDailyBrief(baseInput());
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain("SAMPLE PIPELINE:");
  });

  it("OMITS the section when both buckets are zero (quiet-collapse)", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      sampleQueue: sampleQueue({ awaitingShip: 0, shippedAwaitingResponse: 0 }),
    });
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain("SAMPLE PIPELINE:");
  });

  it("OMITS the section on EOD even when slice is provided", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      kind: "eod",
      sampleQueue: sampleQueue(),
    });
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain("SAMPLE PIPELINE:");
  });
});

// ---------------------------------------------------------------------------
// Phase D4 — reorder follow-ups
// ---------------------------------------------------------------------------

function reorderSummary(overrides: Partial<ReorderFollowUpSummary> = {}): ReorderFollowUpSummary {
  return {
    asOf: NOW.toISOString(),
    topCandidates: [
      {
        channel: "wholesale",
        id: "hubspot-deal:d1",
        displayName: "Thanksgiving Point",
        daysSinceLastOrder: 105,
        windowDays: 90,
        nextAction: "Move to Reorder stage + send check-in email",
        meta: { priorOrders: 1, lastOrderAt: NOW.toISOString(), extra: "Shipped → reorder window" },
      },
      {
        channel: "amazon-fbm",
        id: "amazon:amy-44094",
        displayName: "Amy Catalano",
        daysSinceLastOrder: 88,
        windowDays: 60,
        nextAction: "Send Amazon FBM first-time-buyer reorder offer",
        meta: { priorOrders: 1, extra: "WILOUGHBY HLS, OH" },
      },
    ],
    byChannel: [
      { channel: "wholesale", count: 1, windowDays: 90 },
      { channel: "amazon-fbm", count: 1, windowDays: 60 },
    ],
    total: 2,
    sources: [
      { system: "amazon-fbm-registry", retrievedAt: NOW.toISOString() },
      { system: "hubspot", retrievedAt: NOW.toISOString() },
    ],
    ...overrides,
  };
}

describe("renderReorderFollowUpsMarkdown — D4 formatting", () => {
  it("returns empty string when topCandidates is empty (quiet-collapse)", () => {
    const text = renderReorderFollowUpsMarkdown(
      reorderSummary({ topCandidates: [], byChannel: [], total: 0 }),
    );
    expect(text).toBe("");
  });

  it("renders header + bullets + per-channel footer", () => {
    const text = renderReorderFollowUpsMarkdown(reorderSummary());
    expect(text).toContain("REORDER WINDOW IS OPEN — 2 buyer(s) ready for round 2");
    expect(text).toContain("`wholesale` — 105d — Thanksgiving Point");
    expect(text).toContain("Shipped → reorder window");
    expect(text).toContain("`amazon-fbm` — 88d — Amy Catalano");
    expect(text).toContain("WILOUGHBY HLS, OH");
    expect(text).toContain("Per-channel: wholesale 1 (90d), amazon-fbm 1 (60d)");
  });

  it("omits the (extra) parens when meta.extra is empty", () => {
    const text = renderReorderFollowUpsMarkdown(
      reorderSummary({
        topCandidates: [
          {
            channel: "wholesale",
            id: "hubspot-deal:d1",
            displayName: "Foo Co",
            daysSinceLastOrder: 100,
            windowDays: 90,
            nextAction: "Reach out",
            meta: { priorOrders: 1 },
          },
        ],
        byChannel: [{ channel: "wholesale", count: 1, windowDays: 90 }],
        total: 1,
      }),
    );
    expect(text).toContain("`wholesale` — 100d — Foo Co —");
    expect(text).not.toMatch(/Foo Co \(/);
  });
});

describe("composeDailyBrief — reorderFollowUps slice rendering", () => {
  it("renders the section in morning brief when non-empty", () => {
    const out = composeDailyBrief({ ...baseInput(), reorderFollowUps: reorderSummary() });
    const json = JSON.stringify(out.blocks);
    expect(json).toContain("REORDER WINDOW IS OPEN");
    expect(json).toContain("Thanksgiving Point");
  });

  it("OMITS the section when reorderFollowUps is undefined", () => {
    const out = composeDailyBrief(baseInput());
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain("REORDER WINDOW IS OPEN");
  });

  it("OMITS the section when topCandidates is empty (quiet-collapse)", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      reorderFollowUps: reorderSummary({ topCandidates: [], byChannel: [], total: 0 }),
    });
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain("REORDER WINDOW IS OPEN");
  });

  it("OMITS the section on EOD even when slice is provided", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      kind: "eod",
      reorderFollowUps: reorderSummary(),
    });
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain("REORDER WINDOW IS OPEN");
  });
});

// ---------------------------------------------------------------------------
// Phase D3 — wholesale onboarding blockers
// ---------------------------------------------------------------------------

import type { OnboardingBlockersSummary } from "@/lib/sales/onboarding-blockers";
import { renderOnboardingBlockersMarkdown } from "@/lib/ops/control-plane/daily-brief";

function blockers(overrides: Partial<OnboardingBlockersSummary> = {}): OnboardingBlockersSummary {
  return {
    asOf: NOW.toISOString(),
    topBlockers: [
      {
        flowId: "flow-1",
        displayName: "Bryce Glamp & Camp",
        currentStep: "payment-path",
        daysSinceLastTouch: 4,
        stallHours: 24,
        nextAction: "Call buyer to clarify CC vs AP — they paused on payment path",
        hubspotDealId: "hs-100",
        totalSubtotalUsd: 3141,
      },
      {
        flowId: "flow-2",
        displayName: "Indian Pueblo Stores",
        currentStep: "ap-info",
        daysSinceLastTouch: 5,
        stallHours: 24,
        nextAction: "Email buyer requesting AP contact + tax ID — they didn't finish AP info",
      },
    ],
    byStep: [
      { step: "payment-path", count: 1 },
      { step: "ap-info", count: 1 },
    ],
    flowsScanned: 12,
    stalledTotal: 2,
    stallHours: 24,
    source: { system: "wholesale-onboarding-kv", retrievedAt: NOW.toISOString() },
    ...overrides,
  };
}

describe("renderOnboardingBlockersMarkdown — D3 formatting", () => {
  it("returns empty string when topBlockers is empty (quiet-collapse)", () => {
    const text = renderOnboardingBlockersMarkdown(
      blockers({ topBlockers: [], byStep: [], stalledTotal: 0 }),
    );
    expect(text).toBe("");
  });

  it("renders header + bullets + per-step footer + open-link", () => {
    const text = renderOnboardingBlockersMarkdown(blockers());
    expect(text).toContain("ONBOARDING JAMMED UP — 2 flow(s) parked past 24h");
    expect(text).toContain("scanned 12 total");
    expect(text).toContain("`payment-path` — 4d — Bryce Glamp & Camp ($3,141)");
    expect(text).toContain("`ap-info` — 5d — Indian Pueblo Stores");
    expect(text).toContain("Per-step: payment-path 1, ap-info 1");
    expect(text).toContain("/ops/wholesale/onboarding");
  });

  it("omits dollar amount when totalSubtotalUsd is undefined", () => {
    const text = renderOnboardingBlockersMarkdown(
      blockers({
        topBlockers: [
          {
            flowId: "flow-1",
            displayName: "Foo Co",
            currentStep: "info",
            daysSinceLastTouch: 3,
            stallHours: 24,
            nextAction: "Send first-touch chase",
          },
        ],
        byStep: [{ step: "info", count: 1 }],
        stalledTotal: 1,
      }),
    );
    expect(text).toContain("`info` — 3d — Foo Co —");
    expect(text).not.toMatch(/Foo Co \(\$/);
  });
});

describe("composeDailyBrief — onboardingBlockers slice rendering", () => {
  it("renders the section in morning brief when non-empty", () => {
    const out = composeDailyBrief({ ...baseInput(), onboardingBlockers: blockers() });
    const json = JSON.stringify(out.blocks);
    expect(json).toContain("ONBOARDING JAMMED UP");
    expect(json).toContain("Bryce Glamp & Camp");
  });

  it("OMITS the section when slice is undefined", () => {
    const out = composeDailyBrief(baseInput());
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain("ONBOARDING JAMMED UP");
  });

  it("OMITS the section when topBlockers is empty (quiet-collapse)", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      onboardingBlockers: blockers({ topBlockers: [], byStep: [], stalledTotal: 0 }),
    });
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain("ONBOARDING JAMMED UP");
  });

  it("OMITS the section on EOD even when slice is provided", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      kind: "eod",
      onboardingBlockers: blockers(),
    });
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain("ONBOARDING JAMMED UP");
  });
});

// ---------------------------------------------------------------------------
// Phase D5 v0.3 — enrichment opportunities (morning-brief slot)
// ---------------------------------------------------------------------------

import type { EnrichmentOpportunitiesSummary } from "@/lib/sales/enrichment-opportunities";
import { renderEnrichmentOpportunitiesMarkdown } from "@/lib/ops/control-plane/daily-brief";

function enrichSummary(overrides: Partial<EnrichmentOpportunitiesSummary> = {}): EnrichmentOpportunitiesSummary {
  return {
    asOf: NOW.toISOString(),
    scanned: 50,
    missingAny: 18,
    perField: [
      { field: "jobtitle", count: 12 },
      { field: "phone", count: 8 },
      { field: "company", count: 5 },
      { field: "city", count: 3 },
      { field: "state", count: 3 },
      { field: "firstname", count: 1 },
    ],
    source: { system: "hubspot", retrievedAt: NOW.toISOString() },
    ...overrides,
  };
}

describe("renderEnrichmentOpportunitiesMarkdown — D5 v0.3 formatting", () => {
  it("returns empty string when missingAny=0 (quiet-collapse)", () => {
    const text = renderEnrichmentOpportunitiesMarkdown(
      enrichSummary({ missingAny: 0, perField: [] }),
    );
    expect(text).toBe("");
  });

  it("renders header + top-5 fields + sweep hint", () => {
    const text = renderEnrichmentOpportunitiesMarkdown(enrichSummary());
    expect(text).toContain("INTEL UPGRADE — 18 contact(s) missing fields, ready to enrich");
    expect(text).toContain("scanned 50");
    expect(text).toContain("jobtitle 12");
    expect(text).toContain("phone 8");
    expect(text).toContain("company 5");
    expect(text).toContain("Sweep: `POST /api/ops/sales/apollo-enrich/sweep`");
  });

  it("caps top-fields display at 5", () => {
    const text = renderEnrichmentOpportunitiesMarkdown(enrichSummary());
    // perField has 6 entries; render should only show first 5.
    expect(text).not.toContain("firstname 1");
  });
});

describe("composeDailyBrief — enrichmentOpportunities slice rendering", () => {
  it("renders the section in morning brief when missingAny > 0", () => {
    const out = composeDailyBrief({ ...baseInput(), enrichmentOpportunities: enrichSummary() });
    const json = JSON.stringify(out.blocks);
    expect(json).toContain("INTEL UPGRADE");
  });

  it("OMITS the section when slice is undefined", () => {
    const out = composeDailyBrief(baseInput());
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain("INTEL UPGRADE");
  });

  it("OMITS the section when missingAny = 0 (quiet-collapse)", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      enrichmentOpportunities: enrichSummary({ missingAny: 0, perField: [] }),
    });
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain("INTEL UPGRADE");
  });

  it("OMITS the section on EOD even when slice is provided", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      kind: "eod",
      enrichmentOpportunities: enrichSummary(),
    });
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain("INTEL UPGRADE");
  });
});
