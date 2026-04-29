import { describe, expect, it } from "vitest";

import {
  OPENAI_WORKSPACE_TOOLS,
  connectorSearchDocuments,
  getOpenAIWorkspaceTool,
  listOpenAIWorkspaceTools,
  summarizeOpenAIWorkspaceTools,
} from "../registry";

describe("OpenAI workspace tool registry", () => {
  it("has stable ids and lookup helpers", () => {
    expect(listOpenAIWorkspaceTools()).toBe(OPENAI_WORKSPACE_TOOLS);
    expect(getOpenAIWorkspaceTool("ops.sales.snapshot")?.readOnly).toBe(true);
    expect(getOpenAIWorkspaceTool("ghost.tool")).toBeUndefined();
  });

  it("summarizes the registry without inventing statuses", () => {
    const summary = summarizeOpenAIWorkspaceTools();
    expect(summary.total).toBe(OPENAI_WORKSPACE_TOOLS.length);
    expect(summary.ready).toBeGreaterThan(0);
    // `planned` is allowed to be 0 — we ship planned tools to ready as
    // their blockers clear (e.g. ops.agent.packs + ops.operating-memory.search
    // moved planned→ready when P0-2 + P0-3 shipped 2026-04-29).
    expect(summary.planned).toBeGreaterThanOrEqual(0);
    expect(summary.blocked).toBeGreaterThan(0);
    expect(summary.total).toBe(summary.ready + summary.planned + summary.blocked);
    expect(summary.total).toBe(
      summary.readOnly + summary.approvalRequest + summary.prohibited,
    );
  });

  it("ops.agent.packs is wired to the P0-2 dashboard backing route", () => {
    const t = getOpenAIWorkspaceTool("ops.agent.packs");
    expect(t).toBeDefined();
    expect(t?.status).toBe("ready");
    expect(t?.mode).toBe("read");
    expect(t?.readOnly).toBe(true);
    expect(t?.backingRoute).toBe("/api/ops/agents/packs/snapshot");
    expect(t?.blocker).toBeUndefined();
  });

  it("ops.operating-memory.search is wired to the P0-3 transcript-saver backing route", () => {
    const t = getOpenAIWorkspaceTool("ops.operating-memory.search");
    expect(t).toBeDefined();
    expect(t?.status).toBe("ready");
    expect(t?.mode).toBe("read");
    expect(t?.readOnly).toBe(true);
    expect(t?.backingRoute).toBe("/api/ops/operating-memory/recent");
    expect(t?.blocker).toBeUndefined();
  });

  it("all read tools are actually read-only and never require approval", () => {
    const readTools = OPENAI_WORKSPACE_TOOLS.filter((tool) => tool.mode === "read");
    expect(readTools.length).toBeGreaterThan(0);
    for (const tool of readTools) {
      expect(tool.readOnly, tool.id).toBe(true);
      expect(tool.requiresHumanApproval, tool.id).toBe(false);
      expect(tool.approvalSlug, tool.id).toBeUndefined();
    }
  });

  it("all approval-request tools require human approval and have an approval slug", () => {
    const approvalTools = OPENAI_WORKSPACE_TOOLS.filter(
      (tool) => tool.mode === "approval_request",
    );
    expect(approvalTools.length).toBeGreaterThan(0);
    for (const tool of approvalTools) {
      expect(tool.readOnly, tool.id).toBe(false);
      expect(tool.requiresHumanApproval, tool.id).toBe(true);
      expect(tool.approvalSlug, tool.id).toMatch(/^[a-z0-9.-]+$/);
      expect(tool.backingRoute, tool.id).toMatch(/^\/api\/ops\//);
    }
  });

  it("prohibited tools are blocked and carry a blocker", () => {
    const prohibited = OPENAI_WORKSPACE_TOOLS.filter(
      (tool) => tool.mode === "prohibited",
    );
    expect(prohibited.length).toBeGreaterThan(0);
    for (const tool of prohibited) {
      expect(tool.status, tool.id).toBe("blocked");
      expect(tool.blocker, tool.id).toBeTruthy();
      expect(tool.safetyNotes.join(" "), tool.id).toContain("No ChatGPT");
    }
  });

  it("does not allow direct money, shipping, or customer-facing writes", () => {
    const unsafeDirectRoutes = OPENAI_WORKSPACE_TOOLS.filter((tool) => {
      if (tool.mode !== "approval_request") return false;
      const route = tool.backingRoute ?? "";
      return (
        route.includes("/qbo/") ||
        route.includes("/shipping/auto-ship") ||
        route.includes("/orders/fulfill") ||
        route.includes("/gmail/")
      );
    });
    expect(unsafeDirectRoutes).toEqual([]);
  });

  it("connector documents expose enough MCP search/fetch seed text", () => {
    const docs = connectorSearchDocuments();
    expect(docs.length).toBe(OPENAI_WORKSPACE_TOOLS.length);
    for (const doc of docs) {
      expect(doc.id).toBeTruthy();
      expect(doc.title).toBeTruthy();
      expect(doc.url).toMatch(/^\//);
      expect(doc.text).toContain("Mode:");
      expect(doc.text).toContain("Status:");
    }
  });
});
