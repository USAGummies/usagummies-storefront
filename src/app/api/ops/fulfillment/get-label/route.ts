/**
 * Retrieve a previously-purchased ShipStation label PDF by shipmentId.
 *
 * Why this exists: the buy-label endpoint returns the label PDF inline as
 * a `data:application/pdf;base64,...` URL, but if the caller drops the
 * response (e.g. terminal truncation), there's no built-in way to re-fetch
 * the label without re-buying. ShipStation supports `POST /shipments/getlabel`
 * which returns the existing label without a new purchase. This wraps it.
 *
 * GET /api/ops/fulfillment/get-label?shipmentId=143185364
 *   → { ok, shipmentId, trackingNumber, labelUrl (data URI), pdfBase64 }
 *
 * Auth: bearer CRON_SECRET via middleware whitelist.
 */
import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const shipmentId = url.searchParams.get("shipmentId");
  if (!shipmentId) {
    return NextResponse.json(
      { error: "shipmentId query param required" },
      { status: 400 },
    );
  }

  const apiKey = process.env.SHIPSTATION_API_KEY?.trim();
  const apiSecret = process.env.SHIPSTATION_API_SECRET?.trim();
  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { error: "ShipStation credentials not configured in env" },
      { status: 500 },
    );
  }
  const auth = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`;

  // ShipStation getlabel endpoint reissues the label PDF for an existing
  // shipment without buying again. shipmentId is the canonical input.
  // https://www.shipstation.com/docs/api/shipments/get-label/
  let res: Response;
  try {
    res = await fetch("https://ssapi.shipstation.com/shipments/getlabel", {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shipmentId: Number.parseInt(shipmentId, 10),
        includeReturnLabel: false,
      }),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "ShipStation request failed",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      {
        error: `ShipStation getlabel ${res.status}`,
        details: text.slice(0, 500),
      },
      { status: 502 },
    );
  }

  const data = (await res.json()) as {
    shipmentId?: number;
    trackingNumber?: string;
    labelData?: string;
  };

  if (!data.labelData) {
    return NextResponse.json(
      { error: "ShipStation returned no labelData" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    shipmentId: data.shipmentId ?? Number.parseInt(shipmentId, 10),
    trackingNumber: data.trackingNumber ?? null,
    labelUrl: `data:application/pdf;base64,${data.labelData}`,
    pdfBase64: data.labelData,
  });
}
