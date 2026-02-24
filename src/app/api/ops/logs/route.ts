/**
 * GET /api/ops/logs — Recent agent run logs
 *
 * Returns the run ledger (last 200 entries) plus recent engine logs.
 * Supports ?engine= filter and ?limit= parameter.
 */

import { NextRequest, NextResponse } from "next/server";
import { readStateArray, readStateTail } from "@/lib/ops/state";

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
  runAtET?: string;
  runDateET?: string;
  durationMs?: number;
  status?: string;
  error?: string;
  triggeredBy?: string;
  source?: string;
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const engineFilter = searchParams.get("engine");
  const limit = Math.min(Number(searchParams.get("limit") || "200"), 500);

  const [ledger, engineLogLines] = await Promise.all([
    readStateArray<RunRecord>("run-ledger"),
    readStateTail("engine-log", 200),
  ]);

  let runs = ledger.slice(-limit * 2); // Over-fetch to account for filter

  if (engineFilter) {
    runs = runs.filter(
      (r) => r.engineId === engineFilter || r.agent?.toLowerCase().startsWith(engineFilter.charAt(0))
    );
  }

  runs = runs.slice(-limit).reverse();

  // Stats
  const last24h = Date.now() - 86_400_000;
  const recentRuns = ledger.filter((r) => {
    const ts = r.startedAt || r.runAt;
    return ts ? Date.parse(ts) > last24h : false;
  });

  return NextResponse.json({
    runs,
    engineLog: engineLogLines.slice(-100),
    stats: {
      total: ledger.length,
      last24h: recentRuns.length,
      successes24h: recentRuns.filter((r) => r.status === "success").length,
      failures24h: recentRuns.filter((r) => r.status === "failed").length,
    },
    generatedAt: new Date().toISOString(),
  });
}
