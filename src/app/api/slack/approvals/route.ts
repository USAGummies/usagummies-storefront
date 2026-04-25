/**
 * Slack interactive approval route — 3.0 control plane.
 *
 * Slack posts to this endpoint when an approver clicks Approve / Reject /
 * Ask on an approval message. We:
 *   1. Verify the Slack signing secret.
 *   2. Parse the interactive payload.
 *   3. Resolve the action_id (`approval::<decision>::<id>`) to a decision.
 *   4. Resolve the Slack user id to a HumanOwner.
 *   5. Call recordDecision() on the control plane — which updates the
 *      ApprovalStore and the ApprovalSurface (the original message).
 *   6. Log the decision to the AuditStore.
 *   7. Return a 200 immediately; the in-message update handles UX.
 *
 * Canonical blueprint: §15.4 T5d. Contract: /contracts/approval-taxonomy.md.
 *
 * Security: fail-closed. If SLACK_SIGNING_SECRET is unset, the endpoint
 * refuses all requests (returns 503). No bypass mode.
 */

import { NextResponse } from "next/server";

import { approvalStore, auditStore } from "@/lib/ops/control-plane/stores";
import {
  approvalSurface,
  auditSurface,
  slackUserIdToHumanOwner,
  verifySlackSignature,
} from "@/lib/ops/control-plane/slack";
import { recordDecision } from "@/lib/ops/control-plane/approvals";
import { buildHumanAuditEntry } from "@/lib/ops/control-plane/audit";
import type { ApprovalDecision, DivisionId } from "@/lib/ops/control-plane/types";
import { postMessage } from "@/lib/ops/control-plane/slack/client";
import { executeApprovedEmailReply } from "@/lib/ops/email-intelligence/approval-executor";
import { executeApprovedShipmentCreate } from "@/lib/ops/sample-order-dispatch/approval-closer";
import { executeApprovedVendorMasterCreate } from "@/lib/ops/vendor-onboarding";
import { executeApprovedApPacketSend } from "@/lib/ops/ap-packets/approval-closer";
import { executeApprovedFaireDirectInvite } from "@/lib/faire/approval-closer";
import { executeApprovedFaireDirectFollowUp } from "@/lib/faire/follow-up-closer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SlackInteractivePayload {
  type?: string;
  actions?: Array<{ action_id?: string; value?: string }>;
  user?: { id?: string; username?: string; name?: string };
}

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");

  const verified = await verifySlackSignature({ rawBody, timestamp, signature });
  if (!verified.ok) {
    return NextResponse.json(
      { error: "Invalid or unverifiable Slack signature", reason: verified.reason },
      { status: verified.reason.includes("not configured") ? 503 : 401 },
    );
  }

  // Slack sends interactive payloads as form-encoded `payload=<JSON>`.
  const form = new URLSearchParams(rawBody);
  const payloadRaw = form.get("payload");
  if (!payloadRaw) {
    return NextResponse.json({ error: "Missing payload" }, { status: 400 });
  }

  let payload: SlackInteractivePayload;
  try {
    payload = JSON.parse(payloadRaw) as SlackInteractivePayload;
  } catch {
    return NextResponse.json({ error: "Invalid payload JSON" }, { status: 400 });
  }

  if (payload.type !== "block_actions") {
    // Ignore non-button interactions for this endpoint.
    return NextResponse.json({ ok: true, ignored: true });
  }

  const action = payload.actions?.[0];
  const actionId = action?.action_id ?? "";
  const match = /^approval::(approve|reject|ask)::(.+)$/.exec(actionId);
  if (!match) {
    return NextResponse.json({ error: "Unrecognized action_id" }, { status: 400 });
  }

  const decisionKind = match[1] as ApprovalDecision["decision"];
  const approvalId = match[2];

  const userId = payload.user?.id ?? "";
  const approver = slackUserIdToHumanOwner(userId);
  if (!approver) {
    return NextResponse.json(
      {
        error: "Unknown Slack user — cannot resolve HumanOwner",
        userId,
      },
      { status: 403 },
    );
  }

  // Resolve approval + call the control-plane state machine.
  const store = approvalStore();
  const existing = await store.get(approvalId);
  if (!existing) {
    return NextResponse.json({ error: "Approval not found", approvalId }, { status: 404 });
  }

  // Reject if the approver isn't in requiredApprovers (also guarded in applyDecision).
  if (!existing.requiredApprovers.includes(approver)) {
    return NextResponse.json(
      {
        error: `${approver} is not an approver for this request`,
        requiredApprovers: existing.requiredApprovers,
      },
      { status: 403 },
    );
  }

  let next;
  try {
    next = await recordDecision(store, approvalSurface(), approvalId, {
      approver,
      decision: decisionKind,
      reason: payload.user?.username
        ? `via Slack interaction by ${payload.user.username}`
        : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to record decision",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 409 }, // conflict — often duplicate or invalid transition
    );
  }

  // Mirror to audit log as a HUMAN action (actorType: "human"). Store is
  // authoritative; Slack mirror is best-effort. The original approval's
  // runId is preserved so the audit trail links the click back to the
  // agent run that opened the approval.
  const auditEntry = buildHumanAuditEntry({
    runId: existing.runId,
    division: existing.division as DivisionId,
    actorId: approver,
    action: `approval.${decisionKind}`,
    entityType: "approval",
    entityId: approvalId,
    before: { status: existing.status, decisions: existing.decisions.length },
    after: { status: next.status, decisions: next.decisions.length },
    result: "ok",
    approvalId,
    sourceCitations: [{ system: "slack", id: payload.user?.id }],
  });
  await auditStore().append(auditEntry);
  await auditSurface().mirror(auditEntry).catch(() => void 0);

  // ---- Approved-action closers ---------------------------------------------
  // Each closer is gated by its own targetEntity / payloadRef shape so we
  // never invoke the wrong handler. They run sequentially; the first one
  // that returns handled=true wins. None of them buy labels — label
  // purchase happens only via the dedicated auto-ship pipeline AFTER
  // additional human action.
  let emailExecution:
    | Awaited<ReturnType<typeof executeApprovedEmailReply>>
    | undefined;
  let shipmentExecution:
    | Awaited<ReturnType<typeof executeApprovedShipmentCreate>>
    | undefined;
  let vendorExecution:
    | Awaited<ReturnType<typeof executeApprovedVendorMasterCreate>>
    | undefined;
  let apPacketExecution:
    | Awaited<ReturnType<typeof executeApprovedApPacketSend>>
    | undefined;
  let faireInviteExecution:
    | Awaited<ReturnType<typeof executeApprovedFaireDirectInvite>>
    | undefined;
  let faireFollowUpExecution:
    | Awaited<ReturnType<typeof executeApprovedFaireDirectFollowUp>>
    | undefined;
  let postedThreadText: string | null = null;

  if (decisionKind === "approve" && next.status === "approved") {
    // 1. Email-reply closer: identified by targetEntity.type = "email-reply"
    emailExecution = await executeApprovedEmailReply(next);
    if (emailExecution.handled) {
      postedThreadText = emailExecution.ok
        ? `:email: Email send executed. Gmail message \`${emailExecution.messageId}\`${emailExecution.hubspotLogId ? ` · HubSpot log \`${emailExecution.hubspotLogId}\`` : " · HubSpot log pending/unavailable"}.`
        : `:warning: Email approval recorded, but send failed: ${emailExecution.error}`;
    }

    // 2. Shipment.create closer: identified by payloadRef = "dispatch:<chan>:<id>"
    if (!emailExecution.handled) {
      shipmentExecution = await executeApprovedShipmentCreate(next);
      if (shipmentExecution.handled) {
        postedThreadText = shipmentExecution.ok
          ? shipmentExecution.threadMessage
          : `:warning: Shipment approval recorded, but closer failed: ${shipmentExecution.error}`;
      }
    }

    // 3. Vendor master closer: identified by targetEntity.type = "vendor-master".
    if (!emailExecution.handled && !shipmentExecution?.handled) {
      vendorExecution = await executeApprovedVendorMasterCreate(next);
      if (vendorExecution.handled) {
        postedThreadText = vendorExecution.ok
          ? vendorExecution.threadMessage
          : vendorExecution.threadMessage;
      }
    }

    // 4. AP-packet closer: identified by targetEntity.type = "ap-packet".
    //    Strict gating means email-reply (type="email-reply") never
    //    accidentally triggers this even though both use the
    //    `gmail.send` action slug.
    if (
      !emailExecution.handled &&
      !shipmentExecution?.handled &&
      !vendorExecution?.handled
    ) {
      apPacketExecution = await executeApprovedApPacketSend(next);
      if (apPacketExecution.handled) {
        postedThreadText = apPacketExecution.threadMessage;
      }
    }

    // 5. Faire Direct invite closer: identified by
    //    targetEntity.type = "faire-invite". Strict gating prevents
    //    cross-fire with the other closers — the actionSlug here is
    //    `faire-direct.invite`, not `gmail.send`, but we keep the
    //    targetEntity gate as the canonical identifier so the chain
    //    remains uniform.
    if (
      !emailExecution.handled &&
      !shipmentExecution?.handled &&
      !vendorExecution?.handled &&
      !apPacketExecution?.handled
    ) {
      faireInviteExecution = await executeApprovedFaireDirectInvite(next);
      if (faireInviteExecution.handled) {
        postedThreadText = faireInviteExecution.threadMessage;
      }
    }

    // 6. Faire Direct FOLLOW-UP closer: identified by
    //    targetEntity.type = "faire-follow-up". Distinct gate from the
    //    initial-invite closer (#5 above) so the same strict-type
    //    pattern keeps the two from cross-firing.
    if (
      !emailExecution.handled &&
      !shipmentExecution?.handled &&
      !vendorExecution?.handled &&
      !apPacketExecution?.handled &&
      !faireInviteExecution?.handled
    ) {
      faireFollowUpExecution = await executeApprovedFaireDirectFollowUp(next);
      if (faireFollowUpExecution.handled) {
        postedThreadText = faireFollowUpExecution.threadMessage;
      }
    }

    if (postedThreadText && existing.slackThread?.ts) {
      await postMessage({
        channel: "#ops-approvals",
        text: postedThreadText,
        threadTs: existing.slackThread.ts,
      }).catch(() => void 0);
    }
  }

  return NextResponse.json({
    ok: true,
    approvalId,
    status: next.status,
    decisions: next.decisions.length,
    apPacketExecution,
    faireInviteExecution,
    faireFollowUpExecution,
    execution: emailExecution,
    shipmentExecution,
    vendorExecution,
  });
}
