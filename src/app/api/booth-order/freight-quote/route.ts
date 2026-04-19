/**
 * Booth Order Freight Quote — POST /api/booth-order/freight-quote
 *
 * Live UPS Ground freight quote from Ashford, WA → buyer's ZIP. Called by
 * the booth form on every ZIP/qty change so the customer sees a real number
 * before submitting. Server re-quotes at submit time too — this endpoint is
 * for UX preview only, not for trust.
 *
 * Body: {
 *   to_state: string,
 *   to_zip: string,
 *   qty: number,
 *   packaging_type: "bag" | "case" | "master_carton",
 *   residential?: boolean
 * }
 */
import { NextResponse } from "next/server";
import {
  getUpsGroundRate,
  isShipStationConfigured,
  type ShippingPackageType,
} from "@/lib/ops/shipstation-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isShipStationConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Freight quotes temporarily unavailable" },
      { status: 503 },
    );
  }

  let body: {
    to_state?: string;
    to_zip?: string;
    qty?: number;
    packaging_type?: ShippingPackageType;
    residential?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const toState = String(body.to_state ?? "").trim().toUpperCase();
  const toZip = String(body.to_zip ?? "").trim();
  const qty = Math.max(1, Math.floor(Number(body.qty) || 1));
  const packagingType =
    body.packaging_type === "bag" ||
    body.packaging_type === "case" ||
    body.packaging_type === "master_carton"
      ? body.packaging_type
      : null;

  if (!/^[A-Z]{2}$/.test(toState)) {
    return NextResponse.json(
      { ok: false, error: "Enter a 2-letter state code" },
      { status: 400 },
    );
  }
  if (!/^\d{5}(-\d{4})?$/.test(toZip)) {
    return NextResponse.json(
      { ok: false, error: "Enter a valid 5-digit ZIP" },
      { status: 400 },
    );
  }
  if (!packagingType) {
    return NextResponse.json(
      { ok: false, error: "Select bag, case, or master carton" },
      { status: 400 },
    );
  }

  const result = await getUpsGroundRate({
    toZip,
    toState,
    packagingType,
    quantity: qty,
    residential: body.residential,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    rate: result.quote.rate,
    carrier: result.quote.carrier,
    service: result.quote.service,
    service_code: result.quote.service_code,
    delivery_days: result.quote.delivery_days,
  });
}
