import type {
  OpenAIWorkspaceTool,
  WorkspaceToolAudience,
  WorkspaceToolMode,
  WorkspaceToolStatus,
} from "./registry";

export interface WorkspaceToolDashboardSummary {
  total: number;
  byStatus: Record<WorkspaceToolStatus, number>;
  byMode: Record<WorkspaceToolMode, number>;
  byAudience: Record<WorkspaceToolAudience, number>;
  readyApprovalTools: number;
  blockedProhibitedTools: number;
  canExposeConnector: boolean;
  connectorReadiness: "ready" | "missing_secret" | "no_tools";
  nextActions: string[];
}

export function buildWorkspaceToolDashboardSummary(
  tools: readonly OpenAIWorkspaceTool[],
  options: { hasConnectorSecret: boolean },
): WorkspaceToolDashboardSummary {
  const summary: WorkspaceToolDashboardSummary = {
    total: tools.length,
    byStatus: { ready: 0, planned: 0, blocked: 0 },
    byMode: { read: 0, approval_request: 0, prohibited: 0 },
    byAudience: { Ben: 0, Rene: 0, "Ben+Rene": 0, Ops: 0 },
    readyApprovalTools: 0,
    blockedProhibitedTools: 0,
    canExposeConnector: false,
    connectorReadiness: "no_tools",
    nextActions: [],
  };

  for (const tool of tools) {
    summary.byStatus[tool.status] += 1;
    summary.byMode[tool.mode] += 1;
    summary.byAudience[tool.audience] += 1;
    if (tool.mode === "approval_request" && tool.status === "ready") {
      summary.readyApprovalTools += 1;
    }
    if (tool.mode === "prohibited" && tool.status === "blocked") {
      summary.blockedProhibitedTools += 1;
    }
  }

  if (tools.length === 0) {
    summary.connectorReadiness = "no_tools";
    summary.nextActions.push("Register at least one approved workspace tool.");
  } else if (!options.hasConnectorSecret) {
    summary.connectorReadiness = "missing_secret";
    summary.nextActions.push("Set OPENAI_WORKSPACE_CONNECTOR_SECRET in Vercel before publishing the ChatGPT connector.");
  } else {
    summary.connectorReadiness = "ready";
    summary.canExposeConnector = true;
  }

  if (summary.byStatus.blocked > 0) {
    summary.nextActions.push("Keep blocked tools visible as doctrine; do not expose them as execution tools.");
  }

  if (summary.byMode.approval_request > 0) {
    summary.nextActions.push("Approval-request tools only open Slack approvals; existing closers remain the execution layer.");
  }

  return summary;
}

export function groupWorkspaceToolsByMode(
  tools: readonly OpenAIWorkspaceTool[],
): Record<WorkspaceToolMode, OpenAIWorkspaceTool[]> {
  return {
    read: tools.filter((tool) => tool.mode === "read"),
    approval_request: tools.filter((tool) => tool.mode === "approval_request"),
    prohibited: tools.filter((tool) => tool.mode === "prohibited"),
  };
}
