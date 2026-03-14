import { NextResponse } from "next/server";
import { seedFinancialBrainEntries } from "@/lib/ops/abra-financial-seeds";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  // Auth: require CRON_SECRET or admin session
  const authHeader = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || !authHeader.includes(cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await seedFinancialBrainEntries();
    return NextResponse.json({
      success: true,
      ...result,
      message: `Financial seeds: ${result.inserted} inserted, ${result.skipped} skipped (already existed).`,
    });
  } catch (err) {
    console.error("[seed-financials] Error:", err);
    return NextResponse.json(
      { error: String(err), success: false },
      { status: 500 },
    );
  }
}
