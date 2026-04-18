/**
 * Weekly drift audit HTTP endpoint.
 *
 * Schedule: Sunday 8 PM PT (configured out-of-band via Vercel cron or
 * QStash — see /ops/blocked-items.md). The endpoint is idempotent-ish:
 * each run generates a fresh scorecard id; repeated calls inside the
 * same window just produce additional scorecards in the audit trail.
 *
 * Auth: bearer CRON_SECRET (same convention as /api/ops/qbo/* routes).
 *
 * Canonical spec: /contracts/governance.md §5 + blueprint §15.4 W3b.
 */

import { NextResponse } from "next/server";

import { runDriftAudit } from "@/lib/ops/control-plane/drift-audit";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { auditSurface } from "@/lib/ops/control-plane/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false; // fail-closed if the secret isn't configured
  const header = req.headers.get("authorization") ?? "";
  // Accept both `Bearer <token>` and the raw token (some cron senders omit the scheme).
  const supplied = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : header.trim();
  if (!supplied) return false;
  // Timing-safe compare.
  if (supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < supplied.length; i++) {
    diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Query params let the operator override defaults for ad-hoc runs.
  const url = new URL(req.url);
  const sampleSize = clampInt(url.searchParams.get("sampleSize"), 1, 100, 10);
  const windowDays = clampInt(url.searchParams.get("windowDays"), 1, 30, 7);

  // NOTE: violations + corrections come from stores that are not yet wired
  // (Open Brain integration is a later task — /ops/blocked-items.md tracks
  // this). For now the audit still surfaces the sample + would auto-pause
  // any agent whose violations the caller injects explicitly. Day-one this
  // is strictly better than the silent pass Sunday standup used to emit.
  const scorecard = await runDriftAudit({
    store: auditStore(),
    surface: auditSurface(),
    sampleSize,
    windowDays,
    violations: [], // TODO(open-brain): fetch from violations store
    correctionsCount: 0, // TODO(open-brain): fetch from corrections store
  });

  return NextResponse.json({ ok: true, scorecard });
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}
