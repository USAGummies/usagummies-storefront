/**
 * GET /api/ops/status — Unified operations status
 *
 * Returns agent health summary, recent runs, engine status.
 * Powers the main dashboard and KPI pages.
 */

import { NextResponse } from "next/server";
import { readState, readStateArray } from "@/lib/ops/state";
import { ENGINE_REGISTRY } from "@/lib/ops/engine-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RunRecord = {
  engineId?: string;
  agentKey?: string;
  agentName?: string;
  agent?: string;
  label?: string;
  startedAt?: string;
  completedAt?: string;
  runAt?: string;
  durationMs?: number;
  status?: string;
  error?: string;
  triggeredBy?: string;
  source?: string;
};

type SystemStatus = {
  engine?: string;
  updatedAt?: string;
  updatedAtET?: string;
  agents?: Record<string, {
    key?: string;
    label?: string;
    lastStatus?: string;
    lastRunAtET?: string;
    lastRunDateET?: string;
    lastDurationMs?: number;
    summary?: string;
    lastError?: string;
  }>;
  recentEvents?: Array<{
    at?: string;
    agent?: string;
    status?: string;
    summary?: string;
  }>;
};

export async function GET() {
  const [ledger, status, recentDispatches] = await Promise.all([
    readStateArray<RunRecord>("run-ledger"),
    readState<SystemStatus>("system-status", {}),
    readStateArray<RunRecord>("run-ledger-recent"),
  ]);

  // Last 100 runs
  const recentRuns = ledger.slice(-100).reverse();

  // Build per-engine summary from registry
  const engineSummaries = ENGINE_REGISTRY.map((engine) => {
    const engineRuns = recentRuns.filter(
      (r) => r.engineId === engine.id || r.agent?.startsWith(engine.id === "b2b" ? "agent" : engine.id.charAt(0).toUpperCase())
    );
    const lastRun = engineRuns[0];
    const successCount = engineRuns.filter((r) => r.status === "success").length;
    const failCount = engineRuns.filter((r) => r.status === "failed").length;

    return {
      id: engine.id,
      name: engine.name,
      agentCount: engine.agents.length,
      recentRuns: engineRuns.length,
      successRate: engineRuns.length > 0 ? Math.round((successCount / engineRuns.length) * 100) : null,
      failCount,
      lastRun: lastRun
        ? {
            agent: lastRun.agentKey || lastRun.agent,
            name: lastRun.agentName || lastRun.label,
            status: lastRun.status,
            at: lastRun.startedAt || lastRun.runAt,
            durationMs: lastRun.durationMs,
          }
        : null,
    };
  });

  // Agent health from system status
  const agentStates = status?.agents || {};
  const agentCount = Object.keys(agentStates).length;
  const healthCounts = { healthy: 0, warning: 0, critical: 0, unknown: 0 };
  for (const a of Object.values(agentStates)) {
    if (a.lastStatus === "success") healthCounts.healthy++;
    else if (a.lastStatus === "failed") healthCounts.critical++;
    else if (a.lastStatus === "running") healthCounts.warning++;
    else healthCounts.unknown++;
  }

  const overall =
    healthCounts.critical > 2
      ? "critical"
      : healthCounts.warning > 5
      ? "warning"
      : healthCounts.healthy > 0
      ? "healthy"
      : "unknown";

  const totalAgents = ENGINE_REGISTRY.reduce((sum, e) => sum + e.agents.length, 0);

  return NextResponse.json({
    overall,
    totalAgents,
    healthCounts,
    engines: engineSummaries,
    recentRuns: recentRuns.slice(0, 50),
    systemStatus: {
      updatedAt: status?.updatedAt,
      updatedAtET: status?.updatedAtET,
      agentCount,
    },
    recentDispatches: recentDispatches.slice(-20).reverse(),
    generatedAt: new Date().toISOString(),
  });
}
