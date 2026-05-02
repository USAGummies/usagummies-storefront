import { describe, expect, it } from "vitest";

import { sourceError, sourceNotWired, sourceWired } from "../sales-command-center";
import {
  buildHubSpotProactiveReport,
  renderHubSpotProactiveBriefLine,
} from "../hubspot-proactive";

const NOW = new Date("2026-05-02T12:00:00.000Z");

function pipeline(overrides = {}) {
  return {
    stages: [],
    openDealCount: 0,
    staleSampleShipped: {
      total: 1,
      preview: [
        {
          id: "deal-sample",
          dealname: "Sample Buyer",
          lastModifiedAt: "2026-04-10T12:00:00.000Z",
        },
      ],
    },
    openCallTasks: {
      total: 1,
      preview: [
        {
          id: "task-1",
          subject: "Call buyer",
          priority: "HIGH",
          dueAt: "2026-05-01T12:00:00.000Z",
        },
      ],
    },
    ...overrides,
  };
}

function staleBuyers(overrides = {}) {
  return {
    asOf: NOW.toISOString(),
    stalest: [
      {
        dealId: "deal-old",
        dealName: "Old Buyer",
        stageName: "Contacted",
        daysSinceActivity: 28,
        thresholdDays: 5,
        isStale: true,
        nextAction: "Send follow-up",
        primaryContactId: null,
        primaryCompanyName: null,
      },
    ],
    staleByStage: [{ stageName: "Contacted", count: 1, thresholdDays: 5 }],
    activeDealsScanned: 2,
    source: { system: "hubspot" as const, retrievedAt: NOW.toISOString() },
    ...overrides,
  };
}

describe("buildHubSpotProactiveReport", () => {
  it("builds a proactive queue from stale buyers, samples, and call tasks", () => {
    const report = buildHubSpotProactiveReport({
      salesPipeline: sourceWired(pipeline()),
      staleBuyers: sourceWired(staleBuyers()),
      now: NOW,
    });

    expect(report.status).toBe("ready");
    expect(report.counts.total).toBe(3);
    expect(report.counts.staleBuyers).toBe(1);
    expect(report.counts.staleSamples).toBe(1);
    expect(report.counts.openCallTasks).toBe(1);
    expect(report.topItems[0].label).toBe("Old Buyer");
    expect(report.topItems[0].severity).toBe("critical");
    expect(report.closingMachine.counts.total).toBe(3);
    expect(report.closingMachine.lanes.map((lane) => lane.lane)).toContain(
      "sample_shipped",
    );
  });

  it("keeps wired empty as ready zero, not not_wired", () => {
    const report = buildHubSpotProactiveReport({
      salesPipeline: sourceWired(
        pipeline({
          staleSampleShipped: { total: 0, preview: [] },
          openCallTasks: { total: 0, preview: [] },
        }),
      ),
      staleBuyers: sourceWired(staleBuyers({ stalest: [], staleByStage: [] })),
      now: NOW,
    });

    expect(report.status).toBe("ready");
    expect(report.counts.total).toBe(0);
    expect(renderHubSpotProactiveBriefLine(report)).toBe(
      "HubSpot proactive queue: quiet",
    );
  });

  it("surfaces source errors instead of fabricating zero", () => {
    const report = buildHubSpotProactiveReport({
      salesPipeline: sourceError("HubSpot stage read failed"),
      staleBuyers: sourceWired(staleBuyers()),
      now: NOW,
    });

    expect(report.status).toBe("error");
    expect(report.notes).toContainEqual({
      source: "salesPipeline",
      state: "error",
      reason: "HubSpot stage read failed",
    });
    expect(renderHubSpotProactiveBriefLine(report)).toBe(
      "HubSpot proactive queue: degraded",
    );
  });

  it("surfaces not_wired when sources are missing", () => {
    const report = buildHubSpotProactiveReport({
      salesPipeline: sourceNotWired("HUBSPOT_PRIVATE_APP_TOKEN missing"),
      now: NOW,
    });

    expect(report.status).toBe("not_wired");
    expect(report.notes.map((n) => n.source)).toEqual([
      "salesPipeline",
      "staleBuyers",
    ]);
    expect(renderHubSpotProactiveBriefLine(report)).toBe(
      "HubSpot proactive queue: not wired",
    );
  });

  it("caps top items deterministically", () => {
    const report = buildHubSpotProactiveReport({
      salesPipeline: sourceWired(
        pipeline({
          staleSampleShipped: {
            total: 3,
            preview: [
              { id: "a", dealname: "A", lastModifiedAt: "2026-04-01T00:00:00.000Z" },
              { id: "b", dealname: "B", lastModifiedAt: "2026-04-02T00:00:00.000Z" },
              { id: "c", dealname: "C", lastModifiedAt: "2026-04-03T00:00:00.000Z" },
            ],
          },
          openCallTasks: { total: 0, preview: [] },
        }),
      ),
      staleBuyers: sourceWired(staleBuyers({ stalest: [], staleByStage: [] })),
      now: NOW,
      topLimit: 2,
    });

    expect(report.counts.total).toBe(3);
    expect(report.topItems.map((i) => i.label)).toEqual(["A", "B"]);
  });
});
