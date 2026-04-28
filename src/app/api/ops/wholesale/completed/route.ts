/**
 * GET /api/ops/wholesale/completed — Phase 35.f.6.b
 *
 * Auth-gated read-only surface that lists wholesale onboarding
 * flows that completed within the last `?days=N` window. Powers
 * Rene's monthly close + month-end summary cadence.
 *
 * **Query params** (server-clamped):
 *   - days: [1, 365] default 30
 *   - limit: [1, 500] default 100
 *
 * **Response:**
 *   {
 *     ok: true,
 *     window: { days, since: ISO },
 *     totalCompleted: number,
 *     totalSubtotalUsd: number,    // sum across the window
 *     byPaymentPath: {
 *       "credit-card": { count, totalSubtotalUsd },
 *       "accounts-payable": { count, totalSubtotalUsd },
 *     },
 *     envelopes: AuditEnvelope[],   // most-recent first
 *   }
 *
 * Honest reads: 500 on KV failure (no fabricated zeros). Empty
 * window returns ok:true with all-zero counts (real, source-attested).
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { listRecentAuditEnvelopes } from "@/lib/wholesale/onboarding-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawDays = Number.parseInt(url.searchParams.get("days") ?? "30", 10);
  const days = Number.isFinite(rawDays)
    ? Math.max(1, Math.min(365, rawDays))
    : 30;
  const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(500, rawLimit))
    : 100;

  try {
    const envelopes = await listRecentAuditEnvelopes({
      withinDays: days,
      limit,
    });

    const byPaymentPath: Record<
      "credit-card" | "accounts-payable" | "unknown",
      { count: number; totalSubtotalUsd: number }
    > = {
      "credit-card": { count: 0, totalSubtotalUsd: 0 },
      "accounts-payable": { count: 0, totalSubtotalUsd: 0 },
      unknown: { count: 0, totalSubtotalUsd: 0 },
    };

    let totalSubtotalUsd = 0;
    for (const env of envelopes) {
      const subtotal = env.totalSubtotalUsd ?? 0;
      totalSubtotalUsd += subtotal;
      const path = env.paymentPath ?? "unknown";
      byPaymentPath[path].count += 1;
      byPaymentPath[path].totalSubtotalUsd += subtotal;
    }

    // Round to 2dp for invoice-grade presentation.
    totalSubtotalUsd = Math.round(totalSubtotalUsd * 100) / 100;
    for (const k of Object.keys(byPaymentPath) as (keyof typeof byPaymentPath)[]) {
      byPaymentPath[k].totalSubtotalUsd =
        Math.round(byPaymentPath[k].totalSubtotalUsd * 100) / 100;
    }

    const since = new Date(
      Date.now() - days * 24 * 3600 * 1000,
    ).toISOString();

    return NextResponse.json({
      ok: true,
      window: { days, since },
      totalCompleted: envelopes.length,
      totalSubtotalUsd,
      byPaymentPath,
      envelopes,
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
