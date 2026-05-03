/**
 * POST /api/ops/sales/pipeline-evidence
 *
 * Append a pipeline-evidence row for a HubSpot deal. Required fields:
 *   { dealId, stage, evidenceType, source, sourceId, evidenceAt,
 *     actor, confidence, url?, note? }
 *
 * Validates against the canonical schema:
 *   - stage ∈ PIPELINE_STAGES
 *   - evidenceType ∈ EVIDENCE_TYPES_BY_STAGE[stage]  (HARD: an evidence
 *     row must match its stage's allowlist; otherwise the verifier
 *     would silently ignore it later)
 *   - confidence clamped to [0, 1]
 *
 * Idempotent: re-posting the same { stage, source, sourceId,
 * evidenceType } returns the existing row.
 *
 * Hard rules:
 *   - Auth-gated.
 *   - Read+write to KV only — never mutates HubSpot, never sends Gmail,
 *     never opens an approval. Recording evidence is a strictly local
 *     audit operation; promoting the deal stage is a separate Class C
 *     `hubspot.deal.stage.move` step that consumes this evidence.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  EVIDENCE_TYPES_BY_STAGE,
  PIPELINE_STAGES,
  type PipelineStage,
} from "@/lib/sales/pipeline-evidence";
import { appendPipelineEvidence } from "@/lib/sales/pipeline-evidence-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STAGES = new Set<string>(PIPELINE_STAGES);

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const dealId = strField(body.dealId, 200);
  if (!dealId) {
    return NextResponse.json({ error: "dealId required" }, { status: 400 });
  }
  const stage = body.stage as string;
  if (!VALID_STAGES.has(stage)) {
    return NextResponse.json(
      {
        error: `stage must be one of: ${PIPELINE_STAGES.join(", ")}`,
      },
      { status: 400 },
    );
  }
  const evidenceType = body.evidenceType as string;
  const allowed = EVIDENCE_TYPES_BY_STAGE[stage as PipelineStage] ?? [];
  if (!(allowed as ReadonlyArray<string>).includes(evidenceType)) {
    return NextResponse.json(
      {
        error: `evidenceType "${evidenceType}" is not valid for stage "${stage}". Allowed: ${allowed.join(", ")}`,
      },
      { status: 400 },
    );
  }
  const source = strField(body.source, 80);
  if (!source) {
    return NextResponse.json({ error: "source required" }, { status: 400 });
  }
  const sourceId = strField(body.sourceId, 200);
  if (!sourceId) {
    return NextResponse.json(
      { error: "sourceId required" },
      { status: 400 },
    );
  }
  const evidenceAt = strField(body.evidenceAt, 40);
  if (!evidenceAt || Number.isNaN(Date.parse(evidenceAt))) {
    return NextResponse.json(
      { error: "evidenceAt must be an ISO timestamp" },
      { status: 400 },
    );
  }
  const actor = strField(body.actor, 80);
  if (!actor) {
    return NextResponse.json({ error: "actor required" }, { status: 400 });
  }
  const confidence =
    typeof body.confidence === "number" ? body.confidence : 0.5;

  try {
    const row = await appendPipelineEvidence({
      dealId,
      stage: stage as PipelineStage,
      evidenceType: evidenceType as never,
      source,
      sourceId,
      url: strField(body.url, 500) || undefined,
      evidenceAt,
      actor,
      confidence,
      note: strField(body.note, 1000) || undefined,
    });
    return NextResponse.json({ ok: true, evidence: row });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

function strField(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const t = v.trim();
  if (!t) return "";
  return t.length > max ? t.slice(0, max) : t;
}
