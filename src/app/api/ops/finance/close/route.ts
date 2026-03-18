/**
 * POST /api/ops/finance/close — Monthly Close
 *
 * Triggers the monthly close workflow for a given period.
 * Query params: ?period=2026-02 (defaults to prior month)
 *
 * GET returns list of all closed periods.
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { runMonthlyClose, getClosedPeriods } from "@/lib/finance/monthly-close";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getDefaultPeriod(): string {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed, so current month - 1 = prior
  const year = month === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const m = month === 0 ? 12 : month;
  return `${year}-${String(m).padStart(2, "0")}`;
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const period = url.searchParams.get("period") || getDefaultPeriod();

    // Validate period format
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return NextResponse.json(
        { error: "Invalid period format. Use YYYY-MM (e.g. 2026-02)" },
        { status: 400 },
      );
    }

    const report = await runMonthlyClose(period, "api");
    return NextResponse.json(report);
  } catch (err) {
    console.error("[monthly-close] Failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Monthly close failed" },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const periods = await getClosedPeriods();
    return NextResponse.json({ periods });
  } catch (err) {
    console.error("[monthly-close] List failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list periods" },
      { status: 500 },
    );
  }
}
