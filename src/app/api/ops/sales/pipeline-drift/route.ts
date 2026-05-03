/**
 * GET /api/ops/sales/pipeline-drift
 *
 * Surfaces deals where HubSpot's pipeline stage runs ahead of the
 * verified-evidence stage. The body posts a list of HubSpot deals +
 * each deal's claimed stage (the operator surface fetches from
 * HubSpot, then asks us to verify).
 *
 * Read-only. No HubSpot mutation. Caller is responsible for the
 * HubSpot fetch — this endpoint only verifies what they pass in.
 *
 * Returns:
 *   - drifted[]    — drift envelopes for each mismatched deal
 *   - verified[]   — verified-state for every deal we evaluated
 *   - summary      — counts by drift severity (1-step / 2-step / 3+ /
 *                    no-evidence) + total + clean count
 *
 * Hard rules:
 *   - Auth-gated.
 *   - Never opens approvals, never mutates HubSpot.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  PIPELINE_STAGES,
  type PipelineStage,
} from "@/lib/sales/pipeline-evidence";
import { listPipelineEvidence } from "@/lib/sales/pipeline-evidence-store";
import {
  detectPipelineDrift,
  verifyPipelineState,
  type PipelineDrift,
} from "@/lib/sales/pipeline-verifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STAGES = new Set<string>(PIPELINE_STAGES);

interface DealClaim {
  dealId: string;
  hubspotStage: PipelineStage;
  /** Optional metadata for the response card. */
  dealName?: string;
}

interface DriftSummary {
  total: number;
  clean: number;
  driftCount: number;
  bySeverity: { oneStep: number; twoStep: number; threePlusStep: number; noEvidence: number };
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { deals?: DealClaim[] };
  try {
    body = (await req.json()) as { deals?: DealClaim[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const deals = Array.isArray(body.deals) ? body.deals : [];
  if (deals.length === 0) {
    return NextResponse.json(
      { error: "deals[] required (each: {dealId, hubspotStage})" },
      { status: 400 },
    );
  }

  // Validate each deal claim before doing any KV work.
  for (const d of deals) {
    if (!d || typeof d !== "object" || !d.dealId || !d.hubspotStage) {
      return NextResponse.json(
        { error: "every deal needs {dealId, hubspotStage}" },
        { status: 400 },
      );
    }
    if (!VALID_STAGES.has(d.hubspotStage)) {
      return NextResponse.json(
        {
          error: `hubspotStage must be one of: ${PIPELINE_STAGES.join(", ")}`,
        },
        { status: 400 },
      );
    }
  }

  const drifted: Array<PipelineDrift & { dealName?: string }> = [];
  const verifiedAll: Array<{
    dealId: string;
    dealName?: string;
    verifiedStage: PipelineStage | null;
    verification: string;
  }> = [];
  const degraded: string[] = [];

  for (const claim of deals) {
    const evRes = await listPipelineEvidence(claim.dealId);
    if (evRes.degraded.length > 0) {
      degraded.push(...evRes.degraded.map((d) => `${claim.dealId}:${d}`));
    }
    const verified = verifyPipelineState({
      dealId: claim.dealId,
      evidence: evRes.evidence,
      claimedStage: claim.hubspotStage,
    });
    verifiedAll.push({
      dealId: claim.dealId,
      dealName: claim.dealName,
      verifiedStage: verified.verifiedStage,
      verification: verified.verification,
    });
    const drift = detectPipelineDrift({
      dealId: claim.dealId,
      hubspotStage: claim.hubspotStage,
      verifiedState: verified,
    });
    if (drift) {
      drifted.push({ ...drift, dealName: claim.dealName });
    }
  }

  const summary: DriftSummary = {
    total: deals.length,
    clean: deals.length - drifted.length,
    driftCount: drifted.length,
    bySeverity: {
      oneStep: drifted.filter((d) => d.driftSteps === 1).length,
      twoStep: drifted.filter((d) => d.driftSteps === 2).length,
      threePlusStep: drifted.filter((d) => d.driftSteps >= 3).length,
      noEvidence: drifted.filter((d) => d.verifiedStage === null).length,
    },
  };

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    summary,
    drifted,
    verified: verifiedAll,
    degraded,
  });
}
