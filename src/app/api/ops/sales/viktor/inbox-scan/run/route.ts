/**
 * Phase 37.1 — Inbox Scanner cron route (Viktor capability).
 *
 * Per /contracts/email-agents-system.md §2.1 + §9.1:
 *   - Runtime owner: Viktor (sales). NOT a new top-level agent.
 *   - Class A `system.read` only — no email send, no HubSpot write.
 *   - Cadence: every 5 minutes during weekday business hours
 *     (6 AM – 9 PM PT) per Ben's OQ-1 lock 2026-04-30 PM.
 *
 * Auth: middleware whitelist + isAuthorized fallback (CRON_SECRET bearer).
 *
 * Output: JSON `InboxScanReport` from `runInboxScanner()`. Side-effects:
 *   - One KV record per never-seen message id at `inbox:scan:<msgId>`.
 *   - Cursor advance at `email-intel:cursor:gmail` to max observed date.
 *   - One audit entry per run via `auditStore().append()`.
 *
 * Kill switch: `INBOX_SCANNER_ENABLED=false` env var pauses without
 * redeploy (mirrors the legacy `EMAIL_INTEL_ENABLED` pattern).
 *
 * NOTE: this route does NOT classify, draft, or escalate. Phase 37.2 is
 * the classifier; this is the bare scan-and-persist layer.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditStore } from "@/lib/ops/control-plane/stores";
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
  let error: string | undefined;

  try {
    report = await runInboxScanner({
      dryRun: body.dryRun,
      maxEmails: body.maxEmails,
    });
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
            { system: "contracts.email-agents-system", id: "§2.1" },
            { system: "phase", id: "37.1" },
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
  });
}
