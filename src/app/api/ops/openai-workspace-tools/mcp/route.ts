/**
 * Read-only MCP-compatible endpoint for ChatGPT custom connectors.
 *
 * Exposes `search`, `fetch`, and approval-request tools. Approval
 * tools proxy to existing request-approval routes; they never execute
 * downstream closers, send Gmail, post QBO, buy labels, mutate
 * Shopify/HubSpot/Faire, or read raw env values.
 */
import { NextResponse } from "next/server";

import { isOpenAIWorkspaceAuthorized } from "@/lib/ops/openai-workspace-tools/auth";
import {
  type ApprovalToolExecutor,
  type ConnectorFetchResult,
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
    mode: "read_and_approval_request",
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

  const response = await handleWorkspaceMcpRequest(body, {
    executeApprovalTool: buildApprovalToolExecutor(req),
    loadLiveReadModel: buildLiveReadModelLoader(req),
  });
  const status = response.error?.code === -32004 ? 404 : 200;
  return NextResponse.json(response, { status });
}

function buildLiveReadModelLoader(req: Request) {
  return async (doc: ConnectorFetchResult) => {
    const route = doc.metadata.backingRoute;
    if (!route || !route.startsWith("/api/ops/")) return null;

    const cronSecret = process.env.CRON_SECRET?.trim();
    if (!cronSecret) {
      return {
        ok: false,
        status: 503,
        body: {
          ok: false,
          code: "cron_secret_missing",
          error:
            "CRON_SECRET is required for the ChatGPT connector to fetch live ops read-models.",
        },
      };
    }

    const url = new URL(route, req.url);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          authorization: `Bearer ${cronSecret}`,
        },
      });
    } catch (err) {
      return {
        ok: false,
        status: 502,
        body: {
          ok: false,
          code: "live_read_fetch_failed",
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      parsed = { ok: false, error: "Live read-model route returned non-JSON." };
    }

    return {
      ok: res.ok,
      status: res.status,
      body: parsed,
    };
  };
}

function buildApprovalToolExecutor(req: Request): ApprovalToolExecutor {
  return async ({ route, body }) => {
    const cronSecret = process.env.CRON_SECRET?.trim();
    if (!cronSecret) {
      return {
        ok: false,
        status: 503,
        body: {
          ok: false,
          code: "cron_secret_missing",
          error:
            "CRON_SECRET is required for the ChatGPT connector to call internal request-approval routes.",
        },
      };
    }

    const url = new URL(route, req.url);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: "POST",
        headers: {
          authorization: `Bearer ${cronSecret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return {
        ok: false,
        status: 502,
        body: {
          ok: false,
          code: "request_approval_fetch_failed",
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      parsed = { ok: false, error: "Request-approval route returned non-JSON." };
    }

    return {
      ok: res.ok,
      status: res.status,
      body: parsed,
    };
  };
}
