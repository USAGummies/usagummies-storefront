import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { listSamples, addSample, getSampleSummary } from "@/lib/ops/order-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const summary = url.searchParams.get("summary") === "true";

    if (summary) {
      const data = await getSampleSummary();
      return NextResponse.json({ ok: true, ...data });
    }

    const limit = parseInt(url.searchParams.get("limit") || "100");
    const samples = await listSamples({ limit });
    return NextResponse.json({ ok: true, samples, count: samples.length });
  } catch (error) {
    console.error("[orders/samples] GET failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to list samples" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.id || !body.recipient || !body.address || body.units === undefined || !body.purpose) {
      return NextResponse.json(
        { error: "Required: id, recipient, address, units, purpose" },
        { status: 400 }
      );
    }

    const sample = await addSample({
      id: body.id,
      recipient: body.recipient,
      company: body.company,
      address: body.address,
      units: body.units,
      packaging_format: body.packaging_format || "singles",
      purpose: body.purpose,
      carrier: body.carrier,
      tracking_number: body.tracking_number,
      shipping_cost: body.shipping_cost || 0,
      date: body.date || new Date().toISOString().split("T")[0],
      notes: body.notes,
    });

    return NextResponse.json({ ok: true, sample });
  } catch (error) {
    console.error("[orders/samples] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to add sample" }, { status: 500 });
  }
}
