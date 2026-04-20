/**
 * Diagnostic endpoint — returns the raw list of connected ShipStation
 * carriers + (on POST) a per-carrier rate probe to figure out which
 * ones actually return rates for a known destination.
 *
 * Lives under `/api/ops/shipstation/carriers` because it's ShipStation-
 * account-wide admin (not tied to any single fulfillment entry).
 *
 * Auth: bearer CRON_SECRET.
 */

import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";

import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function auth(): string | null {
  const key = process.env.SHIPSTATION_API_KEY?.trim();
  const secret = process.env.SHIPSTATION_API_SECRET?.trim();
  if (!key || !secret) return null;
  return "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
}

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();
  const a = auth();
  if (!a) return NextResponse.json({ error: "ShipStation creds not configured" }, { status: 500 });

  const out: Record<string, unknown> = {};

  const carrierRes = await fetch("https://ssapi.shipstation.com/carriers", {
    headers: { Authorization: a, Accept: "application/json" },
  });
  out.carriersStatus = carrierRes.status;
  const carrierText = await carrierRes.text();
  try {
    out.carriers = JSON.parse(carrierText);
  } catch {
    out.carriersRaw = carrierText.slice(0, 800);
  }

  // Per-carrier services endpoint helps identify rateable ones
  if (Array.isArray(out.carriers)) {
    const carrierList = out.carriers as Array<{ Code?: string; Name?: string }>;
    const servicesByCarrier: Record<string, unknown> = {};
    for (const c of carrierList.slice(0, 10)) {
      if (!c.Code) continue;
      try {
        const sRes = await fetch(
          `https://ssapi.shipstation.com/carriers/listservices?carrierCode=${encodeURIComponent(c.Code)}`,
          { headers: { Authorization: a, Accept: "application/json" } },
        );
        const sText = await sRes.text();
        try {
          servicesByCarrier[c.Code] = JSON.parse(sText);
        } catch {
          servicesByCarrier[c.Code] = { status: sRes.status, raw: sText.slice(0, 300) };
        }
      } catch (err) {
        servicesByCarrier[c.Code] = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    out.services = servicesByCarrier;
  }

  return NextResponse.json(out);
}
