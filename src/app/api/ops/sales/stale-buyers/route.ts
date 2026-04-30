/**
 * GET /api/ops/sales/stale-buyers
 *
 * Read-only endpoint returning the structured `StaleBuyerSummary` slice
 * that the morning daily-brief surfaces. Companion to `/api/ops/sales`
 * (Sales Command Center aggregator) — separate route because chase
 * tooling and per-deal CLI prep want the full `stalest[]` array, not
 * the summary counts.
 *
 * Hard rules (mirror `/api/ops/sales`):
 *   - Read-only. No KV / HubSpot / Slack / QBO / Shopify mutation.
 *   - Auth: middleware blocks unauthenticated `/api/ops/*`;
 *     `isAuthorized()` rechecks (session OR CRON_SECRET).
 *   - Fail-soft on HubSpot errors — returns `{ ok: false, error }` not
 *     a 500. The chase-prep CLI handles the degraded path.
 *   - No fabrication: when HubSpot is unreachable the response is
 *     empty stalest[] with `degraded: true`, not made-up deals.
 *
 * Backed by the same `summarizeStaleBuyers()` + `listRecentDeals()`
 * pipeline that the daily-brief route uses (see
 * `src/app/api/ops/daily-brief/route.ts` ~line 348). Single source of
 * truth — no parallel implementations.
 *
 * Caller: `scripts/sales/chase-stale-buyers.mjs` chase-prep CLI.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { HUBSPOT, listRecentDeals } from "@/lib/ops/hubspot-client";
import {
  summarizeStaleBuyers,
  type HubSpotDealForStaleness,
  type StaleBuyerSummary,
} from "@/lib/sales/stale-buyer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StaleBuyersResponse {
  ok: boolean;
  generatedAt: string;
  /** Full stalest[] array — no top-N truncation server-side. The
   *  daily-brief renderer caps at 3 for Slack, but tools want all. */
  summary: StaleBuyerSummary | null;
  degraded: boolean;
  degradedReasons: string[];
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const generatedAt = now.toISOString();
  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "200"), 1),
    500,
  );

  const degradedReasons: string[] = [];
  let summary: StaleBuyerSummary | null = null;

  try {
    const deals = await listRecentDeals({ limit });
    const retrievedAt = new Date().toISOString();
    const adapted: HubSpotDealForStaleness[] = deals.map((d) => ({
      id: d.id,
      dealname: d.dealname || null,
      pipelineId: HUBSPOT.PIPELINE_B2B_WHOLESALE,
      stageId: d.dealstage,
      lastActivityAt: d.lastmodifieddate || null,
      primaryContactId: null,
      primaryCompanyName: null,
    }));
    summary = summarizeStaleBuyers(adapted, now, retrievedAt);
  } catch (err) {
    degradedReasons.push(
      `hubspot-deals: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const body: StaleBuyersResponse = {
    ok: degradedReasons.length === 0,
    generatedAt,
    summary,
    degraded: degradedReasons.length > 0,
    degradedReasons,
  };
  return NextResponse.json(body);
}
