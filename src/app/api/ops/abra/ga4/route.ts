import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { fetchGA4Report } from "@/lib/ops/abra-ga4-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolvePeriod(period: string): { startDate: string; endDate: string } {
  switch (period) {
    case "30d":
      return { startDate: "30daysAgo", endDate: "yesterday" };
    case "7d":
      return { startDate: "7daysAgo", endDate: "yesterday" };
    case "yesterday":
    default:
      return { startDate: "yesterday", endDate: "yesterday" };
  }
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const period = (url.searchParams.get("period") || "yesterday").toLowerCase();
    const { startDate, endDate } = resolvePeriod(period);
    const report = await fetchGA4Report({ startDate, endDate });
    return NextResponse.json({
      period,
      startDate,
      endDate,
      report,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch GA4 report",
      },
      { status: 500 },
    );
  }
}
