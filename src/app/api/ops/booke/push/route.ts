/**
 * Booke queue count push endpoint.
 *
 * POST body `{ count: number }` — stores the pending-review count
 * into KV so Finance Exception Agent's morning digest can cite it.
 *
 * Use cases:
 *   - Zapier / Make.com bridge polls Booke and POSTs here on a schedule
 *   - Manual override by Rene if Booke's own dashboard is misreporting
 *   - One-off scripts
 *
 * Auth: bearer CRON_SECRET (matches the rest of /api/ops/* admin routes).
 */

import { NextResponse } from "next/server";

import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";
import { setBookeQueueCount, getBookeQueueState } from "@/lib/ops/booke-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();
  const state = await getBookeQueueState();
  return NextResponse.json(state);
}

export async function POST(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();
  let body: { count?: unknown };
  try {
    body = (await req.json()) as { count?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const count = Number(body.count);
  if (!Number.isFinite(count) || count < 0) {
    return NextResponse.json(
      { error: "count must be a non-negative number" },
      { status: 400 },
    );
  }
  const entry = await setBookeQueueCount(count);
  return NextResponse.json({ ok: true, entry });
}
