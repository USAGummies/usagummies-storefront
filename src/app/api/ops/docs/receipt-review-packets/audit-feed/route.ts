/**
 * GET /api/ops/docs/receipt-review-packets/audit-feed
 *
 * Phase 25 — read-only audit feed of recent receipt-review packet
 * transitions. Powers the "Recent activity" sub-card on the
 * `/ops/finance/review-packets` dashboard so operators can see
 * what just got approved/rejected without scrolling the table.
 *
 * Reads `auditStore().byAction("receipt-review-promote.closer", N)`
 * which returns the most-recent N entries first (per KV adapter).
 * Each entry projects through the canonical `projectAuditEntryToFeedRow`
 * helper so client + server agree on shape; defensive on malformed
 * `after` payloads.
 *
 * Query params:
 *   limit?: 1..100 (default 20)
 *
 * Response (200):
 *   {
 *     ok: true,
 *     count: number,
 *     entries: AuditFeedRow[],   // newest-first
 *   }
 *
 * Hard rules:
 *   - **Auth-gated.** `isAuthorized()` (session OR CRON_SECRET).
 *   - **Read-only.** No KV / HubSpot / QBO / Shopify / Slack
 *     mutation. No `openApproval` / `buildApprovalRequest`.
 *   - **No fabrication on outage.** auditStore exception → HTTP 500
 *     with reason; never returns `count: 0` silently.
 *   - **Bounded.** `limit` clamped server-side to [1, 100].
 *   - **Newest-first.** Entries returned in audit-store order
 *     (newest first per `byAction` adapter contract).
 *   - **Defensive projection.** Audit entries with malformed
 *     `after` payloads are SKIPPED (not fabricated as null fields)
 *     so the operator only sees rows that genuinely represent a
 *     transition. Non-receipt-review-promote.closer entries are
 *     excluded by the byAction filter; the projection is a
 *     defense-in-depth check.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { projectAuditEntryToFeedRow } from "@/app/ops/finance/review-packets/data";

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
    const entries = await auditStore().byAction(
      "receipt-review-promote.closer",
      limit,
    );
    // Project + skip malformed (defensive). The byAction filter
    // guarantees the action matches; the projection still validates
    // shape so a bad write to KV can't poison the feed.
    const rows = entries
      .map(projectAuditEntryToFeedRow)
      .filter((r): r is NonNullable<typeof r> => r !== null);
    return NextResponse.json({
      ok: true,
      count: rows.length,
      entries: rows,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "audit_feed_read_failed",
        reason: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
