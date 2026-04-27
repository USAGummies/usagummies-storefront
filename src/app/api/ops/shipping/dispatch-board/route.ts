/**
 * GET /api/ops/shipping/dispatch-board
 *
 * Server-side join of ShipStation recent-shipments + shipping artifact
 * records, projected to typed `DispatchBoardRow[]` per
 * `src/lib/ops/shipping-dispatch-board.ts`. Backs the dispatch dashboard
 * at `/ops/shipping/dispatch` — Ben (or any operator) can see open vs.
 * dispatched packages at a glance.
 *
 * Query params:
 *   - daysBack:    default 14, clamped [1, 60].
 *   - includeVoided: "true" to include voided labels (default false).
 *   - limit:       default 100, max 500.
 *
 * Auth: bearer CRON_SECRET OR session (matches the rest of /api/ops).
 *
 * Read-only by design — the only write path is the sibling
 * `/mark-dispatched` POST. This route NEVER calls `markDispatched`,
 * `clearDispatched`, or any external system besides ShipStation read.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getRecentShipments } from "@/lib/ops/shipstation-client";
import { bulkLookupArtifacts } from "@/lib/ops/shipping-artifacts";
import { buildDispatchBoardRows } from "@/lib/ops/shipping-dispatch-board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const daysBack = clampInt(url.searchParams.get("daysBack"), 14, 1, 60);
  const limit = clampInt(url.searchParams.get("limit"), 100, 1, 500);
  const includeVoided = url.searchParams.get("includeVoided") === "true";

  const shipDateStart = new Date(Date.now() - daysBack * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  const ssRes = await getRecentShipments({
    shipDateStart,
    includeVoided: true, // we'll filter in the projection so counts are honest
    pageSize: Math.max(limit, 200),
  });
  if (!ssRes.ok) {
    return NextResponse.json(
      { ok: false, error: ssRes.error },
      { status: 502 },
    );
  }

  const shipments = ssRes.shipments.slice(0, limit);

  // Bulk-resolve artifacts. We don't always know `source` up-front;
  // bulkLookupArtifacts tries each known channel by order number.
  const artifactPairs = shipments
    .filter((s) => s.orderNumber)
    .map((s) => ({ orderNumber: s.orderNumber as string }));
  const artifactMap = await bulkLookupArtifacts(artifactPairs);

  // Re-key the artifact map for `buildDispatchBoardRows`. The helper
  // accepts both `${source}:${orderNumber}` and bare `orderNumber`.
  const lookupMap = new Map<string, (typeof artifactMap) extends Map<string, infer V> ? V : never>();
  for (const [orderNumber, record] of artifactMap.entries()) {
    lookupMap.set(orderNumber, record);
    lookupMap.set(`${record.source}:${orderNumber}`, record);
  }

  const view = buildDispatchBoardRows(shipments, lookupMap, {
    excludeVoided: !includeVoided,
  });

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    daysBack,
    limit,
    includeVoided,
    counts: view.counts,
    rows: view.rows,
  });
}
