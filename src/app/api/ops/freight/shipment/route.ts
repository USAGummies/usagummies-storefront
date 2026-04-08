import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  createShipment,
  updateShipment,
  getShipments,
  type ShipmentChannel,
  type ShipmentStatus,
} from "@/lib/ops/freight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_CHANNELS: ShipmentChannel[] = [
  "DTC",
  "FBA Inbound",
  "Wholesale B2B",
  "Distributor",
  "Faire",
  "Sample",
  "Internal Transfer",
  "Raw Material",
];

const VALID_STATUSES: ShipmentStatus[] = [
  "Label Created",
  "Picked Up",
  "In Transit",
  "Delivered",
  "Exception",
  "Returned",
];

const VALID_CARRIERS = [
  "Pirate Ship",
  "USPS",
  "UPS",
  "FedEx",
  "LTL Freight",
  "Self-Haul",
];

const VALID_DESTINATION_TYPES = [
  "Customer DTC",
  "FBA Warehouse",
  "Co-Packer",
  "Our Warehouse",
  "Distributor",
  "Retailer",
  "Sample Prospect",
  "Broker",
];

const VALID_SOURCE_SYSTEMS = ["Pirate Ship", "Shopify", "Amazon FBA", "Manual"];

// ---------------------------------------------------------------------------
// POST — Create a shipment
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    // Required field validation
    const required = [
      "order_reference",
      "ship_date",
      "carrier",
      "tracking_number",
      "destination_name",
      "destination_type",
      "channel",
      "units_shipped",
      "shipping_cost",
      "status",
      "source_system",
    ] as const;

    for (const field of required) {
      if (body[field] === undefined || body[field] === null) {
        return NextResponse.json(
          { error: `${field} is required` },
          { status: 400 },
        );
      }
    }

    // Enum validation
    if (!VALID_CHANNELS.includes(body.channel)) {
      return NextResponse.json(
        { error: `Invalid channel. Must be one of: ${VALID_CHANNELS.join(", ")}` },
        { status: 400 },
      );
    }
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 },
      );
    }
    if (!VALID_CARRIERS.includes(body.carrier)) {
      return NextResponse.json(
        { error: `Invalid carrier. Must be one of: ${VALID_CARRIERS.join(", ")}` },
        { status: 400 },
      );
    }
    if (!VALID_DESTINATION_TYPES.includes(body.destination_type)) {
      return NextResponse.json(
        { error: `Invalid destination_type. Must be one of: ${VALID_DESTINATION_TYPES.join(", ")}` },
        { status: 400 },
      );
    }
    if (!VALID_SOURCE_SYSTEMS.includes(body.source_system)) {
      return NextResponse.json(
        { error: `Invalid source_system. Must be one of: ${VALID_SOURCE_SYSTEMS.join(", ")}` },
        { status: 400 },
      );
    }

    // Numeric validation
    if (typeof body.units_shipped !== "number" || body.units_shipped < 0) {
      return NextResponse.json(
        { error: "units_shipped must be a non-negative number" },
        { status: 400 },
      );
    }
    if (typeof body.shipping_cost !== "number" || body.shipping_cost < 0) {
      return NextResponse.json(
        { error: "shipping_cost must be a non-negative number" },
        { status: 400 },
      );
    }

    const shipment = await createShipment({
      order_reference: body.order_reference,
      ship_date: body.ship_date,
      carrier: body.carrier,
      tracking_number: body.tracking_number,
      destination_name: body.destination_name,
      destination_type: body.destination_type,
      channel: body.channel,
      units_shipped: body.units_shipped,
      weight_lbs: body.weight_lbs,
      shipping_cost: body.shipping_cost,
      status: body.status,
      source_system: body.source_system,
      related_production: body.related_production,
      notes: body.notes,
    });

    return NextResponse.json({ ok: true, shipment });
  } catch (error) {
    console.error(
      "[freight/shipment] POST failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Shipment creation failed" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// PUT — Update a shipment
// ---------------------------------------------------------------------------
export async function PUT(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.shipment_id || typeof body.shipment_id !== "string") {
      return NextResponse.json(
        { error: "shipment_id is required" },
        { status: 400 },
      );
    }

    // Validate enums if provided
    if (body.channel && !VALID_CHANNELS.includes(body.channel)) {
      return NextResponse.json(
        { error: `Invalid channel. Must be one of: ${VALID_CHANNELS.join(", ")}` },
        { status: 400 },
      );
    }
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 },
      );
    }
    if (body.carrier && !VALID_CARRIERS.includes(body.carrier)) {
      return NextResponse.json(
        { error: `Invalid carrier. Must be one of: ${VALID_CARRIERS.join(", ")}` },
        { status: 400 },
      );
    }
    if (body.destination_type && !VALID_DESTINATION_TYPES.includes(body.destination_type)) {
      return NextResponse.json(
        { error: `Invalid destination_type` },
        { status: 400 },
      );
    }

    const { shipment_id, ...updates } = body;
    const shipment = await updateShipment(shipment_id, updates);

    if (!shipment) {
      return NextResponse.json(
        { error: "Shipment not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, shipment });
  } catch (error) {
    console.error(
      "[freight/shipment] PUT failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Shipment update failed" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// GET — List shipments with optional filters
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const channel = searchParams.get("channel") as ShipmentChannel | null;
    const status = searchParams.get("status") as ShipmentStatus | null;
    const start_date = searchParams.get("start_date") ?? undefined;
    const end_date = searchParams.get("end_date") ?? undefined;

    const shipments = await getShipments({
      channel: channel || undefined,
      status: status || undefined,
      start_date,
      end_date,
    });

    return NextResponse.json({
      ok: true,
      count: shipments.length,
      shipments,
    });
  } catch (error) {
    console.error(
      "[freight/shipment] GET failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Failed to fetch shipments" },
      { status: 500 },
    );
  }
}
