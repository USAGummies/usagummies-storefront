/**
 * viktor-pipeline tests — pure digest composition.
 */
import { describe, expect, it } from "vitest";

import { HUBSPOT, type PipelineDeal } from "../hubspot-client";
import {
  PIPELINE_STALE_DAYS,
  renderPipelineDigest,
  summarizePipeline,
} from "../viktor-pipeline";

function deal(overrides: Partial<PipelineDeal> = {}): PipelineDeal {
  return {
    id: "hs-1",
    dealname: "Test Deal",
    dealstage: HUBSPOT.STAGE_LEAD,
    amount: 1000,
    closedate: null,
    createdate: "2026-03-01T00:00:00Z",
    lastmodifieddate: "2026-04-20T00:00:00Z",
    daysSinceLastActivity: 1,
    ...overrides,
  };
}

const FIXED_NOW = new Date("2026-04-21T00:00:00Z");

describe("summarizePipeline", () => {
  it("handles empty deal list", () => {
    const d = summarizePipeline([], FIXED_NOW);
    expect(d.totalDeals).toBe(0);
    expect(d.totalOpenDollars).toBe(0);
    expect(d.rollup).toEqual([]);
    expect(d.staleDeals).toEqual([]);
    expect(d.closingSoon).toEqual([]);
    expect(d.top5).toEqual([]);
  });

  it("aggregates by stage with correct totals", () => {
    const deals = [
      deal({ id: "a", dealstage: HUBSPOT.STAGE_LEAD, amount: 500 }),
      deal({ id: "b", dealstage: HUBSPOT.STAGE_LEAD, amount: 1500 }),
      deal({ id: "c", dealstage: HUBSPOT.STAGE_PO_RECEIVED, amount: 3000 }),
    ];
    const d = summarizePipeline(deals, FIXED_NOW);
    expect(d.totalDeals).toBe(3);
    const lead = d.rollup.find((r) => r.stage === HUBSPOT.STAGE_LEAD);
    const po = d.rollup.find((r) => r.stage === HUBSPOT.STAGE_PO_RECEIVED);
    expect(lead?.count).toBe(2);
    expect(lead?.totalDollars).toBe(2000);
    expect(po?.count).toBe(1);
    expect(po?.totalDollars).toBe(3000);
  });

  it("sorts rollup by totalDollars desc", () => {
    const deals = [
      deal({ id: "a", dealstage: HUBSPOT.STAGE_LEAD, amount: 100 }),
      deal({ id: "b", dealstage: HUBSPOT.STAGE_PO_RECEIVED, amount: 5000 }),
      deal({ id: "c", dealstage: HUBSPOT.STAGE_SHIPPED, amount: 1000 }),
    ];
    const d = summarizePipeline(deals, FIXED_NOW);
    expect(d.rollup.map((r) => r.stage)).toEqual([
      HUBSPOT.STAGE_PO_RECEIVED,
      HUBSPOT.STAGE_SHIPPED,
      HUBSPOT.STAGE_LEAD,
    ]);
  });

  it("excludes shipped + closed-won from totalOpenDollars", () => {
    const deals = [
      deal({ id: "a", dealstage: HUBSPOT.STAGE_LEAD, amount: 1000 }),
      deal({ id: "b", dealstage: HUBSPOT.STAGE_SHIPPED, amount: 5000 }),
      deal({ id: "c", dealstage: HUBSPOT.STAGE_CLOSED_WON, amount: 9000 }),
    ];
    const d = summarizePipeline(deals, FIXED_NOW);
    expect(d.totalOpenDollars).toBe(1000);
  });

  it("flags stale deals (>14d idle) — open stages only", () => {
    const deals = [
      deal({
        id: "stale-open",
        dealstage: HUBSPOT.STAGE_LEAD,
        daysSinceLastActivity: 30,
      }),
      deal({
        id: "fresh-open",
        dealstage: HUBSPOT.STAGE_LEAD,
        daysSinceLastActivity: 5,
      }),
      deal({
        id: "stale-shipped",
        dealstage: HUBSPOT.STAGE_SHIPPED,
        daysSinceLastActivity: 100,
      }),
    ];
    const d = summarizePipeline(deals, FIXED_NOW);
    expect(d.staleDeals.map((x) => x.id)).toEqual(["stale-open"]);
    // Stale count on Lead = 1 (stale-open)
    const lead = d.rollup.find((r) => r.stage === HUBSPOT.STAGE_LEAD);
    expect(lead?.staleCount).toBe(1);
  });

  it("identifies closingSoon deals (closedate within 30d, open stages only)", () => {
    const deals = [
      deal({
        id: "soon",
        dealstage: HUBSPOT.STAGE_PO_RECEIVED,
        closedate: "2026-05-05T00:00:00Z",
      }),
      deal({
        id: "far",
        dealstage: HUBSPOT.STAGE_PO_RECEIVED,
        closedate: "2026-12-01T00:00:00Z",
      }),
      deal({
        id: "shipped-soon",
        dealstage: HUBSPOT.STAGE_SHIPPED,
        closedate: "2026-05-05T00:00:00Z",
      }),
    ];
    const d = summarizePipeline(deals, FIXED_NOW);
    expect(d.closingSoon.map((x) => x.id)).toEqual(["soon"]);
  });

  it("top5 excludes shipped + closed-won, sorts by amount desc", () => {
    const deals = [
      deal({ id: "small", dealstage: HUBSPOT.STAGE_LEAD, amount: 100 }),
      deal({ id: "huge", dealstage: HUBSPOT.STAGE_PO_RECEIVED, amount: 50000 }),
      deal({ id: "shipped", dealstage: HUBSPOT.STAGE_SHIPPED, amount: 99999 }),
      deal({ id: "medium", dealstage: HUBSPOT.STAGE_LEAD, amount: 2000 }),
    ];
    const d = summarizePipeline(deals, FIXED_NOW);
    expect(d.top5.map((x) => x.id)).toEqual(["huge", "medium", "small"]);
    expect(d.top5.find((x) => x.id === "shipped")).toBeUndefined();
  });

  it("PIPELINE_STALE_DAYS is 14", () => {
    expect(PIPELINE_STALE_DAYS).toBe(14);
  });
});

describe("renderPipelineDigest", () => {
  it("includes stage breakdown + stale flag when present", () => {
    const deals = [
      deal({
        id: "a",
        dealstage: HUBSPOT.STAGE_LEAD,
        amount: 1000,
        daysSinceLastActivity: 30,
      }),
      deal({
        id: "b",
        dealstage: HUBSPOT.STAGE_PO_RECEIVED,
        amount: 5000,
        daysSinceLastActivity: 1,
      }),
    ];
    const digest = summarizePipeline(deals, FIXED_NOW);
    const text = renderPipelineDigest(digest);
    expect(text).toContain("Viktor pipeline digest");
    expect(text).toContain("Stage breakdown");
    expect(text).toContain("PO Received");
    expect(text).toContain("Lead");
    expect(text).toContain(":warning:"); // stale flag
  });

  it("shows closing-soon block when non-empty", () => {
    const deals = [
      deal({
        id: "close",
        dealstage: HUBSPOT.STAGE_PO_RECEIVED,
        amount: 2000,
        closedate: "2026-05-01T00:00:00Z",
      }),
    ];
    const text = renderPipelineDigest(summarizePipeline(deals, FIXED_NOW));
    expect(text).toContain("Expected to close in 30 days");
    expect(text).toContain("2026-05-01");
  });

  it("renders doctrine footer for Viktor's role", () => {
    const text = renderPipelineDigest(summarizePipeline([], FIXED_NOW));
    expect(text).toContain("Viktor maintains pipeline");
  });
});
