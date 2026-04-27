/**
 * Phase 31.1 — GET /api/ops/uspto/trademarks route.
 *
 * Locks the contract:
 *   - 401 on auth rejection.
 *   - 200 returns the canonical shape: {ok, generatedAt, summary, rows, actionable}.
 *   - Empty registry honestly returns 0 rows + zero-summary (no fabrication).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

import { GET } from "../route";

beforeEach(() => {
  isAuthorizedMock.mockReset();
  isAuthorizedMock.mockResolvedValue(true);
});

afterEach(() => vi.clearAllMocks());

function makeReq(): Request {
  return new Request("https://www.usagummies.com/api/ops/uspto/trademarks");
}

describe("GET /api/ops/uspto/trademarks", () => {
  it("401 on auth rejection", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns ok=true with canonical shape", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      generatedAt: string;
      summary: {
        total: number;
        byUrgency: { critical: number; high: number; medium: number; low: number };
      };
      rows: unknown[];
      actionable: unknown[];
    };
    expect(body.ok).toBe(true);
    expect(typeof body.generatedAt).toBe("string");
    expect(Array.isArray(body.rows)).toBe(true);
    expect(Array.isArray(body.actionable)).toBe(true);
    // Empty registry → honest zeros, not fabricated rows.
    expect(body.summary.total).toBe(body.rows.length);
    expect(
      body.summary.byUrgency.critical +
        body.summary.byUrgency.high +
        body.summary.byUrgency.medium +
        body.summary.byUrgency.low,
    ).toBe(body.rows.length);
  });
});
