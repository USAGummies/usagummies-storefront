import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
const readStaleBuyersMock = vi.fn();
const readFaireFollowUpsMock = vi.fn();
const readPendingApprovalsMock = vi.fn();
const readWholesaleInquiriesMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

vi.mock("@/lib/ops/sales-command-readers", () => ({
  readStaleBuyers: (now: Date) => readStaleBuyersMock(now),
  readFaireFollowUps: (now: Date) => readFaireFollowUpsMock(now),
  readPendingApprovals: () => readPendingApprovalsMock(),
  readWholesaleInquiries: () => readWholesaleInquiriesMock(),
}));

import { sourceError, sourceWired } from "@/lib/ops/sales-command-center";

function req(): Request {
  return new Request(
    "https://www.usagummies.com/api/ops/agents/b2b-revenue-watcher/run",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  isAuthorizedMock.mockResolvedValue(true);
  readStaleBuyersMock.mockResolvedValue(
    sourceWired({
      asOf: "2026-04-30T12:00:00.000Z",
      stalest: [],
      staleByStage: [{ stageName: "Contacted", count: 2, thresholdDays: 5 }],
      activeDealsScanned: 10,
      source: { system: "hubspot", retrievedAt: "2026-04-30T12:00:00.000Z" },
    }),
  );
  readFaireFollowUpsMock.mockResolvedValue(
    sourceWired({
      counts: { overdue: 1, due_soon: 0, not_due: 3, sent_total: 4 },
      actionable: [],
    }),
  );
  readPendingApprovalsMock.mockResolvedValue(
    sourceWired({ total: 0, byTargetType: {}, preview: [] }),
  );
  readWholesaleInquiriesMock.mockResolvedValue(sourceWired({ total: 5 }));
});

describe("GET /api/ops/agents/b2b-revenue-watcher/run", () => {
  it("401s unauthenticated requests", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns a heartbeat run record without opening approvals", async () => {
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      runRecord: {
        agentId: string;
        outputState: string;
        approvalSlugsRequested: string[];
        nextHumanAction: string | null;
      };
      summary: { staleBuyers: number | null; faireFollowUpsDue: number | null };
    };
    expect(body.ok).toBe(true);
    expect(body.runRecord.agentId).toBe("b2b-revenue-watcher");
    expect(body.runRecord.outputState).toBe("task_created");
    expect(body.runRecord.approvalSlugsRequested).toEqual([]);
    expect(body.runRecord.nextHumanAction).toContain("/ops/sales");
    expect(body.summary.staleBuyers).toBe(2);
    expect(body.summary.faireFollowUpsDue).toBe(1);
  });

  it("surfaces degraded readers without throwing", async () => {
    readStaleBuyersMock.mockResolvedValueOnce(sourceError("HubSpot down"));
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      runRecord: { outputState: string; degradedSources: string[] };
    };
    expect(body.runRecord.outputState).toBe("failed_degraded");
    expect(body.runRecord.degradedSources).toEqual([
      "staleBuyers: HubSpot down",
    ]);
  });
});
