import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { listShipments, upsertShipment } from "@/lib/ops/forge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = ["Pending", "In Transit", "Received", "Delayed", "Cancelled"] as const;

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const shipments = await listShipments();
    return NextResponse.json({ ok: true, shipments, count: shipments.length });
  } catch (error) {
    console.error("[forge/material-shipment] GET failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to list material shipments" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    // Required field validation
    if (!body.shipment_id || typeof body.shipment_id !== "string") {
      return NextResponse.json({ error: "shipment_id is required (string)" }, { status: 400 });
    }
    if (!body.material_type || typeof body.material_type !== "string") {
      return NextResponse.json({ error: "material_type is required (string)" }, { status: 400 });
    }
    if (!body.supplier || typeof body.supplier !== "string") {
      return NextResponse.json({ error: "supplier is required (string)" }, { status: 400 });
    }
    if (!body.destination || typeof body.destination !== "string") {
      return NextResponse.json({ error: "destination is required (string)" }, { status: 400 });
    }
    if (!body.status || !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 },
      );
    }
    if (!body.related_run || typeof body.related_run !== "string") {
      return NextResponse.json({ error: "related_run is required (string)" }, { status: 400 });
    }

    const shipment = await upsertShipment({
      shipment_id: body.shipment_id,
      material_type: body.material_type,
      supplier: body.supplier,
      destination: body.destination,
      ship_date: body.ship_date ?? "",
      eta: body.eta ?? null,
      received_date: body.received_date ?? null,
      carrier: body.carrier ?? "",
      tracking_number: body.tracking_number ?? "",
      freight_cost: body.freight_cost ?? 0,
      material_cost: body.material_cost ?? 0,
      quantity: body.quantity ?? "",
      related_run: body.related_run,
      status: body.status,
      invoice_number: body.invoice_number ?? "",
      notes: body.notes ?? "",
    });

    return NextResponse.json({ ok: true, shipment });
  } catch (error) {
    console.error("[forge/material-shipment] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to create/update material shipment" }, { status: 500 });
  }
}
