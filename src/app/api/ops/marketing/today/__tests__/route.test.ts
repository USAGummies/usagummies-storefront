/**
 * /api/ops/marketing/today route — Build 7.
 *
 * Pins:
 *   - 401 when unauthorized.
 *   - 200 + summary on happy path.
 *   - approval-store error → degraded entry; route still 200s.
 *   - platform fetch error → propagates into summary.degraded.
 *   - Source guards: no Meta/Google/TikTok mutation imports.
 *   - Read-only: no POST/PUT/PATCH/DELETE exports.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
const listPendingMock = vi.fn();
const fetchPlatformsMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

vi.mock("@/lib/ops/control-plane/stores", () => ({
  approvalStore: () => ({
    listPending: () => listPendingMock(),
  }),
}));

vi.mock("@/lib/ops/marketing-today-fetch", () => ({
  fetchMarketingPlatforms: () => fetchPlatformsMock(),
}));

import { GET } from "../route";

function req(): Request {
  return new Request("https://www.usagummies.com/api/ops/marketing/today");
}

beforeEach(() => {
  isAuthorizedMock.mockReset().mockResolvedValue(true);
  listPendingMock.mockReset().mockResolvedValue([]);
  fetchPlatformsMock.mockReset().mockResolvedValue({
    platforms: [
      { platform: "meta", configured: false, campaigns: [], fetchError: null },
      { platform: "google", configured: false, campaigns: [], fetchError: null },
      { platform: "tiktok", configured: false, campaigns: [], fetchError: null },
    ],
    degraded: [],
  });
});

describe("GET /api/ops/marketing/today", () => {
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
      summary: { posture: string; platforms: { platform: string }[] };
    };
    expect(body.ok).toBe(true);
    expect(body.summary.posture).toBe("green");
    expect(body.summary.platforms.map((p) => p.platform).sort()).toEqual([
      "google",
      "meta",
      "tiktok",
    ]);
  });

  it("approval-store throw lands in degraded; route still 200s", async () => {
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

  it("platform fetch error propagates into summary.degraded", async () => {
    fetchPlatformsMock.mockResolvedValueOnce({
      platforms: [
        { platform: "meta", configured: true, campaigns: [], fetchError: "graph 500" },
        { platform: "google", configured: false, campaigns: [], fetchError: null },
        { platform: "tiktok", configured: false, campaigns: [], fetchError: null },
      ],
      degraded: ["meta: graph 500"],
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: {
        platforms: Array<{ platform: string; status: string }>;
        degraded: string[];
      };
    };
    expect(body.summary.degraded).toContain("meta: graph 500");
    const meta = body.summary.platforms.find((p) => p.platform === "meta")!;
    expect(meta.status).toBe("error");
  });
});

describe("source guardrails (route file)", () => {
  it("does not import Meta/Google/TikTok mutation paths or ship POST/PUT/PATCH/DELETE", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/api/ops/marketing/today/route.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/,
    );
    expect(source).not.toMatch(/from\s+["']@\/lib\/shopify\//);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/qbo-client["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/hubspot-client["']/);
    expect(source).not.toMatch(
      /sendGmail|requestApproval|recordDecision|launchCampaign|updateBudget/,
    );
  });
});
