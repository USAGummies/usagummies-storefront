/**
 * /api/ops/shipping/today route — Build 2 close-out.
 *
 * Pins:
 *   - 401 when unauthorized.
 *   - 200 + summary on happy path.
 *   - Fetcher failure surfaces via summary.degraded; route still 200s.
 *   - Source guards: no shipstation buy / cancel / wallet-add imports.
 *   - Read-only: no POST/PUT/PATCH/DELETE exports.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
const fetchInputsMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

vi.mock("@/lib/ops/shipping-today-fetch", () => ({
  fetchShippingTodayInputs: () => fetchInputsMock(),
}));

import { GET } from "../route";

function req(): Request {
  return new Request("https://www.usagummies.com/api/ops/shipping/today");
}

beforeEach(() => {
  isAuthorizedMock.mockReset().mockResolvedValue(true);
  fetchInputsMock.mockReset().mockResolvedValue({
    retryQueue: [],
    pendingApprovals: [],
    wallet: [],
    degraded: [],
  });
});

describe("GET /api/ops/shipping/today", () => {
  it("401 when unauthorized", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("200 + summary on happy path (clean state → green)", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      summary: { posture: string };
    };
    expect(body.ok).toBe(true);
    expect(body.summary.posture).toBe("green");
  });

  it("forwards fetcher degraded list into summary.degraded", async () => {
    fetchInputsMock.mockResolvedValueOnce({
      retryQueue: [],
      pendingApprovals: [],
      wallet: [
        { carrierCode: "stamps_com", balanceUsd: null, fetchError: "500" },
      ],
      degraded: ["wallet:stamps_com:500"],
    });
    const res = await GET(req());
    const body = (await res.json()) as {
      summary: { degraded: string[]; posture: string };
    };
    expect(body.summary.degraded).toContain("wallet:stamps_com:500");
    // null wallet → yellow
    expect(body.summary.posture).toBe("yellow");
  });
});

describe("source guardrails (route file)", () => {
  it("does not import wallet-mutation / label-buy paths", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/api/ops/shipping/today/route.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/,
    );
    expect(source).not.toMatch(/buyLabel|createLabel|addBalance|topUp/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/qbo-client["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/hubspot-client["']/);
  });
});
