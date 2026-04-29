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

  it("exposes only search and fetch tools", () => {
    expect(mcpToolDefinitions().map((tool) => tool.name).sort()).toEqual([
      "fetch",
      "search",
    ]);
  });

  it("handles MCP initialize", () => {
    const response = handleWorkspaceMcpRequest({
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

  it("handles MCP tools/list", () => {
    const response = handleWorkspaceMcpRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ tools: mcpToolDefinitions() });
  });

  it("handles MCP tools/call search", () => {
    const response = handleWorkspaceMcpRequest({
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

  it("handles MCP tools/call fetch", () => {
    const response = handleWorkspaceMcpRequest({
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

  it("returns structured error for unknown fetch id", () => {
    const response = handleWorkspaceMcpRequest({
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

  it("rejects unsupported tools without exposing write tools", () => {
    const response = handleWorkspaceMcpRequest({
      jsonrpc: "2.0",
      id: "write",
      method: "tools/call",
      params: {
        name: "send_email",
        arguments: {},
      },
    });
    expect(response.error?.message).toContain("Only search and fetch");
  });
});
