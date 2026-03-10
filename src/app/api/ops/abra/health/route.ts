import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { checkAndAlertHealth, getSystemHealth } from "@/lib/ops/abra-health-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const health = await getSystemHealth();
    return NextResponse.json(health);
  } catch (error) {
    console.error("[abra-health] get failed:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load health",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await checkAndAlertHealth();
    const health = await getSystemHealth();
    return NextResponse.json({ ok: true, health });
  } catch (error) {
    console.error("[abra-health] post failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Health check trigger failed",
      },
      { status: 500 },
    );
  }
}
