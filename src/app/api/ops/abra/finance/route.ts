import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  getMarginAnalysis,
  getRevenueSnapshot,
  getRevenueTimeline,
} from "@/lib/ops/abra-financial-intel";
import { validateQuery, FinanceQuerySchema } from "@/lib/ops/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SnapshotPeriod = "day" | "week" | "month";

function parsePeriod(value: string | null): SnapshotPeriod {
  if (value === "day" || value === "week" || value === "month") return value;
  return "month";
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const qv = validateQuery(req, FinanceQuerySchema);
    if (!qv.success) return qv.response;
    const { view, period, days } = qv.data;

    if (view === "snapshot") {
      const snapshot = await getRevenueSnapshot(period);
      return NextResponse.json({ view, period, snapshot });
    }

    if (view === "margins") {
      const margins = await getMarginAnalysis();
      return NextResponse.json({ view, margins });
    }

    if (view === "timeline") {
      const timeline = await getRevenueTimeline(days);
      return NextResponse.json({ view, days, timeline });
    }

    return NextResponse.json(
      { error: "Invalid view. Use snapshot, margins, or timeline." },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch financial intelligence" },
      { status: 500 },
    );
  }
}
