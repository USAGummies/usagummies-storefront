/**
 * GET /api/ops/hubspot/proactive
 *
 * Read-only HubSpot proactive revenue queue. This endpoint intentionally
 * composes existing HubSpot readers only: no stage changes, no task
 * writes, no email drafts, no approval creation.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { buildHubSpotProactiveReport } from "@/lib/ops/hubspot-proactive";
import {
  readSalesPipeline,
  readStaleBuyers,
} from "@/lib/ops/sales-command-readers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const [salesPipeline, staleBuyers] = await Promise.all([
    readSalesPipeline(now),
    readStaleBuyers(now),
  ]);

  const report = buildHubSpotProactiveReport({
    salesPipeline,
    staleBuyers,
    now,
  });

  return NextResponse.json({
    ok: report.status === "ready",
    generatedAt: report.generatedAt,
    report,
  });
}
