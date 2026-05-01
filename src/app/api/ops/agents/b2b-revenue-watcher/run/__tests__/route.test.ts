import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
const readStaleBuyersMock = vi.fn();
const readFaireFollowUpsMock = vi.fn();
const readPendingApprovalsMock = vi.fn();
const readWholesaleInquiriesMock = vi.fn();
const auditAppendMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

vi.mock("@/lib/ops/sales-command-readers", () => ({
  readStaleBuyers: (now: Date) => readStaleBuyersMock(now),
  readFaireFollowUps: (now: Date) => readFaireFollowUpsMock(now),
  readPendingApprovals: () => readPendingApprovalsMock(),
  readWholesaleInquiries: () => readWholesaleInquiriesMock(),
}));

vi.mock("@/lib/ops/control-plane/stores", () => ({
  auditStore: () => ({
    append: auditAppendMock,
  }),
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
  auditAppendMock.mockResolvedValue(undefined);
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
    expect(auditAppendMock).not.toHaveBeenCalled();
  });

  it("returns a heartbeat run record and appends a fail-soft audit entry", async () => {
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      runRecord: {
        runId: string;
        agentId: string;
        outputState: string;
        approvalSlugsRequested: string[];
        nextHumanAction: string | null;
      };
      summary: { staleBuyers: number | null; faireFollowUpsDue: number | null };
      degraded: string[];
    };
    expect(body.ok).toBe(true);
    expect(body.runRecord.agentId).toBe("b2b-revenue-watcher");
    expect(body.runRecord.outputState).toBe("task_created");
    expect(body.runRecord.approvalSlugsRequested).toEqual([]);
    expect(body.runRecord.nextHumanAction).toContain("/ops/sales");
    expect(body.summary.staleBuyers).toBe(2);
    expect(body.summary.faireFollowUpsDue).toBe(1);
    expect(body.degraded).toEqual([]);
    expect(auditAppendMock).toHaveBeenCalledTimes(1);
    const entry = auditAppendMock.mock.calls[0]?.[0] as {
      actorId: string;
      action: string;
      entityType: string;
      entityId: string;
      result: string;
      after: { outputState: string };
    };
    expect(entry.actorId).toBe("b2b-revenue-watcher");
    expect(entry.action).toBe("system.read");
    expect(entry.entityType).toBe("agent-heartbeat-run");
    expect(entry.entityId).toBe(body.runRecord.runId);
    expect(entry.result).toBe("ok");
    expect(entry.after.outputState).toBe("task_created");
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
    const entry = auditAppendMock.mock.calls[0]?.[0] as {
      result: string;
      error?: { code?: string; message?: string };
    };
    expect(entry.result).toBe("error");
    expect(entry.error?.code).toBe("heartbeat_failed_degraded");
    expect(entry.error?.message).toContain("HubSpot down");
  });

  it("does not fail the heartbeat when audit append fails", async () => {
    auditAppendMock.mockRejectedValueOnce(new Error("kv down"));
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; degraded: string[] };
    expect(body.ok).toBe(true);
    expect(body.degraded).toEqual(["audit-store: append failed (soft)"]);
  });
});
