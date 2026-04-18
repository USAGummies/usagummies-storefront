/**
 * GET /api/ops/control-plane/scorecards
 *
 * Inspect recent drift-audit scorecards. Implemented on top of
 * auditStore.byAction() — a dedicated per-action index so the latest
 * weekly scorecard is always findable regardless of how much other
 * audit volume has landed since it was persisted. (Previously this
 * route scanned a bounded recent window; under real volume the newest
 * scorecard could fall off the end. See audit.ts AuditStore.byAction
 * + kv-stores.ts 3.0:audit:action:* secondary index.)
 *
 * Query params:
 *   limit — how many to return (default 10, max 50)
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
  const limit = clampInt(url.searchParams.get("limit"), 1, 50, 10);

  try {
    const entries = await auditStore().byAction("drift-audit.scorecard", limit);
    const scorecards = entries.map((e) => ({
      scorecardId: e.entityId,
      runId: e.runId,
      createdAt: e.createdAt,
      summary: typeof e.after === "string" ? e.after : null,
    }));
    return NextResponse.json({
      ok: true,
      count: scorecards.length,
      scorecards,
    });
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
