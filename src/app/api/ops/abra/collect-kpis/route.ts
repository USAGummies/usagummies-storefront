import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/ops/abra-auth";
import { collectDailyKPIs, recordKPIs } from "@/lib/ops/kpi-collector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { metrics, errors } = await collectDailyKPIs();
    const recorded = await recordKPIs(metrics);

    return NextResponse.json({
      ok: true,
      collected: metrics.length,
      recorded,
      collectionErrors: errors,
      metrics: metrics.map((m) => ({ key: m.key, value: m.value })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to collect KPIs",
      },
      { status: 500 },
    );
  }
}
