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
import { kv } from "@vercel/kv";
import { getDueAgents, ENGINE_REGISTRY } from "@/lib/ops/engine-schedule";
import { buildIntegrationSLAReport, type IntegrationSLAReport } from "@/lib/ops/env-check";
import { runFailureInjectionSuite } from "@/lib/ops/failure-injection";
import { appendStateArray, readState, writeState } from "@/lib/ops/state";
import { runOpsAudit } from "@/lib/ops/audit-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // Scheduler itself is lightweight

// ALL autonomous scheduling killed. No sweeps, no agents, no QStash dispatch.
// Interactive Slack responses and morning/evening briefs remain functional
// via their dedicated routes only when explicitly triggered.
const legacyAutonomousAbraDisabled = true;

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
  try {
    const existing = await kv.get<string>(`scheduler:lock:${engineId}:${agentKey}`);
    if (existing) return true;
  } catch {
    // KV unavailable — fall back to state-based dedupe
  }
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
  try {
    await kv.set(`scheduler:last_run:${engineId}:${agentKey}`, new Date().toISOString(), {
      ex: 7 * 86400,
    });
    await kv.set(`scheduler:lock:${engineId}:${agentKey}`, "running", { ex: 300 });
  } catch {
    // KV unavailable — state ledger still records dispatches
  }
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

  if (legacyAutonomousAbraDisabled) {
    return NextResponse.json({
      ok: true,
      disabled: true,
      reason: "Legacy master scheduler disabled; Paperclip is the active control plane.",
      timestamp: new Date().toISOString(),
    });
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

    const destination =
      engineId === "sweeps"
        ? `${baseUrl}/api/ops/sweeps/${agent.key}`
        : `${baseUrl}/api/ops/engine/${engineId}/${agent.key}`;

    if (qstash) {
      // Dispatch via QStash for async execution
      try {
        const res = await qstash.publishJSON({
          url: destination,
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

  // Always dispatch the Abra scheduler for feeds, anomaly detection, morning brief, etc.
  // Use direct fetch (fire-and-forget) instead of QStash to conserve daily QStash quota.
  let abraSchedulerOk = false;
  try {
    const abraUrl = `${baseUrl}/api/ops/abra/scheduler`;
    const cronSecret = process.env.CRON_SECRET;
    const res = await fetch(abraUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cronSecret ? { authorization: `Bearer ${cronSecret}` } : {}),
      },
      body: JSON.stringify({ triggeredBy: "master-scheduler" }),
      signal: AbortSignal.timeout(15000),
    });
    abraSchedulerOk = res.ok;
  } catch (e) {
    console.error("[scheduler] Abra scheduler dispatch failed:", e);
  }

  // Integration/feed health check and alerting (best-effort).
  try {
    const { checkAndAlertHealth } = await import("@/lib/ops/abra-health-monitor");
    await checkAndAlertHealth();
  } catch (e) {
    console.error("[scheduler] Health check failed:", e);
  }

  // Keep audit cache warm — run every 30 min (top of hour + :30) instead of every 5 min
  // to reduce function execution time on most scheduler cycles.
  const etMin = nowET.getMinutes();
  let auditWarm = false;
  if (etMin < 5 || (etMin >= 30 && etMin < 35)) {
    try {
      await runOpsAudit();
      auditWarm = true;
    } catch (err) {
      console.error("[scheduler] Audit warmup failed:", err);
    }
  }

  // Weekly connector SLA report — only check on Monday cycles or first-time init.
  // Previously ran buildIntegrationSLAReport() every 5 min (wasteful).
  let integrationSLA: IntegrationSLAReport | null = null;
  let integrationSLAUpdated = false;
  if (nowET.getDay() === 1 && nowET.getHours() === 8 && etMin < 5) {
    // Monday 8:00 AM ET — rebuild SLA report
    try {
      const currentWeekReport = buildIntegrationSLAReport();
      const existing = await readState<IntegrationSLAReport | null>(
        "integration-sla-report",
        null,
      );
      if (!existing || existing.weekKey !== currentWeekReport.weekKey) {
        await writeState("integration-sla-report", currentWeekReport);
        integrationSLA = currentWeekReport;
        integrationSLAUpdated = true;
      } else {
        integrationSLA = existing;
      }
    } catch (err) {
      console.error("[scheduler] Integration SLA report failed:", err);
    }
  }

  // Chaos / failure-injection suite — run once daily at 3:00 AM ET instead of every 5 min.
  let chaos = null as Awaited<ReturnType<typeof runFailureInjectionSuite>> | null;
  if (nowET.getHours() === 3 && etMin < 5) {
    try {
      chaos = await runFailureInjectionSuite();
      await writeState("chaos-suite-report", chaos);
    } catch (err) {
      console.error("[scheduler] Failure-injection suite failed:", err);
    }
  }

  return NextResponse.json({
    ok: true,
    timestamp: etTimestamp(),
    etTime: `${nowET.getHours().toString().padStart(2, "0")}:${nowET.getMinutes().toString().padStart(2, "0")}`,
    totalDue: dueAgents.length,
    dispatched: dispatched.length,
    abraSchedulerDispatched: abraSchedulerOk,
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
  // Authentication — require CRON_SECRET Bearer token (same as GET handler)
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

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
    const destination =
      engineId === "sweeps"
        ? `${baseUrl}/api/ops/sweeps/${agentKey}`
        : `${baseUrl}/api/ops/engine/${engineId}/${agentKey}`;

    if (qstash) {
      const res = await qstash.publishJSON({
        url: destination,
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

    const cronSecret = process.env.CRON_SECRET?.trim();
    const directRes = await fetch(destination, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
      },
      body: JSON.stringify({ engineId, agentKey, triggeredBy: "manual" }),
      signal: AbortSignal.timeout(30_000),
    });

    const directBody = (await directRes.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json({
      ok: directRes.ok,
      message: directRes.ok
        ? `Dispatched ${agent.name} (${engineId}/${agentKey}) directly`
        : `Direct dispatch failed for ${agent.name} (${engineId}/${agentKey})`,
      result: directBody,
    }, { status: directRes.ok ? 200 : 500 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
