/**
 * GET /api/ops/pnl — Profit & Loss report
 *
 * Returns revenue, COGS, gross profit, operating expenses, and net income.
 * Query params:
 *   ?period=mtd|custom|compare
 *   &start=YYYY-MM-DD (for custom)
 *   &end=YYYY-MM-DD (for custom)
 *   &months=3 (for compare — how many months back, default 3)
 *
 * Protected by middleware (requires JWT session).
 */

import { NextResponse } from "next/server";
import { buildPnL } from "@/lib/finance/pnl";
import type { PnLReport } from "@/lib/finance/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getMonthRange(monthsBack: number): Array<{ start: string; end: string; label: string }> {
  const ranges: Array<{ start: string; end: string; label: string }> = [];
  const now = new Date();

  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = i === 0
      ? now.toISOString().slice(0, 10) // Current month: up to today
      : `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    ranges.push({ start, end, label });
  }

  return ranges.reverse(); // Oldest first
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const period = url.searchParams.get("period") || "mtd";

    // Multi-period comparison mode
    if (period === "compare") {
      const months = Math.min(
        parseInt(url.searchParams.get("months") || "3", 10),
        12,
      );
      const ranges = getMonthRange(months);

      const reports: Array<PnLReport & { _period: string }> = [];
      // Build sequentially to avoid hammering APIs
      for (const range of ranges) {
        const report = await buildPnL(range.start, range.end);
        reports.push({ ...report, _period: range.label });
      }

      // Calculate trends
      const trends = reports.length >= 2
        ? {
            revenueGrowth: reports.map((r, i) =>
              i === 0
                ? 0
                : reports[i - 1].revenue.total > 0
                  ? Math.round(
                      ((r.revenue.total - reports[i - 1].revenue.total) /
                        reports[i - 1].revenue.total) *
                        1000,
                    ) / 10
                  : 0,
            ),
            marginTrend: reports.map((r) => r.grossMargin),
            netIncomeTrend: reports.map((r) => r.netIncome),
          }
        : null;

      return NextResponse.json({
        mode: "compare",
        months,
        reports,
        trends,
        summary: {
          avgRevenue:
            Math.round(
              (reports.reduce((s, r) => s + r.revenue.total, 0) /
                reports.length) *
                100,
            ) / 100,
          avgGrossMargin:
            Math.round(
              (reports.reduce((s, r) => s + r.grossMargin, 0) /
                reports.length) *
                10,
            ) / 10,
          avgNetMargin:
            Math.round(
              (reports.reduce((s, r) => s + r.netMargin, 0) /
                reports.length) *
                10,
            ) / 10,
          totalRevenue: Math.round(
            reports.reduce((s, r) => s + r.revenue.total, 0) * 100,
          ) / 100,
          totalNetIncome: Math.round(
            reports.reduce((s, r) => s + r.netIncome, 0) * 100,
          ) / 100,
        },
      });
    }

    // Standard single-period mode
    let start: string | undefined;
    let end: string | undefined;

    if (period === "custom") {
      start = url.searchParams.get("start") || undefined;
      end = url.searchParams.get("end") || undefined;
    }

    const report = await buildPnL(start, end);
    return NextResponse.json(report);
  } catch (err) {
    console.error("[pnl] Build failed:", err);
    return NextResponse.json(
      { error: "P&L build failed" },
      { status: 500 },
    );
  }
}
