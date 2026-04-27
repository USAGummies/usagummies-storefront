/**
 * GET /api/ops/agents/health
 *
 * Phase 28L.4 — read-only doctrine view of every registered agent.
 *
 * What this returns (vs the existing `/api/ops/agents/status`):
 *   - status route → runtime view (cadence, last run, errors-24h)
 *   - health route → doctrine view (job vs task, owner, approver,
 *     lifecycle, doctrine flags)
 *
 * Both are valuable; they're sibling surfaces, not replacements.
 *
 * Hard rules:
 *   - **Auth-gated.** `isAuthorized()` (session OR CRON_SECRET).
 *   - **Pure.** No KV, no Slack, no external reads. Just the
 *     hand-curated manifest + the doctrine evaluator.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  AGENT_MANIFEST,
  buildAgentHealthRows,
  summarizeAgentHealth,
} from "@/lib/ops/agent-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = buildAgentHealthRows(AGENT_MANIFEST);
  const summary = summarizeAgentHealth(rows);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    summary,
    rows,
  });
}
