/**
 * Phase 3.3 send-on-approve closer for Faire Direct FOLLOW-UP emails.
 *
 * Strict gate (locked by tests):
 *   - approval.status === "approved"
 *   - targetEntity.type === "faire-follow-up"
 *   - payloadRef startsWith "faire-follow-up:"
 *
 * Once Ben clicks Approve in Slack on a Class B `faire-direct.follow-up`
 * approval, `/api/slack/approvals` calls this closer, which:
 *
 *   1. Strict-gates as above (cross-fire with the email-reply,
 *      shipment.create, vendor-master, ap-packet, or initial Faire
 *      invite closers is impossible because they all check
 *      targetEntity.type).
 *   2. Re-loads the invite from KV and re-runs `classifyForFollowUp`
 *      — a record whose state drifted between request-approval and
 *      Slack click never gets sent.
 *   3. Renders the locked follow-up template (subject + body —
 *      no medical claims, no pricing/terms promises, operator-only
 *      contact in the closing).
 *   4. Sends the Gmail follow-up via `sendViaGmailApiDetailed`.
 *      Faire's API is NEVER called from this closer.
 *   5. Logs the send to HubSpot via `logEmail`, using the same
 *      `resolveHubSpotContactIdForInviteRecord` helper as the initial
 *      invite (operator-pasted id wins; falls back to email lookup).
 *      Best-effort — a HubSpot failure does NOT undo the Gmail send.
 *   6. Stamps `followUpSentAt`, `followUpSentBy`, `followUpGmailMessageId`,
 *      `followUpGmailThreadId`, `followUpHubspotEmailLogId`, and
 *      `followUpSentApprovalId` on the invite row via
 *      `markFaireFollowUpSent`. **Status stays at "sent"** —
 *      follow-up never moves the invite lifecycle off "sent".
 *   7. Audits both success and failure into the control-plane store +
 *      mirrors to `#ops-audit`.
 *
 * Idempotency: a re-fired Slack click that re-arrives here detects an
 * already-sent record by `followUpSentApprovalId === approval.id` and
 * short-circuits without re-sending Gmail.
 *
 * The closer NEVER:
 *   - Calls Faire's API.
 *   - Sends to a recipient other than `record.email`.
 *   - Promises pricing, terms, lead times, or product effects.
 *   - Mutates the invite's `status` field.
 *   - Touches HubSpot lifecycle stages, custom properties, deals, or
 *     tasks.
 */
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { auditSurface } from "@/lib/ops/control-plane/slack";
import type {
  ApprovalRequest,
  RunContext,
} from "@/lib/ops/control-plane/types";

import { classifyForFollowUp } from "./follow-ups";
import {
  getInvite,
  markFaireFollowUpSent,
  type FaireInviteRecord,
} from "./invites";
import {
  FAIRE_FOLLOW_UP_SUBJECT,
  renderFaireFollowUpEmailBody,
} from "./follow-up-template";
import { sendViaGmailApiDetailed } from "@/lib/ops/gmail-reader";
import { findContactByEmail, logEmail } from "@/lib/ops/hubspot-client";
import { resolveHubSpotContactIdForInviteRecord } from "./hubspot-mirror";

const TARGET_ENTITY_TYPE = "faire-follow-up";
const PAYLOAD_REF_PREFIX = "faire-follow-up:";

export type FaireFollowUpExecutionResult =
  | {
      ok: true;
      handled: true;
      kind: "faire-direct-follow-up";
      inviteId: string;
      gmailMessageId: string;
      gmailThreadId: string | null;
      hubspotEmailLogId: string | null;
      sentAt: string;
      alreadySent: boolean;
      threadMessage: string;
    }
  | {
      ok: false;
      handled: true;
      kind: "faire-direct-follow-up";
      inviteId: string | null;
      error: string;
      threadMessage: string;
    }
  | { ok: true; handled: false; reason: string };

async function appendCloseAudit(
  run: RunContext,
  approval: ApprovalRequest,
  fields: {
    result: "ok" | "error";
    inviteId: string | null;
    gmailMessageId?: string | null;
    gmailThreadId?: string | null;
    hubspotEmailLogId?: string | null;
    error?: string;
  },
): Promise<void> {
  const entry = buildAuditEntry(run, {
    action: "faire-direct.follow-up.approved.send",
    entityType: "faire-follow-up",
    entityId: fields.inviteId ?? approval.targetEntity?.id,
    result: fields.result,
    approvalId: approval.id,
    after: {
      inviteId: fields.inviteId,
      gmailMessageId: fields.gmailMessageId,
      gmailThreadId: fields.gmailThreadId,
      hubspotEmailLogId: fields.hubspotEmailLogId,
    },
    error: fields.error ? { message: fields.error } : undefined,
    sourceCitations: [
      { system: "control-plane:approval", id: approval.id },
      ...(fields.inviteId
        ? [{ system: "faire-invites", id: fields.inviteId }]
        : []),
    ],
    confidence: approval.evidence.confidence,
  });
  await auditStore().append(entry);
  await auditSurface()
    .mirror(entry)
    .catch(() => undefined);
}

function makeRunContext(approval: ApprovalRequest): RunContext {
  return {
    runId: approval.runId,
    agentId: "faire-direct-follow-up-approved-closer",
    division: approval.division,
    startedAt: new Date().toISOString(),
    source: "event",
    trigger: `approval:${approval.id}`,
  };
}

export async function executeApprovedFaireDirectFollowUp(
  approval: ApprovalRequest,
  options: {
    sendImpl?: typeof sendViaGmailApiDetailed;
    logEmailImpl?: typeof logEmail;
    findContactImpl?: typeof findContactByEmail;
    now?: Date;
  } = {},
): Promise<FaireFollowUpExecutionResult> {
  // ---- Strict gating ----------------------------------------------------
  if (approval.status !== "approved") {
    return {
      ok: true,
      handled: false,
      reason: `approval status is ${approval.status}`,
    };
  }
  if (approval.targetEntity?.type !== TARGET_ENTITY_TYPE) {
    return {
      ok: true,
      handled: false,
      reason: "not a faire-follow-up approval",
    };
  }
  const payloadRef = approval.payloadRef ?? "";
  if (!payloadRef.startsWith(PAYLOAD_REF_PREFIX)) {
    const run = makeRunContext(approval);
    const err = `faire-follow-up approval ${approval.id} missing valid payloadRef (expected "faire-follow-up:<id>")`;
    await appendCloseAudit(run, approval, {
      result: "error",
      inviteId: null,
      error: err,
    });
    return {
      ok: false,
      handled: true,
      kind: "faire-direct-follow-up",
      inviteId: null,
      error: err,
      threadMessage: `:warning: Faire Direct follow-up approval recorded, but closer could not derive invite id: ${err}.`,
    };
  }
  const inviteId = payloadRef.slice(PAYLOAD_REF_PREFIX.length).trim();
  if (!inviteId) {
    const run = makeRunContext(approval);
    const err = `faire-follow-up approval ${approval.id} payloadRef has no id`;
    await appendCloseAudit(run, approval, {
      result: "error",
      inviteId: null,
      error: err,
    });
    return {
      ok: false,
      handled: true,
      kind: "faire-direct-follow-up",
      inviteId: null,
      error: err,
      threadMessage: `:warning: Faire Direct follow-up approval recorded, but invite id was empty.`,
    };
  }

  const run = makeRunContext(approval);
  const record = await getInvite(inviteId);
  if (!record) {
    const err = `Invite ${inviteId} not found in KV at follow-up send time.`;
    await appendCloseAudit(run, approval, {
      result: "error",
      inviteId,
      error: err,
    });
    return {
      ok: false,
      handled: true,
      kind: "faire-direct-follow-up",
      inviteId,
      error: err,
      threadMessage: `:warning: Faire Direct follow-up: invite *${inviteId}* not found at send time.`,
    };
  }

  // Idempotency short-circuit FIRST: if this exact approval already
  // delivered a follow-up, return alreadySent without resending.
  if (
    record.followUpSentAt &&
    record.followUpSentApprovalId === approval.id
  ) {
    const threadMessage =
      `:white_check_mark: Faire Direct follow-up already sent to *${record.retailerName}* ` +
      `<${record.email}>` +
      (record.followUpGmailMessageId
        ? ` · Gmail message \`${record.followUpGmailMessageId}\``
        : "") +
      `. (idempotent re-fire, no duplicate email)`;
    return {
      ok: true,
      handled: true,
      kind: "faire-direct-follow-up",
      inviteId,
      gmailMessageId: record.followUpGmailMessageId ?? "",
      gmailThreadId: record.followUpGmailThreadId ?? null,
      hubspotEmailLogId: record.followUpHubspotEmailLogId ?? null,
      sentAt: record.followUpSentAt,
      alreadySent: true,
      threadMessage,
    };
  }

  // The classifier suppresses any record with followUpQueuedAt set
  // (so the read-only queue doesn't re-surface it). But the closer
  // ITSELF runs after request-approval has stamped that field — so we
  // must re-classify against a clone with followUpQueuedAt cleared
  // IFF this approval is the one that queued it. A queued state with
  // a *different* approval id means someone else's request is in
  // flight; refuse.
  if (
    record.followUpQueuedAt &&
    record.followUpRequestApprovalId &&
    record.followUpRequestApprovalId !== approval.id
  ) {
    const err = `Invite ${inviteId} has a different follow-up approval in flight (approvalId=${record.followUpRequestApprovalId}). This closer's approval id (${approval.id}) does not match — refusing to send to avoid a cross-approval send.`;
    await appendCloseAudit(run, approval, {
      result: "error",
      inviteId,
      error: err,
    });
    return {
      ok: false,
      handled: true,
      kind: "faire-direct-follow-up",
      inviteId,
      error: err,
      threadMessage: `:warning: Faire Direct follow-up to *${record.retailerName}* aborted: a different approval is queued for this invite.`,
    };
  }

  // Re-classify at send time using a clone with the suppression
  // marker temporarily cleared. Bucket must still be due_soon or
  // overdue based on age. A row that drifted to fresh /
  // wrong_status / missing_sent_at must NOT send.
  const classifierInput: FaireInviteRecord = {
    ...record,
    followUpQueuedAt: undefined,
    followUpRequestApprovalId: undefined,
  };
  const classification = classifyForFollowUp(classifierInput, options.now);
  if (
    classification.bucket !== "overdue" &&
    classification.bucket !== "due_soon"
  ) {
    const err = `Invite ${inviteId} no longer eligible for follow-up at send time: ${classification.reason.code} — ${classification.reason.detail}`;
    await appendCloseAudit(run, approval, {
      result: "error",
      inviteId,
      error: err,
    });
    return {
      ok: false,
      handled: true,
      kind: "faire-direct-follow-up",
      inviteId,
      error: err,
      threadMessage: `:warning: Faire Direct follow-up to *${record.retailerName}* aborted: no longer eligible (${classification.reason.code}). No email sent. Approval id: \`${approval.id}\`.`,
    };
  }

  const sendImpl = options.sendImpl ?? sendViaGmailApiDetailed;
  const logEmailImpl = options.logEmailImpl ?? logEmail;

  const body = renderFaireFollowUpEmailBody(record);

  // ---- Gmail send -------------------------------------------------------
  // Reply-on-thread when we have the original threadId — keeps the
  // follow-up in the same email conversation as the initial invite,
  // which is the operator's default UX expectation.
  const sendArgs: Parameters<typeof sendViaGmailApiDetailed>[0] = {
    to: record.email,
    subject: FAIRE_FOLLOW_UP_SUBJECT,
    body,
  };
  if (record.gmailThreadId) sendArgs.threadId = record.gmailThreadId;

  const sendResult = await sendImpl(sendArgs).catch((err) => ({
    ok: false as const,
    error: err instanceof Error ? err.message : String(err),
  }));

  if (!sendResult.ok) {
    const err = `Gmail follow-up send failed: ${sendResult.error}`;
    await appendCloseAudit(run, approval, {
      result: "error",
      inviteId,
      error: err,
    });
    return {
      ok: false,
      handled: true,
      kind: "faire-direct-follow-up",
      inviteId,
      error: err,
      threadMessage: `:warning: Faire Direct follow-up to *${record.retailerName}* failed at Gmail send: ${err}. KV row NOT marked followUpSentAt. Fix the cause and re-approve, or send manually.`,
    };
  }

  // ---- HubSpot mirror (best-effort) ------------------------------------
  let hubspotEmailLogId: string | null = null;
  try {
    const contactId = await resolveHubSpotContactIdForInviteRecord(record, {
      findImpl: options.findContactImpl,
    });
    hubspotEmailLogId = await logEmailImpl({
      subject: FAIRE_FOLLOW_UP_SUBJECT,
      body,
      direction: "EMAIL",
      to: record.email,
      contactId: contactId ?? undefined,
    });
  } catch {
    hubspotEmailLogId = null;
  }

  // ---- KV flip (single write) ------------------------------------------
  const sentBy =
    approval.decisions.find((d) => d.decision === "approve")?.approver ??
    approval.requiredApprovers[0] ??
    "Ben";
  const markResult = await markFaireFollowUpSent(inviteId, {
    approvalId: approval.id,
    sentBy,
    gmailMessageId: sendResult.messageId,
    gmailThreadId: sendResult.threadId,
    hubspotEmailLogId,
    now: options.now ?? new Date(),
  });
  if (!markResult.ok) {
    // Gmail already went out — partial-failure path. The operator
    // MUST know the email landed even though our KV is now stale.
    const err = `KV flip failed after Gmail follow-up send: ${markResult.error.code} — ${markResult.error.message}`;
    await appendCloseAudit(run, approval, {
      result: "error",
      inviteId,
      gmailMessageId: sendResult.messageId,
      gmailThreadId: sendResult.threadId,
      hubspotEmailLogId,
      error: err,
    });
    return {
      ok: false,
      handled: true,
      kind: "faire-direct-follow-up",
      inviteId,
      error: err,
      threadMessage:
        `:warning: Gmail follow-up to *${record.retailerName}* SENT (\`${sendResult.messageId}\`), but KV flip failed: ` +
        `${markResult.error.code}. Manually mark the invite's followUpSentAt — the email already went out.`,
    };
  }

  const sentAtIso = markResult.invite.followUpSentAt ?? new Date().toISOString();
  await appendCloseAudit(run, approval, {
    result: "ok",
    inviteId,
    gmailMessageId: sendResult.messageId,
    gmailThreadId: sendResult.threadId,
    hubspotEmailLogId,
  });

  const sentAtShort = sentAtIso.slice(0, 16);
  const threadMessage =
    `:envelope_with_arrow: Faire Direct follow-up sent to *${record.retailerName}* ` +
    `<${record.email}>` +
    ` · Gmail message \`${sendResult.messageId}\`` +
    (sendResult.threadId ? ` · thread \`${sendResult.threadId}\`` : "") +
    (hubspotEmailLogId
      ? ` · HubSpot log \`${hubspotEmailLogId}\``
      : " · HubSpot log pending/unavailable") +
    ` · sent at \`${sentAtShort}\``;

  return {
    ok: true,
    handled: true,
    kind: "faire-direct-follow-up",
    inviteId,
    gmailMessageId: sendResult.messageId,
    gmailThreadId: sendResult.threadId,
    hubspotEmailLogId,
    sentAt: sentAtIso,
    alreadySent: false,
    threadMessage,
  };
}

/** Re-export for closer-shaped helpers — keep `FaireInviteRecord` available. */
export type { FaireInviteRecord };
