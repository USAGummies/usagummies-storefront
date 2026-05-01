/**
 * GET /api/ops/fulfillment/email-intel/run
 * POST /api/ops/fulfillment/email-intel/run
 *
 * The P0 email-intelligence orchestrator. Cron-triggered at:
 *   8:00 AM PT  (cron 0 15 * * *)
 *   12:00 PM PT (cron 0 19 * * *)
 *   3:00 PM PT  (cron 0 22 * * *)
 *   6:00 PM PT  (cron 0 1 * * *)  -- next day UTC
 *   9:00 PM PT  (cron 0 4 * * *)  -- next day UTC
 *
 * Lives under /api/ops/fulfillment/ to inherit the existing middleware
 * whitelist (a known-good prefix) — same shape as ap-packet/ + gmail-draft/.
 *
 * Flow:
 *   1. Read cursor from KV (default = 12h ago).
 *   2. Pull Gmail INBOX with `after:<cursor>` (cap 50 messages/run).
 *   3. For each: dedupe (KV processed-set + Gmail SENT thread + HubSpot contact).
 *   4. For each not-deduped: classifyEmail() (deterministic rules, no LLM yet).
 *   5. For each actionable category: generateDraftReply() — template-based.
 *   6. Save Gmail draft via createGmailDraft() (Class A — no approval needed
 *      since "draft" is autonomous; the SEND is what's gated).
 *   7. For Class B email categories (gmail.send), open an approval card via
 *      requestApproval() with targetEntity { type:"email-reply", id:<msgId> }.
 *   8. Mark each as processed in KV so the next cron tick skips it.
 *   9. Render Slack report → post to #ops-daily.
 *  10. Advance cursor to now.
 *  11. Audit-log every step via record() / requestApproval().
 *
 * Kill switch: `EMAIL_INTEL_ENABLED=false` env var pauses without redeploy.
 *
 * Auth: session OR CRON_SECRET bearer (whitelisted under /api/ops/fulfillment).
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  classifyEmail,
  type Classification,
} from "@/lib/ops/email-intelligence/classifier";
import {
  gmailAfterFragment,
  readCursor,
  writeCursor,
} from "@/lib/ops/email-intelligence/cursor";
import {
  markProcessed,
  runDedupe,
} from "@/lib/ops/email-intelligence/dedupe";
import { generateDraftReply } from "@/lib/ops/email-intelligence/draft";
import {
  renderApprovalCard,
  hasActionableSignal,
  renderEmailReport,
  type ScannedEmail,
} from "@/lib/ops/email-intelligence/report";
import { record, requestApproval } from "@/lib/ops/control-plane/record";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { getChannel, slackChannelRef } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack/client";
import { listEmails, createGmailDraft } from "@/lib/ops/gmail-reader";
import { evaluateSampleRequest } from "@/lib/ops/email-intelligence/sample-request";
import { processReceipt } from "@/lib/ops/docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Long enough for ~50 emails @ ~2s each (network-bound).
export const maxDuration = 120;

interface RunBody {
  /** Optional override of the lookback in hours. Default = use cursor. */
  lookbackHours?: number;
  /** When true, skip Gmail draft creation + approval card posting. */
  dryRun?: boolean;
  /** Override Slack channel (default: ops-daily). */
  slackChannel?: string;
  /** Cap on # of emails processed in one run. Default 50. */
  maxEmails?: number;
}

interface RunResult {
  ok: boolean;
  paused?: boolean;
  generatedAt: string;
  windowDescription: string;
  scanned: number;
  classified: number;
  skipped: number;
  drafted: number;
  approvalsOpened: number;
  sampleDispatchesOpened: number;
  receiptsQueued: number;
  reportPostedTo?: string | null;
  errors: string[];
  perEmail: Array<{
    messageId: string;
    subject: string;
    from: string;
    category: Classification["category"];
    confidence: number;
    skippedReason?: string;
    draftId?: string | null;
    approvalId?: string | null;
    sampleApprovalId?: string | null;
    sampleMissing?: string[];
    error?: string;
  }>;
}

function isEnabled(): boolean {
  // 2026-04-30 incident: this route auto-replied to Eric Miller @ Event Network
  // with a stale "1-pack/5-pack/master case" sample-request template after he
  // had already confirmed sample receipt. To prevent recurrence, default is now
  // OFF — must be explicitly enabled with EMAIL_INTEL_ENABLED=true. Re-enable
  // ONLY after (a) the approval gate is verified to catch 100% of class-B
  // sends and (b) the stale templates in src/lib/ops/email-intelligence/draft.ts
  // are replaced with current SKU language.
  const v = process.env.EMAIL_INTEL_ENABLED?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "on";
}

function describeWindow(cursorSec: number, nowMs: number): string {
  const ageH = Math.round((nowMs / 1000 - cursorSec) / 360) / 10;
  return `last ${ageH.toFixed(1)}h`;
}

async function runOnce(opts: RunBody): Promise<RunResult> {
  const errors: string[] = [];
  const perEmail: RunResult["perEmail"] = [];
  const nowMs = Date.now();

  // --- 1. Cursor + window
  const cursorSec = opts.lookbackHours
    ? Math.floor(nowMs / 1000) - opts.lookbackHours * 3600
    : await readCursor();
  const afterFragment = gmailAfterFragment(cursorSec);
  const windowDescription = describeWindow(cursorSec, nowMs);
  const maxEmails = Math.max(1, Math.min(100, opts.maxEmails ?? 50));

  // --- 2. Pull Gmail
  let envelopes: Awaited<ReturnType<typeof listEmails>> = [];
  try {
    envelopes = await listEmails({
      folder: "INBOX",
      query: `${afterFragment} -label:sent -category:promotions`,
      count: maxEmails,
    });
  } catch (err) {
    errors.push(
      `Gmail listEmails failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      ok: false,
      generatedAt: new Date().toISOString(),
      windowDescription,
      scanned: 0,
      classified: 0,
      skipped: 0,
      drafted: 0,
      approvalsOpened: 0,
      sampleDispatchesOpened: 0,
      receiptsQueued: 0,
      errors,
      perEmail: [],
    };
  }

  // --- 3-7. Per-email pipeline
  const scanned: ScannedEmail[] = [];
  let drafted = 0;
  let approvalsOpened = 0;
  let sampleDispatchesOpened = 0;
  let receiptsQueued = 0;
  let skipped = 0;

  for (const env of envelopes) {
    const dedupe = await runDedupe({
      messageId: env.id,
      threadId: env.threadId,
      fromAddr: env.from,
    });

    if (dedupe.shouldSkip) {
      skipped += 1;
      perEmail.push({
        messageId: env.id,
        subject: env.subject,
        from: env.from,
        category: "junk_fyi",
        confidence: 0,
        skippedReason: dedupe.signals.kv.hit
          ? "already processed (KV)"
          : "already replied (Gmail SENT)",
      });
      continue;
    }

    // 4. Classify
    const classification = classifyEmail(env);
    const item: ScannedEmail = {
      envelope: env,
      classification,
      alreadyEngaged: !!dedupe.signals.hubspotTimeline.detail.includes(
        "HubSpot contact found",
      ),
      hasDraft: false,
      hasApproval: false,
    };

    // 5+6+7. Draft (if actionable) + maybe open approval
    const reply = generateDraftReply(env, classification);
    if (!reply.actionable || opts.dryRun) {
      if (classification.category === "receipt_document" && !opts.dryRun) {
        try {
          await processReceipt({
            source_url: `gmail:${env.id}`,
            source_channel: "gmail",
            vendor: deriveVendorFromHeader(env.from),
            notes: [
              `Email receipt/document queued by email-intel.`,
              `Subject: ${env.subject || "(no subject)"}`,
              `From: ${env.from || "(unknown)"}`,
              `Thread: ${env.threadId || "(none)"}`,
              env.snippet ? `Snippet: ${env.snippet.slice(0, 300)}` : null,
            ].filter(Boolean).join("\n"),
          });
          receiptsQueued += 1;
        } catch (err) {
          errors.push(
            `receipt queue failed for ${env.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      perEmail.push({
        messageId: env.id,
        subject: env.subject,
        from: env.from,
        category: classification.category,
        confidence: classification.confidence,
        skippedReason: opts.dryRun
          ? "dryRun"
          : `non-actionable (${reply.template})`,
      });
      scanned.push(item);
      await markProcessed(env.id);
      continue;
    }

    // 5b. Save Gmail draft (Class A — `draft.email` per taxonomy)
    let draftId: string | null = null;
    try {
      const draftRes = await createGmailDraft({
        to: env.from, // Reply to sender
        subject: reply.subject,
        body: reply.body,
        threadId: env.threadId,
      });
      if (draftRes.ok) {
        draftId = draftRes.draftId;
        item.hasDraft = true;
        item.draftId = draftId;
        drafted += 1;

        // Audit the draft creation as a Class A action.
        const run = newRunContext({
          agentId: "email-intel",
          division: "platform-data-automation",
          source: "scheduled",
          trigger: `email-intel:draft:${classification.category}`,
        });
        await record(run, {
          actionSlug: "draft.email",
          entityType: "gmail.draft",
          entityId: draftId,
          after: {
            messageId: env.id,
            threadId: env.threadId,
            to: env.from,
            subject: reply.subject,
            template: reply.template,
            category: classification.category,
            confidence: classification.confidence,
          },
          result: "ok",
          sourceCitations: [
            { system: "gmail", id: env.id },
            { system: "email-intel", url: `template:${reply.template}` },
          ],
          confidence: classification.confidence,
        });
      } else {
        errors.push(`draft create failed for ${env.id}: ${draftRes.error}`);
      }
    } catch (err) {
      errors.push(
        `draft exception for ${env.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 6+7. Class B approval card (gmail.send)
    let approvalId: string | null = null;
    if (item.hasDraft) {
      try {
        const run = newRunContext({
          agentId: "email-intel",
          division: "platform-data-automation",
          source: "scheduled",
          trigger: `email-intel:approval:${classification.category}`,
        });
        const approval = await requestApproval(run, {
          actionSlug: "gmail.send",
          targetSystem: "gmail",
          targetEntity: {
            type: "email-reply",
            id: env.id,
            label: `Reply to ${env.from}`,
          },
          payloadPreview: renderApprovalCard({
            scanned: item,
            draftBodyPreview: reply.body,
          }),
          payloadRef: `gmail:draft:${draftId}`,
          evidence: {
            claim: `Reply to inbound email "${env.subject}" classified as ${classification.category} (rule: ${classification.ruleId}).`,
            sources: [
              {
                system: "gmail",
                id: env.id,
                retrievedAt: new Date().toISOString(),
              },
            ],
            confidence: classification.confidence,
          },
          rollbackPlan:
            "Gmail undo-send window (~30s after dispatch). Past 30s: send a follow-up correction email + delete the HubSpot timeline entry.",
        });
        approvalId = approval.id;
        item.hasApproval = true;
        item.approvalId = approvalId;
        approvalsOpened += 1;
      } catch (err) {
        errors.push(
          `approval open failed for ${env.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 7b. Sample-request → shipping bridge.
    //
    // When the classifier flagged this as `sample_request` AND we
    // could parse a complete US ship-to from the email, hand off to
    // the existing sample-dispatch route (channel="manual"). That
    // route opens its own Class B `shipment.create` approval card in
    // #ops-approvals — the email-intel reply approval (`gmail.send`)
    // and the shipment approval are TWO SEPARATE cards, so Ben can
    // approve the reply without committing to ship.
    //
    // No address parsed → no dispatch; the existing sample-request
    // draft template (from draft.ts) already asks for the missing
    // ship-to fields. We do NOT invent addresses.
    let sampleApprovalId: string | null = null;
    let sampleMissing: string[] | undefined;
    if (
      classification.category === "sample_request" &&
      !opts.dryRun
    ) {
      const evaluation = evaluateSampleRequest(env);
      if (evaluation.ready && evaluation.intent) {
        try {
          // Use the local server origin since we're calling our own route.
          const dispatchUrl = new URL(
            "/api/ops/agents/sample-dispatch/dispatch",
            process.env.NEXT_PUBLIC_SITE_URL ||
              "https://www.usagummies.com",
          );
          const dispatchRes = await fetch(dispatchUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // Forward CRON_SECRET so isAuthorized passes.
              Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}`,
            },
            body: JSON.stringify(evaluation.intent),
          });
          const dispatchBody = (await dispatchRes
            .json()
            .catch(() => ({}))) as {
            ok?: boolean;
            posted?: boolean;
            approvalId?: string | null;
            proposalTs?: string | null;
            classification?: { refuse?: boolean };
            refuse?: boolean;
          };
          if (dispatchRes.ok && !dispatchBody.refuse && dispatchBody.approvalId) {
            // Record the canonical approvalId (from the control-plane
            // ApprovalStore), NOT the Slack ts. This is what links the
            // email-intel run back to the approval row when Ben clicks
            // Approve and the closer fires.
            sampleApprovalId = dispatchBody.approvalId;
            sampleDispatchesOpened += 1;
          } else {
            errors.push(
              `sample-dispatch failed for ${env.id}: HTTP ${dispatchRes.status}${
                dispatchBody.refuse ? ` refuse=true` : ""
              }`,
            );
          }
        } catch (err) {
          errors.push(
            `sample-dispatch exception for ${env.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else {
        sampleMissing = evaluation.missing;
        // Not an error — the draft template already asks for these
        // fields. Just record what's missing in the per-email log.
      }
    }

    perEmail.push({
      messageId: env.id,
      subject: env.subject,
      from: env.from,
      category: classification.category,
      confidence: classification.confidence,
      draftId,
      approvalId,
      sampleApprovalId,
      sampleMissing,
    });
    scanned.push(item);
    await markProcessed(env.id);
  }

  // --- 9. Slack report
  const reportText = renderEmailReport({
    scanned,
    rollup: {
      scanned: envelopes.length,
      classified: scanned.length,
      skipped,
      byCategory: scanned.reduce(
        (acc, s) => {
          acc[s.classification.category] =
            (acc[s.classification.category] ?? 0) + 1;
          return acc;
        },
        {} as Record<Classification["category"], number>,
      ),
    },
    windowDescription,
  });

  let postedTo: string | null = null;
  // Slim mode (Cut C): suppress the post entirely when nothing
  // actionable surfaced. Most digests were posting "_Scanned 50,
  // classified 1, FYI/junk (1) — collapsed_" — pure noise. Critical /
  // approval / sample-request / vendor / B2B / receipts buckets all
  // still trigger the post; junk-only does not.
  const actionable = hasActionableSignal(scanned);
  if (!opts.dryRun && actionable) {
    const channelKey =
      (opts.slackChannel as Parameters<typeof getChannel>[0]) ?? "ops-daily";
    const channel = getChannel(channelKey);
    if (channel) {
      try {
        const res = await postMessage({
          channel: slackChannelRef(channelKey),
          text: reportText,
        });
        if (res.ok) postedTo = channel.name;
        else errors.push(`Slack post not ok: ${res.error ?? "unknown"}`);
      } catch (err) {
        errors.push(
          `Slack post exception: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      errors.push(`Channel ${channelKey} not in registry`);
    }
  }

  // --- 10. Advance cursor
  if (!opts.dryRun) {
    await writeCursor(Math.floor(nowMs / 1000));
  }

  return {
    ok: errors.length === 0,
    generatedAt: new Date().toISOString(),
    windowDescription,
    scanned: envelopes.length,
    classified: scanned.length,
    skipped,
    drafted,
    approvalsOpened,
    sampleDispatchesOpened,
    receiptsQueued,
    reportPostedTo: postedTo,
    errors,
    perEmail,
  };
}

function deriveVendorFromHeader(from: string): string | undefined {
  const display = from.match(/^([^<]+)</)?.[1]?.trim().replace(/^"|"$/g, "");
  if (display) return display.slice(0, 80);
  const domain = from.match(/@([^>\s]+)/)?.[1]?.trim();
  if (!domain) return undefined;
  return domain.replace(/^www\./, "").split(".")[0]?.slice(0, 80);
}

// ----- Handlers ----------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isEnabled()) {
    return NextResponse.json({
      ok: true,
      paused: true,
      reason: "EMAIL_INTEL_ENABLED env var is false",
    });
  }
  let body: RunBody = {};
  try {
    body = (await req.json()) as RunBody;
  } catch {
    /* empty body OK */
  }
  return NextResponse.json(await runOnce(body));
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isEnabled()) {
    return NextResponse.json({
      ok: true,
      paused: true,
      reason: "EMAIL_INTEL_ENABLED env var is false",
    });
  }
  // Cron uses GET. Read query params for dry-run / lookback.
  const url = new URL(req.url);
  const opts: RunBody = {
    dryRun: url.searchParams.get("dry") === "true",
    lookbackHours: url.searchParams.get("lookbackHours")
      ? Number.parseInt(url.searchParams.get("lookbackHours")!, 10)
      : undefined,
    maxEmails: url.searchParams.get("maxEmails")
      ? Number.parseInt(url.searchParams.get("maxEmails")!, 10)
      : undefined,
  };
  return NextResponse.json(await runOnce(opts));
}
