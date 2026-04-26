/**
 * POST /api/ops/faire/direct-invites/[id]/follow-up/request-approval
 *
 * Phase 3.3 — opens a Class B `faire-direct.follow-up` approval for a
 * sent Faire Direct invite that crossed the 3-day "due soon" or
 * 7-day "overdue" threshold. The Slack click-approve handler at
 * `/api/slack/approvals` then drives the actual send via
 * `executeApprovedFaireDirectFollowUp`.
 *
 * Hard rules:
 *   - Status MUST be "sent" with a valid `sentAt` (re-validated here +
 *     again inside the closer at send time).
 *   - `classifyForFollowUp()` must return `bucket="due_soon"` or
 *     `bucket="overdue"`. Fresh / queued / wrong_status / missing_sent_at
 *     → 409 with stable code.
 *   - Refuses if `followUpQueuedAt` is already set with a different
 *     approval id in flight (idempotent re-fire on the same id is OK).
 *   - Refuses if `followUpSentAt` is already set (the follow-up
 *     already shipped — no second one).
 *   - **Never sends Gmail.** Gmail is the closer's job, gated by
 *     Ben's Slack approve click.
 *   - **Never touches HubSpot stages, custom properties, deals, or
 *     tasks.** This file only opens a control-plane approval and
 *     stamps `followUpQueuedAt` / `followUpRequestApprovalId` on the
 *     invite record via `markFaireFollowUpQueued`.
 *
 * Status mapping:
 *   200 — approval opened; body = { ok, approvalId, slackThread, … }.
 *   400 — invalid JSON body.
 *   401 — unauthenticated.
 *   404 — invite id not in queue.
 *   409 — invite not eligible for follow-up; body carries `code`.
 *   500 — approval system / KV failure.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { newRunId } from "@/lib/ops/control-plane/run-id";
import { openApproval } from "@/lib/ops/control-plane/approvals";
import { approvalSurface } from "@/lib/ops/control-plane/slack";
import { approvalStore } from "@/lib/ops/control-plane/stores";
import { classifyForFollowUp } from "@/lib/faire/follow-ups";
import {
  getInvite,
  markFaireFollowUpQueued,
} from "@/lib/faire/invites";
import {
  FAIRE_FOLLOW_UP_SUBJECT,
  renderFaireFollowUpEmailBody,
} from "@/lib/faire/follow-up-template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface RequestBody {
  approvers?: Array<"Ben" | "Rene" | "Drew">;
  requestedBy?: string;
}

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RequestBody = {};
  const text = await req.text();
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as RequestBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }

  const { id } = await ctx.params;
  const invite = await getInvite(id);
  if (!invite) {
    return NextResponse.json(
      { ok: false, code: "not_found", error: `Invite ${id} not found.` },
      { status: 404 },
    );
  }

  // Eligibility re-check at request time. The follow-up queue UI
  // already filters to actionable rows, but a router that trusted
  // the client could let a stale row through.
  const classification = classifyForFollowUp(invite);
  if (
    classification.bucket !== "overdue" &&
    classification.bucket !== "due_soon"
  ) {
    return NextResponse.json(
      {
        ok: false,
        code: classification.reason.code,
        error: classification.reason.detail,
      },
      { status: 409 },
    );
  }

  // Compose the approval. The body preview is a scrubbed copy of the
  // template the closer will actually send — the approver sees the
  // exact wording before clicking approve.
  const runId = newRunId();
  const requestedBy = (body.requestedBy ?? "").trim().slice(0, 80);
  const previewBody = renderFaireFollowUpEmailBody(invite);
  const previewSummary = [
    `Follow-up to: ${invite.retailerName}${
      invite.buyerName ? ` (${invite.buyerName})` : ""
    }`,
    `Email: ${invite.email}`,
    `Source: ${invite.source}`,
    `Days since initial send: ${classification.daysSinceSent ?? "?"}`,
    invite.directLinkUrl ? `Faire Direct link: ${invite.directLinkUrl}` : null,
  ]
    .filter((x): x is string => Boolean(x))
    .join("\n");
  const payloadPreview =
    `Send Faire Direct FOLLOW-UP via Gmail (NOT via Faire API)\n` +
    `${previewSummary}\n\n` +
    `Subject: ${FAIRE_FOLLOW_UP_SUBJECT}\n` +
    `Body preview:\n${previewBody}`;

  let request;
  try {
    request = await openApproval(approvalStore(), approvalSurface(), {
      actionSlug: "faire-direct.follow-up",
      runId,
      division: "sales",
      actorAgentId: "faire-direct-follow-up-sender",
      targetSystem: "gmail",
      targetEntity: {
        type: "faire-follow-up",
        id: invite.id,
        label: `Faire Direct follow-up — ${invite.retailerName}`,
      },
      payloadRef: `faire-follow-up:${invite.id}`,
      payloadPreview,
      evidence: {
        claim: `Send Faire Direct follow-up to ${invite.retailerName} (${invite.email}). Initial invite went out ${classification.daysSinceSent ?? "?"} days ago — bucket=${classification.bucket}.`,
        sources: [
          {
            system: "faire-invites",
            id: invite.id,
            url: `/ops/faire-direct`,
            retrievedAt: new Date().toISOString(),
          },
          ...(invite.gmailMessageId
            ? [
                {
                  system: "gmail-initial-send",
                  id: invite.gmailMessageId,
                  retrievedAt: new Date().toISOString(),
                },
              ]
            : []),
          ...(invite.hubspotContactId
            ? [
                {
                  system: "hubspot",
                  id: invite.hubspotContactId,
                  retrievedAt: new Date().toISOString(),
                },
              ]
            : []),
          ...(requestedBy.length > 0
            ? [
                {
                  system: "operator-request",
                  id: requestedBy,
                  retrievedAt: new Date().toISOString(),
                },
              ]
            : []),
        ],
        confidence: 0.95,
      },
      rollbackPlan:
        "Gmail follow-up send is irreversible past the ~30s undo-send window. If sent in error, email the recipient with a correction. The invite row's followUpSentAt flag prevents accidental third-touch sends from this surface.",
      requiredApprovers: body.approvers,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Failed to create approval: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }

  // Stamp the invite with followUpQueuedAt + followUpRequestApprovalId
  // AFTER the approval card is opened. Suppression of the follow-up
  // queue is therefore tied to a real approval id, not just an
  // optimistic local flag.
  const queueResult = await markFaireFollowUpQueued(invite.id, {
    approvalId: request.id,
  });
  if (!queueResult.ok) {
    // Approval card is already in Slack; we can't atomically pull it
    // back. Surface the KV-stamp failure so the operator sees the
    // mismatch and can decide whether to manually reject the open
    // card.
    return NextResponse.json(
      {
        ok: false,
        code: queueResult.error.code,
        error: queueResult.error.message,
        approvalId: request.id,
        warning:
          "An approval card was opened in Slack but the invite record could not be marked queued. Reject the Slack card to avoid a duplicate send.",
        slackThread: request.slackThread ?? null,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    approvalId: request.id,
    status: request.status,
    class: request.class,
    requiredApprovers: request.requiredApprovers,
    slackThread: request.slackThread ?? null,
    nextStep: request.slackThread
      ? `Ben clicks approve in Slack #ops-approvals; the Slack approval handler runs the closer automatically.`
      : `Approval stored but Slack post may have failed — check #ops-audit. Approval id: ${request.id}.`,
  });
}
