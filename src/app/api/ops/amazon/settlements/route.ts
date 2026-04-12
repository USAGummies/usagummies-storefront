/**
 * Amazon Settlements — /api/ops/amazon/settlements
 *
 * Wraps existing SP-API functions so Viktor can query settlement data via HTTP.
 *
 * GET  ?action=groups                          — List financial event groups (settlement periods)
 * GET  ?action=groups&started_after=&started_before=  — Filter by date range
 * GET  ?action=revenue&start_date=&end_date=   — Accurate revenue report (requests + polls SP-API report)
 * GET  ?action=fees&start_date=&end_date=       — Per-order fee breakdown (referral, FBA, refunds)
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
  fetchSettlementFeeBreakdown,
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

      case "fees": {
        const feeStart = url.searchParams.get("start_date");
        const feeEnd = url.searchParams.get("end_date");

        if (!feeStart || !feeEnd) {
          return NextResponse.json(
            { error: "start_date and end_date are required (YYYY-MM-DD)" },
            { status: 400 },
          );
        }

        const breakdowns = await fetchSettlementFeeBreakdown(feeStart, feeEnd);

        // Aggregate across all settlement groups
        const combined = {
          gross_revenue: 0,
          referral_fees: 0,
          fba_fees: 0,
          other_fees: 0,
          refunds: 0,
          promotions: 0,
          service_fees: 0,
          net_proceeds: 0,
        };
        let totalOrders = 0;
        let totalRefunds = 0;

        for (const b of breakdowns) {
          combined.gross_revenue += b.totals.gross_revenue;
          combined.referral_fees += b.totals.referral_fees;
          combined.fba_fees += b.totals.fba_fees;
          combined.other_fees += b.totals.other_fees;
          combined.refunds += b.totals.refunds;
          combined.promotions += b.totals.promotions;
          combined.service_fees += b.totals.service_fees;
          combined.net_proceeds += b.totals.net_proceeds;
          totalOrders += b.order_count;
          totalRefunds += b.refund_count;
        }

        // Round combined totals
        for (const key of Object.keys(combined) as (keyof typeof combined)[]) {
          combined[key] = Math.round(combined[key] * 100) / 100;
        }

        return NextResponse.json({
          ok: true,
          period: { start_date: feeStart, end_date: feeEnd },
          settlement_groups: breakdowns.length,
          total_orders: totalOrders,
          total_refunds: totalRefunds,
          combined_totals: combined,
          breakdowns,
          source: "sp-api-finances",
          coa_mapping: {
            gross_revenue: "400015.xx (Revenue by channel — Amazon)",
            referral_fees: "500040.xx (Marketplace Selling Fees — COGS)",
            fba_fees: "500040.xx (FBA Fulfillment Fees — COGS)",
            refunds: "400025.xx (Returns by channel — Amazon)",
            service_fees: "660020 (Marketing/Overhead — NOT COGS)",
            net_proceeds: "Matches bank deposit",
          },
        });
      }

      case "status": {
        const health = await testAmazonConnection();
        return NextResponse.json({ ok: true, ...health });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action "${action}". Use: groups, revenue, fees, status` },
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
