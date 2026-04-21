/**
 * Inventory Snapshot — /api/ops/inventory/snapshot
 *
 * GET   — returns the cached snapshot from KV. Reads cheap.
 * POST  — fresh-fetches from Shopify + rewrites KV + returns the new snapshot.
 *
 * POST is invoked by the Ops Agent cron (weekday 09:00 PT) and
 * on-demand when an agent needs a guaranteed-fresh read (e.g. Shipping
 * Hub over-promise check during a multi-SKU large order).
 *
 * Auth: bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";
import {
  KV_INVENTORY_SNAPSHOT,
  buildSnapshotFromOnHand,
  type InventorySnapshot,
} from "@/lib/ops/inventory-snapshot";
import { getAllOnHandInventory } from "@/lib/ops/shopify-admin-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  const snap = (await kv.get<InventorySnapshot>(KV_INVENTORY_SNAPSHOT)) ?? null;
  if (!snap) {
    return NextResponse.json({
      ok: true,
      cached: false,
      snapshot: null,
      message:
        "No snapshot in cache yet — POST this endpoint to populate (runs automatically daily).",
    });
  }
  const ageMs = Date.now() - new Date(snap.generatedAt).getTime();
  return NextResponse.json({
    ok: true,
    cached: true,
    ageHours: Math.round((ageMs / 3_600_000) * 10) / 10,
    snapshot: snap,
  });
}

export async function POST(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  const url = new URL(req.url);
  const threshold = Number.parseInt(
    url.searchParams.get("lowThreshold") ?? "",
    10,
  );
  const opts = Number.isFinite(threshold) && threshold > 0
    ? { lowThreshold: threshold }
    : undefined;

  let rows;
  try {
    rows = await getAllOnHandInventory();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Shopify fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }

  const snapshot = buildSnapshotFromOnHand(rows, opts);
  await kv.set(KV_INVENTORY_SNAPSHOT, snapshot);

  return NextResponse.json({
    ok: true,
    written: true,
    generatedAt: snapshot.generatedAt,
    totalRows: snapshot.totalRows,
    lowCount: snapshot.lowCount,
    lowThreshold: snapshot.lowThreshold,
    lowRows: snapshot.rows.filter((r) => r.low),
  });
}
