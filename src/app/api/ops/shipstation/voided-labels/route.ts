/**
 * GET /api/ops/shipstation/voided-labels
 *
 * BUILD #9 — Finance Exception Agent data source for the voided-label
 * refund watcher. Returns every voided ShipStation shipment in the
 * last N days (default 14) along with an `ageHours` + `stale` flag so
 * the agent can surface voids whose refunds haven't posted in the
 * expected Stamps.com window.
 *
 * Query params:
 *   - daysBack: int, 1-60, default 14
 *   - staleAfterHours: int, default 72
 *
 * Auth: bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { listVoidedLabels } from "@/lib/ops/shipstation-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseIntWithDefault(
  s: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!s) return fallback;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const daysBack = parseIntWithDefault(url.searchParams.get("daysBack"), 14, 1, 60);
  const staleAfterHours = parseIntWithDefault(
    url.searchParams.get("staleAfterHours"),
    72,
    1,
    720, // 30 days max
  );

  const res = await listVoidedLabels({ daysBack, staleAfterHours });
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
  }

  // Compute aggregate stats the digest can splat directly.
  const totalPendingRefund = res.stale.reduce(
    (sum, v) => sum + (v.shipmentCost ?? 0),
    0,
  );
  const byCarrier: Record<string, { count: number; totalDollars: number }> = {};
  for (const v of res.stale) {
    const key = v.carrierCode ?? "unknown";
    const b = byCarrier[key] ?? { count: 0, totalDollars: 0 };
    b.count += 1;
    b.totalDollars = Math.round((b.totalDollars + (v.shipmentCost ?? 0)) * 100) / 100;
    byCarrier[key] = b;
  }

  return NextResponse.json({
    ok: true,
    daysBack,
    staleAfterHours,
    totalVoided: res.voided.length,
    staleCount: res.stale.length,
    totalPendingRefundDollars: Math.round(totalPendingRefund * 100) / 100,
    byCarrier,
    stale: res.stale,
    // Full list for debugging / audit; callers can paginate client-side.
    voided: res.voided,
  });
}
