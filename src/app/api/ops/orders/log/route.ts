import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { listOrders, getOrder, upsertOrder } from "@/lib/ops/order-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const orderId = url.searchParams.get("order_id");
    const channel = url.searchParams.get("channel") || undefined;
    const status = url.searchParams.get("status") || undefined;
    const limit = parseInt(url.searchParams.get("limit") || "200");

    if (orderId) {
      const order = await getOrder(orderId);
      if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
      return NextResponse.json({ ok: true, order });
    }

    const orders = await listOrders({
      channel: channel as any,
      status: status as any,
      limit,
    });
    return NextResponse.json({ ok: true, orders, count: orders.length });
  } catch (error) {
    console.error("[orders/log] GET failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to list orders" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.id || !body.channel || !body.order_ref || !body.customer_name || body.units === undefined || body.total === undefined) {
      return NextResponse.json(
        { error: "Required: id, channel, order_ref, customer_name, units, total" },
        { status: 400 }
      );
    }

    const order = await upsertOrder({
      id: body.id,
      channel: body.channel,
      order_ref: body.order_ref,
      customer_name: body.customer_name,
      ship_to: body.ship_to,
      date: body.date || new Date().toISOString().split("T")[0],
      units: body.units,
      subtotal: body.subtotal || body.total,
      shipping_charged: body.shipping_charged,
      tax: body.tax,
      total: body.total,
      terms: body.terms,
      po_details: body.po_details,
      packaging_format: body.packaging_format,
      status: body.status || "received",
      notes: body.notes,
    });

    return NextResponse.json({ ok: true, order });
  } catch (error) {
    console.error("[orders/log] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to save order" }, { status: 500 });
  }
}
