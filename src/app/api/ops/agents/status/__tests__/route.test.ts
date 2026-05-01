/**
 * GET /api/ops/agents/status
 *
 * Locks the status strip contract for the agent runtime manifest:
 * auth-gated, audit-log-backed, and includes the B2B Revenue Watcher
 * dry-run as an intentionally unscheduled/manual heartbeat.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
const recentMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

vi.mock("@/lib/ops/control-plane/stores", () => ({
  auditStore: () => ({
    recent: recentMock,
  }),
}));

import { GET } from "../route";

beforeEach(() => {
  isAuthorizedMock.mockReset();
  isAuthorizedMock.mockResolvedValue(true);
  recentMock.mockReset();
  recentMock.mockResolvedValue([]);
});

afterEach(() => vi.clearAllMocks());

function makeReq(): Request {
  return new Request("https://www.usagummies.com/api/ops/agents/status");
}

describe("GET /api/ops/agents/status", () => {
  it("401 on auth rejection", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(recentMock).not.toHaveBeenCalled();
  });

  it("includes B2B Revenue Watcher with audit-only cron metadata", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      agents: Array<{
        id: string;
        runtimePath: string;
        cadence: string;
        channel: string;
        notes?: string;
        lastSummary: string | null;
        staleness: string;
        stalenessReason: string;
      }>;
    };
    expect(body.ok).toBe(true);
    const watcher = body.agents.find((a) => a.id === "b2b-revenue-watcher");
    expect(watcher).toBeDefined();
    expect(watcher?.runtimePath).toBe(
      "/api/ops/agents/b2b-revenue-watcher/run",
    );
    expect(watcher?.cadence).toMatch(/14:45 UTC/i);
    expect(watcher?.channel).toContain("OpenAI workspace tool");
    expect(watcher?.notes).toMatch(/Read-only heartbeat/i);
    expect(watcher?.lastSummary).toBeNull();
    expect(watcher?.staleness).toBe("unknown");
  });

  it("includes Email Agents Readiness as a manual read-only heartbeat", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      agents: Array<{
        id: string;
        runtimePath: string;
        cadence: string;
        channel: string;
        notes?: string;
      }>;
    };
    const agent = body.agents.find((a) => a.id === "email-agents-readiness");
    expect(agent).toBeDefined();
    expect(agent?.runtimePath).toBe("/api/ops/agents/email-intel/run");
    expect(agent?.cadence).toMatch(/manual/i);
    expect(agent?.channel).toContain("/ops/email-agents");
    expect(agent?.notes).toMatch(/no Gmail scan/i);
    expect(agent?.notes).toMatch(/direct email-intel runner/i);
  });

  it("surfaces the latest audit summary and error message", async () => {
    recentMock.mockResolvedValueOnce([
      {
        id: "audit-1",
        runId: "run-1",
        division: "sales",
        actorType: "agent",
        actorId: "b2b-revenue-watcher",
        action: "system.read",
        entityType: "agent-heartbeat-run",
        entityId: "run-1",
        result: "error",
        after: {
          summary: {
            summary:
              "B2B Revenue Watcher found 2 stale B2B buyer(s). Top stale buyer: Retailer 1.",
          },
        },
        error: { message: "staleBuyers: HubSpot rate limited" },
        sourceCitations: [],
        createdAt: new Date().toISOString(),
      },
    ]);

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      agents: Array<{
        id: string;
        lastResult: string | null;
        lastSummary: string | null;
        lastError: string | null;
      }>;
    };
    const watcher = body.agents.find((a) => a.id === "b2b-revenue-watcher");
    expect(watcher).toMatchObject({
      lastResult: "error",
      lastSummary:
        "B2B Revenue Watcher found 2 stale B2B buyer(s). Top stale buyer: Retailer 1.",
      lastError: "staleBuyers: HubSpot rate limited",
    });
  });

  it("surfaces latest email readiness heartbeat audit entries", async () => {
    recentMock.mockResolvedValueOnce([
      {
        id: "audit-email-1",
        runId: "email-run-1",
        division: "platform-data-automation",
        actorType: "agent",
        actorId: "email-agents-readiness",
        action: "system.read",
        entityType: "agent-heartbeat-run",
        entityId: "email-run-1",
        result: "ok",
        after: {
          summary: "Email agents remain blocked (5/6 gates passed).",
        },
        sourceCitations: [],
        createdAt: new Date().toISOString(),
      },
    ]);

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      agents: Array<{
        id: string;
        lastResult: string | null;
        lastSummary: string | null;
        lastError: string | null;
      }>;
    };
    const agent = body.agents.find((a) => a.id === "email-agents-readiness");
    expect(agent).toMatchObject({
      lastResult: "ok",
      lastSummary: "Email agents remain blocked (5/6 gates passed).",
      lastError: null,
    });
  });

  it("degrades honestly when the audit store fails", async () => {
    recentMock.mockRejectedValueOnce(new Error("kv down"));
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      degraded: string[];
      agents: Array<{ id: string; lastRunAt: string | null }>;
    };
    expect(body.degraded.join("\n")).toContain("kv down");
    expect(
      body.agents.find((a) => a.id === "b2b-revenue-watcher")?.lastRunAt,
    ).toBeNull();
  });
});
