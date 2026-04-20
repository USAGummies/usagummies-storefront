/**
 * ShipStation tracking webhook — Phase 3 of the Shipping Hub.
 *
 * ShipStation fires `SHIP_NOTIFY` (label created / shipped) and
 * `ITEM_SHIP_NOTIFY` when a tracking number goes in-transit / delivered.
 * The payload is a `resource_url` we have to GET to fetch the actual event
 * list. We iterate the returned shipments, match `trackingNumber` back to
 * our KV stage map (stage.tracking can contain multiple numbers joined by
 * ", "), and promote the matching entries to `shipped`.
 *
 * Auth: ShipStation supports a custom webhook URL but doesn't sign it.
 * We require a shared-secret query param `?token=<FULFILLMENT_WEBHOOK_SECRET>`
 * so the endpoint can't be discovered + forged.
 *
 * Docs: https://www.shipstation.com/docs/api/webhooks/
 */

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { Buffer } from "node:buffer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KV_STAGES = "fulfillment:stages";

interface StageEntry {
  stage: "received" | "packed" | "ready" | "shipped";
  cartonsRequired: number;
  cartonsPacked: number;
  tracking?: string;
  labelUrl?: string;
  labelCost?: number;
  carrier?: string;
  service?: string;
  notes?: string;
  receivedAt: string;
  packedAt?: string;
  readyAt?: string;
  shippedAt?: string;
  updatedBy?: string;
  updatedAt: string;
}
type StageMap = Record<string, StageEntry>;

interface ShipStationWebhookPayload {
  resource_url?: string;
  resource_type?: string;
}

interface ShipStationShipmentsResponse {
  shipments?: Array<{
    shipmentId: number;
    trackingNumber?: string;
    voidDate?: string | null;
    shipDate?: string | null;
    deliveryDate?: string | null;
    [key: string]: unknown;
  }>;
}

function tokenMatches(req: Request): boolean {
  const expected = process.env.FULFILLMENT_WEBHOOK_SECRET?.trim();
  if (!expected) return false;
  const url = new URL(req.url);
  return url.searchParams.get("token")?.trim() === expected;
}

async function fetchShipstationResource(
  url: string,
): Promise<ShipStationShipmentsResponse | null> {
  const key = process.env.SHIPSTATION_API_KEY?.trim();
  const secret = process.env.SHIPSTATION_API_SECRET?.trim();
  if (!key || !secret) return null;
  const auth = "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
  try {
    const res = await fetch(url, { headers: { Authorization: auth } });
    if (!res.ok) return null;
    return (await res.json()) as ShipStationShipmentsResponse;
  } catch {
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!tokenMatches(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: ShipStationWebhookPayload;
  try {
    payload = (await req.json()) as ShipStationWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload.resource_url) {
    return NextResponse.json({ ok: true, note: "ignored — no resource_url" });
  }

  const resource = await fetchShipstationResource(payload.resource_url);
  const shipments = resource?.shipments ?? [];
  if (shipments.length === 0) {
    return NextResponse.json({ ok: true, note: "no shipments in resource" });
  }

  const stages: StageMap = ((await kv.get<StageMap>(KV_STAGES)) ?? {}) as StageMap;
  const now = new Date().toISOString();
  const promoted: string[] = [];

  for (const shipment of shipments) {
    const tracking = shipment.trackingNumber?.trim();
    if (!tracking) continue;
    for (const [key, entry] of Object.entries(stages)) {
      if (!entry.tracking) continue;
      const tokens = entry.tracking.split(/[,\s]+/).filter(Boolean);
      if (!tokens.includes(tracking)) continue;
      if (entry.stage === "shipped") continue;
      stages[key] = {
        ...entry,
        stage: "shipped",
        shippedAt: shipment.shipDate ?? now,
        updatedAt: now,
      };
      promoted.push(key);
    }
  }

  if (promoted.length > 0) {
    await kv.set(KV_STAGES, stages);
  }

  return NextResponse.json({ ok: true, promoted });
}

// Allow GET for ShipStation's connection test.
export async function GET(req: Request): Promise<Response> {
  if (!tokenMatches(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, service: "fulfillment-tracking-webhook" });
}
