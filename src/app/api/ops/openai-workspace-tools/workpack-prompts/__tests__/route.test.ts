/**
 * /api/ops/openai-workspace-tools/workpack-prompts route — Build 6 finish.
 *
 * Pins:
 *   - 401 when unauthorized.
 *   - 200 + full registry on default GET.
 *   - 400 on invalid `department` param.
 *   - ?department=email returns just the email pack.
 *   - Source guards — read-only, no mutation imports, no POST/PUT/PATCH/DELETE.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

import { GET } from "../route";

function req(qs = ""): Request {
  return new Request(
    `https://www.usagummies.com/api/ops/openai-workspace-tools/workpack-prompts${qs}`,
  );
}

beforeEach(() => {
  isAuthorizedMock.mockReset().mockResolvedValue(true);
});

describe("GET workpack-prompts", () => {
  it("401 when unauthorized", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("200 + full registry on default GET", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      packs: Array<{ department: string }>;
      prohibitedGlobal: string[];
    };
    expect(body.ok).toBe(true);
    expect(body.packs.length).toBe(5);
    expect(body.packs.map((p) => p.department).sort()).toEqual([
      "email",
      "finance",
      "marketing",
      "sales",
      "shipping",
    ]);
    expect(body.prohibitedGlobal.length).toBeGreaterThan(5);
  });

  it("400 on invalid department", async () => {
    const res = await GET(req("?department=banana"));
    expect(res.status).toBe(400);
  });

  it("returns single pack for ?department=email", async () => {
    const res = await GET(req("?department=email"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      pack: { department: string };
    };
    expect(body.pack.department).toBe("email");
  });

  it("returns null pack + note for unregistered department (e.g. research)", async () => {
    const res = await GET(req("?department=research"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      pack: unknown;
      note: string;
    };
    expect(body.pack).toBeNull();
    expect(body.note).toMatch(/No prompt pack registered/);
  });
});

describe("source guardrails (route file)", () => {
  it("does not import write paths or expose mutating verbs", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/app/api/ops/openai-workspace-tools/workpack-prompts/route.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(
      /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/,
    );
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/qbo-client["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/hubspot-client["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/gmail-reader["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/shopify\//);
    expect(source).not.toMatch(/sendGmail|recordDecision|launchCampaign|buyLabel/);
  });
});
