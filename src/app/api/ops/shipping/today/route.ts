/**
 * GET /api/ops/shipping/today
 *
 * Browser-parity surface for the `shipping today` Slack card. Same
 * pattern as /api/ops/finance/today + /api/ops/marketing/today —
 * read-only, fail-soft per source.
 *
 * Hard rules:
 *   - Auth-gated.
 *   - Read-only: never enqueues retries, never buys labels, never
 *     mutates wallet, never opens approvals.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { fetchShippingTodayInputs } from "@/lib/ops/shipping-today-fetch";
import { summarizeShippingToday } from "@/lib/ops/shipping-today";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const inputs = await fetchShippingTodayInputs();
  const summary = summarizeShippingToday({
    retryQueue: inputs.retryQueue,
    pendingApprovals: inputs.pendingApprovals,
    wallet: inputs.wallet,
    degraded: inputs.degraded,
    now: new Date(),
  });

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    summary,
    notes: {
      sources: [
        "readRetryQueue() — fulfillment:dispatch-retry-queue KV",
        "approvalStore.listPending() — production-supply-chain division only",
        "getShipStationWalletBalance(stamps_com|ups_walleted)",
      ],
    },
  });
}
