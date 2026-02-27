import { NextRequest, NextResponse } from "next/server";
import { runOpsAudit } from "@/lib/ops/audit-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const forceRefresh = req.nextUrl.searchParams.get("force") === "1";
    const report = await runOpsAudit({ forceRefresh });
    return NextResponse.json(report);
  } catch (err) {
    console.error("[audit] Failed:", err);
    return NextResponse.json(
      {
        rules: [],
        freshness: [],
        summary: {
          passed: 0,
          warning: 0,
          failed: 0,
          unknown: 0,
          fresh: 0,
          stale: 0,
          critical: 0,
          missing: 0,
        },
        generatedAt: new Date().toISOString(),
        lastFetched: new Date().toISOString(),
        budget: null,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
