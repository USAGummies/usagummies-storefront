/**
 * GET /api/ops/docs/receipt-review-packets/export.csv
 *
 * Phase 18 (Option A) — read-only CSV export of the filtered review
 * packets queue, for finance ops handoffs. Reuses the canonical
 * filter spec (Phase 14/15/16) so a CSV download mirrors what the
 * operator sees on `/ops/finance/review-packets`.
 *
 * Phase 21 — accepts the canonical Phase 17 cursor (`?cursor=...`)
 * for traversal of queues larger than the storage cap. The dashboard's
 * "Export CSV" button continues to send no cursor (default first page,
 * up to 500 rows — backward-compatible with Phase 18). Programmatic
 * clients chase `nextCursor` via the `Link: rel="next"` response
 * header. Filename stays stable; multi-page consumers can rename
 * downloaded files locally.
 *
 * Query params (all optional, same shape as the JSON list route):
 *   limit?:           1..500 (default 500 — exporters want a full page)
 *   status?:          all | draft | rene-approved | rejected
 *   vendor?:          case-insensitive substring (matches OCR cells)
 *   createdAfter?:    ISO date / date-time (inclusive)
 *   createdBefore?:   ISO date / date-time (inclusive)
 *   approvalStatus?:  any | no-approval | pending | approved | rejected | expired | stood-down
 *   cursor?:          opaque base64url-encoded cursor from a prior
 *                     response's `Link: rel="next"` / `X-Next-Cursor`.
 *                     Malformed → first page (no fabrication).
 *
 * Hard rules:
 *   - **Auth-gated.** `isAuthorized()` (session OR CRON_SECRET).
 *     Same gate as the JSON list route — the CSV is the same data
 *     in a different format.
 *   - **Read-only.** No KV / HubSpot / QBO / Shopify / Slack
 *     mutation. No `openApproval` / `buildApprovalRequest`.
 *   - **No fabrication.** KV exception → HTTP 500 text/plain with
 *     reason; never returns an empty CSV silently.
 *   - **Mirrors JSON-route filter + pagination semantics.** Same
 *     canonical helpers (`parseReviewPacketsFilterSpec`,
 *     `filterPacketsBySpec`, `paginateReviewPackets`,
 *     `buildReviewPacketsView`, `renderReviewPacketsCsv`). Locked
 *     by parity tests that assert the CSV row set + nextCursor
 *     matches what the JSON list route would have returned for the
 *     same spec + cursor.
 *   - **Filters apply BEFORE pagination.** Cursor traversal of an
 *     active filter doesn't show half-empty pages (mirrors Phase
 *     17's contract on the JSON list route).
 *   - **Malformed cursor → first page.** Defensive — never throws.
 *
 * Response:
 *   200 → text/csv with:
 *           - `Content-Disposition: attachment; filename="usa-gummies-review-packets-YYYY-MM-DD.csv"`
 *           - `X-Matched-Total: <number>` — full filtered set length
 *             (NOT the page length; mirrors the JSON list's
 *             `matchedTotal` field).
 *           - `X-Next-Cursor: <opaque>` — present when more pages
 *             remain. Absent on the final page (NEVER fabricated as
 *             empty string / "null" — header is just absent).
 *           - `Link: <next-url>; rel="next"` — RFC 5988 navigation
 *             hint. Present iff `X-Next-Cursor` is present.
 *         Body is RFC-4180 CSV with a fixed header row.
 *   401 → JSON {error: "Unauthorized"}
 *   500 → text/plain "csv_export_failed: <reason>"
 */
import { isAuthorized } from "@/lib/ops/abra-auth";
import { listReceiptReviewPackets } from "@/lib/ops/docs";
import { getCachedApprovalLookup } from "@/lib/ops/receipt-review-approval-lookup";
import {
  buildReviewPacketsView,
  filterPacketsBySpec,
  paginateReviewPackets,
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
  const cursor = url.searchParams.get("cursor");

  const spec = parseReviewPacketsFilterSpec(url.searchParams);
  const filterApplied =
    (spec.status !== undefined && spec.status !== "all") ||
    spec.vendorContains !== undefined ||
    spec.createdAfter !== undefined ||
    spec.createdBefore !== undefined ||
    (spec.approvalStatus !== undefined && spec.approvalStatus !== "any");

  try {
    // Phase 21: load the full storage cap (500) and paginate the
    // FILTERED set — mirrors the Phase 17 contract on the JSON list
    // route. Cursor traversal of a filter doesn't emit half-empty
    // pages.
    const allPackets = await listReceiptReviewPackets({ limit: 500 });
    // Phase 16/19 — KV-cached canonical approval lookup, shared
    // with the JSON list route. Read-only; fail-soft.
    const approvalsByPacketId = await getCachedApprovalLookup();
    const filtered = filterApplied
      ? filterPacketsBySpec(allPackets, spec, approvalsByPacketId)
      : allPackets;
    // Phase 21 — paginate the filtered set with the canonical
    // cursor. Malformed cursor falls back to first page (defensive
    // guard inside `paginateReviewPackets` / `decodeReviewPacketCursor`).
    const paginated = paginateReviewPackets(filtered, { limit, cursor });
    const view = buildReviewPacketsView(paginated.page, approvalsByPacketId);
    const csv = renderReviewPacketsCsv(view.rows);
    const filename = reviewPacketsCsvFilename();

    const headers: Record<string, string> = {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Mirror the JSON route's no-cache contract — exports
      // should never serve a stale page from a CDN.
      "Cache-Control": "no-store, max-age=0",
      // Phase 21 — full filtered set length (NOT page length).
      // Mirrors the JSON list's `matchedTotal` so power users
      // chasing cursors know how much remains.
      "X-Matched-Total": String(filtered.length),
    };
    if (paginated.nextCursor) {
      headers["X-Next-Cursor"] = paginated.nextCursor;
      // RFC 5988 Link header — navigation hint pointing at the
      // next page's full URL with the cursor swapped in.
      const nextUrl = new URL(req.url);
      nextUrl.searchParams.set("cursor", paginated.nextCursor);
      headers["Link"] = `<${nextUrl.toString()}>; rel="next"`;
    }

    return new Response(csv, { status: 200, headers });
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
