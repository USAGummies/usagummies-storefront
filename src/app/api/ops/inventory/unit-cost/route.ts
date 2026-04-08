import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { getUnitCost, listBatches } from "@/lib/ops/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const batchId = url.searchParams.get("batch_id");

    // Single batch cost lookup
    if (batchId) {
      const cost = await getUnitCost(batchId);
      if (!cost) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
      return NextResponse.json({ ok: true, ...cost });
    }

    // All batches with cost summary
    const batches = await listBatches();
    const costs = batches.map((b) => ({
      batch_id: b.batch_id,
      vendor: b.vendor,
      status: b.status,
      unit_count: b.unit_count,
      landed_cost: b.landed_cost,
      cost_per_unit: b.cost_per_unit,
      waste_rate: b.waste_rate,
    }));

    // Weighted average cost per unit across all active batches
    const active = batches.filter((b) => b.status !== "depleted");
    const totalUnits = active.reduce((sum, b) => sum + b.unit_count, 0);
    const totalCost = active.reduce((sum, b) => sum + b.landed_cost, 0);
    const weightedAvgCost = totalUnits > 0 ? totalCost / totalUnits : 0;

    return NextResponse.json({
      ok: true,
      costs,
      summary: {
        active_batches: active.length,
        total_units: totalUnits,
        total_cost: totalCost,
        weighted_avg_cost_per_unit: Math.round(weightedAvgCost * 10000) / 10000,
      },
    });
  } catch (error) {
    console.error("[inventory/unit-cost] GET failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to get unit cost" }, { status: 500 });
  }
}
