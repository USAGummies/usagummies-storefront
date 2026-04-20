/**
 * One-off admin endpoint — subscribe a ShipStation webhook to our
 * /api/ops/fulfillment/tracking-webhook target.
 *
 * ShipStation removed the webhooks UI from its newer dashboards; the
 * v1 API (`ssapi.shipstation.com/webhooks/subscribe`) remains the
 * only way to register them. This route wraps that one call so we
 * can register without maintaining a standalone script.
 *
 * Idempotent-ish: POST subscribes a new webhook (ShipStation allows
 * multiple on the same event+target); GET lists current subscriptions;
 * DELETE?id=<webhookId> removes one. Run once, then never touch again.
 *
 * Auth: bearer CRON_SECRET.
 */

import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";

import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SS_BASE = "https://ssapi.shipstation.com";

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
  const res = await fetch(`${SS_BASE}/webhooks`, { headers: { Authorization: a } });
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
}

export async function POST(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();
  const a = auth();
  if (!a) return NextResponse.json({ error: "ShipStation creds not configured" }, { status: 500 });

  const webhookSecret = process.env.FULFILLMENT_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "FULFILLMENT_WEBHOOK_SECRET not configured" },
      { status: 500 },
    );
  }

  let body: { event?: string; name?: string } = {};
  try {
    body = (await req.json()) as { event?: string; name?: string };
  } catch {
    // body optional — defaults below
  }
  const event = body.event || "ITEM_SHIP_NOTIFY";
  const name = body.name || `fulfillment-hub-${event}`;
  const targetUrl = `https://www.usagummies.com/api/ops/fulfillment/tracking-webhook?token=${encodeURIComponent(webhookSecret)}`;

  const res = await fetch(`${SS_BASE}/webhooks/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: a },
    body: JSON.stringify({
      target_url: targetUrl,
      event,
      friendly_name: name,
    }),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Non-JSON ShipStation response (unlikely for 2xx); surface raw.
  }
  return NextResponse.json(
    { ok: res.ok, status: res.status, event, targetUrl, response: parsed },
    { status: res.ok ? 200 : 502 },
  );
}

export async function DELETE(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();
  const a = auth();
  if (!a) return NextResponse.json({ error: "ShipStation creds not configured" }, { status: 500 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "?id=<webhookId> required" }, { status: 400 });
  const res = await fetch(`${SS_BASE}/webhooks/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: a },
  });
  return NextResponse.json({ ok: res.ok, status: res.status, id });
}
