/**
 * Control-plane operator route: append + count CorrectionEvent entries.
 *
 * POST — append a correction. Schema is CorrectionEvent. Used by Ben /
 *        Rene / Drew when they correct an agent (per /contracts/governance.md §6).
 *
 * GET  — count corrections in a window. No agent filter at this route —
 *        CorrectionStore.countInWindow() exposes total count only. If
 *        per-agent correction tracking is needed later, extend the
 *        store interface (listInWindow or countByAgent) first.
 *
 * Auth: bearer CRON_SECRET.
 */

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { correctionStore } from "@/lib/ops/control-plane/stores";
import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";
import type {
  CorrectionEvent,
} from "@/lib/ops/control-plane/enforcement";
import type { DivisionId, HumanOwner } from "@/lib/ops/control-plane/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KNOWN_OWNERS: HumanOwner[] = ["Ben", "Rene", "Drew"];

type AppendBody = {
  agentId?: string;
  division?: DivisionId;
  field?: string;
  wrongValue?: unknown;
  correctValue?: unknown;
  correctedBy?: HumanOwner;
  note?: string;
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
  if (!body.correctedBy) missing.push("correctedBy");
  if (missing.length > 0) {
    return NextResponse.json(
      { error: "Missing required field(s)", missing },
      { status: 400 },
    );
  }
  if (!KNOWN_OWNERS.includes(body.correctedBy!)) {
    return NextResponse.json(
      { error: "Unknown correctedBy", allowed: KNOWN_OWNERS },
      { status: 400 },
    );
  }

  const correction: CorrectionEvent = {
    id: randomUUID(),
    at: new Date().toISOString(),
    agentId: body.agentId!,
    division: body.division!,
    field: body.field,
    wrongValue: body.wrongValue,
    correctValue: body.correctValue,
    correctedBy: body.correctedBy!,
    note: body.note,
  };

  try {
    await correctionStore().append(correction);
  } catch (err) {
    return NextResponse.json(
      {
        error: "correction store unavailable",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, correction });
}

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();
  const url = new URL(req.url);
  const windowDays = clampInt(url.searchParams.get("windowDays"), 1, 90, 7);
  const now = new Date();
  const until = now.toISOString();
  const since = new Date(now.getTime() - windowDays * 86_400_000).toISOString();

  try {
    const count = await correctionStore().countInWindow(since, until);
    return NextResponse.json({
      ok: true,
      window: { since, until, windowDays },
      count,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "correction store unavailable",
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
