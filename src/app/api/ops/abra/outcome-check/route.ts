import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/ops/abra-auth";
import { runOutcomeCheck, getOutcomeSummaryFromState } from "@/lib/ops/abra-outcome-tracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/ops/abra/outcome-check
 * Runs the outcome checker — iterates over pending outcomes older than 24h
 * and checks for results (email replies, deal progression, etc.).
 */
export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runOutcomeCheck();
    return NextResponse.json({
      ok: true,
      checked: result.checked,
      updated: result.updated,
      results: result.results,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Outcome check failed",
      },
      { status: 500 },
    );
  }
}

/**
 * GET /api/ops/abra/outcome-check
 * Returns outcome summary for the last 7 days.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await getOutcomeSummaryFromState(7);
    return NextResponse.json({ ok: true, days: 7, ...summary });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to get outcome summary",
      },
      { status: 500 },
    );
  }
}
