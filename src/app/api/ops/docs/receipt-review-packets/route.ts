/**
 * GET /api/ops/docs/receipt-review-packets
 *
 * Phase 13 — read-only list route. Powers the aggregate dashboard
 * at `/ops/finance/review-packets` so the operator can see every
 * receipt review packet's current status + approval state in one
 * view (instead of one packet per receipt row on the existing
 * Finance Review page).
 *
 * Phase 15 — accepts the canonical filter spec via query string
 * (`status`, `vendor`, `createdAfter`, `createdBefore`) so the
 * server can pre-filter for larger datasets. The filter behavior
 * is locked in lockstep with the client by routing through the
 * SAME pure helper (`filterPacketsBySpec`) — no parallel
 * implementation.
 *
 * Query params:
 *   limit?:          1..500 (default 100)
 *   status?:         all | draft | rene-approved | rejected
 *   vendor?:         case-insensitive substring (matches OCR cells)
 *   createdAfter?:   ISO date / date-time (inclusive)
 *   createdBefore?:  ISO date / date-time (inclusive)
 *
 * Response (200):
 *   {
 *     ok: true,
 *     count: number,        // length of the (filtered) packets array
 *     totalBeforeFilter: number,   // length BEFORE filtering — operator
 *                                  // can compare against `count` to see
 *                                  // how much the filter narrowed.
 *     limit: number,
 *     filterApplied: boolean,
 *     packets: ReceiptReviewPacket[]
 *   }
 *
 * Hard rules:
 *   - **Auth-gated.** `isAuthorized()` (session OR CRON_SECRET).
 *   - **Read-only.** No KV / HubSpot / QBO / Shopify / Slack
 *     mutation.
 *   - **No fabrication on outage.** KV exception → HTTP 500 with
 *     reason; never returns `count: 0` silently.
 *   - **Bounded.** `limit` clamped server-side to [1, 500].
 *   - **Lockstep filter semantics.** Server uses the SAME
 *     `filterPacketsBySpec` helper as the client view. Locked by
 *     test that asserts identical output for the same input + spec.
 *
 * Static-source assertions in the test suite lock the no-mutation
 * contract by name.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { listReceiptReviewPackets } from "@/lib/ops/docs";
import { getCachedApprovalLookup } from "@/lib/ops/receipt-review-approval-lookup";
import {
  filterPacketsBySpec,
  paginateReviewPackets,
  parseReviewPacketsFilterSpec,
} from "@/app/ops/finance/review-packets/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Phase 19 (Option B): the inlined `buildApprovalLookup` helper
// was extracted to `src/lib/ops/receipt-review-approval-lookup.ts`
// + wrapped in a 30-second KV cache. Both this list route and the
// CSV export route now share the canonical helper. The previous
// duplicate copies are gone.

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(500, rawLimit))
    : 100;
  const cursor = url.searchParams.get("cursor");

  const spec = parseReviewPacketsFilterSpec(url.searchParams);
  const filterApplied =
    (spec.status !== undefined && spec.status !== "all") ||
    spec.vendorContains !== undefined ||
    spec.createdAfter !== undefined ||
    spec.createdBefore !== undefined ||
    (spec.approvalStatus !== undefined && spec.approvalStatus !== "any") ||
    spec.idContains !== undefined;

  try {
    // Phase 17: load the full sorted set (capped at the storage cap,
    // 500). Filters apply BEFORE pagination so cursor traversal is
    // over the FILTERED set — operator scrolling through "pending"
    // approvals doesn't get half-empty pages.
    const allPackets = await listReceiptReviewPackets({ limit: 500 });

    // Phase 16/19 — read-only approval lookup, KV-cached (30s TTL)
    // through the shared canonical helper. Both reads inside the
    // helper fail-soft; the cache write is best-effort.
    const approvalsByPacketId = await getCachedApprovalLookup();

    const filtered = filterApplied
      ? filterPacketsBySpec(allPackets, spec, approvalsByPacketId)
      : allPackets;

    // Phase 17 — paginate the filtered set with the canonical cursor.
    const paginated = paginateReviewPackets(filtered, { limit, cursor });

    return NextResponse.json({
      ok: true,
      // Phase 17: count is page length; matchedTotal is the FULL
      // filtered length (so the client can render "X of Y").
      count: paginated.page.length,
      matchedTotal: filtered.length,
      totalBeforeFilter: allPackets.length,
      limit,
      filterApplied,
      packets: paginated.page,
      // Phase 17 — opaque cursor for the next page; null when no
      // more pages remain. Client treats it verbatim.
      nextCursor: paginated.nextCursor,
      // Phase 16 — flat lookup so the client view can attach
      // approvalId / approvalStatus to each row without a second
      // fetch. Keys are packetId (= targetEntity.id). Scoped to the
      // current page's packets only — irrelevant entries dropped.
      approvals: Object.fromEntries(
        Array.from(approvalsByPacketId.entries()).filter(([packetId]) =>
          paginated.page.some((p) => p.packetId === packetId),
        ),
      ),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "list_read_failed",
        reason: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
