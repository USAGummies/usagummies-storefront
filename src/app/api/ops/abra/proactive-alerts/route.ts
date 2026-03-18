import { NextResponse } from "next/server";
import { isAuthorized, isCronAuthorized } from "@/lib/ops/abra-auth";
import { runProactiveAlertScan } from "@/lib/ops/proactive-alerts";
import { readState } from "@/lib/ops/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// POST — Run the proactive alert scan (auth via cron secret)
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runProactiveAlertScan();
    return NextResponse.json({
      ok: true,
      alerts: result.alerts.length,
      sent: result.sent,
      suppressed: result.suppressed,
      details: result.alerts.map((a) => ({
        type: a.type,
        severity: a.severity,
        title: a.title,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Proactive alert scan failed",
      },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// GET — Return recent alerts (dedup map as proxy for last 24h)
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const dedupMap = await readState(
      "proactive-alert-dedup",
      {} as Record<string, number>,
    );

    // Filter to last 24h
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recentAlerts = Object.entries(dedupMap)
      .filter(([, ts]) => ts > cutoff)
      .map(([key, ts]) => ({
        dedupKey: key,
        lastAlerted: new Date(ts).toISOString(),
        ageMinutes: Math.round((Date.now() - ts) / 60_000),
      }))
      .sort((a, b) => b.ageMinutes - a.ageMinutes);

    return NextResponse.json({
      ok: true,
      recentAlerts,
      count: recentAlerts.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch recent alerts",
      },
      { status: 500 },
    );
  }
}
