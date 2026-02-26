/**
 * GET /api/ops/forecast — Cash flow forecast for 30/60/90 days
 *
 * Combines known receivables (settlements, payouts) with
 * estimated payables (recurring expenses, COGS) to project cash flow.
 *
 * Protected by middleware (requires JWT session).
 */

import { NextResponse } from "next/server";
import { buildForecastReport } from "@/lib/finance/forecast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const report = await buildForecastReport();
    return NextResponse.json(report);
  } catch (err) {
    console.error("[forecast] Build failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Forecast build failed" },
      { status: 500 },
    );
  }
}
