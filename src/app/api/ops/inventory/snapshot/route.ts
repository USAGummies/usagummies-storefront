/**
 * Inventory Snapshot — /api/ops/inventory/snapshot
 *
 * GET  — returns the cached snapshot from KV. Reads cheap. When
 *        called with `?refresh=true` (or `?staleHours=N` + cache is
 *        older than N), fresh-fetches from Shopify + rewrites KV.
 *        Cron-friendly (Vercel Cron sends GET only).
 * POST — always fresh-fetches from Shopify + rewrites KV. On-demand
 *        when an agent needs a guaranteed-fresh read (e.g. Shipping
 *        Hub over-promise check during a multi-SKU large order).
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

async function refreshSnapshot(
  lowThreshold?: number,
): Promise<
  | { ok: true; snapshot: InventorySnapshot }
  | { ok: false; error: string }
> {
  let rows;
  try {
    rows = await getAllOnHandInventory();
  } catch (err) {
    return {
      ok: false,
      error: `Shopify fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const opts = lowThreshold && lowThreshold > 0 ? { lowThreshold } : undefined;
  const snapshot = buildSnapshotFromOnHand(rows, opts);
  await kv.set(KV_INVENTORY_SNAPSHOT, snapshot);
  return { ok: true, snapshot };
}

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  const url = new URL(req.url);
  const forceRefresh = url.searchParams.get("refresh") === "true";
  const staleHoursParam = Number.parseFloat(
    url.searchParams.get("staleHours") ?? "",
  );
  const staleHours =
    Number.isFinite(staleHoursParam) && staleHoursParam > 0
      ? staleHoursParam
      : null;
  const lowThreshold = Number.parseInt(
    url.searchParams.get("lowThreshold") ?? "",
    10,
  );

  const cached =
    (await kv.get<InventorySnapshot>(KV_INVENTORY_SNAPSHOT)) ?? null;
  const ageMs = cached ? Date.now() - new Date(cached.generatedAt).getTime() : Infinity;
  const ageHours = cached
    ? Math.round((ageMs / 3_600_000) * 10) / 10
    : null;

  const needsRefresh =
    forceRefresh ||
    !cached ||
    (staleHours !== null && ageHours !== null && ageHours >= staleHours) ||
    // Default: auto-refresh when the cached snapshot is >18h old.
    // Pairs with the weekday 13:15 UTC (06:15 PT) dedicated cron.
    (ageHours !== null && ageHours >= 18);

  if (needsRefresh) {
    const res = await refreshSnapshot(
      Number.isFinite(lowThreshold) && lowThreshold > 0 ? lowThreshold : undefined,
    );
    if (!res.ok) {
      // On refresh failure, return the stale cache if we have one
      // rather than 502 — Ben's ATP gate shouldn't break when Shopify
      // has a transient outage.
      if (cached) {
        return NextResponse.json({
          ok: true,
          cached: true,
          refreshed: false,
          refreshError: res.error,
          ageHours,
          snapshot: cached,
        });
      }
      return NextResponse.json(
        { ok: false, error: res.error },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      cached: false,
      refreshed: true,
      generatedAt: res.snapshot.generatedAt,
      totalRows: res.snapshot.totalRows,
      lowCount: res.snapshot.lowCount,
      lowThreshold: res.snapshot.lowThreshold,
      snapshot: res.snapshot,
    });
  }

  return NextResponse.json({
    ok: true,
    cached: true,
    refreshed: false,
    ageHours,
    snapshot: cached,
  });
}

export async function POST(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  const url = new URL(req.url);
  const threshold = Number.parseInt(
    url.searchParams.get("lowThreshold") ?? "",
    10,
  );
  const res = await refreshSnapshot(
    Number.isFinite(threshold) && threshold > 0 ? threshold : undefined,
  );
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    written: true,
    generatedAt: res.snapshot.generatedAt,
    totalRows: res.snapshot.totalRows,
    lowCount: res.snapshot.lowCount,
    lowThreshold: res.snapshot.lowThreshold,
    lowRows: res.snapshot.rows.filter((r) => r.low),
  });
}
