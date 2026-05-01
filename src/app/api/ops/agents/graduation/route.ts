/**
 * GET /api/ops/agents/graduation
 *
 * Read-only graduation gauge — for every agent in the manifest, returns
 * pass/fail criteria for advancing to the next lifecycle stage. Codex's
 * Phase 6.10 heartbeat primitives (audit log + last-run handoff context)
 * provide the run history; this route layers the doctrine criteria on
 * top so an operator can see "is this agent earning the next stage?"
 *
 * Sibling to:
 *   /api/ops/agents/status — runtime view (cron, last run, errors)
 *   /api/ops/agents/health — doctrine view (owner/approver/flags)
 *   /api/ops/agents/graduation — readiness view (THIS route)
 *
 * Hard rules:
 *   - Auth-gated. `isAuthorized()` (session OR CRON_SECRET).
 *   - Read-only. Never advances an agent's lifecycle on its own.
 *   - Defensive on audit fetch — if the store throws, return all gauges
 *     with empty audit (criteria related to runs will fail; the rest
 *     still surface). Operator can see the degraded source.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  AGENT_MANIFEST,
  buildAgentHealthRows,
} from "@/lib/ops/agent-health";
import {
  evaluateAllGraduations,
  groupAuditByAgent,
  summarizeGraduations,
} from "@/lib/ops/agent-graduation";
import { auditStore } from "@/lib/ops/control-plane/stores";
import type { AuditLogEntry } from "@/lib/ops/control-plane/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Audit fetch limit. The graduation window is 30 days; in steady state
 * we expect a few hundred entries per active agent, so 5,000 is a
 * comfortable cap that keeps the request bounded.
 */
const AUDIT_FETCH_LIMIT = 5000;

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = buildAgentHealthRows(AGENT_MANIFEST);

  let audit: AuditLogEntry[] = [];
  const degraded: string[] = [];
  try {
    audit = (await auditStore().recent(AUDIT_FETCH_LIMIT)) as AuditLogEntry[];
  } catch (err) {
    degraded.push(
      `audit-fetch: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const auditByAgent = groupAuditByAgent(audit, AGENT_MANIFEST);

  const gauges = evaluateAllGraduations({
    rows,
    auditByAgent,
    now: new Date(),
  });
  const summary = summarizeGraduations(gauges);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    summary,
    gauges,
    degraded,
    notes: {
      auditFetchLimit: AUDIT_FETCH_LIMIT,
      windowDays: 30,
      sibling: {
        runtime: "/api/ops/agents/status",
        doctrine: "/api/ops/agents/health",
      },
    },
  });
}
