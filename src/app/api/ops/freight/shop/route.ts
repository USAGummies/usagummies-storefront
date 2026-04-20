/**
 * Rate-shop across ShipStation + Pirate Ship and return the cheapest.
 *
 * POST body:
 *   {
 *     toZip: string,
 *     toState: string,
 *     packagingType: "case" | "master_carton",
 *     quantity: number,
 *     residential?: boolean,
 *     weightOverrideLbs?: number
 *   }
 *
 * Returns:
 *   {
 *     ok: true,
 *     cheapest: { provider, carrier, service, serviceCode, rate, perPackage, ... },
 *     shipstation: <winner across all connected SS carriers, or null>,
 *     pirateship:  <USPS winner via Pirate Ship, or null + reason>,
 *     degraded: string[]
 *   }
 *
 * Auth: bearer CRON_SECRET.
 */

import { NextResponse } from "next/server";

import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";
import {
  getCheapestShipStationRate,
  BOOTH_ORIGIN_ZIP,
  type ShippingPackageType,
} from "@/lib/ops/shipstation-client";
import {
  getPirateShipCheapest,
  isPirateShipConfigured,
} from "@/lib/ops/pirateship-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keep in sync with PACKAGE_PROFILES in shipstation-client.ts.
const PACKAGE_DIMS: Record<
  Exclude<ShippingPackageType, "pallet">,
  { length: number; width: number; height: number; weightLbs: number }
> = {
  case: { length: 14, width: 10, height: 8, weightLbs: 6 },
  master_carton: { length: 21, width: 14, height: 8, weightLbs: 21.125 },
};

export async function POST(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  let body: {
    toZip?: string;
    toState?: string;
    packagingType?: ShippingPackageType;
    quantity?: number;
    residential?: boolean;
    weightOverrideLbs?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const packagingType =
    body.packagingType === "case" || body.packagingType === "master_carton"
      ? body.packagingType
      : "master_carton";
  const quantity = Math.max(1, Math.floor(Number(body.quantity) || 1));
  const toZip = String(body.toZip ?? "").trim();
  const toState = String(body.toState ?? "").trim().toUpperCase();

  if (!/^\d{5}(-\d{4})?$/.test(toZip)) {
    return NextResponse.json({ error: "Invalid toZip" }, { status: 400 });
  }
  if (!/^[A-Z]{2}$/.test(toState)) {
    return NextResponse.json({ error: "Invalid toState" }, { status: 400 });
  }

  const degraded: string[] = [];
  const profile = PACKAGE_DIMS[packagingType];
  const weightLbs = body.weightOverrideLbs ?? profile.weightLbs;

  // Fire both lanes in parallel.
  const [ssRate, psRate] = await Promise.all([
    getCheapestShipStationRate({
      toZip,
      toState,
      packagingType,
      quantity,
      residential: body.residential,
      weightOverrideLbs: body.weightOverrideLbs,
    }),
    isPirateShipConfigured()
      ? getPirateShipCheapest({
          toZip,
          toState,
          fromZip: BOOTH_ORIGIN_ZIP,
          weightLbs,
          lengthIn: profile.length,
          widthIn: profile.width,
          heightIn: profile.height,
          quantity,
        })
      : Promise.resolve({
          ok: false as const,
          unavailable: true as const,
          reason: "PIRATESHIP_API_TOKEN not configured",
        }),
  ]);

  const ssWinner = ssRate.ok ? ssRate.quote : null;
  if (!ssRate.ok) degraded.push(`shipstation: ${ssRate.error}`);

  const psWinner = psRate.ok ? psRate.quote : null;
  if (!psRate.ok) degraded.push(`pirateship: ${psRate.reason}`);

  const candidates = [ssWinner, psWinner].filter(
    (c): c is NonNullable<typeof c> => c !== null,
  );
  if (candidates.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No rates from either provider", degraded },
      { status: 502 },
    );
  }
  candidates.sort((a, b) => a.rate - b.rate);

  return NextResponse.json({
    ok: true,
    cheapest: candidates[0],
    shipstation: ssWinner,
    pirateship: psWinner,
    degraded,
  });
}
