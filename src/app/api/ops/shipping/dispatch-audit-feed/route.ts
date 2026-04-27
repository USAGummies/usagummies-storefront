/**
 * GET /api/ops/shipping/dispatch-audit-feed
 *
 * Phase 28g — read-only audit feed of recent dispatch transitions.
 * Powers the "Recent dispatch activity" sub-card on
 * `/ops/shipping/dispatch` so operators can see what just got marked
 * (or unmarked) without scrolling the full board.
 *
 * Reads `auditStore().byAction("shipping.dispatch.mark", N)` AND
 * `auditStore().byAction("shipping.dispatch.clear", N)`, merges the
 * two streams, projects each through the canonical
 * `projectDispatchAuditEntryToFeedRow` helper, and returns the
 * newest-first slice up to `limit`.
 *
 * Query params:
 *   limit?: 1..100 (default 20)
 *
 * Response (200):
 *   {
 *     ok: true,
 *     count: number,
 *     entries: DispatchFeedRow[],   // newest-first
 *   }
 *
 * Hard rules:
 *   - **Auth-gated.** `isAuthorized()` (session OR CRON_SECRET).
 *   - **Read-only.** No KV / Slack / external mutation.
 *   - **No fabrication on outage.** auditStore exception → HTTP 500
 *     with reason; never returns `count: 0` silently.
 *   - **Bounded.** `limit` clamped server-side to [1, 100]. We fetch
 *     `limit` from EACH action stream and then merge+slice, so the
 *     final response can have up to `limit` entries (mark or clear).
 *   - **Newest-first.** Final order respects the merged sort across
 *     mark + clear streams (timestampIso DESC, id DESC tie-break).
 *   - **Defensive projection.** Audit entries that don't fit the
 *     contract are SKIPPED. The byAction filter guarantees the action
 *     matches; the projection still validates entityType + entityId
 *     shape so a bad write to KV can't poison the feed.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { auditStore } from "@/lib/ops/control-plane/stores";
import {
  DISPATCH_AUDIT_ACTIONS,
  projectDispatchAuditEntryToFeedRow,
  sortDispatchFeedRows,
  type DispatchFeedRow,
} from "@/lib/ops/shipping-dispatch-audit-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(100, rawLimit))
    : 20;

  try {
    const [marks, clears] = await Promise.all([
      auditStore().byAction(DISPATCH_AUDIT_ACTIONS.mark, limit),
      auditStore().byAction(DISPATCH_AUDIT_ACTIONS.clear, limit),
    ]);
    const projected: DispatchFeedRow[] = [];
    for (const entry of [...marks, ...clears]) {
      const row = projectDispatchAuditEntryToFeedRow(entry);
      if (row) projected.push(row);
    }
    const sorted = sortDispatchFeedRows(projected).slice(0, limit);
    return NextResponse.json({
      ok: true,
      count: sorted.length,
      entries: sorted,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
