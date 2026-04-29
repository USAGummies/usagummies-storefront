/**
 * Read-only MCP-compatible endpoint for ChatGPT custom connectors.
 *
 * Exposes only `search` and `fetch` over the approved workspace-tool
 * documents. It never executes tools, opens approvals, writes KV, calls
 * Gmail/QBO/ShipStation/Shopify/HubSpot/Faire, or reads raw env values.
 */
import { NextResponse } from "next/server";

import { isOpenAIWorkspaceAuthorized } from "@/lib/ops/openai-workspace-tools/auth";
import {
  handleWorkspaceMcpRequest,
  mcpToolDefinitions,
} from "@/lib/ops/openai-workspace-tools/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!(await isOpenAIWorkspaceAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    server: "usa-gummies-openai-workspace-tools",
    mode: "read_only",
    tools: mcpToolDefinitions(),
  });
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isOpenAIWorkspaceAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Invalid JSON body" },
      },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid MCP request body" },
      },
      { status: 400 },
    );
  }

  const response = handleWorkspaceMcpRequest(body);
  const status = response.error?.code === -32004 ? 404 : 200;
  return NextResponse.json(response, { status });
}
