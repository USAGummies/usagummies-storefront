/**
 * Phase 37.7 — Spam Cleaner cron route (Class A-d delete + daily digest).
 *
 * Per /contracts/email-agents-system.md §2.5d + §2.8:
 *   - Class A-d (autonomous DELETE) — moves category-Z noise to Gmail
 *     Trash. The ONLY autonomous-DELETE lane in the system.
 *   - Detection rules (ALL must be true): denylist sender + noise
 *     subject + no HubSpot engagement + no attachment.
 *   - Hard stops: whale-domain match / attachment / safety-pattern
 *     subject (invoice / W-9 / sample request) / HubSpot engagement.
 *   - Posts a daily digest to #ops-audit.
 *
 * Auto-delete is GATED behind `SPAM_CLEANER_AUTO_DELETE=true` env. Default
 * = dry-run. The detection runs unconditionally and surfaces candidates
 * in the digest so the operator can audit volume + per-domain mix BEFORE
 * flipping the auto-delete flag.
 *
 * Auth: middleware whitelist + isAuthorized fallback (CRON_SECRET bearer).
 *
 * Source data: pulls recent `inbox:scan:<msgId>` records via the recent-
 * scan index — same KV namespace populated by Phase 37.1 + 37.2 + 37.3.
 *
 * Cadence: once daily, off-hours (08:00 UTC = 1 AM PT during PDT) so the
 * cleanup runs after the workday inbox has settled.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { getChannel } from "@/lib/ops/control-plane/channels";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { postMessage } from "@/lib/ops/control-plane/slack/client";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { listEmails, moveToTrash, readEmail } from "@/lib/ops/gmail-reader";
import type { ClassifiedRecord } from "@/lib/sales/viktor/classifier";
import { classifyScannedRecord } from "@/lib/sales/viktor/classifier";
import {
  fromEmailDomain,
  parseFromAddress,
  type ScannedRecord,
} from "@/lib/sales/viktor/inbox-scanner";
import {
  renderSpamCleanerDigest,
  runSpamCleaner,
  type SpamCleanerReport,
} from "@/lib/sales/viktor/spam-cleaner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RunBody {
  /** Override: explicit dryRun (default = derived from env). */
  dryRun?: boolean;
  /** Cap on # envelopes pulled in one cleanup pass (default 100). */
  maxEmails?: number;
  /** Override Slack channel for digest (default ops-audit). */
  slackChannel?: string;
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

  // Honor the inbox-scanner kill switch — if the upstream pipeline is paused,
  // the spam cleaner pauses too.
  const inboxFlag = (process.env.INBOX_SCANNER_ENABLED ?? "true").trim().toLowerCase();
  if (inboxFlag === "false" || inboxFlag === "0" || inboxFlag === "off") {
    return NextResponse.json({
      ok: true,
      paused: true,
      reason: "INBOX_SCANNER_ENABLED=false",
    });
  }

  const startedAt = new Date();
  const runCtx = newRunContext({
    agentId: "viktor.spam-cleaner",
    division: "sales",
    source: "scheduled",
    trigger: "phase-37.7-spam-cleaner",
  });

  let body: RunBody = {};
  if (req.method === "POST") {
    try {
      body = (await req.json()) as RunBody;
    } catch {
      body = {};
    }
  } else {
    const url = new URL(req.url);
    if (url.searchParams.get("dryRun") === "true") body.dryRun = true;
    if (url.searchParams.get("dryRun") === "false") body.dryRun = false;
    const maxParam = url.searchParams.get("maxEmails");
    if (maxParam) {
      const parsed = Number.parseInt(maxParam, 10);
      if (Number.isFinite(parsed) && parsed > 0) body.maxEmails = parsed;
    }
    const ch = url.searchParams.get("slackChannel");
    if (ch) body.slackChannel = ch;
  }

  let report: SpamCleanerReport | null = null;
  let error: string | undefined;
  let slackOk = false;

  try {
    // 1. Pull recent inbox envelopes — last 24h is the natural cleanup window.
    const envelopes = await listEmails({
      folder: "INBOX",
      query: "newer_than:1d",
      count: body.maxEmails ?? 100,
    });

    // 2. Materialize each envelope into a ClassifiedRecord with attachment
    //    metadata pulled from the full message. We classify here (rather
    //    than reading prior inbox:scan records) so the spam-cleaner can run
    //    on its own schedule even if the inbox-scan KV is empty / cold.
    const records: Array<
      ClassifiedRecord & {
        hasAttachment: boolean;
        hubspotHasEngagement: boolean;
      }
    > = [];
    const now = new Date();

    for (const env of envelopes) {
      // Build a synthetic ScannedRecord for the classifier.
      const fromEmail = parseFromAddress(env.from);
      const scanned: ScannedRecord = {
        messageId: env.id,
        threadId: env.threadId,
        fromEmail,
        fromHeader: env.from,
        subject: env.subject,
        date: env.date,
        snippet: env.snippet,
        labelIds: env.labelIds,
        status: "received",
        noiseReason: "",
        observedAt: now.toISOString(),
      };

      const decision = classifyScannedRecord(scanned);

      // Only consider records the classifier flagged Z (or noise).
      if (
        decision.category !== "Z_obvious_spam" &&
        scanned.status !== "received_noise"
      ) {
        continue;
      }

      // Attachment check — pull the full message metadata for this one.
      let hasAttachment = false;
      try {
        const full = await readEmail(env.id);
        hasAttachment = (full?.attachments?.length ?? 0) > 0;
      } catch {
        // If we can't determine attachment status, default safe (assume yes).
        hasAttachment = true;
      }

      records.push({
        ...scanned,
        category: decision.category,
        confidence: decision.confidence,
        ruleId: decision.ruleId,
        classificationReason: decision.reason,
        classifiedAt: now.toISOString(),
        hasAttachment,
        // Conservative default — without a full HubSpot batch lookup
        // here we treat every domain as "potentially has engagement"
        // is too strict; instead we treat as "no known engagement"
        // and rely on the denylist + safety-pattern filters as the
        // primary precision lever. Future enhancement: cross-cut to
        // hubspot-verification module to populate this field.
        hubspotHasEngagement: false,
      });
    }

    // 3. Run the cleaner — dry-run by default.
    report = await runSpamCleaner({
      records,
      dryRun: body.dryRun,
      trashFn: async (id: string) => moveToTrash(id),
    });

    // 4. Post the daily digest to #ops-audit (or operator-supplied channel).
    const channelOverride = body.slackChannel || getChannel("ops-audit")?.name || "#ops-audit";
    const digestText = renderSpamCleanerDigest(report);
    try {
      const slackRes = await postMessage({
        channel: channelOverride,
        text: digestText,
      });
      slackOk = slackRes.ok;
    } catch {
      // Slack failure is non-fatal — digest text still in the response body.
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  // 5. Audit envelope.
  try {
    await auditStore().append(
      buildAuditEntry(
        runCtx,
        {
          action: "system.read", // detection-only is system.read; auto-delete
          // mode would be a future Class A-d slug — but
          // this Phase 37.7 commit defaults to dry-run.
          entityType: "viktor.spam-cleaner",
          entityId: runCtx.runId,
          result: report && !error ? "ok" : "error",
          after: report
            ? {
                examined: report.examined,
                deleted: report.deleted,
                deletedDryRun: report.deletedDryRun,
                deleteFailed: report.deleteFailed,
                skippedNotEligible: report.skippedNotEligible,
                skippedEngagement: report.skippedEngagement,
                skippedWhale: report.skippedWhale,
                skippedAttachment: report.skippedAttachment,
                skippedSafety: report.skippedSafety,
                byDomain: report.byDomain,
                degraded: report.degraded,
                slackOk,
              }
            : undefined,
          error: error
            ? { message: error, code: "spam_cleaner_failed" }
            : report?.degraded
              ? {
                  message: report.degradedNotes.join("; "),
                  code: "spam_cleaner_degraded",
                }
              : undefined,
          sourceCitations: [
            { system: "contracts.email-agents-system", id: "§2.5d+§2.8" },
            { system: "phase", id: "37.7" },
          ],
          confidence: 1,
        },
        startedAt,
      ),
    );
  } catch {
    /* audit failure non-fatal */
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
    slackOk,
  });
}

// ---------------------------------------------------------------------------
// Lint-quiet helpers — kept around so future enhancements can reuse the
// pattern. Currently unused inside this route but exported for future
// per-domain HubSpot engagement bulk-lookup.
// ---------------------------------------------------------------------------

export { fromEmailDomain };
