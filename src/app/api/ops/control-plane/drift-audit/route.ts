/**
 * Weekly drift audit HTTP endpoint.
 *
 * Schedule: Sunday 8 PM PT (configured out-of-band via Vercel cron or
 * QStash — see /ops/blocked-items.md). Each run generates a fresh
 * scorecard id; repeated calls inside the same window just produce
 * additional scorecards in the audit trail.
 *
 * Auth: bearer CRON_SECRET (same convention as /api/ops/qbo/* routes).
 *
 * Canonical spec: /contracts/governance.md §5 + blueprint §15.4 W3b.
 */

import { NextResponse } from "next/server";

import { runDriftAudit } from "@/lib/ops/control-plane/drift-audit";
import {
  auditStore,
  correctionStore,
  pauseSink,
  violationStore,
} from "@/lib/ops/control-plane/stores";
import { auditSurface } from "@/lib/ops/control-plane/slack";
import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";
import type { PolicyViolation } from "@/lib/ops/control-plane/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  // Query params let the operator override defaults for ad-hoc runs.
  const url = new URL(req.url);
  const sampleSize = clampInt(url.searchParams.get("sampleSize"), 1, 100, 10);
  const windowDays = clampInt(url.searchParams.get("windowDays"), 1, 30, 7);

  const now = new Date();
  const windowStart = new Date(now.getTime() - windowDays * 86_400_000).toISOString();
  const windowEnd = now.toISOString();

  // ---- Resolve enforcement inputs ----
  //
  // The route pulls violations + corrections from their real stores and
  // passes them to the runner. If either store is unreachable OR has
  // never been written to, we mark the run as degraded in the response
  // envelope so the caller cannot interpret an empty-violations outcome
  // as "everything is clean."

  const degradedReasons: string[] = [];
  const degradations: Record<string, string> = {};
  let violations: PolicyViolation[] = [];
  let correctionsCount = 0;
  let violationsEverRecorded = false;
  let correctionsEverRecorded = false;

  try {
    const vs = violationStore();
    violations = await vs.listInWindow(windowStart, windowEnd);
    violationsEverRecorded = await vs.hasAnyEverRecorded();
    if (!violationsEverRecorded) {
      degradedReasons.push(
        "violation store has never recorded an entry — auto-pause cannot fire until agents or reviewers start appending policy violations.",
      );
      degradations.violationStore = "never-populated";
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    degradedReasons.push(`violation store unreachable: ${msg}`);
    degradations.violationStore = "unreachable";
  }

  try {
    const cs = correctionStore();
    correctionsCount = await cs.countInWindow(windowStart, windowEnd);
    correctionsEverRecorded = await cs.hasAnyEverRecorded();
    if (!correctionsEverRecorded) {
      degradedReasons.push(
        "correction store has never recorded an entry — human-correction counts are structurally zero, not measured-zero.",
      );
      degradations.correctionStore = "never-populated";
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    degradedReasons.push(`correction store unreachable: ${msg}`);
    degradations.correctionStore = "unreachable";
  }

  // PauseSink: if the factory throws on construction (KV unreachable in
  // cloud mode) we fall back to running without enforcement rather than
  // crashing the audit. This is still surfaced as degraded.
  let sink: ReturnType<typeof pauseSink> | null = null;
  try {
    sink = pauseSink();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    degradedReasons.push(`pause sink unavailable: ${msg}. Auto-pause cannot be persisted this run.`);
    degradations.pauseSink = "unreachable";
    sink = null;
  }

  const scorecard = await runDriftAudit({
    store: auditStore(),
    surface: auditSurface(),
    pauseSink: sink ?? null,
    sampleSize,
    windowDays,
    now,
    violations,
    correctionsCount,
  });

  const degraded = degradedReasons.length > 0;
  return NextResponse.json({
    ok: true,
    degraded,
    degradedReasons,
    enforcement: {
      violationStore: degradations.violationStore ?? "healthy",
      correctionStore: degradations.correctionStore ?? "healthy",
      pauseSink: degradations.pauseSink ?? (sink ? "healthy" : "unavailable"),
      inWindowViolations: violations.length,
      inWindowCorrections: correctionsCount,
      violationsEverRecorded,
      correctionsEverRecorded,
    },
    scorecard,
  });
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}
