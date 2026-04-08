import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { allocate, listAllocations } from "@/lib/ops/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const batch_id = url.searchParams.get("batch_id") || undefined;
    const limit = parseInt(url.searchParams.get("limit") || "100");

    const allocations = await listAllocations({ batch_id, limit });
    return NextResponse.json({ ok: true, allocations, count: allocations.length });
  } catch (error) {
    console.error("[inventory/allocate] GET failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to list allocations" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.batch_id || !body.from_location || !body.to_location || body.units === undefined || !body.reason) {
      return NextResponse.json(
        { error: "Required: batch_id, from_location, to_location, units, reason" },
        { status: 400 }
      );
    }

    const result = await allocate({
      batch_id: body.batch_id,
      from_location: body.from_location,
      to_location: body.to_location,
      units: body.units,
      reason: body.reason,
      order_ref: body.order_ref,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("Insufficient units")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("[inventory/allocate] POST failed:", msg);
    return NextResponse.json({ error: "Failed to allocate" }, { status: 500 });
  }
}
