import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  getShippingCostsByChannel,
  getShippingCostsByCarrier,
} from "@/lib/ops/freight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET — Cost report grouped by channel or carrier
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const groupBy = searchParams.get("group_by") || "channel";
    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "start_date and end_date query params are required (YYYY-MM-DD)" },
        { status: 400 },
      );
    }

    if (groupBy !== "channel" && groupBy !== "carrier") {
      return NextResponse.json(
        { error: "group_by must be 'channel' or 'carrier'" },
        { status: 400 },
      );
    }

    const costs =
      groupBy === "carrier"
        ? await getShippingCostsByCarrier(startDate, endDate)
        : await getShippingCostsByChannel(startDate, endDate);

    const totalCost = costs.reduce((sum, c) => sum + c.total_cost, 0);
    const totalUnits = costs.reduce((sum, c) => sum + c.total_units, 0);
    const totalShipments = costs.reduce((sum, c) => sum + c.shipment_count, 0);

    return NextResponse.json({
      ok: true,
      group_by: groupBy,
      start_date: startDate,
      end_date: endDate,
      summary: {
        total_cost: Math.round(totalCost * 100) / 100,
        total_units: totalUnits,
        total_shipments: totalShipments,
        avg_cost_per_unit:
          totalUnits > 0
            ? Math.round((totalCost / totalUnits) * 100) / 100
            : 0,
      },
      breakdown: costs,
    });
  } catch (error) {
    console.error(
      "[freight/costs] GET failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Cost report failed" },
      { status: 500 },
    );
  }
}
