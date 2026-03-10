import { NextResponse } from "next/server";
import {
  getAccuracyReport,
  formatAccuracyReport,
} from "@/lib/ops/abra-truth-benchmark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const days = parseInt(url.searchParams.get("days") || "30", 10);
    const format = url.searchParams.get("format") || "json";

    const report = await getAccuracyReport(days);

    if (format === "text") {
      return new NextResponse(formatAccuracyReport(report), {
        headers: { "Content-Type": "text/plain" },
      });
    }

    return NextResponse.json(report);
  } catch (error) {
    console.error("[accuracy] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate accuracy report" },
      { status: 500 },
    );
  }
}
