/**
 * GET /api/ops/inventory/burn-rate
 *
 * GET  — returns cached calibration (from KV). Cheap read.
 *        ?refresh=true re-computes from Shopify + Amazon order history.
 * POST — always re-computes + writes KV.
 *
 * Cron: weekly Sunday (03:30 UTC / 20:30 PT Saturday) to refresh the
 * calibration before the Monday drift audit + daily Ops Agent reads.
 *
 * Auth: bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";

import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";
import {
  cacheBurnRate,
  computeBurnRateCalibration,
  getCachedBurnRate,
} from "@/lib/ops/burn-rate-calibration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();
  const url = new URL(req.url);
  const forceRefresh = url.searchParams.get("refresh") === "true";
  const windowDays = Math.max(
    1,
    Math.min(90, Number.parseInt(url.searchParams.get("windowDays") ?? "30", 10) || 30),
  );

  if (forceRefresh) {
    const cal = await computeBurnRateCalibration({ windowDays });
    await cacheBurnRate(cal);
    return NextResponse.json({ ok: true, refreshed: true, calibration: cal });
  }

  const cached = await getCachedBurnRate();
  if (!cached) {
    // Miss — compute now so first call populates cache.
    const cal = await computeBurnRateCalibration({ windowDays });
    await cacheBurnRate(cal);
    return NextResponse.json({
      ok: true,
      refreshed: true,
      fromCache: false,
      calibration: cal,
    });
  }

  const ageHours =
    Math.round(
      ((Date.now() - new Date(cached.generatedAt).getTime()) / 3_600_000) *
        10,
    ) / 10;

  // Auto-refresh when cache is ≥ 8 days old (weekly cron should keep it
  // under 7). This is a safety net, not the primary refresh path.
  if (ageHours >= 8 * 24) {
    const cal = await computeBurnRateCalibration({ windowDays });
    await cacheBurnRate(cal);
    return NextResponse.json({
      ok: true,
      refreshed: true,
      fromCache: false,
      ageHours: 0,
      calibration: cal,
    });
  }

  return NextResponse.json({
    ok: true,
    refreshed: false,
    fromCache: true,
    ageHours,
    calibration: cached,
  });
}

export async function POST(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();
  const url = new URL(req.url);
  const windowDays = Math.max(
    1,
    Math.min(90, Number.parseInt(url.searchParams.get("windowDays") ?? "30", 10) || 30),
  );
  const cal = await computeBurnRateCalibration({ windowDays });
  await cacheBurnRate(cal);
  return NextResponse.json({ ok: true, written: true, calibration: cal });
}
