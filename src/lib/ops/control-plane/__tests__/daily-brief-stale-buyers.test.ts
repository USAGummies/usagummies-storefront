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
  renderSampleQueueMarkdown,
  renderStaleBuyersMarkdown,
  type BriefInput,
} from "@/lib/ops/control-plane/daily-brief";
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
    expect(text).toContain("Stale buyers — 2 deal(s) need follow-up");
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
    expect(json).toContain("Stale buyers");
    expect(json).toContain("Indian Pueblo Stores");
  });

  it("OMITS the section when staleBuyers slice is undefined", () => {
    const out = composeDailyBrief(baseInput());
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain("Stale buyers");
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
    expect(json).not.toContain("Stale buyers");
  });

  it("OMITS the section on EOD even when slice is provided", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      kind: "eod",
      staleBuyers: summary(),
    });
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain("Stale buyers");
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
    expect(json).toContain("Sample queue:");
    expect(json).toContain("awaiting ship");
  });

  it("OMITS the section when sampleQueue is undefined", () => {
    const out = composeDailyBrief(baseInput());
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain("Sample queue:");
  });

  it("OMITS the section when both buckets are zero (quiet-collapse)", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      sampleQueue: sampleQueue({ awaitingShip: 0, shippedAwaitingResponse: 0 }),
    });
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain("Sample queue:");
  });

  it("OMITS the section on EOD even when slice is provided", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      kind: "eod",
      sampleQueue: sampleQueue(),
    });
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain("Sample queue:");
  });
});
