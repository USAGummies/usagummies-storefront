import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  autoManageInitiatives,
  checkInitiativeHealth,
} from "@/lib/ops/abra-initiative-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const initiatives = await checkInitiativeHealth();
    const counts = {
      healthy: initiatives.filter((row) => row.health === "healthy").length,
      stale: initiatives.filter((row) => row.health === "stale").length,
      abandoned: initiatives.filter((row) => row.health === "abandoned").length,
    };

    return NextResponse.json({
      initiatives,
      counts,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to compute initiative health",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await autoManageInitiatives();
    return NextResponse.json({
      ok: true,
      ...result,
      triggered_at: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to auto-manage initiatives",
      },
      { status: 500 },
    );
  }
}
