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
import { approvalStore } from "@/lib/ops/control-plane/stores";
import {
  filterPacketsBySpec,
  parseReviewPacketsFilterSpec,
  type ApprovalsByPacketId,
} from "@/app/ops/finance/review-packets/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 16 — read-only approval lookup builder. Indexes by
 * `targetEntity.id` so the canonical view helper can attach the
 * matching approval to each packet row.
 *
 * Both `listPending()` and `listByAgent()` are read-only. Either
 * source failing is non-fatal — we return a partial map; rows with
 * no match end up with `approvalStatus: null`.
 */
async function buildApprovalLookup(): Promise<ApprovalsByPacketId> {
  const map: ApprovalsByPacketId = new Map();
  const store = approvalStore();
  try {
    const pending = await store.listPending();
    for (const a of pending) {
      const id = a.targetEntity?.id;
      if (typeof id === "string" && id.length > 0) {
        map.set(id, { id: a.id, status: a.status });
      }
    }
  } catch {
    // partial — continue with the listByAgent fallback
  }
  try {
    // Terminal-state approvals routed by the promote-review route's
    // agent id. Cap at 200 — the operator-facing dashboard only
    // shows the most-recent batch; older closer history lives in
    // the audit log.
    const recent = await store.listByAgent("ops-route:receipt-promote", 200);
    for (const a of recent) {
      const id = a.targetEntity?.id;
      if (typeof id === "string" && id.length > 0) {
        // Don't overwrite a pending entry with the older terminal
        // state; the pending lookup wins on conflict.
        if (!map.has(id)) {
          map.set(id, { id: a.id, status: a.status });
        }
      }
    }
  } catch {
    // partial — already accumulated whatever listPending returned
  }
  return map;
}

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
    spec.createdBefore !== undefined ||
    (spec.approvalStatus !== undefined && spec.approvalStatus !== "any");

  try {
    const packets = await listReceiptReviewPackets({ limit });

    // Phase 16 — build the read-only approval lookup. Pulls pending
    // approvals + recent terminal-state approvals routed by the
    // promote-review agent (`ops-route:receipt-promote`). Both reads
    // are read-only; failure of either is non-fatal — we surface a
    // partial map and rows with no match get `approvalStatus: null`.
    const approvalsByPacketId = await buildApprovalLookup();

    const filtered = filterApplied
      ? filterPacketsBySpec(packets, spec, approvalsByPacketId)
      : packets;
    return NextResponse.json({
      ok: true,
      count: filtered.length,
      totalBeforeFilter: packets.length,
      limit,
      filterApplied,
      packets: filtered,
      // Phase 16 — flat lookup so the client view can attach
      // approvalId / approvalStatus to each row without a second
      // fetch. Keys are packetId (= targetEntity.id).
      approvals: Object.fromEntries(approvalsByPacketId.entries()),
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
