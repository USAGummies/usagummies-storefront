import { describe, expect, it } from "vitest";

import {
  buildWorkspaceToolDashboardSummary,
  groupWorkspaceToolsByMode,
} from "../dashboard";
import type { OpenAIWorkspaceTool } from "../registry";

function tool(
  patch: Partial<OpenAIWorkspaceTool> & Pick<OpenAIWorkspaceTool, "id" | "mode">,
): OpenAIWorkspaceTool {
  return {
    id: patch.id,
    name: patch.name ?? patch.id,
    description: patch.description ?? "test",
    mode: patch.mode,
    status: patch.status ?? "ready",
    audience: patch.audience ?? "Ben",
    readOnly: patch.readOnly ?? patch.mode === "read",
    requiresHumanApproval:
      patch.requiresHumanApproval ?? patch.mode === "approval_request",
    backingRoute: patch.backingRoute,
    backingSurface: patch.backingSurface,
    approvalSlug: patch.approvalSlug,
    blocker: patch.blocker,
    safetyNotes: patch.safetyNotes ?? [],
  };
}

describe("OpenAI workspace tools dashboard helpers", () => {
  it("counts status, mode, audience, and approval/prohibited lanes", () => {
    const tools = [
      tool({ id: "read", mode: "read", audience: "Ops" }),
      tool({
        id: "approval",
        mode: "approval_request",
        approvalSlug: "faire-direct.invite",
        audience: "Ben",
      }),
      tool({
        id: "blocked",
        mode: "prohibited",
        status: "blocked",
        blocker: "no closer",
        audience: "Ben+Rene",
      }),
    ];

    const summary = buildWorkspaceToolDashboardSummary(tools, {
      hasConnectorSecret: true,
    });

    expect(summary.total).toBe(3);
    expect(summary.byStatus.ready).toBe(2);
    expect(summary.byStatus.blocked).toBe(1);
    expect(summary.byMode.read).toBe(1);
    expect(summary.byMode.approval_request).toBe(1);
    expect(summary.byMode.prohibited).toBe(1);
    expect(summary.byAudience.Ops).toBe(1);
    expect(summary.byAudience.Ben).toBe(1);
    expect(summary.byAudience["Ben+Rene"]).toBe(1);
    expect(summary.readyApprovalTools).toBe(1);
    expect(summary.blockedProhibitedTools).toBe(1);
  });

  it("reports ready only when the connector secret is present", () => {
    const tools = [tool({ id: "read", mode: "read" })];
    expect(
      buildWorkspaceToolDashboardSummary(tools, {
        hasConnectorSecret: true,
      }).connectorReadiness,
    ).toBe("ready");
    const missing = buildWorkspaceToolDashboardSummary(tools, {
      hasConnectorSecret: false,
    });
    expect(missing.connectorReadiness).toBe("missing_secret");
    expect(missing.canExposeConnector).toBe(false);
    expect(missing.nextActions.join(" ")).toContain(
      "OPENAI_WORKSPACE_CONNECTOR_SECRET",
    );
  });

  it("does not claim readiness for an empty registry", () => {
    const summary = buildWorkspaceToolDashboardSummary([], {
      hasConnectorSecret: true,
    });
    expect(summary.connectorReadiness).toBe("no_tools");
    expect(summary.canExposeConnector).toBe(false);
    expect(summary.nextActions.join(" ")).toContain("Register");
  });

  it("groups tools by mode without mutating the input", () => {
    const tools = [
      tool({ id: "read", mode: "read" }),
      tool({ id: "approval", mode: "approval_request" }),
      tool({ id: "blocked", mode: "prohibited", status: "blocked" }),
    ];
    const before = JSON.stringify(tools);
    const grouped = groupWorkspaceToolsByMode(tools);
    expect(grouped.read.map((t) => t.id)).toEqual(["read"]);
    expect(grouped.approval_request.map((t) => t.id)).toEqual(["approval"]);
    expect(grouped.prohibited.map((t) => t.id)).toEqual(["blocked"]);
    expect(JSON.stringify(tools)).toBe(before);
  });

  it("never includes raw secret-shaped values in summary output", () => {
    const summary = buildWorkspaceToolDashboardSummary(
      [tool({ id: "read", mode: "read" })],
      { hasConnectorSecret: true },
    );
    const text = JSON.stringify(summary);
    expect(text).not.toContain("sk-");
    expect(text).not.toContain("Bearer ");
    expect(text).not.toContain("secret-value");
  });
});
