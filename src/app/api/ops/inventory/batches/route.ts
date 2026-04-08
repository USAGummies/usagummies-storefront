import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { listBatches, getBatch, upsertBatch } from "@/lib/ops/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = ["raw_materials", "in_production", "finished", "depleted"] as const;

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const batchId = url.searchParams.get("batch_id");
    const status = url.searchParams.get("status") as typeof VALID_STATUSES[number] | undefined;
    const vendor = url.searchParams.get("vendor") || undefined;

    // Single batch lookup
    if (batchId) {
      const batch = await getBatch(batchId);
      if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
      return NextResponse.json({ ok: true, batch });
    }

    const batches = await listBatches({ status, vendor });
    return NextResponse.json({ ok: true, batches, count: batches.length });
  } catch (error) {
    console.error("[inventory/batches] GET failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to list batches" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.batch_id || !body.vendor || body.unit_count === undefined || body.landed_cost === undefined || body.cost_per_unit === undefined) {
      return NextResponse.json(
        { error: "Required: batch_id, vendor, unit_count, landed_cost, cost_per_unit" },
        { status: 400 }
      );
    }

    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: `Invalid status. Valid: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    const batch = await upsertBatch({
      batch_id: body.batch_id,
      vendor: body.vendor,
      unit_count: body.unit_count,
      actual_yield: body.actual_yield,
      waste_rate: body.waste_rate,
      status: body.status || "raw_materials",
      location: body.location || "Powers",
      component_costs: body.component_costs || [],
      landed_cost: body.landed_cost,
      cost_per_unit: body.cost_per_unit,
      packaging_config: body.packaging_config,
      best_by_date: body.best_by_date,
      batch_report_id: body.batch_report_id,
      start_date: body.start_date || new Date().toISOString().split("T")[0],
      completion_date: body.completion_date,
      notes: body.notes,
    });

    return NextResponse.json({ ok: true, batch });
  } catch (error) {
    console.error("[inventory/batches] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to save batch" }, { status: 500 });
  }
}
