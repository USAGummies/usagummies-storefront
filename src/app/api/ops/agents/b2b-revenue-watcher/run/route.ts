/**
 * B2B Revenue Watcher heartbeat.
 *
 * Read-only first heartbeat for the ChatGPT workspace-agent direction:
 * reads B2B revenue queues, returns a heartbeat run record, and does
 * not post Slack, send Gmail, mutate HubSpot, open approvals, or write
 * external systems. It writes one fail-soft internal audit entry so
 * `/ops/agents/status` can observe the dry-run.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { buildB2BRevenueWatcherRun } from "@/lib/ops/b2b-revenue-watcher";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { auditStore } from "@/lib/ops/control-plane/stores";
import type { RunContext } from "@/lib/ops/control-plane/types";
import { sourceWired } from "@/lib/ops/sales-command-center";
import {
  readFaireFollowUps,
  readPendingApprovals,
  readStaleBuyers,
  readWholesaleInquiries,
} from "@/lib/ops/sales-command-readers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return run(req);
}

export async function POST(req: Request): Promise<Response> {
  return run(req);
}

async function run(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const [staleBuyers, faireFollowUpsRaw, pendingApprovals, wholesaleInquiries] =
    await Promise.all([
      readStaleBuyers(now),
      readFaireFollowUps(now),
      readPendingApprovals(),
      readWholesaleInquiries(),
    ]);

  const faireFollowUps =
    faireFollowUpsRaw.status === "wired"
      ? sourceWired({
          overdue: faireFollowUpsRaw.value.counts.overdue,
          dueSoon: faireFollowUpsRaw.value.counts.due_soon,
        })
      : faireFollowUpsRaw;

  const pending =
    pendingApprovals.status === "wired"
      ? sourceWired({ total: pendingApprovals.value.total })
      : pendingApprovals;

  const result = buildB2BRevenueWatcherRun({
    now,
    runId: `b2b-revenue-watcher-${now.toISOString()}`,
    sources: {
      staleBuyers,
      faireFollowUps,
      pendingApprovals: pending,
      wholesaleInquiries,
    },
  });

  const degraded: string[] = [];
  const run: RunContext = {
    runId: result.runRecord.runId,
    agentId: "b2b-revenue-watcher",
    division: "sales",
    startedAt: now.toISOString(),
    source: "human-invoked",
    trigger: "heartbeat-dry-run",
  };

  try {
    await auditStore().append(
      buildAuditEntry(
        run,
        {
          action: "system.read",
          entityType: "agent-heartbeat-run",
          entityId: result.runRecord.runId,
          result:
            result.runRecord.outputState === "failed_degraded" ? "error" : "ok",
          after: {
            outputState: result.runRecord.outputState,
            nextHumanAction: result.runRecord.nextHumanAction,
            summary: result.summary,
            degradedSources: result.runRecord.degradedSources,
          },
          error:
            result.runRecord.outputState === "failed_degraded"
              ? {
                  message: result.runRecord.degradedSources.join("; "),
                  code: "heartbeat_failed_degraded",
                }
              : undefined,
          sourceCitations: [
            { system: "sales-command.stale-buyers" },
            { system: "faire.follow-ups" },
            { system: "control-plane.approvals" },
            { system: "wholesale.inquiries" },
          ],
          confidence: 1,
        },
        now,
      ),
    );
  } catch {
    degraded.push("audit-store: append failed (soft)");
  }

  return NextResponse.json({ ok: true, ...result, degraded });
}
