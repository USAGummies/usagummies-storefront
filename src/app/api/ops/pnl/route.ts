/**
 * GET /api/ops/pnl — Profit & Loss report
 *
 * Returns revenue, COGS, gross profit, operating expenses, and net income.
 * Query params:
 *   ?period=mtd|custom
 *   &start=YYYY-MM-DD (for custom)
 *   &end=YYYY-MM-DD (for custom)
 *
 * Protected by middleware (requires JWT session).
 */

import { NextResponse } from "next/server";
import { buildPnL } from "@/lib/finance/pnl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const period = url.searchParams.get("period") || "mtd";
    let start: string | undefined;
    let end: string | undefined;

    if (period === "custom") {
      start = url.searchParams.get("start") || undefined;
      end = url.searchParams.get("end") || undefined;
    }

    const report = await buildPnL(start, end);
    return NextResponse.json(report);
  } catch (err) {
    console.error("[pnl] Build failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "P&L build failed" },
      { status: 500 },
    );
  }
}
