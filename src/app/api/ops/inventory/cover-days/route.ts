/**
 * GET /api/ops/inventory/cover-days
 *
 * Days-of-cover forecast per SKU (Inventory Specialist S-07 MVP).
 *
 * Reads the cached inventory snapshot (`inventory:snapshot:v1`) and
 * the configured burn rate to compute cover-days for each SKU +
 * fleet total. Flags urgent (≤14d) + soon (≤30d) SKUs so Drew knows
 * when to raise a Powers PO.
 *
 * Auth: session OR bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getCachedBurnRate } from "@/lib/ops/burn-rate-calibration";
import { forecastCoverDays } from "@/lib/ops/inventory-forecast";
import {
  KV_INVENTORY_SNAPSHOT,
  type InventorySnapshot,
} from "@/lib/ops/inventory-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [snap, calibration] = await Promise.all([
    (async () =>
      ((await kv.get<InventorySnapshot>(KV_INVENTORY_SNAPSHOT)) ??
        null) as InventorySnapshot | null)(),
    getCachedBurnRate(),
  ]);
  const forecast = forecastCoverDays(snap, calibration);

  return NextResponse.json({
    ok: true,
    ...forecast,
    snapshotAgeHours: snap
      ? Math.round(
          ((Date.now() - new Date(snap.generatedAt).getTime()) / 3_600_000) *
            10,
        ) / 10
      : null,
    snapshotGeneratedAt: snap?.generatedAt ?? null,
    calibrationAgeHours: calibration
      ? Math.round(
          ((Date.now() - new Date(calibration.generatedAt).getTime()) /
            3_600_000) *
            10,
        ) / 10
      : null,
  });
}
