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
    expect(watcher?.staleness).toBe("unknown");
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
