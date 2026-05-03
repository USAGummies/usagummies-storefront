/**
 * GET /api/ops/agents/runs/[agentId]
 *
 * Per-agent run-history timeline. Drill-down sibling of
 * /api/ops/agents/status (which shows just the LAST run per agent).
 *
 * Closes the Phase 2 build-sequence item: "/ops/agents dashboard —
 * consolidated run history per agent". The status strip stays the
 * fleet-wide health view; this route powers the per-agent
 * `/ops/agents/runs/[agentId]` timeline page.
 *
 * Response shape:
 *   { ok, agent: AgentManifestEntry | null, history: AgentRunHistory }
 *
 * `agent` is null when the agentId isn't in the manifest. We still
 * return whatever audit entries exist for that actor — surfacing
 * "unknown agent" honestly is better than 404'ing on a real run.
 *
 * Auth: session OR bearer CRON_SECRET (matches /api/ops/agents/status).
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { auditStore } from "@/lib/ops/control-plane/stores";
import {
  getAgentManifestEntry,
  type AgentManifestEntry,
} from "@/lib/ops/agents-runs/manifest";
import {
  buildAgentRunHistory,
  type AgentRunHistory,
} from "@/lib/ops/agents-runs/run-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many audit entries we scan to source the timeline. */
const AUDIT_WINDOW = 1000;
/** Default + max number of runs returned. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface RouteResponse {
  ok: boolean;
  agentId: string;
  agent: AgentManifestEntry | null;
  history: AgentRunHistory;
  degraded: string[];
}

export async function GET(
  req: Request,
  context: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { agentId } = await context.params;
  if (!agentId || typeof agentId !== "string" || agentId.length > 200) {
    return NextResponse.json(
      { error: "agentId required (path param)" },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const limitRaw = Number.parseInt(
    url.searchParams.get("limit") ?? "",
    10,
  );
  const limit = Math.max(
    1,
    Math.min(
      MAX_LIMIT,
      Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT,
    ),
  );

  const degraded: string[] = [];
  let recent: Awaited<ReturnType<ReturnType<typeof auditStore>["recent"]>> = [];
  try {
    recent = await auditStore().recent(AUDIT_WINDOW);
  } catch (err) {
    degraded.push(
      `audit-store: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const history = buildAgentRunHistory(recent, agentId, {
    limit,
    windowDescription: `last ${AUDIT_WINDOW} audit entries (${recent.length} actually retrieved)`,
  });

  const response: RouteResponse = {
    ok: true,
    agentId,
    agent: getAgentManifestEntry(agentId),
    history,
    degraded,
  };
  return NextResponse.json(response);
}
