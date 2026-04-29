/**
 * Approval-Expiry Sweeper HTTP endpoint — P0-5.
 *
 * Schedule (when wired): hourly. The pure functions in
 * `src/lib/ops/control-plane/approvals.ts` (`shouldEscalate`,
 * `checkExpiry`) define the 24h / 72h windows from blueprint §5.2;
 * this endpoint runs them across the live pending queue.
 *
 * Auth: bearer CRON_SECRET (same convention as `/api/ops/control-plane/
 * drift-audit`, `/api/ops/operating-memory/drift`, etc.).
 *
 * Class A only — never executes the underlying Class B/C action; only
 * persists the `expired` terminal state (already-allowed per
 * `ApprovalStatus`) and emits audit envelopes for sweep events.
 *
 * To wire on Vercel Cron, add to `vercel.json`:
 *   { "path": "/api/ops/control-plane/approval-sweep", "schedule": "22 * * * *" }
 *
 * The legacy `/api/ops/sweeps/[sweep]/route.ts` returns
 * `{disabled:true}` and is dead since the Abra retirement; the QStash
 * `abra-approval-expiry` schedule pointing at it is dormant config —
 * cleanup is a separate operator concern.
 */

import { NextResponse } from "next/server";

import {
  isCronAuthorized,
  unauthorized,
} from "@/lib/ops/control-plane/admin-auth";
import { auditStore, approvalStore } from "@/lib/ops/control-plane/stores";
import { auditSurface } from "@/lib/ops/control-plane/slack";

import { runApprovalExpirySweep } from "@/lib/ops/sweeps/approval-expiry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return runSweep(req);
}

export async function POST(req: Request): Promise<Response> {
  return runSweep(req);
}

async function runSweep(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();
  try {
    const report = await runApprovalExpirySweep({
      approvalStore: approvalStore(),
      auditStore: auditStore(),
      auditSurface: auditSurface(),
    });
    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
