import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
const readSalesPipelineMock = vi.fn();
const readStaleBuyersMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

vi.mock("@/lib/ops/sales-command-readers", () => ({
  readSalesPipeline: (now: Date) => readSalesPipelineMock(now),
  readStaleBuyers: (now: Date) => readStaleBuyersMock(now),
}));

import { GET } from "../route";

function req() {
  return new Request("http://localhost/api/ops/hubspot/proactive");
}

beforeEach(() => {
  isAuthorizedMock.mockReset();
  readSalesPipelineMock.mockReset();
  readStaleBuyersMock.mockReset();
});

describe("GET /api/ops/hubspot/proactive", () => {
  it("401s unauthenticated requests", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(readSalesPipelineMock).not.toHaveBeenCalled();
  });

  it("returns a ready proactive report from wired HubSpot readers", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    readSalesPipelineMock.mockResolvedValueOnce({
      status: "wired",
      value: {
        stages: [],
        openDealCount: 0,
        staleSampleShipped: {
          total: 1,
          preview: [
            {
              id: "sample-1",
              dealname: "Sample Buyer",
              lastModifiedAt: "2026-04-01T00:00:00.000Z",
            },
          ],
        },
        openCallTasks: { total: 0, preview: [] },
      },
    });
    readStaleBuyersMock.mockResolvedValueOnce({
      status: "wired",
      value: {
        asOf: "2026-05-02T12:00:00.000Z",
        stalest: [],
        staleByStage: [],
        activeDealsScanned: 0,
        source: { system: "hubspot", retrievedAt: "2026-05-02T12:00:00.000Z" },
      },
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.report.status).toBe("ready");
    expect(body.report.counts.staleSamples).toBe(1);
  });

  it("returns degraded/error report without throwing when a reader errors", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    readSalesPipelineMock.mockResolvedValueOnce({
      status: "error",
      reason: "HubSpot down",
    });
    readStaleBuyersMock.mockResolvedValueOnce({
      status: "wired",
      value: {
        asOf: "2026-05-02T12:00:00.000Z",
        stalest: [],
        staleByStage: [],
        activeDealsScanned: 0,
        source: { system: "hubspot", retrievedAt: "2026-05-02T12:00:00.000Z" },
      },
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.report.status).toBe("error");
    expect(body.report.notes[0].reason).toBe("HubSpot down");
  });

  it("the route imports no HubSpot/QBO/Gmail/Slack write helpers directly", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      "src/app/api/ops/hubspot/proactive/route.ts",
      "utf8",
    );
    expect(src).not.toMatch(/createDeal|updateDealStage|createNote|logEmail/);
    expect(src).not.toMatch(/qbo|gmail|sendViaGmail|openApproval/i);
  });
});
