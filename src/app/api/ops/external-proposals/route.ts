/**
 * /api/ops/external-proposals — Build 8 inbound + read endpoint.
 *
 * POST: external tools (Polsia / Sola / Reevo / OpenAI workspace /
 *       Claude Code / Codex) register a proposal. Body must validate
 *       against `validateExternalProposalInput`. Mutation-verb claims
 *       are auto-flagged + downgraded to `risk_class: approval_required`.
 *       Returns the persisted record.
 *
 * GET:  reads recent proposals (newest first) + a roll-up summary.
 *
 * Hard rules:
 *   - Auth-gated: `isAuthorized()` (session OR bearer CRON_SECRET).
 *   - Read-only on every external system. The repo never executes
 *     a proposal directly; promotion to runtime happens via the
 *     existing `canonical approval` Class B/C flow on the repo side.
 *   - No Gmail / HubSpot / QBO / Shopify / Meta imports allowed
 *     in this route file (locked by source-guard test).
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  appendExternalProposal,
  listExternalProposals,
  summarizeExternalProposals,
  validateExternalProposalInput,
} from "@/lib/ops/external-proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const validated = validateExternalProposalInput(raw);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  try {
    const record = await appendExternalProposal(
      validated.input,
      validated.flags,
    );
    return NextResponse.json({
      ok: true,
      record,
      flags: validated.flags,
      effectiveRiskClass: validated.effectiveRiskClass,
    });
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

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  let limit: number | undefined;
  if (limitParam) {
    const parsed = Number.parseInt(limitParam, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json(
        { error: "limit must be a positive integer" },
        { status: 400 },
      );
    }
    limit = parsed;
  }
  const { records, degraded } = await listExternalProposals({ limit });
  const summary = summarizeExternalProposals(records);
  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    summary,
    records,
    degraded,
  });
}
