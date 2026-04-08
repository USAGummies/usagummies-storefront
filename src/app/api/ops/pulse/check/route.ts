import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  checkFleetHealth,
  generateFleetReport,
  storeHealthSnapshot,
} from "@/lib/ops/pulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const health = await checkFleetHealth();
    await storeHealthSnapshot(health);
    const report = generateFleetReport(health);

    return NextResponse.json({
      ok: true,
      health,
      report,
    });
  } catch (error) {
    console.error("[pulse/check] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Health check failed" }, { status: 500 });
  }
}
