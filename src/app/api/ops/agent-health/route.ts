import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  getAllAgentHealth,
  getFailingAgents,
} from "@/lib/ops/agent-performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/ops/agent-health — agent health reports (auth required)
//   ?failing=1 — only failing/degraded agents
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const params = req.nextUrl.searchParams;
    const failingOnly = params.get("failing") === "1";

    const reports = failingOnly
      ? await getFailingAgents()
      : await getAllAgentHealth();

    return NextResponse.json({
      reports,
      total: reports.length,
      failing: reports.filter(
        (r) => r.health === "failing" || r.health === "degraded",
      ).length,
      disabled: reports.filter((r) => r.disabled).length,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[api/ops/agent-health] GET failed:", err);
    return NextResponse.json(
      {
        reports: [],
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
