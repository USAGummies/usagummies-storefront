/**
 * GET /api/ops/sales/pipeline-evidence/[dealId]
 *
 * Read-only verified state for a single HubSpot deal. Returns:
 *   - the evidence trail (all rows for this dealId)
 *   - the verified state (highest stage, verification status,
 *     missing-evidence list, conversion timestamps, blocker, revenue
 *     status)
 *   - the transition log (when stages actually changed)
 *
 * Optional ?claimedStage=<stage> param triggers drift comparison.
 *
 * Auth-gated; never mutates HubSpot.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  PIPELINE_STAGES,
  type PipelineStage,
} from "@/lib/sales/pipeline-evidence";
import {
  listPipelineEvidence,
  listPipelineTransitions,
} from "@/lib/sales/pipeline-evidence-store";
import { verifyPipelineState } from "@/lib/sales/pipeline-verifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STAGES = new Set<string>(PIPELINE_STAGES);

interface RouteParams {
  params: Promise<{ dealId: string }>;
}

export async function GET(req: Request, ctx: RouteParams): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { dealId } = await ctx.params;
  if (!dealId) {
    return NextResponse.json({ error: "dealId required" }, { status: 400 });
  }
  const url = new URL(req.url);
  const claimedStageParam = url.searchParams.get("claimedStage");
  let claimedStage: PipelineStage | null = null;
  if (claimedStageParam) {
    if (!VALID_STAGES.has(claimedStageParam)) {
      return NextResponse.json(
        {
          error: `claimedStage must be one of: ${PIPELINE_STAGES.join(", ")}`,
        },
        { status: 400 },
      );
    }
    claimedStage = claimedStageParam as PipelineStage;
  }

  const [evRes, txRes] = await Promise.all([
    listPipelineEvidence(dealId),
    listPipelineTransitions(dealId),
  ]);
  const verified = verifyPipelineState({
    dealId,
    evidence: evRes.evidence,
    claimedStage,
    transitions: txRes.transitions,
  });
  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    dealId,
    evidence: evRes.evidence,
    transitions: txRes.transitions,
    verified,
    degraded: [...evRes.degraded, ...txRes.degraded],
  });
}
