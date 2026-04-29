import type { Metadata } from "next";

import {
  buildWorkspaceToolDashboardSummary,
  groupWorkspaceToolsByMode,
} from "@/lib/ops/openai-workspace-tools/dashboard";
import { listOpenAIWorkspaceTools } from "@/lib/ops/openai-workspace-tools/registry";

import { OpenAIWorkspaceToolsView } from "./OpenAIWorkspaceToolsView.client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ChatGPT Connector · USA Gummies Ops",
};

export default function OpenAIWorkspaceToolsPage() {
  const tools = listOpenAIWorkspaceTools();
  const hasConnectorSecret =
    typeof process.env.OPENAI_WORKSPACE_CONNECTOR_SECRET === "string" &&
    process.env.OPENAI_WORKSPACE_CONNECTOR_SECRET.trim().length > 0;

  return (
    <OpenAIWorkspaceToolsView
      grouped={groupWorkspaceToolsByMode(tools)}
      summary={buildWorkspaceToolDashboardSummary(tools, {
        hasConnectorSecret,
      })}
    />
  );
}
