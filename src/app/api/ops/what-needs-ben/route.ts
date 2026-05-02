/**
 * GET /api/ops/what-needs-ben
 *
 * Master cross-department posture roll-up. Fetches each lane summary
 * concurrently fail-soft and returns the aggregated `WhatNeedsBenSummary`.
 *
 * Read-only:
 *   - Auth-gated.
 *   - Never opens approvals, sends, mutates Gmail/HubSpot/QBO/Shopify.
 *   - Each lane fetch is independently fail-soft → degraded list.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { fetchWhatNeedsBenInputs } from "@/lib/ops/what-needs-ben-fetch";
import { summarizeWhatNeedsBen } from "@/lib/ops/what-needs-ben";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const inputs = await fetchWhatNeedsBenInputs();
  const summary = summarizeWhatNeedsBen({
    ...inputs,
    degraded: inputs.degraded,
    now: new Date(),
  });

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    summary,
    notes: {
      lanes: ["shipping", "finance", "email", "sales", "proposals", "marketing"],
      doctrine:
        "Build 2 close-out per docs/SYSTEM_BUILD_CONTINUATION_BLUEPRINT.md §4. Master cross-department roll-up.",
    },
  });
}
