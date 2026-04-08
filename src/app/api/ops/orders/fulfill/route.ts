import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { fulfillOrder, listFulfillments } from "@/lib/ops/order-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const order_id = url.searchParams.get("order_id") || undefined;
    const limit = parseInt(url.searchParams.get("limit") || "200");

    const fulfillments = await listFulfillments({ order_id, limit });
    return NextResponse.json({ ok: true, fulfillments, count: fulfillments.length });
  } catch (error) {
    console.error("[orders/fulfill] GET failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to list fulfillments" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.id || !body.order_id || !body.carrier || body.shipping_cost === undefined || !body.fulfillment_source || body.units_shipped === undefined) {
      return NextResponse.json(
        { error: "Required: id, order_id, carrier, shipping_cost, fulfillment_source, units_shipped" },
        { status: 400 }
      );
    }

    const fulfillment = await fulfillOrder({
      id: body.id,
      order_id: body.order_id,
      shipment_id: body.shipment_id,
      carrier: body.carrier,
      tracking_number: body.tracking_number,
      shipping_cost: body.shipping_cost,
      fulfillment_source: body.fulfillment_source,
      pirate_ship_label_id: body.pirate_ship_label_id,
      fba_shipment_id: body.fba_shipment_id,
      units_shipped: body.units_shipped,
      date: body.date || new Date().toISOString().split("T")[0],
      status: body.status || "shipped",
      notes: body.notes,
    });

    return NextResponse.json({ ok: true, fulfillment });
  } catch (error) {
    console.error("[orders/fulfill] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to fulfill order" }, { status: 500 });
  }
}
