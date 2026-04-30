import { describe, expect, it } from "vitest";

import { HUBSPOT } from "@/lib/ops/hubspot-client";
import {
  SAMPLE_REQUESTED_BEHIND_THRESHOLD_DAYS,
  computeSampleQueueHealth,
} from "@/lib/sales/sample-queue";
import type { HubSpotDealForStaleness } from "@/lib/sales/stale-buyer";

const NOW = new Date("2026-04-30T15:00:00.000Z");

function deal(overrides: Partial<HubSpotDealForStaleness> = {}): HubSpotDealForStaleness {
  return {
    id: "deal-1",
    dealname: "Test Co",
    pipelineId: HUBSPOT.PIPELINE_B2B_WHOLESALE,
    stageId: HUBSPOT.STAGE_SAMPLE_REQUESTED,
    lastActivityAt: "2026-04-28T15:00:00.000Z", // 2d
    primaryContactId: null,
    primaryCompanyName: null,
    ...overrides,
  };
}

describe("computeSampleQueueHealth", () => {
  it("empty input yields zero counts and Infinity oldest values", () => {
    const r = computeSampleQueueHealth([], NOW, NOW.toISOString());
    expect(r.awaitingShip).toBe(0);
    expect(r.awaitingShipBehind).toBe(0);
    expect(r.shippedAwaitingResponse).toBe(0);
    expect(r.oldestRequestedDays).toBe(Infinity);
    expect(r.oldestShippedDays).toBe(Infinity);
    expect(r.behindThresholdDays).toBe(SAMPLE_REQUESTED_BEHIND_THRESHOLD_DAYS);
    expect(r.source).toEqual({ system: "hubspot", retrievedAt: NOW.toISOString() });
  });

  it("counts Sample Requested + Sample Shipped buckets", () => {
    const deals = [
      deal({ id: "r1", stageId: HUBSPOT.STAGE_SAMPLE_REQUESTED, lastActivityAt: "2026-04-29T15:00:00.000Z" }), // 1d
      deal({ id: "r2", stageId: HUBSPOT.STAGE_SAMPLE_REQUESTED, lastActivityAt: "2026-04-25T15:00:00.000Z" }), // 5d (behind)
      deal({ id: "s1", stageId: HUBSPOT.STAGE_SAMPLE_SHIPPED, lastActivityAt: "2026-04-20T15:00:00.000Z" }), // 10d
      deal({ id: "lead", stageId: HUBSPOT.STAGE_LEAD, lastActivityAt: "2026-04-29T15:00:00.000Z" }), // ignored
    ];
    const r = computeSampleQueueHealth(deals, NOW, NOW.toISOString());
    expect(r.awaitingShip).toBe(2);
    expect(r.awaitingShipBehind).toBe(1); // r2 at 5d > 3d threshold
    expect(r.shippedAwaitingResponse).toBe(1);
    expect(r.oldestRequestedDays).toBe(5);
    expect(r.oldestShippedDays).toBe(10);
  });

  it("ignores deals from other pipelines (defense in depth)", () => {
    const r = computeSampleQueueHealth(
      [
        deal({ pipelineId: "different-pipeline", stageId: HUBSPOT.STAGE_SAMPLE_REQUESTED }),
      ],
      NOW,
      NOW.toISOString(),
    );
    expect(r.awaitingShip).toBe(0);
  });

  it("respects custom behindThresholdDays", () => {
    const deals = [
      deal({ id: "r1", stageId: HUBSPOT.STAGE_SAMPLE_REQUESTED, lastActivityAt: "2026-04-25T15:00:00.000Z" }), // 5d
    ];
    const r = computeSampleQueueHealth(deals, NOW, NOW.toISOString(), {
      behindThresholdDays: 7,
    });
    expect(r.awaitingShipBehind).toBe(0);
    expect(r.behindThresholdDays).toBe(7);
  });

  it("treats null lastActivityAt as Infinity-aged (data hygiene)", () => {
    const deals = [
      deal({ id: "r1", stageId: HUBSPOT.STAGE_SAMPLE_REQUESTED, lastActivityAt: null }),
    ];
    const r = computeSampleQueueHealth(deals, NOW, NOW.toISOString());
    expect(r.awaitingShipBehind).toBe(1);
    expect(r.oldestRequestedDays).toBe(Infinity);
  });
});
