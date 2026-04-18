/**
 * POST /api/ops/control-plane/unpause
 *
 * Remove an agent from the paused set. Ben is the only human who may
 * unpause per /contracts/governance.md §6.2 (graduation / pause lifecycle).
 *
 * Auth (tier 2):
 *   `X-Admin-Authorization: Bearer <CONTROL_PLANE_ADMIN_SECRET>`
 *   (NOT the scheduled-job CRON_SECRET — see admin-auth.ts for the rationale).
 *   Fail-closed 401 if the admin secret env var is missing or the
 *   header is absent/wrong.
 *
 * Body: { agentId: string, reason: string }
 *   A caller-supplied `actor` field is IGNORED. Unpause is always
 *   attributed to "Ben" because that is the only human who holds the
 *   admin secret; trusting a body-supplied actor would let any caller
 *   with the admin secret attribute the action to Rene or Drew.
 *
 * Side effects:
 *   1. pauseSink.unpauseAgent(agentId, reason)
 *   2. Writes a runtime.agent-unpaused human audit entry (actorId=Ben)
 *      so the unpause is observable + attributable.
 */

import { NextResponse } from "next/server";

import { buildHumanAuditEntry } from "@/lib/ops/control-plane/audit";
import { auditStore, pauseSink } from "@/lib/ops/control-plane/stores";
import { isAdminAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  agentId?: string;
  reason?: string;
  // `actor` is deliberately not part of the type — body-supplied actor
  // is ignored by the route. If someone sends one, the server pretends
  // it isn't there.
};

const AUTHORIZED_ACTOR = "Ben" as const;

export async function POST(req: Request): Promise<Response> {
  if (!isAdminAuthorized(req)) return unauthorized();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const missing: string[] = [];
  if (!body.agentId) missing.push("agentId");
  if (!body.reason) missing.push("reason");
  if (missing.length > 0) {
    return NextResponse.json(
      { error: "Missing required field(s)", missing },
      { status: 400 },
    );
  }

  const actor = AUTHORIZED_ACTOR;
  const sink = pauseSink();

  let wasPaused = false;
  let priorRecord = null;
  try {
    wasPaused = await sink.isPaused(body.agentId!);
    if (wasPaused) {
      const all = await sink.listPaused();
      priorRecord = all.find((r) => r.agentId === body.agentId) ?? null;
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: "pause sink unavailable",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    );
  }

  if (!wasPaused) {
    return NextResponse.json(
      {
        ok: false,
        error: "not-paused",
        message: `Agent ${body.agentId} is not currently paused. Nothing to do.`,
      },
      { status: 409 },
    );
  }

  try {
    await sink.unpauseAgent(body.agentId!, body.reason!);
  } catch (err) {
    return NextResponse.json(
      {
        error: "unpause failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    );
  }

  // Audit — human-authored. actorId is hardcoded "Ben" regardless of
  // body content; admin-tier auth is the evidence that Ben (or his
  // delegate with the admin secret) initiated this.
  try {
    await auditStore().append(
      buildHumanAuditEntry({
        runId: priorRecord?.scorecardId ?? body.agentId!,
        division: priorRecord?.division ?? "executive-control",
        actorId: actor,
        action: "runtime.agent-unpaused",
        entityType: "agent",
        entityId: body.agentId!,
        before: priorRecord,
        after: { unpausedAt: new Date().toISOString(), reason: body.reason },
        result: "ok",
        sourceCitations: [{ system: "control-plane-admin" }],
      }),
    );
  } catch {
    // Audit failure is not-fatal for the unpause itself but should be
    // investigated. It will show up on the health endpoint.
  }

  return NextResponse.json({
    ok: true,
    agentId: body.agentId,
    reason: body.reason,
    actor,
    priorRecord,
  });
}
