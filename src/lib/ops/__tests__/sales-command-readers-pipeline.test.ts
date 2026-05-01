import { beforeEach, describe, expect, it, vi } from "vitest";

const stageCountsMock = vi.fn();
const staleDealsMock = vi.fn();
const callTasksMock = vi.fn();
const listRecentDealsMock = vi.fn();

vi.mock("@/lib/ops/hubspot-client", () => ({
  HUBSPOT: { PIPELINE_B2B_WHOLESALE: "b2b-pipeline" },
  HUBSPOT_B2B_STAGES: [
    { id: "lead", name: "Lead" },
    { id: "contacted", name: "Contacted" },
    { id: "closed-won", name: "Closed Won" },
  ],
  readB2BWholesaleStageCounts: () => stageCountsMock(),
  readStaleSampleShippedDeals: (opts: unknown) => staleDealsMock(opts),
  readOpenHubSpotCallTasks: (opts: unknown) => callTasksMock(opts),
  listRecentDeals: (opts: unknown) => listRecentDealsMock(opts),
}));

import { readSalesPipeline, readStaleBuyers } from "../sales-command-readers";

beforeEach(() => {
  stageCountsMock.mockReset();
  staleDealsMock.mockReset();
  callTasksMock.mockReset();
  listRecentDealsMock.mockReset();
});

describe("readSalesPipeline", () => {
  const now = new Date("2026-04-30T12:00:00.000Z");

  it("returns a wired pipeline summary when all HubSpot reads succeed", async () => {
    stageCountsMock.mockResolvedValueOnce({
      ok: true,
      value: [
        { id: "lead", name: "Lead", count: 2 },
        { id: "won", name: "Closed Won", count: 9 },
      ],
    });
    staleDealsMock.mockResolvedValueOnce({
      ok: true,
      value: [{ id: "d1", dealname: "Store A", lastModifiedAt: "2026-04-01T00:00:00.000Z" }],
    });
    callTasksMock.mockResolvedValueOnce({
      ok: true,
      value: [{ id: "t1", subject: "Call buyer", priority: "HIGH", dueAt: null }],
    });

    const state = await readSalesPipeline(now);
    expect(staleDealsMock).toHaveBeenCalledWith({ now, olderThanDays: 7, limit: 20 });
    expect(callTasksMock).toHaveBeenCalledWith({ limit: 25 });
    expect(state.status).toBe("wired");
    if (state.status !== "wired") return;
    expect(state.value.openDealCount).toBe(2);
    expect(state.value.staleSampleShipped.total).toBe(1);
    expect(state.value.openCallTasks.total).toBe(1);
  });

  it("returns error instead of wired zero when stage counts fail", async () => {
    stageCountsMock.mockResolvedValueOnce({
      ok: false,
      reason: "HubSpot auth failed",
    });
    staleDealsMock.mockResolvedValueOnce({ ok: true, value: [] });
    callTasksMock.mockResolvedValueOnce({ ok: true, value: [] });
    const state = await readSalesPipeline(now);
    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.reason).toContain("HubSpot auth failed");
    }
  });

  it("isolates thrown HubSpot client failures as SourceState error", async () => {
    stageCountsMock.mockRejectedValueOnce(new Error("network down"));
    staleDealsMock.mockResolvedValueOnce({ ok: true, value: [] });
    callTasksMock.mockResolvedValueOnce({ ok: true, value: [] });
    const state = await readSalesPipeline(now);
    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.reason).toContain("network down");
    }
  });
});

describe("readStaleBuyers", () => {
  const now = new Date("2026-04-30T12:00:00.000Z");

  it("returns a wired stale-buyer summary from HubSpot deals", async () => {
    listRecentDealsMock.mockResolvedValueOnce([
      {
        id: "d-old",
        dealname: "Old Buyer",
        dealstage: "contacted",
        lastmodifieddate: "2026-04-01T12:00:00.000Z",
      },
      {
        id: "d-fresh",
        dealname: "Fresh Buyer",
        dealstage: "contacted",
        lastmodifieddate: "2026-04-29T12:00:00.000Z",
      },
    ]);
    const state = await readStaleBuyers(now, { limit: 25 });
    expect(listRecentDealsMock).toHaveBeenCalledWith({ limit: 25 });
    expect(state.status).toBe("wired");
    if (state.status !== "wired") return;
    expect(state.value.activeDealsScanned).toBe(2);
    expect(state.value.stalest.map((d) => d.dealId)).toEqual(["d-old"]);
    expect(state.value.staleByStage).toEqual([
      { stageName: "Contacted", count: 1, thresholdDays: 5 },
    ]);
  });

  it("returns error instead of wired zero when HubSpot throws", async () => {
    listRecentDealsMock.mockRejectedValueOnce(new Error("rate_limited"));
    const state = await readStaleBuyers(now);
    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.reason).toContain("rate_limited");
    }
  });

  it("clamps listRecentDeals limit to [1,500]", async () => {
    listRecentDealsMock.mockResolvedValue([]);
    await readStaleBuyers(now, { limit: 100_000 });
    expect(listRecentDealsMock).toHaveBeenLastCalledWith({ limit: 500 });
    await readStaleBuyers(now, { limit: -5 });
    expect(listRecentDealsMock).toHaveBeenLastCalledWith({ limit: 1 });
  });
});
