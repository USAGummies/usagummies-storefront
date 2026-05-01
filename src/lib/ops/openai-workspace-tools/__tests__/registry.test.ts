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

  it("ops.agents.b2b-revenue-watcher.run is read-only heartbeat dry-run", () => {
    const t = getOpenAIWorkspaceTool("ops.agents.b2b-revenue-watcher.run");
    expect(t).toBeDefined();
    expect(t?.status).toBe("ready");
    expect(t?.mode).toBe("read");
    expect(t?.readOnly).toBe(true);
    expect(t?.requiresHumanApproval).toBe(false);
    expect(t?.backingRoute).toBe(
      "/api/ops/agents/b2b-revenue-watcher/run",
    );
    expect(t?.description).toMatch(/does not post Slack/i);
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

  it("ops.sales.day1-prospects is exposed as a read-only prospect playbook", () => {
    const t = getOpenAIWorkspaceTool("ops.sales.day1-prospects");
    expect(t).toBeDefined();
    expect(t?.status).toBe("ready");
    expect(t?.mode).toBe("read");
    expect(t?.readOnly).toBe(true);
    expect(t?.requiresHumanApproval).toBe(false);
    expect(t?.backingRoute).toBe("/api/ops/sales/prospects/day1");
    expect(t?.description).toMatch(/no sends/i);
  });

  it("ops.sales.tour-playbook is exposed as a read-only route playbook", () => {
    const t = getOpenAIWorkspaceTool("ops.sales.tour-playbook");
    expect(t).toBeDefined();
    expect(t?.status).toBe("ready");
    expect(t?.mode).toBe("read");
    expect(t?.readOnly).toBe(true);
    expect(t?.requiresHumanApproval).toBe(false);
    expect(t?.backingRoute).toBe("/api/ops/sales/tour");
    expect(t?.backingSurface).toBe("/ops/sales/tour");
    expect(t?.description).toMatch(/no sends/i);
  });

  it("ops.sales.stale-buyers is exposed as a read-only HubSpot hit list", () => {
    const t = getOpenAIWorkspaceTool("ops.sales.stale-buyers");
    expect(t).toBeDefined();
    expect(t?.status).toBe("ready");
    expect(t?.mode).toBe("read");
    expect(t?.readOnly).toBe(true);
    expect(t?.requiresHumanApproval).toBe(false);
    expect(t?.backingRoute).toBe("/api/ops/sales/stale-buyers");
    expect(t?.backingSurface).toBe("/ops/sales");
    expect(t?.description).toMatch(/no outreach send/i);
  });

  it("ops.finance.vendor-margin exposes the read-only margin ledger", () => {
    const t = getOpenAIWorkspaceTool("ops.finance.vendor-margin");
    expect(t).toBeDefined();
    expect(t?.status).toBe("ready");
    expect(t?.mode).toBe("read");
    expect(t?.audience).toBe("Ben+Rene");
    expect(t?.readOnly).toBe(true);
    expect(t?.requiresHumanApproval).toBe(false);
    expect(t?.backingRoute).toBe("/api/ops/finance/vendor-margin");
    expect(t?.backingSurface).toBe("/ops/finance/vendor-margin");
    expect(t?.description).toMatch(/no QBO/i);
  });

  it("ops.agents.status exposes read-only runtime handoff state", () => {
    const t = getOpenAIWorkspaceTool("ops.agents.status");
    expect(t).toBeDefined();
    expect(t?.status).toBe("ready");
    expect(t?.mode).toBe("read");
    expect(t?.readOnly).toBe(true);
    expect(t?.requiresHumanApproval).toBe(false);
    expect(t?.backingRoute).toBe("/api/ops/agents/status");
    expect(t?.backingSurface).toBe("/ops/agents/status");
    expect(t?.description).toMatch(/no heartbeat trigger/i);
  });

  it("ops.finance.off-grid-quotes exposes the read-only off-grid replay surface", () => {
    const t = getOpenAIWorkspaceTool("ops.finance.off-grid-quotes");
    expect(t).toBeDefined();
    expect(t?.status).toBe("ready");
    expect(t?.mode).toBe("read");
    expect(t?.audience).toBe("Ben+Rene");
    expect(t?.readOnly).toBe(true);
    expect(t?.requiresHumanApproval).toBe(false);
    expect(t?.backingRoute).toBe("/api/ops/finance/off-grid");
    expect(t?.backingSurface).toBe("/ops/finance/off-grid");
    expect(t?.description).toMatch(/no pricing changes/i);
  });

  it("ops.inbox.unified exposes inbox context as read-only", () => {
    const t = getOpenAIWorkspaceTool("ops.inbox.unified");
    expect(t).toBeDefined();
    expect(t?.status).toBe("ready");
    expect(t?.mode).toBe("read");
    expect(t?.readOnly).toBe(true);
    expect(t?.requiresHumanApproval).toBe(false);
    expect(t?.backingRoute).toBe("/api/ops/inbox");
    expect(t?.backingSurface).toBe("/ops/inbox");
    expect(t?.description).toMatch(/must not triage via AI/i);
  });

  it("blocks direct email-intel runner access after the incident", () => {
    const t = getOpenAIWorkspaceTool("ops.email-intel.run.direct");
    expect(t).toBeDefined();
    expect(t?.status).toBe("blocked");
    expect(t?.mode).toBe("prohibited");
    expect(t?.readOnly).toBe(false);
    expect(t?.requiresHumanApproval).toBe(true);
    expect(t?.backingRoute).toBe("/api/ops/fulfillment/email-intel/run");
    expect(t?.blocker).toMatch(/EMAIL_INTEL_ENABLED defaults off/i);
    expect(t?.description).toMatch(/2026-04-30 incident/i);
  });

  it("ops.email-agents.status exposes readiness gates without runner access", () => {
    const t = getOpenAIWorkspaceTool("ops.email-agents.status");
    expect(t).toBeDefined();
    expect(t?.status).toBe("ready");
    expect(t?.mode).toBe("read");
    expect(t?.readOnly).toBe(true);
    expect(t?.requiresHumanApproval).toBe(false);
    expect(t?.backingRoute).toBe("/api/ops/email-agents/status");
    expect(t?.backingSurface).toBe("/ops/email-agents");
    expect(t?.description).toMatch(/never triggers email-intel/i);
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
