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
import {
  filterPacketsBySpec,
  parseReviewPacketsFilterSpec,
} from "@/app/ops/finance/review-packets/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(500, rawLimit))
    : 100;

  const spec = parseReviewPacketsFilterSpec(url.searchParams);
  const filterApplied =
    (spec.status !== undefined && spec.status !== "all") ||
    spec.vendorContains !== undefined ||
    spec.createdAfter !== undefined ||
    spec.createdBefore !== undefined;

  try {
    const packets = await listReceiptReviewPackets({ limit });
    const filtered = filterApplied ? filterPacketsBySpec(packets, spec) : packets;
    return NextResponse.json({
      ok: true,
      count: filtered.length,
      totalBeforeFilter: packets.length,
      limit,
      filterApplied,
      packets: filtered,
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
