/**
 * GET /api/ops/amazon/restock-check — FBA restock recommendations
 *
 * Query params:
 *   lead_time_days — default 14
 *   target_days_of_supply — default 60
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { checkRestock } from "@/lib/ops/amazon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const lead_time_days = url.searchParams.get("lead_time_days");
  const target_days_of_supply = url.searchParams.get("target_days_of_supply");

  const recommendations = await checkRestock({
    lead_time_days: lead_time_days ? parseInt(lead_time_days) : undefined,
    target_days_of_supply: target_days_of_supply ? parseInt(target_days_of_supply) : undefined,
  });

  return NextResponse.json({
    recommendations,
    count: recommendations.length,
    urgent: recommendations.filter((r) => r.status === "urgent" || r.status === "stockout_imminent").length,
  });
}
