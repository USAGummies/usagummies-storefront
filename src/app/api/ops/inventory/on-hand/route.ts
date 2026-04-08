import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { getOnHand, setLocationUnits } from "@/lib/ops/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const locations = await getOnHand();
    const totalUnits = locations.reduce((sum, l) => sum + l.units, 0);

    return NextResponse.json({
      ok: true,
      locations,
      total_units: totalUnits,
    });
  } catch (error) {
    console.error("[inventory/on-hand] GET failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to get on-hand" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.location || body.units === undefined) {
      return NextResponse.json(
        { error: "Required: location, units" },
        { status: 400 }
      );
    }

    const locations = await setLocationUnits(body.location, body.units, body.notes);
    const totalUnits = locations.reduce((sum, l) => sum + l.units, 0);

    return NextResponse.json({ ok: true, locations, total_units: totalUnits });
  } catch (error) {
    console.error("[inventory/on-hand] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to update on-hand" }, { status: 500 });
  }
}
