/**
 * Amazon Settlements — /api/ops/amazon/settlements
 *
 * Wraps existing SP-API functions so Viktor can query settlement data via HTTP.
 *
 * GET  ?action=groups                          — List financial event groups (settlement periods)
 * GET  ?action=groups&started_after=&started_before=  — Filter by date range
 * GET  ?action=revenue&start_date=&end_date=   — Accurate revenue report (requests + polls SP-API report)
 * GET  ?action=status                          — Check SP-API connection health
 *
 * Revenue report can take 30-120 seconds (Amazon generates the report async).
 * Use ?max_wait_ms=60000 to control timeout (default 120000).
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  isAmazonConfigured,
  fetchFinancialEventGroups,
  fetchAccurateRevenue,
  testAmazonConnection,
} from "@/lib/amazon/sp-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAmazonConfigured()) {
    return NextResponse.json(
      { error: "Amazon SP-API credentials not configured" },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "groups";

  try {
    switch (action) {
      case "groups": {
        const startedAfter = url.searchParams.get("started_after") || undefined;
        const startedBefore = url.searchParams.get("started_before") || undefined;
        const groups = await fetchFinancialEventGroups(startedAfter, startedBefore);
        return NextResponse.json({
          ok: true,
          count: groups.length,
          financial_event_groups: groups,
        });
      }

      case "revenue": {
        const startDate = url.searchParams.get("start_date");
        const endDate = url.searchParams.get("end_date");

        if (!startDate || !endDate) {
          return NextResponse.json(
            { error: "start_date and end_date are required (YYYY-MM-DD)" },
            { status: 400 },
          );
        }

        const maxWaitMs = parseInt(url.searchParams.get("max_wait_ms") || "120000", 10);
        const result = await fetchAccurateRevenue(startDate, endDate, maxWaitMs);

        return NextResponse.json({
          ok: true,
          period: { start_date: startDate, end_date: endDate },
          total_revenue: result.totalRevenue,
          total_units: result.totalUnits,
          total_orders: result.totalOrders,
          orders: result.orders,
          source: "sp-api-reports",
        });
      }

      case "status": {
        const health = await testAmazonConnection();
        return NextResponse.json({ ok: true, ...health });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action "${action}". Use: groups, revenue, status` },
          { status: 400 },
        );
    }
  } catch (error) {
    console.error(
      "[amazon/settlements] GET failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Settlement query failed" },
      { status: 500 },
    );
  }
}
