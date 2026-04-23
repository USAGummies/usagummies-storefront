/**
 * POST /api/ops/amazon/auto-ship
 *
 * Thin pass-through to the unified auto-ship route at
 * `/api/ops/shipping/auto-ship`. Kept for any explicit Amazon-only
 * invocations (e.g. one-off manual runs via cron tooling), but the
 * primary cron points directly at the unified endpoint now.
 *
 * If the caller supplies an Amazon storeId via env var
 * (`SHIPSTATION_STORE_ID_AMAZON`), the unified route filters the
 * queue to that store only. Otherwise it processes every awaiting-
 * shipment order regardless of source — which is the desired default
 * given the pipeline idempotency + packaging refusal guards.
 *
 * Auth: session OR bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { POST as unifiedAutoShip } from "@/app/api/ops/shipping/auto-ship/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function forward(req: Request, extraBody: Record<string, unknown>): Promise<Response> {
  const storeIdEnv = process.env.SHIPSTATION_STORE_ID_AMAZON?.trim();
  const storeId = storeIdEnv ? Number(storeIdEnv) : undefined;
  const forwardReq = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({
      ...extraBody,
      storeId: Number.isFinite(storeId) ? storeId : undefined,
    }),
  });
  return unifiedAutoShip(forwardReq);
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* empty body is fine */
  }
  return forward(req, body);
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "true";
  return forward(req, { dryRun });
}
