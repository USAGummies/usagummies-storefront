/**
 * GET /api/ops/control-plane/approvals
 *
 * Inspect recent approvals. Modes:
 *   mode=pending      — approvalStore.listPending()
 *   mode=by-agent     — approvalStore.listByAgent(agentId, limit)
 *
 * Query params:
 *   mode     (required)
 *   agentId  (required for mode=by-agent)
 *   limit    (default 50, max 200)
 *
 * Auth: bearer CRON_SECRET.
 */

import { NextResponse } from "next/server";

import { approvalStore } from "@/lib/ops/control-plane/stores";
import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "pending";
  const limit = clampInt(url.searchParams.get("limit"), 1, 200, 50);

  if (mode !== "pending" && mode !== "by-agent") {
    return NextResponse.json(
      { error: "Invalid mode", allowed: ["pending", "by-agent"] },
      { status: 400 },
    );
  }

  try {
    if (mode === "pending") {
      const approvals = await approvalStore().listPending();
      const capped = approvals.slice(0, limit);
      return NextResponse.json({
        ok: true,
        mode,
        count: capped.length,
        approvals: capped,
      });
    }
    const agentId = url.searchParams.get("agentId");
    if (!agentId) {
      return NextResponse.json(
        { error: "Missing required param: agentId (for mode=by-agent)" },
        { status: 400 },
      );
    }
    const approvals = await approvalStore().listByAgent(agentId, limit);
    return NextResponse.json({
      ok: true,
      mode,
      agentId,
      count: approvals.length,
      approvals,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "approval store unavailable",
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
