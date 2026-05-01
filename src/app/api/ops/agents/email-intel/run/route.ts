/**
 * Email-agent readiness heartbeat dry-run.
 *
 * This is NOT the email-intel runner. It reads readiness doctrine, builds a
 * canonical heartbeat run record, and writes one fail-soft internal audit entry
 * so /ops/agents/status can observe the dry-run. It never calls Gmail, creates
 * drafts, posts Slack approvals, mutates HubSpot, or invokes
 * /api/ops/fulfillment/email-intel/run.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { auditStore } from "@/lib/ops/control-plane/stores";
import type { RunContext } from "@/lib/ops/control-plane/types";
import { deriveEmailAgentsStatus } from "@/lib/ops/email-agents-status";
import { buildEmailAgentsHeartbeatRun } from "@/lib/ops/email-agents-heartbeat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = process.cwd();

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

  try {
    const now = new Date();
    const status = deriveEmailAgentsStatus({
      ...(await readStatusSources()),
      env: {
        EMAIL_INTEL_ENABLED: process.env.EMAIL_INTEL_ENABLED,
      },
    });
    const result = buildEmailAgentsHeartbeatRun({
      now,
      runId: `email-agents-readiness-${now.toISOString()}`,
      status,
    });
    const degraded: string[] = [];

    try {
      const runContext: RunContext = {
        runId: result.runRecord.runId,
        agentId: "email-agents-readiness",
        division: "platform-data-automation",
        startedAt: now.toISOString(),
        source: "human-invoked",
        trigger: "heartbeat-dry-run",
      };
      await auditStore().append(
        buildAuditEntry(
          runContext,
          {
            action: "system.read",
            entityType: "agent-heartbeat-run",
            entityId: result.runRecord.runId,
            result:
              result.runRecord.outputState === "failed_degraded" ? "error" : "ok",
            after: {
              outputState: result.runRecord.outputState,
              readiness: result.summary.readiness,
              gatesPassed: result.summary.gatesPassed,
              gatesTotal: result.summary.gatesTotal,
              nextHumanAction: result.runRecord.nextHumanAction,
              enabled: result.summary.enabled,
              cronConfigured: result.summary.cronConfigured,
            },
            error:
              result.runRecord.outputState === "failed_degraded"
                ? {
                    message: result.runRecord.degradedSources.join("; "),
                    code: "email_agents_heartbeat_degraded",
                  }
                : undefined,
            sourceCitations: [
              { system: "contracts.email-agents-system" },
              { system: "contracts.email-intel-incident" },
              { system: "contracts.email-agents-hubspot-schema" },
              { system: "vercel.crons" },
            ],
            confidence: 1,
          },
          now,
        ),
      );
    } catch {
      degraded.push("audit-store: append failed (soft)");
    }

    return NextResponse.json({ ok: true, status, ...result, degraded });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        code: "email_agents_heartbeat_failed",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

async function readStatusSources(): Promise<{
  incidentMarkdown: string;
  systemMarkdown: string;
  hubspotPropertyMarkdown: string;
  vercelJson: string;
}> {
  const [incidentMarkdown, systemMarkdown, hubspotPropertyMarkdown, vercelJson] =
    await Promise.all([
      readText("contracts/incident-2026-04-30-email-intel.md"),
      readText("contracts/email-agents-system.md"),
      readText("contracts/email-agents-hubspot-property-spec.md"),
      readText("vercel.json"),
    ]);
  return { incidentMarkdown, systemMarkdown, hubspotPropertyMarkdown, vercelJson };
}

function readText(relativePath: string): Promise<string> {
  return readFile(join(ROOT, relativePath), "utf8");
}
