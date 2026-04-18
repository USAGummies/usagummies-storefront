/**
 * Control-plane operator route: append + list PolicyViolation entries.
 *
 * POST — append a violation. Caller provides the fields; the route
 *        stamps a fresh id + createdAt. Shape matches types.PolicyViolation.
 *
 * GET  — window + optional agent-id filter. Returns violations in the
 *        [since, until] window sorted by detectedAt asc.
 *
 * Auth: bearer CRON_SECRET.
 *
 * Canonical contract: /contracts/governance.md §5 (weekly drift audit
 * consumes this store) + §6 (correction protocol). Blueprint §15.4
 * T6 audit-mirroring — this store is the upstream feed.
 */

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { violationStore } from "@/lib/ops/control-plane/stores";
import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";
import type {
  DivisionId,
  PolicyViolation,
  ViolationKind,
} from "@/lib/ops/control-plane/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KNOWN_KINDS: ViolationKind[] = [
  "fabricated_data",
  "unapproved_write",
  "prohibited_action",
  "stale_data",
  "missing_citation",
  "duplicate_output",
  "wrong_channel",
];

type AppendBody = {
  runId?: string;
  agentId?: string;
  division?: DivisionId;
  kind?: ViolationKind;
  detail?: string;
  detectedBy?: PolicyViolation["detectedBy"];
  remediation?: string;
};

export async function POST(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  let body: AppendBody;
  try {
    body = (await req.json()) as AppendBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const missing: string[] = [];
  if (!body.agentId) missing.push("agentId");
  if (!body.division) missing.push("division");
  if (!body.kind) missing.push("kind");
  if (!body.detail) missing.push("detail");
  if (missing.length > 0) {
    return NextResponse.json(
      { error: "Missing required field(s)", missing },
      { status: 400 },
    );
  }
  if (!KNOWN_KINDS.includes(body.kind!)) {
    return NextResponse.json(
      { error: "Unknown violation kind", allowed: KNOWN_KINDS },
      { status: 400 },
    );
  }

  const detectedBy: PolicyViolation["detectedBy"] = body.detectedBy ?? "human-correction";
  if (!["self-check", "drift-audit", "human-correction"].includes(detectedBy)) {
    return NextResponse.json(
      {
        error: "Invalid detectedBy",
        allowed: ["self-check", "drift-audit", "human-correction"],
      },
      { status: 400 },
    );
  }

  const violation: PolicyViolation = {
    id: randomUUID(),
    runId: body.runId ?? randomUUID(),
    agentId: body.agentId!,
    division: body.division!,
    kind: body.kind!,
    detail: body.detail!,
    detectedBy,
    detectedAt: new Date().toISOString(),
    remediation: body.remediation,
  };

  try {
    await violationStore().append(violation);
  } catch (err) {
    return NextResponse.json(
      {
        error: "violation store unavailable",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, violation });
}

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();
  const url = new URL(req.url);
  const windowDays = clampInt(url.searchParams.get("windowDays"), 1, 90, 7);
  const agentId = url.searchParams.get("agentId");
  const now = new Date();
  const until = now.toISOString();
  const since = new Date(now.getTime() - windowDays * 86_400_000).toISOString();

  try {
    const all = await violationStore().listInWindow(since, until);
    const filtered = agentId ? all.filter((v) => v.agentId === agentId) : all;
    return NextResponse.json({
      ok: true,
      window: { since, until, windowDays },
      count: filtered.length,
      violations: filtered,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "violation store unavailable",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    );
  }
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}
