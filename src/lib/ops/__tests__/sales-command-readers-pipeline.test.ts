import { beforeEach, describe, expect, it, vi } from "vitest";

const stageCountsMock = vi.fn();
const staleDealsMock = vi.fn();
const callTasksMock = vi.fn();

vi.mock("@/lib/ops/hubspot-client", () => ({
  readB2BWholesaleStageCounts: () => stageCountsMock(),
  readStaleSampleShippedDeals: (opts: unknown) => staleDealsMock(opts),
  readOpenHubSpotCallTasks: (opts: unknown) => callTasksMock(opts),
}));

import { readSalesPipeline } from "../sales-command-readers";

beforeEach(() => {
  stageCountsMock.mockReset();
  staleDealsMock.mockReset();
  callTasksMock.mockReset();
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

