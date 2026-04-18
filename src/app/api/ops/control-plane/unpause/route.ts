/**
 * POST /api/ops/control-plane/unpause
 *
 * Remove an agent from the paused set. Ben is the only human who may
 * unpause (blueprint §6.2). This route does NOT enforce that — the
 * auth gate is CRON_SECRET — so it's intended for the Ben-authored
 * unpause script. When the Slack approval route is wired for unpause
 * (Class B `agent.unpause` slug, not registered yet), callers should
 * move to that path.
 *
 * Body: { agentId: string, reason: string }
 *
 * Side effects:
 *   1. pauseSink.unpauseAgent(agentId, reason)
 *   2. Writes a runtime.agent-unpaused audit entry with before/after
 *      metadata so the unpause is observable, not silent.
 *
 * Auth: bearer CRON_SECRET.
 */

import { NextResponse } from "next/server";

import { buildHumanAuditEntry } from "@/lib/ops/control-plane/audit";
import { auditStore, pauseSink } from "@/lib/ops/control-plane/stores";
import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";
import type { HumanOwner } from "@/lib/ops/control-plane/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  agentId?: string;
  reason?: string;
  actor?: HumanOwner;
};

export async function POST(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

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

  const actor: HumanOwner = body.actor ?? "Ben";
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

  // Audit — human-authored since unpause is an explicit human decision.
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
