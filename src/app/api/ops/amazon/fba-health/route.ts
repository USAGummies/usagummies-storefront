/**
 * GET /api/ops/amazon/fba-health — Comprehensive FBA health report
 *
 * Returns inventory snapshots, sales velocity, restock recommendations,
 * PPC summary, listing health, and alerts.
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { generateFBAHealthReport } from "@/lib/ops/amazon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const report = await generateFBAHealthReport();
  return NextResponse.json(report);
}
