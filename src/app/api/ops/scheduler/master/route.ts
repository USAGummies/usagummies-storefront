/**
 * GET /api/ops/scheduler/master — Master scheduler (Vercel Cron, every 5 min)
 *
 * Runs every 5 minutes via vercel.json cron. Checks which agents are due
 * based on ET time, then dispatches each via QStash to the universal
 * executor route for async processing.
 *
 * Also handles direct invocation: POST with { engineId, agentKey } to
 * manually dispatch a specific agent.
 */

import { NextRequest, NextResponse } from "next/server";
import { Client } from "@upstash/qstash";
import { getDueAgents, ENGINE_REGISTRY } from "@/lib/ops/engine-schedule";
import { buildIntegrationSLAReport, type IntegrationSLAReport } from "@/lib/ops/env-check";
import { runFailureInjectionSuite } from "@/lib/ops/failure-injection";
import { appendStateArray, readState, writeState } from "@/lib/ops/state";
import { runOpsAudit } from "@/lib/ops/audit-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // Scheduler itself is lightweight

// ---------------------------------------------------------------------------
// QStash client (lazy init)
// ---------------------------------------------------------------------------

function getQStash(): Client | null {
  const token = process.env.QSTASH_TOKEN;
  if (!token) return null;
  return new Client({ token });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getETNow(): Date {
  // Create a date object that represents current ET time
  const now = new Date();
  const etString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  return new Date(etString);
}

function etTimestamp(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .replace(",", "");
}

type DispatchRecord = {
  engineId: string;
  agentKey: string;
  agentName: string;
  dispatchedAt: string;
  qstashMessageId?: string;
  method: "qstash" | "direct" | "skipped";
  error?: string;
};

// ---------------------------------------------------------------------------
// Deduplication — prevent double-dispatch within the 5-min window
// ---------------------------------------------------------------------------

type RecentDispatch = { engineId: string; agentKey: string; at: string };

async function wasRecentlyDispatched(
  engineId: string,
  agentKey: string
): Promise<boolean> {
  const recent = await readState<RecentDispatch[]>("run-ledger-recent", []);
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  return recent.some(
    (r) =>
      r.engineId === engineId &&
      r.agentKey === agentKey &&
      new Date(r.at).getTime() > fiveMinAgo
  );
}

async function recordDispatch(engineId: string, agentKey: string): Promise<void> {
  const recent = await readState<RecentDispatch[]>("run-ledger-recent", []);
  recent.push({ engineId, agentKey, at: new Date().toISOString() });
  // Keep only last 200 entries
  const trimmed = recent.slice(-200);
  await writeState("run-ledger-recent" as never, trimmed);
}

// ---------------------------------------------------------------------------
// GET — Cron-triggered master scheduler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  // Verify Vercel cron secret (optional extra security)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const nowET = getETNow();
  const dueAgents = getDueAgents(nowET);
  const dispatched: DispatchRecord[] = [];
  const qstash = getQStash();

  const baseUrl =
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXTAUTH_URL || "https://www.usagummies.com";

  for (const { engineId, agent } of dueAgents) {
    // Dedup check
    if (await wasRecentlyDispatched(engineId, agent.key)) {
      dispatched.push({
        engineId,
        agentKey: agent.key,
        agentName: agent.name,
        dispatchedAt: etTimestamp(),
        method: "skipped",
        error: "Recently dispatched (dedup)",
      });
      continue;
    }

    if (qstash) {
      // Dispatch via QStash for async execution
      try {
        const res = await qstash.publishJSON({
          url: `${baseUrl}/api/ops/engine/${engineId}/${agent.key}`,
          body: { engineId, agentKey: agent.key, triggeredBy: "scheduler" },
          retries: 1,
          timeout: "5m",
        });

        await recordDispatch(engineId, agent.key);
        dispatched.push({
          engineId,
          agentKey: agent.key,
          agentName: agent.name,
          dispatchedAt: etTimestamp(),
          qstashMessageId: res.messageId,
          method: "qstash",
        });
      } catch (err) {
        dispatched.push({
          engineId,
          agentKey: agent.key,
          agentName: agent.name,
          dispatchedAt: etTimestamp(),
          method: "qstash",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      // No QStash configured — log as skipped (dev mode)
      dispatched.push({
        engineId,
        agentKey: agent.key,
        agentName: agent.name,
        dispatchedAt: etTimestamp(),
        method: "skipped",
        error: "QStash not configured",
      });
    }
  }

  // Append to run ledger
  if (dispatched.length > 0) {
    await appendStateArray("run-ledger", dispatched, 10000);
  }

  // Keep audit cache warm so pages have recent reconciliation + freshness data.
  let auditWarm = false;
  try {
    await runOpsAudit();
    auditWarm = true;
  } catch (err) {
    console.error("[scheduler] Audit warmup failed:", err);
  }

  // Weekly connector SLA report (Monday ET) + nightly failure-injection report.
  let integrationSLA: IntegrationSLAReport | null = null;
  let integrationSLAUpdated = false;
  try {
    const currentWeekReport = buildIntegrationSLAReport();
    const existing = await readState<IntegrationSLAReport | null>(
      "integration-sla-report",
      null,
    );

    if (nowET.getDay() === 1 && existing?.weekKey !== currentWeekReport.weekKey) {
      await writeState("integration-sla-report", currentWeekReport);
      integrationSLA = currentWeekReport;
      integrationSLAUpdated = true;
    } else {
      integrationSLA = existing || currentWeekReport;
      if (!existing) {
        await writeState("integration-sla-report", currentWeekReport);
        integrationSLAUpdated = true;
      }
    }
  } catch (err) {
    console.error("[scheduler] Integration SLA report failed:", err);
  }

  let chaos = null as Awaited<ReturnType<typeof runFailureInjectionSuite>> | null;
  try {
    chaos = await runFailureInjectionSuite();
    await writeState("chaos-suite-report", chaos);
  } catch (err) {
    console.error("[scheduler] Failure-injection suite failed:", err);
  }

  return NextResponse.json({
    ok: true,
    timestamp: etTimestamp(),
    etTime: `${nowET.getHours().toString().padStart(2, "0")}:${nowET.getMinutes().toString().padStart(2, "0")}`,
    totalDue: dueAgents.length,
    dispatched: dispatched.length,
    auditWarm,
    integrationSLA: integrationSLA
      ? {
          weekKey: integrationSLA.weekKey,
          coveragePct: integrationSLA.summary.coveragePct,
          staleCredentials: integrationSLA.summary.staleCredentials,
          notConfigured: integrationSLA.summary.notConfigured,
          generatedAt: integrationSLA.generatedAt,
          updated: integrationSLAUpdated,
        }
      : null,
    chaos: chaos
      ? {
          generatedAt: chaos.generatedAt,
          passed: chaos.summary.passed,
          failed: chaos.summary.failed,
          total: chaos.summary.total,
        }
      : null,
    agents: dispatched,
  });
}

// ---------------------------------------------------------------------------
// POST — Manual agent dispatch
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { engineId, agentKey } = body as {
      engineId: string;
      agentKey: string;
    };

    if (!engineId || !agentKey) {
      return NextResponse.json(
        { error: "engineId and agentKey are required" },
        { status: 400 }
      );
    }

    // Validate engine/agent exists
    const engine = ENGINE_REGISTRY.find((e) => e.id === engineId);
    if (!engine) {
      return NextResponse.json(
        { error: `Engine "${engineId}" not found` },
        { status: 404 }
      );
    }
    const agent = engine.agents.find((a) => a.key === agentKey);
    if (!agent) {
      return NextResponse.json(
        { error: `Agent "${agentKey}" not found in engine "${engineId}"` },
        { status: 404 }
      );
    }

    const qstash = getQStash();
    const baseUrl =
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.NEXTAUTH_URL || "https://www.usagummies.com";

    if (qstash) {
      const res = await qstash.publishJSON({
        url: `${baseUrl}/api/ops/engine/${engineId}/${agentKey}`,
        body: { engineId, agentKey, triggeredBy: "manual" },
        retries: 1,
        timeout: "5m",
      });

      return NextResponse.json({
        ok: true,
        message: `Dispatched ${agent.name} (${engineId}/${agentKey}) via QStash`,
        qstashMessageId: res.messageId,
      });
    }

    return NextResponse.json({
      ok: false,
      message: "QStash not configured — cannot dispatch",
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
