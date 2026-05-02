/**
 * Finance Today route — Build 5 close-out.
 *
 * Pins:
 *   - 401 when unauthorized.
 *   - 200 + summary on happy path.
 *   - approval-store error → degraded entry, route still succeeds.
 *   - packets-store error → degraded entry, route still succeeds.
 *   - Source guards: no QBO/HubSpot/Shopify imports, no POST/PUT/PATCH/DELETE.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
const listPendingMock = vi.fn();
const listPacketsMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

vi.mock("@/lib/ops/control-plane/stores", () => ({
  approvalStore: () => ({
    listPending: () => listPendingMock(),
  }),
}));

vi.mock("@/lib/ops/docs", () => ({
  listReceiptReviewPackets: () => listPacketsMock(),
}));

import { GET } from "../route";

function req(): Request {
  return new Request("https://www.usagummies.com/api/ops/finance/today");
}

beforeEach(() => {
  isAuthorizedMock.mockReset().mockResolvedValue(true);
  listPendingMock.mockReset().mockResolvedValue([]);
  listPacketsMock.mockReset().mockResolvedValue([]);
});

describe("GET /api/ops/finance/today", () => {
  it("401 when unauthorized", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("200 + summary on happy path", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      summary: { posture: string; pendingFinanceApprovals: number };
    };
    expect(body.ok).toBe(true);
    expect(body.summary.posture).toBe("green");
    expect(body.summary.pendingFinanceApprovals).toBe(0);
  });

  it("approval-store throw lands in degraded, route still 200s", async () => {
    listPendingMock.mockRejectedValueOnce(new Error("kv-down"));
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { degraded: string[] };
    };
    expect(body.summary.degraded.some((d) => d.startsWith("approvals:"))).toBe(
      true,
    );
  });

  it("packets-store throw lands in degraded, route still 200s", async () => {
    listPacketsMock.mockRejectedValueOnce(new Error("kv-down"));
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { degraded: string[] };
    };
    expect(body.summary.degraded.some((d) => d.startsWith("packets:"))).toBe(
      true,
    );
  });
});

describe("source guardrails (route file)", () => {
  it("does not import QBO/HubSpot/Shopify clients or expose mutating verbs", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/api/ops/finance/today/route.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/qbo-client["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/hubspot-client["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/shopify\//);
    expect(source).not.toMatch(/sendGmail|requestApproval|recordDecision/);
    expect(source).not.toMatch(
      /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/,
    );
  });
});
