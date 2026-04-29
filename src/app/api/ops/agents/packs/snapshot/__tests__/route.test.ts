/**
 * Tests for GET /api/ops/agents/packs/snapshot — backing route for
 * Codex's `ops.agent.packs` MCP tool.
 *
 * Verifies:
 *   - 401 on missing/wrong CRON_SECRET
 *   - happy path returns the same shape as buildPacksView()
 *
 * The route reads /contracts/*.md from disk (drift detector + lockstep
 * auditor); we run with cwd at repo root so those files exist. The
 * heavy logic is already test-locked under
 * src/lib/ops/agents-packs/__tests__/ — this test ONLY locks the
 * route contract (auth + JSON shape).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const PRIOR_CRON = process.env.CRON_SECRET;
const FAKE_SECRET = "test-cron-secret-snapshot";

function req(): Request {
  return new Request("http://localhost/api/ops/agents/packs/snapshot", {
    method: "GET",
    headers: { authorization: `Bearer ${FAKE_SECRET}` },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = FAKE_SECRET;
});

afterEach(() => {
  if (PRIOR_CRON !== undefined) process.env.CRON_SECRET = PRIOR_CRON;
  else delete process.env.CRON_SECRET;
});

describe("GET /api/ops/agents/packs/snapshot", () => {
  it("401s when CRON_SECRET missing", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("401s when bearer doesn't match", async () => {
    const bad = new Request("http://localhost/api/ops/agents/packs/snapshot", {
      headers: { authorization: "Bearer wrong-secret" },
    });
    const { GET } = await import("../route");
    const res = await GET(bad);
    expect(res.status).toBe(401);
  });

  it("happy path returns ok=true with packs array + invariants + p0Status", async () => {
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean;
      generatedAt: string;
      packs: Array<{ pack: { id: string }; agents: unknown[] }>;
      invariants: {
        drewOwnsNothing: boolean;
        allSlugsResolve: boolean;
        noNewDivisions: boolean;
        noNewSlugs: boolean;
      };
      p0Status: Array<{ id: string; state: string }>;
      ghostWarning: { triggered: boolean };
    };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.packs)).toBe(true);
    expect(body.packs.length).toBe(6);
    expect(body.invariants.drewOwnsNothing).toBe(true);
    expect(body.invariants.allSlugsResolve).toBe(true);
    expect(body.invariants.noNewDivisions).toBe(true);
    expect(body.invariants.noNewSlugs).toBe(true);
    // All 7 P0s should be implemented in the table
    const ids = body.p0Status.map((p) => p.id).sort();
    expect(ids).toEqual(["P0-1", "P0-2", "P0-3", "P0-4", "P0-5", "P0-6", "P0-7"]);
    for (const p of body.p0Status) {
      expect(p.state, `${p.id} should be implemented`).toBe("implemented");
    }
  });
});
