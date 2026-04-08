import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { listRuns, upsertRun } from "@/lib/ops/forge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = ["Planned", "Running", "Complete", "On Hold", "Cancelled"] as const;

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const runs = await listRuns();
    return NextResponse.json({ ok: true, runs, count: runs.length });
  } catch (error) {
    console.error("[forge/production-run] GET failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to list production runs" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    // Required field validation
    if (!body.batch_id || typeof body.batch_id !== "string") {
      return NextResponse.json({ error: "batch_id is required (string)" }, { status: 400 });
    }
    if (!body.co_packer || typeof body.co_packer !== "string") {
      return NextResponse.json({ error: "co_packer is required (string)" }, { status: 400 });
    }
    if (!body.status || !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 },
      );
    }
    if (typeof body.target_units !== "number" || body.target_units <= 0) {
      return NextResponse.json({ error: "target_units must be a positive number" }, { status: 400 });
    }
    if (!body.start_date || typeof body.start_date !== "string") {
      return NextResponse.json({ error: "start_date is required (ISO date string)" }, { status: 400 });
    }

    const run = await upsertRun({
      batch_id: body.batch_id,
      co_packer: body.co_packer,
      status: body.status,
      target_units: body.target_units,
      actual_units: body.actual_units ?? null,
      start_date: body.start_date,
      end_date: body.end_date ?? null,
      candy_cost: body.candy_cost ?? 0,
      film_cost: body.film_cost ?? 0,
      co_pack_labor: body.co_pack_labor ?? 0,
      freight_in: body.freight_in ?? 0,
      other_costs: body.other_costs ?? 0,
      candy_lot: body.candy_lot ?? "",
      film_lot: body.film_lot ?? "",
      invoice_ref: body.invoice_ref ?? "",
      destination: body.destination ?? "",
      notes: body.notes ?? "",
    });

    return NextResponse.json({ ok: true, run });
  } catch (error) {
    console.error("[forge/production-run] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to create/update production run" }, { status: 500 });
  }
}
