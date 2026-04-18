/**
 * GET /api/ops/control-plane/paused
 *
 * List all currently paused agents from the PauseSink.
 *
 * Auth: bearer CRON_SECRET.
 * Canonical spec: /contracts/governance.md §5.
 */

import { NextResponse } from "next/server";

import { pauseSink } from "@/lib/ops/control-plane/stores";
import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  try {
    const paused = await pauseSink().listPaused();
    return NextResponse.json({
      ok: true,
      count: paused.length,
      paused,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "pause sink unavailable",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    );
  }
}
