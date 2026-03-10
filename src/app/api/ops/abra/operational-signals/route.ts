import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getActiveSignals } from "@/lib/ops/abra-operational-signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  return !!secret && authHeader === `Bearer ${secret}`;
}

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.email && !isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const department = url.searchParams.get("department") || undefined;
    const severity = url.searchParams.get("severity") || undefined;
    const limitRaw = Number(url.searchParams.get("limit") || 5);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.floor(limitRaw), 1), 50)
      : 5;

    const signals = await getActiveSignals({ department, severity, limit });
    const sorted = [...signals].sort((a, b) => {
      const sev = (SEVERITY_WEIGHT[b.severity] || 0) - (SEVERITY_WEIGHT[a.severity] || 0);
      if (sev !== 0) return sev;
      return b.created_at.localeCompare(a.created_at);
    });

    return NextResponse.json({
      signals: sorted.slice(0, limit),
      count: sorted.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load operational signals",
      },
      { status: 500 },
    );
  }
}
