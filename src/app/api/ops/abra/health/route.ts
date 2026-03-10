import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { checkAndAlertHealth, getSystemHealth } from "@/lib/ops/abra-health-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  return !!secret && authHeader === `Bearer ${secret}`;
}

async function isAuthorized(req: Request): Promise<boolean> {
  const session = await auth();
  if (session?.user?.email) return true;
  return isCronAuthorized(req);
}

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
