import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { checkEscalations, generateEscalationReport } from "@/lib/ops/pulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(req.url);
    const format = url.searchParams.get("format"); // "text" for Slack-ready report
    const escalations = await checkEscalations();
    if (format === "text") {
      const report = await generateEscalationReport(escalations);
      return NextResponse.json({ ok: true, report, count: escalations.length });
    }
    return NextResponse.json({ ok: true, escalations, count: escalations.length });
  } catch (error) {
    return NextResponse.json({ error: "Failed to check escalations" }, { status: 500 });
  }
}
