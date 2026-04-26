/**
 * GET /api/ops/faire/direct-invites/follow-ups
 *
 * Phase 3.2 — read-only follow-up surface for the Faire Direct invite
 * queue. Reads the existing invite records from KV, classifies each
 * via `reportFollowUps()`, and returns the grouped buckets.
 *
 * Hard rules:
 *   - **Read-only.** No KV write. No Gmail / Faire / HubSpot / Slack
 *     network call. No mutation of any record.
 *   - No follow-up email is sent from this surface. The grouping
 *     output is what the operator looks at to decide whether to
 *     manually reply on the original Gmail thread.
 *   - Auth: middleware blocks `/api/ops/*` for unauthenticated
 *     traffic; `isAuthorized()` rechecks (session OR CRON_SECRET).
 *
 * Response shape:
 *   {
 *     ok: true,
 *     now: ISO-8601 string,
 *     totals: { overdue, due_soon, not_due, total, sent_total },
 *     overdue:   FollowUpClassification[],
 *     due_soon:  FollowUpClassification[],
 *     not_due:   FollowUpClassification[],
 *   }
 *
 * The classifications carry `daysSinceSent` and the suggested action
 * copy for each actionable row, so the dashboard renders without a
 * second round-trip.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { listInvites } from "@/lib/faire/invites";
import {
  reportFollowUps,
  suggestNextActionCopy,
  type FollowUpClassification,
} from "@/lib/faire/follow-ups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FollowUpRow {
  id: string;
  retailerName: string;
  buyerName?: string;
  email: string;
  source: string;
  notes?: string;
  hubspotContactId?: string;
  sentAt?: string;
  sentBy?: string;
  gmailMessageId?: string;
  daysSinceSent: number | null;
  bucket: "overdue" | "due_soon" | "not_due";
  reason: { code: string; detail: string };
  suggestedAction: string | null;
  // Phase 3.3 follow-up lifecycle metadata — surfaced so the UI can
  // render "queued" / "sent" badges without a second round-trip.
  followUpQueuedAt?: string;
  followUpRequestApprovalId?: string;
  followUpSentAt?: string;
  followUpSentBy?: string;
  followUpGmailMessageId?: string;
}

function toRow(c: FollowUpClassification): FollowUpRow {
  const r = c.record;
  return {
    id: r.id,
    retailerName: r.retailerName,
    buyerName: r.buyerName,
    email: r.email,
    source: r.source,
    notes: r.notes,
    hubspotContactId: r.hubspotContactId,
    sentAt: r.sentAt,
    sentBy: r.sentBy,
    gmailMessageId: r.gmailMessageId,
    daysSinceSent: c.daysSinceSent,
    bucket: c.bucket,
    reason: c.reason,
    suggestedAction:
      c.bucket === "overdue" || c.bucket === "due_soon"
        ? suggestNextActionCopy(r, c.daysSinceSent ?? 0)
        : null,
    followUpQueuedAt: r.followUpQueuedAt,
    followUpRequestApprovalId: r.followUpRequestApprovalId,
    followUpSentAt: r.followUpSentAt,
    followUpSentBy: r.followUpSentBy,
    followUpGmailMessageId: r.followUpGmailMessageId,
  };
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const all = await listInvites();
  const now = new Date();
  const report = reportFollowUps(all, now);
  const sentTotal = all.filter((r) => r.status === "sent").length;

  return NextResponse.json({
    ok: true,
    now: now.toISOString(),
    totals: {
      overdue: report.overdue.length,
      due_soon: report.due_soon.length,
      not_due: report.not_due.length,
      total: report.total,
      sent_total: sentTotal,
    },
    overdue: report.overdue.map(toRow),
    due_soon: report.due_soon.map(toRow),
    not_due: report.not_due.map(toRow),
  });
}
