import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/ops/abra-auth";
import { requestReport, getReport, getProfiles } from "@/lib/amazon/ads-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/ops/amazon-ads/report — get report status or profiles */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const reportId = searchParams.get("report_id");

  // If report_id provided, fetch that report
  if (reportId) {
    const report = await getReport(reportId);
    if (!report) {
      return NextResponse.json({ error: "Report not ready or not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, report });
  }

  // Otherwise return profile info (useful for debugging)
  const profiles = await getProfiles();
  return NextResponse.json({ ok: true, profiles });
}

/** POST /api/ops/amazon-ads/report — request a new performance report */
export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const reportType = body.type || "campaigns";
  const dateRange = body.date_range || "LAST_7_DAYS";

  if (!["campaigns", "keywords", "adGroups"].includes(reportType)) {
    return NextResponse.json({ error: "type must be campaigns, keywords, or adGroups" }, { status: 400 });
  }

  const result = await requestReport(reportType, dateRange);
  if (!result) {
    return NextResponse.json({ error: "Failed to request report" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    report_id: result.reportId,
    message: "Report requested. Poll GET /api/ops/amazon-ads/report?report_id=<id> for results.",
  });
}
