/**
 * Phase 37.1 + 37.2 — Inbox Scanner + Classifier cron route (Viktor).
 *
 * Per /contracts/email-agents-system.md §2.1 + §2.2 + §9.1:
 *   - Runtime owner: Viktor (sales). NOT a new top-level agent.
 *   - Class A `system.read` only — no email send, no HubSpot write,
 *     no spam-cleaner delete (37.7 owns that lane).
 *   - Cadence: every 5 minutes during weekday business hours
 *     (6 AM – 9 PM PT) per Ben's OQ-1 lock 2026-04-30 PM.
 *
 * Pipeline (one tick):
 *   1. Inbox scan (Phase 37.1) — list new envelopes, write `inbox:scan:<id>`
 *      records with status `received` / `received_noise`.
 *   2. Classifier (Phase 37.2) — classify the new records into the
 *      22 v1 categories (whale HARD STOP first), persist back at the
 *      same key with status `classified` / `classified_whale`.
 *
 * Auth: middleware whitelist + isAuthorized fallback (CRON_SECRET bearer).
 *
 * Kill switch: `INBOX_SCANNER_ENABLED=false` env var pauses both stages
 * without redeploy.
 *
 * NOTE: this route does NOT draft replies or open approvals. Drafting is
 * Phase 37.5 + 37.6 + 37.11; approvals are §2.5a (Phase 37.6).
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditStore } from "@/lib/ops/control-plane/stores";
import {
  runClassifier,
  type ClassifierReport,
} from "@/lib/sales/viktor/classifier";
import {
  runInboxScanner,
  type InboxScanReport,
} from "@/lib/sales/viktor/inbox-scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Cap aligns with the existing email-intel orchestrator (50 msgs * ~2s each).
export const maxDuration = 60;

interface RunBody {
  /** Skip writes / cursor advance — useful for diagnostics. */
  dryRun?: boolean;
  /** Override the per-run envelope cap (default 50). */
  maxEmails?: number;
}

export async function GET(req: Request): Promise<Response> {
  return run(req);
}

export async function POST(req: Request): Promise<Response> {
  return run(req);
}

async function run(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Kill switch — explicit `false` (case-insensitive) pauses; anything else runs.
  const enabledFlag = (process.env.INBOX_SCANNER_ENABLED ?? "true").trim().toLowerCase();
  if (enabledFlag === "false" || enabledFlag === "0" || enabledFlag === "off") {
    return NextResponse.json({
      ok: true,
      paused: true,
      reason: "INBOX_SCANNER_ENABLED=false",
    });
  }

  const startedAt = new Date();
  const runCtx = newRunContext({
    agentId: "viktor.inbox-scanner",
    division: "sales",
    source: "scheduled",
    trigger: "phase-37.1-inbox-scan",
  });

  let body: RunBody = {};
  if (req.method === "POST") {
    try {
      body = (await req.json()) as RunBody;
    } catch {
      // Tolerate empty/invalid bodies — cron pings come without JSON.
      body = {};
    }
  } else {
    const url = new URL(req.url);
    if (url.searchParams.get("dryRun") === "true") body.dryRun = true;
    const maxParam = url.searchParams.get("maxEmails");
    if (maxParam) {
      const parsed = Number.parseInt(maxParam, 10);
      if (Number.isFinite(parsed) && parsed > 0) body.maxEmails = parsed;
    }
  }

  let report: InboxScanReport | null = null;
  let classifierReport: ClassifierReport | null = null;
  let error: string | undefined;

  try {
    report = await runInboxScanner({
      dryRun: body.dryRun,
      maxEmails: body.maxEmails,
    });

    // Phase 37.2 — chain the classifier on whatever the scanner just
    // wrote. Scanner returns `newRecords` even in dry-run; the classifier
    // honors the dry-run flag too so neither stage mutates KV when off.
    if (report.newRecords.length > 0) {
      try {
        classifierReport = await runClassifier({
          records: report.newRecords,
          dryRun: body.dryRun,
        });
      } catch (err) {
        // Classifier failure does NOT fail the run — scanner output is
        // still useful, classifier-degraded is just a degraded note.
        const msg = err instanceof Error ? err.message : String(err);
        classifierReport = {
          examined: report.newRecords.length,
          classified: 0,
          skippedAlreadyClassified: 0,
          skippedNoise: 0,
          byCategory: {},
          whaleHits: 0,
          unclassified: 0,
          degraded: true,
          degradedNotes: [`runClassifier-threw: ${msg}`],
          classifiedRecords: [],
        };
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  // Audit — one entry per run. Fails-soft so a KV outage on the audit
  // store can't take down the scanner itself.
  try {
    await auditStore().append(
      buildAuditEntry(
        runCtx,
        {
          action: "system.read",
          entityType: "viktor.inbox-scan",
          entityId: runCtx.runId,
          result: report && !error ? "ok" : "error",
          after: report
            ? {
                envelopesFetched: report.envelopesFetched,
                recordsWritten: report.recordsWritten,
                byStatus: report.byStatus,
                alreadyKnown: report.alreadyKnown,
                capExceeded: report.capExceeded,
                degraded: report.degraded,
                cursorAdvanced: report.cursorAdvanced,
                cursorBefore: report.cursorBefore,
                cursorAfter: report.cursorAfter,
                classifier: classifierReport
                  ? {
                      examined: classifierReport.examined,
                      classified: classifierReport.classified,
                      whaleHits: classifierReport.whaleHits,
                      unclassified: classifierReport.unclassified,
                      byCategory: classifierReport.byCategory,
                      degraded: classifierReport.degraded,
                    }
                  : null,
              }
            : undefined,
          error: error
            ? { message: error, code: "inbox_scanner_failed" }
            : report?.degraded
              ? {
                  message: report.degradedNotes.join("; "),
                  code: "inbox_scanner_degraded",
                }
              : undefined,
          sourceCitations: [
            { system: "contracts.email-agents-system", id: "§2.1+§2.2+§3.1" },
            { system: "phase", id: "37.1+37.2" },
          ],
          confidence: 1,
        },
        startedAt,
      ),
    );
  } catch {
    // Audit-store failures are non-fatal — the run still returns its
    // report so the cron tick is observable in logs even when audit is
    // degraded.
  }

  if (error) {
    return NextResponse.json(
      { ok: false, runId: runCtx.runId, error },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    runId: runCtx.runId,
    report,
    classifier: classifierReport,
  });
}
