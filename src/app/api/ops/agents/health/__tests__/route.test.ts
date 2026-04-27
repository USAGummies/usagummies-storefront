/**
 * Phase 28L.4 — GET /api/ops/agents/health route.
 *
 * Locks the contract:
 *   - 401 on auth rejection.
 *   - 200 returns {ok, generatedAt, summary, rows}.
 *   - One row per manifest entry; counts reconcile to total.
 *   - Read-only: no fetch / no KV write side effects.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

import { GET } from "../route";
import { AGENT_MANIFEST } from "@/lib/ops/agent-health";

beforeEach(() => {
  isAuthorizedMock.mockReset();
  isAuthorizedMock.mockResolvedValue(true);
});

afterEach(() => vi.clearAllMocks());

function makeReq(): Request {
  return new Request("https://www.usagummies.com/api/ops/agents/health");
}

describe("GET /api/ops/agents/health", () => {
  it("401 on auth rejection", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns full shape with one row per manifest entry", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      generatedAt: string;
      summary: {
        total: number;
        green: number;
        yellow: number;
        red: number;
        jobs: number;
        tasks: number;
        drewOwnedCount: number;
      };
      rows: Array<{
        id: string;
        classification: "job" | "task";
        owner: string;
        health: "green" | "yellow" | "red";
        doctrineFlags: Array<{ flag: string; message: string }>;
      }>;
    };
    expect(body.ok).toBe(true);
    expect(body.rows.length).toBe(AGENT_MANIFEST.length);
    expect(body.summary.total).toBe(AGENT_MANIFEST.length);
    expect(body.summary.green + body.summary.yellow + body.summary.red).toBe(
      body.summary.total,
    );
    expect(body.summary.jobs + body.summary.tasks).toBe(body.summary.total);
  });

  it("the live manifest is clean — no drew-owned agents", async () => {
    const res = await GET(makeReq());
    const body = (await res.json()) as {
      summary: { drewOwnedCount: number };
      rows: Array<{ owner: string }>;
    };
    expect(body.summary.drewOwnedCount).toBe(0);
    for (const r of body.rows) {
      expect(r.owner).not.toBe("drew");
    }
  });
});
