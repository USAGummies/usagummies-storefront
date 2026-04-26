/**
 * Phase 3 send-on-approve closer for Faire Direct invites.
 *
 * Once Ben clicks Approve in Slack on a Class B `faire-direct.invite`
 * approval, `/api/slack/approvals` calls this closer, which:
 *
 *   1. Strict-gates on approval.status === "approved" AND
 *      targetEntity.type === "faire-invite" AND
 *      payloadRef === "faire-invite:<id>".
 *   2. Re-loads the invite from KV and re-runs `classifyForSend` —
 *      a record whose fields drifted between request-approval and
 *      Slack click never gets sent.
 *   3. Renders a plain-text Gmail body that contains the
 *      operator-pasted Faire Direct link URL. NO claims about
 *      product effects, NO medical language; only the company's
 *      operator contact in the signature.
 *   4. Sends via `sendViaGmailApiDetailed`. Faire's API is NEVER
 *      called from this closer.
 *   5. Logs the send to HubSpot via `logEmail` (best-effort —
 *      a HubSpot failure does not undo the Gmail send).
 *   6. Flips the KV invite row to status="sent" with sentAt, sentBy,
 *      gmailMessageId, gmailThreadId, hubspotEmailLogId, sentApprovalId
 *      via `markFaireInviteSent`.
 *   7. Audits both success and failure into the control-plane store +
 *      mirrors to `#ops-audit`.
 *   8. Returns a Slack thread message string so the Slack route can
 *      post the result back into the approval thread.
 *
 * Idempotency: an approval that re-fires (e.g. duplicate Slack click,
 * retry after an Anthropic outage) hits `markFaireInviteSent` which
 * detects an already-sent record by approvalId and short-circuits.
 *
 * The closer NEVER:
 *   - Calls Faire's API.
 *   - Generates or guesses the Faire Direct link URL — it must be
 *     pasted by the operator before approval, otherwise eligibility
 *     fails earlier in the pipeline.
 *   - Sends to a recipient other than `record.email`.
 *   - Promises medical / health benefits in the body copy.
 *   - Mutates KV beyond the single `markFaireInviteSent` write.
 */
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { auditSurface } from "@/lib/ops/control-plane/slack";
import type {
  ApprovalRequest,
  RunContext,
} from "@/lib/ops/control-plane/types";

import { classifyForSend } from "./eligible-for-send";
import {
  getInvite,
  isValidDirectLinkUrl,
  markFaireInviteSent,
  type FaireInviteRecord,
} from "./invites";
import { sendViaGmailApiDetailed } from "@/lib/ops/gmail-reader";
import { findContactByEmail, logEmail } from "@/lib/ops/hubspot-client";
import { resolveHubSpotContactIdForInviteRecord } from "./hubspot-mirror";

// ---------------------------------------------------------------------------
// Strict gate constants
// ---------------------------------------------------------------------------

const TARGET_ENTITY_TYPE = "faire-invite";
const PAYLOAD_REF_PREFIX = "faire-invite:";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type FaireInviteApprovalExecutionResult =
  | {
      ok: true;
      handled: true;
      kind: "faire-direct-invite";
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
      kind: "faire-direct-invite";
      inviteId: string | null;
      error: string;
      threadMessage: string;
    }
  | { ok: true; handled: false; reason: string };

// ---------------------------------------------------------------------------
// Body rendering
// ---------------------------------------------------------------------------

const SUBJECT = "USA Gummies on Faire Direct";

/**
 * Plain-text email body. Locked-by-tests rules:
 *   - Includes retailerName (greeting context).
 *   - Includes buyerName when present (more personalized greeting).
 *   - Includes the operator-pasted directLinkUrl verbatim.
 *   - No medical / "supports immunity" / "vitamin" / etc. claims.
 *   - Closing carries the operator email + business name only — never
 *     the recipient's PII back, never the recipient's HubSpot id, never
 *     internal ids.
 */
export function renderFaireInviteEmailBody(record: FaireInviteRecord): string {
  const greetingName = record.buyerName?.trim() || record.retailerName.trim();
  const lines: string[] = [];
  lines.push(`Hi ${greetingName},`);
  lines.push("");
  lines.push(
    `We'd love to have ${record.retailerName} carry USA Gummies through ` +
      `Faire Direct. Faire Direct routes the order through Faire (so you ` +
      `keep the same checkout, payment terms, and free returns) at 0% ` +
      `commission for us — meaning we can offer you better wholesale ` +
      `pricing on the same all-American, dye-free gummy bears you've ` +
      `seen from us.`,
  );
  lines.push("");
  lines.push(
    `Your Faire Direct invite link is below. The link goes straight to ` +
      `our brand portal on Faire — sign in or create your free Faire ` +
      `account, and the invite is connected automatically:`,
  );
  lines.push("");
  lines.push(record.directLinkUrl ?? "");
  lines.push("");
  lines.push(
    `If anything looks off or you'd rather see pricing first, just reply ` +
      `to this email and I'll send a one-pager.`,
  );
  lines.push("");
  lines.push("Thanks,");
  lines.push("Ben Stutman");
  lines.push("Founder, USA Gummies");
  lines.push("ben@usagummies.com");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Audit helpers
// ---------------------------------------------------------------------------

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
    action: "faire-direct.invite.approved.send",
    entityType: "faire-invite",
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

// ---------------------------------------------------------------------------
// Closer
// ---------------------------------------------------------------------------

/**
 * Executes the Gmail send for a single approved Faire Direct invite.
 * Test seam: pass `sendImpl` / `logEmailImpl` to substitute mocks. In
 * production the real Gmail + HubSpot clients are used.
 */
export async function executeApprovedFaireDirectInvite(
  approval: ApprovalRequest,
  options: {
    sendImpl?: typeof sendViaGmailApiDetailed;
    logEmailImpl?: typeof logEmail;
    /**
     * Test seam for the HubSpot contact lookup fallback. Production
     * uses `findContactByEmail` from the HubSpot client; tests inject
     * a vi.fn so the closer never touches the real HubSpot API.
     */
    findContactImpl?: typeof findContactByEmail;
    now?: Date;
  } = {},
): Promise<FaireInviteApprovalExecutionResult> {
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
      reason: "not a faire-invite approval",
    };
  }
  const payloadRef = approval.payloadRef ?? "";
  if (!payloadRef.startsWith(PAYLOAD_REF_PREFIX)) {
    // The request-approval route always writes payloadRef. A missing or
    // mismatched prefix is a bug — fail closed and audit it.
    const run = makeRunContext(approval);
    const err = `faire-invite approval ${approval.id} missing valid payloadRef (expected "faire-invite:<id>")`;
    await appendCloseAudit(run, approval, {
      result: "error",
      inviteId: null,
      error: err,
    });
    return {
      ok: false,
      handled: true,
      kind: "faire-direct-invite",
      inviteId: null,
      error: err,
      threadMessage: `:warning: Faire Direct invite approval recorded, but closer could not derive invite id: ${err}.`,
    };
  }
  const inviteId = payloadRef.slice(PAYLOAD_REF_PREFIX.length).trim();
  if (!inviteId) {
    const run = makeRunContext(approval);
    const err = `faire-invite approval ${approval.id} payloadRef has no id`;
    await appendCloseAudit(run, approval, {
      result: "error",
      inviteId: null,
      error: err,
    });
    return {
      ok: false,
      handled: true,
      kind: "faire-direct-invite",
      inviteId: null,
      error: err,
      threadMessage: `:warning: Faire Direct invite approval recorded, but invite id was empty.`,
    };
  }

  const run = makeRunContext(approval);
  const record = await getInvite(inviteId);
  if (!record) {
    const err = `Invite ${inviteId} not found in KV at send time.`;
    await appendCloseAudit(run, approval, {
      result: "error",
      inviteId,
      error: err,
    });
    return {
      ok: false,
      handled: true,
      kind: "faire-direct-invite",
      inviteId,
      error: err,
      threadMessage: `:warning: Faire Direct invite *${inviteId}* not found at send time. Approval id: \`${approval.id}\`.`,
    };
  }

  // Idempotency short-circuit FIRST: if the record is already "sent"
  // with this same approvalId, we've successfully closed before. Don't
  // re-send and don't run eligibility (which rejects status="sent").
  if (record.status === "sent" && record.sentApprovalId === approval.id) {
    const threadMessage =
      `:white_check_mark: Faire Direct invite already sent to *${record.retailerName}* ` +
      `<${record.email}>` +
      (record.gmailMessageId ? ` · Gmail message \`${record.gmailMessageId}\`` : "") +
      `. (idempotent re-fire, no duplicate email)`;
    return {
      ok: true,
      handled: true,
      kind: "faire-direct-invite",
      inviteId,
      gmailMessageId: record.gmailMessageId ?? "",
      gmailThreadId: record.gmailThreadId ?? null,
      hubspotEmailLogId: record.hubspotEmailLogId ?? null,
      sentAt: record.sentAt ?? new Date().toISOString(),
      alreadySent: true,
      threadMessage,
    };
  }

  // Re-classify at send time. A field that drifted between
  // request-approval and Slack click (operator cleared the link, email
  // got corrected to invalid, status was rolled back to needs_review)
  // must NOT send.
  const classification = classifyForSend(record);
  if (!classification.eligible) {
    const err = `Invite ${inviteId} no longer eligible at send time: ${classification.reason.code} — ${classification.reason.detail}`;
    await appendCloseAudit(run, approval, {
      result: "error",
      inviteId,
      error: err,
    });
    return {
      ok: false,
      handled: true,
      kind: "faire-direct-invite",
      inviteId,
      error: err,
      threadMessage: `:warning: Faire Direct invite *${record.retailerName}* is no longer eligible to send (${classification.reason.code}). No email was sent. Approval id: \`${approval.id}\`.`,
    };
  }
  // Defensive: closer-level invariant. Eligibility above already guaranteed
  // a valid URL, but if a future refactor changes that we want a hard fail
  // rather than a Gmail send with an empty body.
  if (!record.directLinkUrl || !isValidDirectLinkUrl(record.directLinkUrl)) {
    const err = `Invite ${inviteId} missing valid directLinkUrl at send time.`;
    await appendCloseAudit(run, approval, {
      result: "error",
      inviteId,
      error: err,
    });
    return {
      ok: false,
      handled: true,
      kind: "faire-direct-invite",
      inviteId,
      error: err,
      threadMessage: `:warning: Faire Direct invite *${record.retailerName}* missing link URL. No email was sent.`,
    };
  }

  const sendImpl = options.sendImpl ?? sendViaGmailApiDetailed;
  const logEmailImpl = options.logEmailImpl ?? logEmail;

  const body = renderFaireInviteEmailBody(record);

  // ---- Gmail send -------------------------------------------------------
  const sendResult = await sendImpl({
    to: record.email,
    subject: SUBJECT,
    body,
  }).catch((err) => ({
    ok: false as const,
    error: err instanceof Error ? err.message : String(err),
  }));

  if (!sendResult.ok) {
    const err = `Gmail send failed: ${sendResult.error}`;
    await appendCloseAudit(run, approval, {
      result: "error",
      inviteId,
      error: err,
    });
    return {
      ok: false,
      handled: true,
      kind: "faire-direct-invite",
      inviteId,
      error: err,
      threadMessage: `:warning: Faire Direct invite to *${record.retailerName}* failed at Gmail send: ${err}. KV row NOT flipped to "sent". Fix the cause and re-approve, or send manually.`,
    };
  }

  // ---- HubSpot mirror (best-effort) ------------------------------------
  // Phase 3.1: prefer the operator-pasted hubspotContactId, but fall
  // back to a read-only findContactByEmail() lookup so the timeline
  // email associates to the retailer's contact record when it exists.
  // Mirrors the email-intelligence approval-executor pattern. Fail-soft.
  let hubspotEmailLogId: string | null = null;
  try {
    const contactId = await resolveHubSpotContactIdForInviteRecord(record, {
      findImpl: options.findContactImpl,
    });
    hubspotEmailLogId = await logEmailImpl({
      subject: SUBJECT,
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
  const markResult = await markFaireInviteSent(inviteId, {
    approvalId: approval.id,
    sentBy,
    gmailMessageId: sendResult.messageId,
    gmailThreadId: sendResult.threadId,
    hubspotEmailLogId,
    now: options.now ?? new Date(),
  });
  if (!markResult.ok) {
    // Gmail already went out — this is a partial-failure path. The
    // operator MUST know the email landed even though our KV is now
    // out of sync.
    const err = `KV flip failed after Gmail send: ${markResult.error.code} — ${markResult.error.message}`;
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
      kind: "faire-direct-invite",
      inviteId,
      error: err,
      threadMessage:
        `:warning: Gmail to *${record.retailerName}* SENT (\`${sendResult.messageId}\`), but KV flip to "sent" failed: ` +
        `${markResult.error.code}. Manually mark the invite as "sent" — the email already went out.`,
    };
  }

  // ---- Success audit + return ------------------------------------------
  const sentAtIso = markResult.invite.sentAt ?? new Date().toISOString();
  await appendCloseAudit(run, approval, {
    result: "ok",
    inviteId,
    gmailMessageId: sendResult.messageId,
    gmailThreadId: sendResult.threadId,
    hubspotEmailLogId,
  });

  const sentAtShort = sentAtIso.slice(0, 16);
  const threadMessage =
    `:envelope_with_arrow: Faire Direct invite sent to *${record.retailerName}* ` +
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
    kind: "faire-direct-invite",
    inviteId,
    gmailMessageId: sendResult.messageId,
    gmailThreadId: sendResult.threadId,
    hubspotEmailLogId,
    sentAt: sentAtIso,
    alreadySent: false,
    threadMessage,
  };
}

function makeRunContext(approval: ApprovalRequest): RunContext {
  return {
    runId: approval.runId,
    agentId: "faire-direct-invite-approved-closer",
    division: approval.division,
    startedAt: new Date().toISOString(),
    source: "event",
    trigger: `approval:${approval.id}`,
  };
}
