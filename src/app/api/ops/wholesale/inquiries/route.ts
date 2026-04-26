/**
 * GET /api/ops/wholesale/inquiries
 *
 * Phase 6 Sales Command Center — auth-gated, read-only internal
 * list of wholesale inquiry submissions. Powers the wholesale
 * inquiries source on `/ops/sales` (replaces the Phase 1
 * `not_wired` placeholder once durable storage is in place).
 *
 * Hard rules:
 *   - **Read-only.** No KV / HubSpot / QBO / Shopify / Slack mutation.
 *   - **Auth-gated.** Middleware blocks `/api/ops/*` for unauthenticated
 *     traffic; `isAuthorized()` rechecks (session OR CRON_SECRET) so
 *     scripts and human operators get the same answer.
 *   - **No fabricated zero on error.** A KV exception returns HTTP
 *     500 with the underlying reason; the caller (sales-command
 *     reader) maps that to `error` state, never `wired:0`.
 *   - **Bounded.** `limit` query param is clamped server-side to
 *     [1, 500] (default 50).
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  getWholesaleInquirySummary,
  listWholesaleInquiries,
} from "@/lib/wholesale/inquiries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(500, rawLimit))
    : 50;

  try {
    const [summary, recent] = await Promise.all([
      getWholesaleInquirySummary(),
      listWholesaleInquiries({ limit }),
    ]);
    if (!summary.ok) {
      return NextResponse.json(
        { ok: false, error: "kv_read_failed", reason: summary.reason },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      total: summary.summary.total,
      lastSubmittedAt: summary.summary.lastSubmittedAt ?? null,
      limit,
      recent,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "kv_read_failed",
        reason: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
