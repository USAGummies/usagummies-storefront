import { describe, expect, it } from "vitest";

import {
  asMcpText,
  fetchOpenAIWorkspaceDocument,
  handleWorkspaceMcpRequest,
  mcpToolDefinitions,
  searchOpenAIWorkspaceDocuments,
} from "../mcp";

describe("OpenAI workspace MCP helpers", () => {
  it("searches connector documents by title/text/id", () => {
    const results = searchOpenAIWorkspaceDocuments("sales");
    expect(results.some((result) => result.id === "ops.sales.snapshot")).toBe(true);
    expect(results[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        title: expect.any(String),
        url: expect.any(String),
      }),
    );
  });

  it("blank search returns the approved inventory instead of fabricating external data", () => {
    const results = searchOpenAIWorkspaceDocuments("   ");
    expect(results.length).toBeGreaterThan(5);
    expect(results.every((result) => result.url.startsWith("/"))).toBe(true);
  });

  it("fetch returns metadata for a known document", () => {
    const doc = fetchOpenAIWorkspaceDocument("ops.readiness.snapshot");
    expect(doc?.metadata).toEqual(
      expect.objectContaining({
        mode: "read",
        status: "ready",
        readOnly: true,
        requiresHumanApproval: false,
      }),
    );
    expect(doc?.text).toContain("Mode: read");
  });

  it("fetch returns null for unknown documents", () => {
    expect(fetchOpenAIWorkspaceDocument("ghost")).toBeNull();
  });

  it("formats MCP text content as JSON text", () => {
    const content = asMcpText({ ok: true });
    expect(content).toEqual({
      content: [{ type: "text", text: '{"ok":true}' }],
    });
  });

  it("exposes search/fetch plus approval-request tools only", () => {
    expect(mcpToolDefinitions().map((tool) => tool.name).sort()).toEqual([
      "fetch",
      "request_faire_direct_invite_approval",
      "request_faire_follow_up_approval",
      "request_receipt_review_approval",
      "search",
    ]);
  });

  it("handles MCP initialize", async () => {
    const response = await handleWorkspaceMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });
    expect(response.error).toBeUndefined();
    expect(response.result).toEqual(
      expect.objectContaining({
        capabilities: { tools: {} },
      }),
    );
  });

  it("handles MCP tools/list", async () => {
    const response = await handleWorkspaceMcpRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ tools: mcpToolDefinitions() });
  });

  it("handles MCP tools/call search", async () => {
    const response = await handleWorkspaceMcpRequest({
      jsonrpc: "2.0",
      id: "search-1",
      method: "tools/call",
      params: {
        name: "search",
        arguments: { query: "receipt" },
      },
    });
    expect(response.error).toBeUndefined();
    const result = response.result as { content: Array<{ text: string }> };
    const parsed = JSON.parse(result.content[0].text) as {
      results: Array<{ id: string }>;
    };
    expect(parsed.results.some((item) => item.id.includes("receipt"))).toBe(true);
  });

  it("handles MCP tools/call fetch", async () => {
    const response = await handleWorkspaceMcpRequest({
      jsonrpc: "2.0",
      id: "fetch-1",
      method: "tools/call",
      params: {
        name: "fetch",
        arguments: { id: "ops.faire.direct" },
      },
    });
    expect(response.error).toBeUndefined();
    const result = response.result as { content: Array<{ text: string }> };
    const parsed = JSON.parse(result.content[0].text) as { id: string };
    expect(parsed.id).toBe("ops.faire.direct");
  });

  it("enriches fetch with live read-model data when a loader is provided", async () => {
    const response = await handleWorkspaceMcpRequest(
      {
        jsonrpc: "2.0",
        id: "fetch-live",
        method: "tools/call",
        params: {
          name: "fetch",
          arguments: { id: "ops.sales.snapshot" },
        },
      },
      {
        loadLiveReadModel: async (doc) => ({
          ok: true,
          status: 200,
          body: { source: doc.id, ok: true },
        }),
      },
    );

    const result = response.result as { content: Array<{ text: string }> };
    const parsed = JSON.parse(result.content[0].text) as {
      text: string;
      metadata: { liveRead: { body: { source: string } } };
    };
    expect(parsed.text).toContain("Live read-model snapshot");
    expect(parsed.metadata.liveRead.body.source).toBe("ops.sales.snapshot");
  });

  it("returns structured error for unknown fetch id", async () => {
    const response = await handleWorkspaceMcpRequest({
      jsonrpc: "2.0",
      id: "bad-fetch",
      method: "tools/call",
      params: {
        name: "fetch",
        arguments: { id: "ghost" },
      },
    });
    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32004,
        message: "Document not found",
      }),
    );
  });

  it("rejects unsupported tools without exposing write tools", async () => {
    const response = await handleWorkspaceMcpRequest({
      jsonrpc: "2.0",
      id: "write",
      method: "tools/call",
      params: {
        name: "send_email",
        arguments: {},
      },
    });
    expect(response.error?.message).toContain(
      "Only search, fetch, and approval-request tools",
    );
  });

  it("approval-request tools fail closed when no executor is configured", async () => {
    const response = await handleWorkspaceMcpRequest({
      jsonrpc: "2.0",
      id: "approval",
      method: "tools/call",
      params: {
        name: "request_faire_direct_invite_approval",
        arguments: { id: "faire-1" },
      },
    });
    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32010,
        message: expect.stringContaining("not configured"),
      }),
    );
  });

  it("approval-request tools call the injected executor exactly once", async () => {
    const calls: Array<{ route: string; body: Record<string, unknown> }> = [];
    const response = await handleWorkspaceMcpRequest(
      {
        jsonrpc: "2.0",
        id: "approval",
        method: "tools/call",
        params: {
          name: "request_faire_direct_invite_approval",
          arguments: { id: "faire-1", requestedBy: "Ben" },
        },
      },
      {
        executeApprovalTool: async (input) => {
          calls.push(input);
          return {
            ok: true,
            status: 200,
            body: { ok: true, approvalId: "appr-1" },
          };
        },
      },
    );

    expect(calls).toEqual([
      {
        route: "/api/ops/faire/direct-invites/faire-1/request-approval",
        body: { requestedBy: "Ben" },
      },
    ]);
    const result = response.result as { content: Array<{ text: string }> };
    expect(JSON.parse(result.content[0].text)).toEqual(
      expect.objectContaining({
        ok: true,
        status: 200,
        body: { ok: true, approvalId: "appr-1" },
      }),
    );
  });

  it("receipt approval-request tool routes by receiptId", async () => {
    const calls: Array<{ route: string; body: Record<string, unknown> }> = [];
    await handleWorkspaceMcpRequest(
      {
        jsonrpc: "2.0",
        id: "receipt",
        method: "tools/call",
        params: {
          name: "request_receipt_review_approval",
          arguments: { receiptId: "rcpt-1" },
        },
      },
      {
        executeApprovalTool: async (input) => {
          calls.push(input);
          return { ok: true, status: 200, body: { ok: true } };
        },
      },
    );
    expect(calls).toEqual([
      {
        route: "/api/ops/docs/receipt/promote-review",
        body: { receiptId: "rcpt-1" },
      },
    ]);
  });
});
