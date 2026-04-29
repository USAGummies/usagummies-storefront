import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: vi.fn(async () => true),
}));

import * as authModule from "@/lib/ops/abra-auth";

const mockedAuth = authModule.isAuthorized as unknown as ReturnType<typeof vi.fn>;

function req(): Request {
  return new Request("http://localhost/api/ops/openai-workspace-tools", {
    method: "GET",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAuth.mockResolvedValue(true);
});

describe("GET /api/ops/openai-workspace-tools", () => {
  it("401s unauthenticated requests", async () => {
    mockedAuth.mockResolvedValueOnce(false);
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns the OpenAI workspace tool doctrine and registry", async () => {
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      doctrine: { writes: string; prohibited: string };
      summary: { total: number; approvalRequest: number; prohibited: number };
      tools: Array<{ id: string; mode: string; readOnly: boolean }>;
      connectorDocuments: Array<{ id: string; text: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.doctrine.writes).toContain("Slack approvals");
    expect(body.doctrine.prohibited).toContain("No direct QBO");
    expect(body.summary.total).toBe(body.tools.length);
    expect(body.summary.approvalRequest).toBeGreaterThan(0);
    expect(body.summary.prohibited).toBeGreaterThan(0);
    expect(body.connectorDocuments.length).toBe(body.tools.length);
    expect(body.tools.find((tool) => tool.id === "ops.sales.snapshot")?.readOnly).toBe(
      true,
    );
  });

  it("does not expose secret-shaped strings", async () => {
    process.env.OPENAI_API_KEY = "sk-proj-should-not-appear-in-this-response";
    process.env.CRON_SECRET = "cron-secret-should-not-appear";
    const { GET } = await import("../route");
    const res = await GET(req());
    const text = await res.text();
    expect(text).not.toContain("sk-proj-should-not-appear");
    expect(text).not.toContain("cron-secret-should-not-appear");
  });

  it("exports GET only", async () => {
    const route = await import("../route");
    expect(route.GET).toBeTypeOf("function");
    expect("POST" in route).toBe(false);
    expect("PATCH" in route).toBe(false);
    expect("DELETE" in route).toBe(false);
  });
});
