/**
 * GET /api/ops/marketing/today
 *
 * Browser-parity surface for the `marketing today` Slack card. Same
 * shape as `/api/ops/finance/today` — read-only, fail-soft.
 *
 * Hard rules:
 *   - Auth-gated: `isAuthorized()` (session OR bearer CRON_SECRET).
 *   - Read-only: never publishes creative, never launches/changes
 *     ad spend, never writes to Meta/Google/TikTok ad APIs.
 *   - Fail-soft per platform: an errored platform appears with
 *     `status: "error"` + `fetchError`; the rest still load.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { approvalStore } from "@/lib/ops/control-plane/stores";
import { fetchMarketingPlatforms } from "@/lib/ops/marketing-today-fetch";
import { summarizeMarketingToday } from "@/lib/ops/marketing-today";
import type { ApprovalRequest } from "@/lib/ops/control-plane/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const degraded: string[] = [];

  let approvals: ApprovalRequest[] = [];
  try {
    approvals = await approvalStore().listPending();
  } catch (err) {
    degraded.push(
      `approvals:${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const platformFetch = await fetchMarketingPlatforms();

  const summary = summarizeMarketingToday({
    platforms: platformFetch.platforms,
    pendingApprovals: approvals,
    degraded: [...degraded, ...platformFetch.degraded],
    now: new Date(),
  });

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    summary,
    notes: {
      sources: [
        "fetchMarketingPlatforms() — Meta live; Google/TikTok config-only at this layer",
        "approvalStore.listPending() — marketing-{brand,paid} divisions only",
      ],
      doctrine: "/contracts/approval-taxonomy.md",
    },
  });
}
