/**
 * GET /api/ops/uspto/trademarks
 *
 * Phase 31.1 — read-only USPTO trademark surface.
 *
 * Returns:
 *   {
 *     ok: true,
 *     generatedAt: ISO,
 *     summary: { total, registered, pending, notFiled, officeAction,
 *                abandonedOrExpired, supplemental, byUrgency },
 *     rows: TrademarkRow[],
 *     actionable: TrademarkRow[]   // top-5 non-low rows, urgency-first
 *   }
 *
 * Hard rules:
 *   - **Auth-gated.** `isAuthorized()` (session OR CRON_SECRET).
 *   - **Pure.** No external calls. The TM registry is hand-curated
 *     (see `src/lib/ops/uspto-trademarks.ts`); USPTO TESS scraping
 *     is intentionally NOT wired (brittle + paid API, manual update
 *     is cheaper).
 *   - **No fabrication.** When the manifest is empty the response
 *     honestly returns zero rows + a zero-everything summary.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  TRADEMARK_REGISTRY,
  buildTrademarkRows,
  pickActionableTrademarks,
  summarizeTrademarks,
} from "@/lib/ops/uspto-trademarks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const rows = buildTrademarkRows(TRADEMARK_REGISTRY, now);
  const summary = summarizeTrademarks(rows);
  const actionable = pickActionableTrademarks(rows, { limit: 5 });

  return NextResponse.json({
    ok: true,
    generatedAt: now.toISOString(),
    summary,
    rows,
    actionable,
  });
}
