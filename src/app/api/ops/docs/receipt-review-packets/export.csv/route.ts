/**
 * GET /api/ops/docs/receipt-review-packets/export.csv
 *
 * Phase 18 (Option A) — read-only CSV export of the filtered review
 * packets queue, for finance ops handoffs. Reuses the canonical
 * filter spec (Phase 14/15/16) so a CSV download mirrors what the
 * operator sees on `/ops/finance/review-packets`.
 *
 * Query params (all optional, same shape as the JSON list route):
 *   limit?:           1..500 (default 500 — exporters want the full set)
 *   status?:          all | draft | rene-approved | rejected
 *   vendor?:          case-insensitive substring (matches OCR cells)
 *   createdAfter?:    ISO date / date-time (inclusive)
 *   createdBefore?:   ISO date / date-time (inclusive)
 *   approvalStatus?:  any | no-approval | pending | approved | rejected | expired | stood-down
 *
 * Hard rules:
 *   - **Auth-gated.** `isAuthorized()` (session OR CRON_SECRET).
 *     Same gate as the JSON list route — the CSV is the same data
 *     in a different format.
 *   - **Read-only.** No KV / HubSpot / QBO / Shopify / Slack
 *     mutation. No `openApproval` / `buildApprovalRequest`.
 *   - **No fabrication.** KV exception → HTTP 500 text/plain with
 *     reason; never returns an empty CSV silently.
 *   - **Mirrors JSON-route filter semantics.** Same canonical
 *     helpers (`parseReviewPacketsFilterSpec`, `filterPacketsBySpec`,
 *     `buildReviewPacketsView`, `renderReviewPacketsCsv`). Locked
 *     by parity test that asserts the CSV row set matches what the
 *     JSON list route would have returned for the same spec.
 *   - **No pagination.** Exports the full filtered set up to
 *     `limit` (capped at 500 by storage). The Phase 17 cursor
 *     applies only to the JSON list route — finance ops want one
 *     CSV per export.
 *
 * Response:
 *   200 → text/csv with `Content-Disposition: attachment; filename=
 *         usa-gummies-review-packets-YYYY-MM-DD.csv`. Body is RFC-4180
 *         CSV with a fixed header row.
 *   401 → JSON {error: "Unauthorized"}
 *   500 → text/plain "csv_export_failed: <reason>"
 */
import { isAuthorized } from "@/lib/ops/abra-auth";
import { listReceiptReviewPackets } from "@/lib/ops/docs";
import { getCachedApprovalLookup } from "@/lib/ops/receipt-review-approval-lookup";
import {
  buildReviewPacketsView,
  filterPacketsBySpec,
  parseReviewPacketsFilterSpec,
  renderReviewPacketsCsv,
  reviewPacketsCsvFilename,
} from "@/app/ops/finance/review-packets/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Phase 19 (Option B): the inlined `buildApprovalLookup` helper
// here was extracted to `src/lib/ops/receipt-review-approval-lookup.ts`
// + wrapped in a 30-second KV cache. Both this CSV route and the
// JSON list route now share the canonical helper. The previous
// duplicate copy is gone.

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "500", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(500, rawLimit))
    : 500;

  const spec = parseReviewPacketsFilterSpec(url.searchParams);
  const filterApplied =
    (spec.status !== undefined && spec.status !== "all") ||
    spec.vendorContains !== undefined ||
    spec.createdAfter !== undefined ||
    spec.createdBefore !== undefined ||
    (spec.approvalStatus !== undefined && spec.approvalStatus !== "any");

  try {
    const allPackets = await listReceiptReviewPackets({ limit });
    // Phase 16/19 — KV-cached canonical approval lookup, shared
    // with the JSON list route. Read-only; fail-soft.
    const approvalsByPacketId = await getCachedApprovalLookup();
    const filtered = filterApplied
      ? filterPacketsBySpec(allPackets, spec, approvalsByPacketId)
      : allPackets;
    const view = buildReviewPacketsView(filtered, approvalsByPacketId);
    const csv = renderReviewPacketsCsv(view.rows);
    const filename = reviewPacketsCsvFilename();
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // Mirror the JSON route's no-cache contract — exports
        // should never serve a stale page from a CDN.
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    return new Response(
      `csv_export_failed: ${err instanceof Error ? err.message : String(err)}`,
      {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      },
    );
  }
}
