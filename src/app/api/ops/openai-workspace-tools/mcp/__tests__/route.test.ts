import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: vi.fn(async () => true),
}));

import * as authModule from "@/lib/ops/abra-auth";

const mockedAuth = authModule.isAuthorized as unknown as ReturnType<typeof vi.fn>;

function req(body?: unknown, headers?: HeadersInit): Request {
  return new Request("http://localhost/api/ops/openai-workspace-tools/mcp", {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAuth.mockResolvedValue(true);
  delete process.env.OPENAI_WORKSPACE_CONNECTOR_SECRET;
  delete process.env.CRON_SECRET;
  vi.unstubAllGlobals();
});

describe("OpenAI workspace MCP route", () => {
  it("401s unauthenticated GET", async () => {
    mockedAuth.mockResolvedValueOnce(false);
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("GET returns read-only tool definitions", async () => {
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mode: string;
      tools: Array<{ name: string }>;
    };
    expect(body.mode).toBe("read_and_approval_request");
    expect(body.tools.map((tool) => tool.name).sort()).toEqual([
      "fetch",
      "request_faire_direct_invite_approval",
      "request_faire_follow_up_approval",
      "request_receipt_review_approval",
      "search",
    ]);
  });

  it("GET allows the dedicated OpenAI workspace connector bearer", async () => {
    mockedAuth.mockResolvedValueOnce(false);
    process.env.OPENAI_WORKSPACE_CONNECTOR_SECRET = "workspace-connector-secret";
    const { GET } = await import("../route");
    const res = await GET(
      req(undefined, { authorization: "Bearer workspace-connector-secret" }),
    );
    expect(res.status).toBe(200);
  });

  it("401s unauthenticated POST", async () => {
    mockedAuth.mockResolvedValueOnce(false);
    const { POST } = await import("../route");
    const res = await POST(req({ method: "tools/list" }));
    expect(res.status).toBe(401);
  });

  it("POST tools/list returns only search/fetch", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      req({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(body.result.tools.map((tool) => tool.name).sort()).toEqual([
      "fetch",
      "request_faire_direct_invite_approval",
      "request_faire_follow_up_approval",
      "request_receipt_review_approval",
      "search",
    ]);
  });

  it("POST allows the dedicated OpenAI workspace connector bearer", async () => {
    mockedAuth.mockResolvedValueOnce(false);
    process.env.OPENAI_WORKSPACE_CONNECTOR_SECRET = "workspace-connector-secret";
    const { POST } = await import("../route");
    const res = await POST(
      req(
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { authorization: "Bearer workspace-connector-secret" },
      ),
    );
    expect(res.status).toBe(200);
  });

  it("POST search returns MCP text content with connector results", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      req({
        jsonrpc: "2.0",
        id: "search",
        method: "tools/call",
        params: { name: "search", arguments: { query: "sales" } },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { content: Array<{ text: string }> };
    };
    const parsed = JSON.parse(body.result.content[0].text) as {
      results: Array<{ id: string; title: string; url: string }>;
    };
    expect(parsed.results.some((result) => result.id === "ops.sales.snapshot")).toBe(
      true,
    );
  });

  it("POST fetch returns one connector document", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      req({
        jsonrpc: "2.0",
        id: "fetch",
        method: "tools/call",
        params: { name: "fetch", arguments: { id: "ops.readiness.snapshot" } },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { content: Array<{ text: string }> };
    };
    const parsed = JSON.parse(body.result.content[0].text) as {
      id: string;
      metadata: { readOnly: boolean };
    };
    expect(parsed.id).toBe("ops.readiness.snapshot");
    expect(parsed.metadata.readOnly).toBe(true);
  });

  it("POST fetch enriches read tools with live read-model payloads", async () => {
    process.env.CRON_SECRET = "cron-secret";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      expect((init?.headers as Record<string, string>).authorization).toBe(
        "Bearer cron-secret",
      );
      return new Response(JSON.stringify({ ok: true, report: { total: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../route");
    const res = await POST(
      req({
        jsonrpc: "2.0",
        id: "fetch-live",
        method: "tools/call",
        params: { name: "fetch", arguments: { id: "ops.sales.snapshot" } },
      }),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost/api/ops/sales",
      expect.objectContaining({ method: "GET" }),
    );
    const body = (await res.json()) as {
      result: { content: Array<{ text: string }> };
    };
    const parsed = JSON.parse(body.result.content[0].text) as {
      text: string;
      metadata: { liveRead: { body: { report: { total: number } } } };
    };
    expect(parsed.text).toContain("Live read-model snapshot");
    expect(parsed.metadata.liveRead.body.report.total).toBe(1);
  });

  it("unknown fetch id returns a structured 404", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      req({
        jsonrpc: "2.0",
        id: "fetch",
        method: "tools/call",
        params: { name: "fetch", arguments: { id: "ghost" } },
      }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      error: { code: number; message: string };
    };
    expect(body.error).toEqual(
      expect.objectContaining({ code: -32004, message: "Document not found" }),
    );
  });

  it("invalid JSON returns 400", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/ops/openai-workspace-tools/mcp", {
        method: "POST",
        body: "{bad",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("approval-request tool fails closed when CRON_SECRET is missing", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      req({
        jsonrpc: "2.0",
        id: "approval",
        method: "tools/call",
        params: {
          name: "request_faire_direct_invite_approval",
          arguments: { id: "faire-1" },
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { content: Array<{ text: string }> };
    };
    const parsed = JSON.parse(body.result.content[0].text) as {
      ok: boolean;
      status: number;
      body: { code: string };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.status).toBe(503);
    expect(parsed.body.code).toBe("cron_secret_missing");
  });

  it("approval-request tool proxies to the existing request-approval route", async () => {
    process.env.CRON_SECRET = "cron-secret";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).authorization).toBe(
        "Bearer cron-secret",
      );
      return new Response(
        JSON.stringify({ ok: true, approvalId: "appr-123" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../route");
    const res = await POST(
      req({
        jsonrpc: "2.0",
        id: "approval",
        method: "tools/call",
        params: {
          name: "request_faire_follow_up_approval",
          arguments: { id: "faire-1", requestedBy: "Ben" },
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost/api/ops/faire/direct-invites/faire-1/follow-up/request-approval",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ requestedBy: "Ben" }),
      }),
    );
    const body = (await res.json()) as {
      result: { content: Array<{ text: string }> };
    };
    const parsed = JSON.parse(body.result.content[0].text) as {
      ok: boolean;
      body: { approvalId: string };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.body.approvalId).toBe("appr-123");
  });

  it("does not expose secret-shaped strings", async () => {
    process.env.OPENAI_API_KEY = "sk-proj-do-not-leak-openai-workspace";
    process.env.CRON_SECRET = "cron-secret-do-not-leak-openai-workspace";
    const { POST } = await import("../route");
    const res = await POST(
      req({
        jsonrpc: "2.0",
        id: "search",
        method: "tools/call",
        params: { name: "search", arguments: { query: "ops" } },
      }),
    );
    const text = await res.text();
    expect(text).not.toContain("sk-proj-do-not-leak");
    expect(text).not.toContain("cron-secret-do-not-leak");
  });

  it("exports only GET and POST", async () => {
    const route = await import("../route");
    expect(route.GET).toBeTypeOf("function");
    expect(route.POST).toBeTypeOf("function");
    expect("PATCH" in route).toBe(false);
    expect("DELETE" in route).toBe(false);
  });

  it("route imports no direct write clients", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/api/ops/openai-workspace-tools/mcp/route.ts"),
      "utf8",
    );
    const imports = source
      .split("\n")
      .filter((line) => line.startsWith("import "))
      .join("\n");
    expect(imports).not.toMatch(/qbo|gmail|shipstation|shopify|hubspot|faire-client/i);
    expect(source).not.toContain("@vercel/kv");
  });
});
