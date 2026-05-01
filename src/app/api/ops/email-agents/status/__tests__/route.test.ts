import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

import { GET } from "../route";

function req(): Request {
  return new Request("https://www.usagummies.com/api/ops/email-agents/status");
}

beforeEach(() => {
  isAuthorizedMock.mockReset();
  isAuthorizedMock.mockResolvedValue(true);
  delete process.env.EMAIL_INTEL_ENABLED;
});

describe("GET /api/ops/email-agents/status", () => {
  it("401s when unauthorized", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns readiness without exposing raw secrets or running email-intel", async () => {
    process.env.EMAIL_INTEL_ENABLED = "false";
    process.env.GMAIL_OAUTH_REFRESH_TOKEN = "super-secret-refresh-token";
    const res = await GET(req());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("super-secret-refresh-token");
    const body = JSON.parse(text) as {
      ok: boolean;
      status: {
        readiness: string;
        enabled: boolean;
        gates: Array<{ id: string; ok: boolean }>;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.status.enabled).toBe(false);
    expect(body.status.gates.find((g) => g.id === "hubspot_schema")?.ok).toBe(true);
  });

  it("is read-only and exports only GET", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/api/ops/email-agents/status/route.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/gmail-reader["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/hubspot-client["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/ops\/qbo-client["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/shopify\//);
    expect(source).not.toMatch(/listEmails|createGmailDraft|sendGmail|requestApproval|postMessage/);
  });
});
