import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { checkFleetHealth, generateFleetReport } from "@/lib/ops/pulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const health = await checkFleetHealth();
    const report = generateFleetReport(health);
    return new NextResponse(report, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    console.error("[pulse/report] GET failed:", error instanceof Error ? error.message : error);
    return new NextResponse("Report generation failed", { status: 500 });
  }
}
