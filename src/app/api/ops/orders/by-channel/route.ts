import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { getOrdersByChannel } from "@/lib/ops/order-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const byChannel = await getOrdersByChannel();
    return NextResponse.json({ ok: true, channels: byChannel });
  } catch (error) {
    console.error("[orders/by-channel] GET failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to get orders by channel" }, { status: 500 });
  }
}
