import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { auditSurface } from "@/lib/ops/control-plane/slack";
import type { ApprovalRequest, RunContext } from "@/lib/ops/control-plane/types";
import { sendGmailDraftDetailed } from "@/lib/ops/gmail-reader";
import { findContactByEmail, logEmail } from "@/lib/ops/hubspot-client";

export type EmailApprovalExecutionResult =
  | {
      ok: true;
      handled: true;
      draftId: string;
      messageId: string;
      threadId: string | null;
      hubspotLogId: string | null;
    }
  | { ok: true; handled: false; reason: string }
  | { ok: false; handled: true; error: string; draftId?: string };

function draftIdFromRef(ref?: string): string | null {
  const match = /^gmail:draft:(.+)$/.exec(ref ?? "");
  return match?.[1] ?? null;
}

function emailFromHeader(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim().toLowerCase();
}

async function appendExecutionAudit(
  run: RunContext,
  approval: ApprovalRequest,
  fields: {
    result: "ok" | "error";
    draftId?: string;
    messageId?: string;
    threadId?: string | null;
    to?: string;
    subject?: string;
    hubspotLogId?: string | null;
    error?: string;
  },
) {
  const entry = buildAuditEntry(run, {
    action: "gmail.send",
    entityType: fields.messageId ? "gmail.message" : "gmail.draft",
    entityId: fields.messageId ?? fields.draftId,
    result: fields.result,
    approvalId: approval.id,
    after: {
      draftId: fields.draftId,
      messageId: fields.messageId,
      threadId: fields.threadId,
      to: fields.to,
      subject: fields.subject,
      hubspotLogId: fields.hubspotLogId,
    },
    error: fields.error ? { message: fields.error } : undefined,
    sourceCitations: [
      { system: "control-plane:approval", id: approval.id },
      ...(fields.draftId ? [{ system: "gmail:draft", id: fields.draftId }] : []),
    ],
    confidence: approval.evidence.confidence,
  });
  await auditStore().append(entry);
  await auditSurface().mirror(entry).catch(() => void 0);
}

export async function executeApprovedEmailReply(
  approval: ApprovalRequest,
): Promise<EmailApprovalExecutionResult> {
  if (approval.status !== "approved") {
    return { ok: true, handled: false, reason: `approval status is ${approval.status}` };
  }
  if (approval.targetEntity?.type !== "email-reply") {
    return { ok: true, handled: false, reason: "not an email-reply approval" };
  }

  const draftId = draftIdFromRef(approval.payloadRef);
  if (!draftId) {
    return {
      ok: false,
      handled: true,
      error: `email-reply approval ${approval.id} missing gmail:draft:<id> payloadRef`,
    };
  }

  const run: RunContext = {
    runId: approval.runId,
    agentId: "email-intel-send-closer",
    division: approval.division,
    startedAt: new Date().toISOString(),
    source: "event",
    trigger: `approval:${approval.id}`,
  };

  const sent = await sendGmailDraftDetailed(draftId);
  if (!sent.ok) {
    await appendExecutionAudit(run, approval, {
      result: "error",
      draftId,
      error: sent.error,
    });
    return { ok: false, handled: true, draftId, error: sent.error };
  }

  let hubspotLogId: string | null = null;
  try {
    const contactId = sent.to ? await findContactByEmail(emailFromHeader(sent.to)) : null;
    hubspotLogId = await logEmail({
      to: sent.to,
      from: sent.from,
      subject: sent.subject,
      body: sent.body,
      direction: "EMAIL",
      contactId: contactId ?? undefined,
    });
  } catch {
    // HubSpot is a writeback mirror, not the send system of record. The
    // audit event below still records a null hubspotLogId for follow-up.
  }

  await appendExecutionAudit(run, approval, {
    result: "ok",
    draftId,
    messageId: sent.messageId,
    threadId: sent.threadId,
    to: sent.to,
    subject: sent.subject,
    hubspotLogId,
  });

  return {
    ok: true,
    handled: true,
    draftId,
    messageId: sent.messageId,
    threadId: sent.threadId,
    hubspotLogId,
  };
}
