import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { checkMargin } from "@/lib/ops/order-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    if (!body.order_ref || !body.channel || !body.customer || body.units === undefined || body.unit_price === undefined) {
      return NextResponse.json(
        { error: "Required: order_ref, channel, customer, units, unit_price" },
        { status: 400 }
      );
    }
    const result = await checkMargin({
      order_ref: body.order_ref, channel: body.channel, customer: body.customer,
      units: body.units, unit_price: body.unit_price,
      ship_to: body.ship_to, freight_estimate: body.freight_estimate,
    });
    return NextResponse.json({ ok: true, margin_check: result });
  } catch (error) {
    return NextResponse.json({ error: "Failed to check margin" }, { status: 500 });
  }
}
