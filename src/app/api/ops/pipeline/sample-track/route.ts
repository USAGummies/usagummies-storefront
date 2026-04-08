/**
 * POST /api/ops/pipeline/sample-track — Track sample shipment + auto-schedule follow-up
 * GET  /api/ops/pipeline/sample-track — Get sample follow-ups due today or overdue
 *
 * POST body: { prospect_id, tracking_number?, carrier?, ship_date, estimated_delivery_date?, units, notes? }
 * Returns: { prospect, touch, follow_up_date }
 *
 * GET returns prospects with status "Sample Sent" whose follow-up date has passed.
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { trackSampleShipment, getSampleFollowupsDue } from "@/lib/ops/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.prospect_id || !body.ship_date || !body.units) {
      return NextResponse.json(
        { error: "Required fields: prospect_id, ship_date, units" },
        { status: 400 },
      );
    }

    const result = await trackSampleShipment(body);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to track sample" },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const due = await getSampleFollowupsDue();
  return NextResponse.json({ due, count: due.length });
}
