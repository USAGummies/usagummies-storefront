/**
 * /api/ops/what-needs-ben route — Build 2 cap.
 *
 * Pins:
 *   - 401 when unauthorized.
 *   - 200 + summary on happy path.
 *   - Forwards lane fetch failures into summary.degraded.
 *   - Source guards: read-only, no mutation imports.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
const fetchInputsMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

vi.mock("@/lib/ops/what-needs-ben-fetch", () => ({
  fetchWhatNeedsBenInputs: () => fetchInputsMock(),
}));

import { GET } from "../route";

function req(): Request {
  return new Request("https://www.usagummies.com/api/ops/what-needs-ben");
}

beforeEach(() => {
  isAuthorizedMock.mockReset().mockResolvedValue(true);
  fetchInputsMock.mockReset().mockResolvedValue({
    email: null,
    finance: null,
    marketing: null,
    shipping: null,
    proposals: null,
    sales: null,
    degraded: [],
  });
});

describe("GET /api/ops/what-needs-ben", () => {
  it("401 when unauthorized", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("200 + summary on happy path (all-null → 6 unknown lanes)", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      summary: { posture: string; lanes: { posture: string }[] };
    };
    expect(body.ok).toBe(true);
    expect(body.summary.posture).toBe("unknown");
    expect(body.summary.lanes).toHaveLength(6);
    expect(body.summary.lanes.every((l) => l.posture === "unknown")).toBe(true);
  });

  it("forwards lane fetch failures via summary.degraded", async () => {
    fetchInputsMock.mockResolvedValueOnce({
      email: null,
      finance: null,
      marketing: null,
      shipping: null,
      proposals: null,
      sales: null,
      degraded: ["email: kv-down", "finance: kv-down"],
    });
    const res = await GET(req());
    const body = (await res.json()) as {
      summary: { degraded: string[] };
    };
    expect(body.summary.degraded).toEqual([
      "email: kv-down",
      "finance: kv-down",
    ]);
  });
});

describe("source guardrails (route file)", () => {
  it("does not import write paths or expose mutation verbs", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/api/ops/what-needs-ben/route.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/,
    );
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/qbo-client["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/hubspot-client["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/shopify\//);
    expect(source).not.toMatch(
      /sendGmail|requestApproval|recordDecision|launchCampaign|buyLabel/,
    );
  });
});
