/**
 * GET /api/ops/openai-workspace-tools
 *
 * Internal, auth-gated registry for what a future ChatGPT custom
 * connector / MCP surface may expose. This route is diagnostic only:
 * it does not call external services, read env values, write KV, open
 * Slack approvals, or execute any tool.
 */
import { NextResponse } from "next/server";

import { isOpenAIWorkspaceAuthorized } from "@/lib/ops/openai-workspace-tools/auth";
import {
  connectorSearchDocuments,
  listOpenAIWorkspaceTools,
  summarizeOpenAIWorkspaceTools,
} from "@/lib/ops/openai-workspace-tools/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!(await isOpenAIWorkspaceAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tools = listOpenAIWorkspaceTools();

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    doctrine: {
      canonicalSurface:
        "ChatGPT workspace agents are a connector/read surface over the existing control-plane, not a second automation brain.",
      writes:
        "ChatGPT may request registered Slack approvals only. Existing closers execute after human approval.",
      prohibited:
        "No direct QBO, Gmail, ShipStation, Shopify checkout, HubSpot stage/property, or Faire API writes from ChatGPT.",
    },
    summary: summarizeOpenAIWorkspaceTools(tools),
    tools,
    connectorDocuments: connectorSearchDocuments(tools),
  });
}
