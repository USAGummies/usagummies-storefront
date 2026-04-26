/**
 * GET /api/ops/docs/receipt-review-packets
 *
 * Phase 13 — read-only list route. Powers the aggregate dashboard
 * at `/ops/finance/review-packets` so the operator can see every
 * receipt review packet's current status + approval state in one
 * view (instead of one packet per receipt row on the existing
 * Finance Review page).
 *
 * Query params:
 *   limit?: 1..500 (default 100)
 *
 * Response (200):
 *   {
 *     ok: true,
 *     count: number,
 *     packets: ReceiptReviewPacket[]
 *   }
 *
 * Hard rules:
 *   - **Auth-gated.** `isAuthorized()` (session OR CRON_SECRET).
 *   - **Read-only.** No KV / HubSpot / QBO / Shopify / Slack
 *     mutation. No `openApproval` / `buildApprovalRequest`.
 *   - **No fabrication on outage.** KV exception → HTTP 500 with
 *     reason; never returns `count: 0` silently.
 *   - **Bounded.** `limit` clamped server-side to [1, 500].
 *
 * Static-source assertions in the test suite lock the no-mutation
 * contract by name.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { listReceiptReviewPackets } from "@/lib/ops/docs";

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

  try {
    const packets = await listReceiptReviewPackets({ limit });
    return NextResponse.json({
      ok: true,
      count: packets.length,
      limit,
      packets,
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
