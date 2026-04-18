/**
 * GET /api/ops/control-plane/audit
 *
 * Inspect recent audit entries. Modes:
 *   mode=recent    — auditStore.recent(limit)
 *   mode=by-run    — auditStore.byRun(runId)
 *   mode=by-agent  — auditStore.byAgent(agentId, sinceISO)
 *
 * Query params:
 *   mode      (default recent)
 *   runId     (required for mode=by-run)
 *   agentId   (required for mode=by-agent)
 *   sinceDays (mode=by-agent only, default 7, max 90)
 *   limit     (mode=recent, default 50, max 500)
 *
 * Auth: bearer CRON_SECRET.
 */

import { NextResponse } from "next/server";

import { auditStore } from "@/lib/ops/control-plane/stores";
import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "recent";
  const store = auditStore();

  try {
    if (mode === "recent") {
      const limit = clampInt(url.searchParams.get("limit"), 1, 500, 50);
      const entries = await store.recent(limit);
      return NextResponse.json({ ok: true, mode, count: entries.length, entries });
    }
    if (mode === "by-run") {
      const runId = url.searchParams.get("runId");
      if (!runId) {
        return NextResponse.json(
          { error: "Missing required param: runId (for mode=by-run)" },
          { status: 400 },
        );
      }
      const entries = await store.byRun(runId);
      return NextResponse.json({
        ok: true,
        mode,
        runId,
        count: entries.length,
        entries,
      });
    }
    if (mode === "by-agent") {
      const agentId = url.searchParams.get("agentId");
      if (!agentId) {
        return NextResponse.json(
          { error: "Missing required param: agentId (for mode=by-agent)" },
          { status: 400 },
        );
      }
      const sinceDays = clampInt(url.searchParams.get("sinceDays"), 1, 90, 7);
      const sinceISO = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
      const entries = await store.byAgent(agentId, sinceISO);
      return NextResponse.json({
        ok: true,
        mode,
        agentId,
        sinceISO,
        count: entries.length,
        entries,
      });
    }
    return NextResponse.json(
      {
        error: "Invalid mode",
        allowed: ["recent", "by-run", "by-agent"],
      },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "audit store unavailable",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    );
  }
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}
