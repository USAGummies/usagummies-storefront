/**
 * POST /api/ops/faire/direct-invites/[id]/request-approval
 *
 * Phase 3 — opens a Class B `faire-direct.invite` approval for an
 * already-reviewed-and-approved invite candidate. The Slack click
 * approve handler at `/api/slack/approvals` then drives the actual
 * send-on-approve closer (`executeApprovedFaireDirectInvite`), which
 * dispatches the Gmail message containing the operator-pasted Faire
 * Direct link URL.
 *
 * Hard rules:
 *   - The invite must be `status === "approved"` AND eligible per
 *     `classifyForSend` (re-validates fields + presence of valid
 *     `directLinkUrl`). Any other state → 409 with stable code.
 *   - This route NEVER calls Gmail / HubSpot / Slack write APIs
 *     beyond `openApproval` (which posts the approval card to
 *     `#ops-approvals`).
 *   - The approval record is the single authorization token; nothing
 *     else may flip the invite to "sent".
 *
 * Status mapping:
 *   200 — approval opened; body = { ok, approvalId, slackThread, ... }
 *   400 — invalid JSON body
 *   401 — unauthenticated
 *   404 — invite id not in queue
 *   409 — invite is not eligible (wrong_status / validation_failed),
 *         body carries `code` + a human-readable detail
 *   500 — approval system failure
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { newRunId } from "@/lib/ops/control-plane/run-id";
import { openApproval } from "@/lib/ops/control-plane/approvals";
import { approvalSurface } from "@/lib/ops/control-plane/slack";
import { approvalStore } from "@/lib/ops/control-plane/stores";
import { classifyForSend, summarizeForApproval } from "@/lib/faire/eligible-for-send";
import { getInvite } from "@/lib/faire/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface RequestBody {
  /** Override taxonomy approver list — typically only Ben needs to approve. */
  approvers?: Array<"Ben" | "Rene" | "Drew">;
  /** Operator who clicked "Request send approval" — captured into evidence. */
  requestedBy?: string;
}

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Body is optional — most callers will POST {}.
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

  // Eligibility re-check. The dashboard already filters approved+eligible
  // rows, but a router that trusted the client could let a stale
  // `needs_review` or `sent` row through. Always re-classify here.
  const classification = classifyForSend(invite);
  if (!classification.eligible) {
    return NextResponse.json(
      {
        ok: false,
        code: classification.reason.code,
        error: classification.reason.detail,
      },
      { status: 409 },
    );
  }

  // Compose the approval. Note: the Faire send is irreversible (can't
  // un-send a Gmail), so the rollbackPlan is honest about that. The
  // approval class is locked at "B" by `/contracts/approval-taxonomy.md`
  // for the `faire-direct.invite` slug.
  const runId = newRunId();
  const requestedBy = (body.requestedBy ?? "").trim().slice(0, 80);
  const previewSummary = summarizeForApproval(invite);
  const payloadPreview =
    `Send Faire Direct invite via Gmail (NOT via Faire API)\n` +
    `${previewSummary}\n\n` +
    `Send mechanics: a single plain-text Gmail message will be sent to ` +
    `${invite.email} with the operator-pasted Faire Direct link in the body. ` +
    `On success, the invite row flips to status="sent" and gets timestamped.`;

  try {
    const request = await openApproval(approvalStore(), approvalSurface(), {
      actionSlug: "faire-direct.invite",
      runId,
      division: "sales",
      actorAgentId: "faire-direct-invite-sender",
      targetSystem: "gmail",
      targetEntity: {
        type: "faire-invite",
        id: invite.id,
        label: `Faire Direct invite — ${invite.retailerName}`,
      },
      payloadRef: `faire-invite:${invite.id}`,
      payloadPreview,
      evidence: {
        claim: `Send Faire Direct invite to ${invite.retailerName} via Gmail. Source: ${invite.source}. Direct link URL is operator-pasted from the Faire brand portal.`,
        sources: [
          {
            system: "faire-invites",
            id: invite.id,
            url: `/ops/faire-direct`,
            retrievedAt: new Date().toISOString(),
          },
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
        "Gmail send is irreversible past the ~30s undo-send window. If sent in error, email the recipient with a correction; the invite row's status='sent' flag prevents accidental re-send.",
      requiredApprovers: body.approvers,
    });

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
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Failed to create approval: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
}
