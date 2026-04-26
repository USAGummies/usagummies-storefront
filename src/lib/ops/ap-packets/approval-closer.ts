/**
 * Closer for approved AP-packet `gmail.send` approvals.
 *
 * The pattern mirrors the email-reply and shipment-create closers:
 * Slack POSTs an approve click → /api/slack/approvals updates the
 * canonical approvalStore via recordDecision() → this closer fires
 * when status flips to "approved" and the approval's targetEntity
 * unambiguously identifies an AP packet.
 *
 * Identification is strict (locked by tests):
 *   - approval.status === "approved"
 *   - targetEntity?.type === "ap-packet"
 *   - targetEntity.id === "ap-packet:<slug>"  (parsed for the slug)
 *   - approval.id is the approvalToken passed to /send
 *
 * The actual send work is NOT duplicated here. We dispatch to the
 * existing `/api/ops/fulfillment/ap-packet/send` route, which is the
 * single source of truth for:
 *   - Triple-gate dedup (Gmail SENT + HubSpot + KV)
 *   - Drive attachment fetch (W-9, COI, sell sheet)
 *   - In-process item-list CSV generation
 *   - Gmail compose + send via the Gmail API
 *   - HubSpot logEmail timeline entry
 *   - KV `ap-packets:sent:<slug>` write (this is what the dashboard
 *     surfaces as `lastSent`)
 *   - Audit
 *
 * That route already enforces approvalToken matching, dedup, attachment
 * readiness — so this closer is a thin trigger that:
 *   - decides whether to fire (strict gate)
 *   - calls /send exactly once
 *   - audits the approval-to-send hand-off
 *   - returns a structured result the Slack handler can render
 *
 * No retries. A failure here surfaces in the Slack thread and
 * #ops-audit; the operator can re-trigger via the existing
 * `/api/ops/fulfillment/ap-packet/send` POST after fixing the cause.
 * Re-clicking Approve in Slack does NOT re-fire this closer because
 * recordDecision() rejects state transitions on already-approved rows
 * (returns 409 from the slack route).
 */
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { auditSurface } from "@/lib/ops/control-plane/slack";
import type {
  ApprovalRequest,
  RunContext,
} from "@/lib/ops/control-plane/types";

export type ApPacketApprovalExecutionResult =
  | {
      ok: true;
      handled: true;
      kind: "ap-packet-send";
      slug: string;
      messageId: string;
      threadId: string | null;
      hubspotLogId: string | null;
      sentAt: string;
      threadMessage: string;
    }
  | {
      ok: false;
      handled: true;
      kind: "ap-packet-send";
      slug: string | null;
      error: string;
      threadMessage: string;
    }
  | { ok: true; handled: false; reason: string };

interface SendRouteResponse {
  ok?: boolean;
  slug?: string;
  messageId?: string;
  threadId?: string | null;
  hubspotLogId?: string | null;
  approvalId?: string;
  sentAt?: string;
  attachmentCount?: number;
  error?: string;
  reason?: string;
}

const TARGET_ENTITY_TYPE = "ap-packet";
const TARGET_ENTITY_PREFIX = "ap-packet:";
const SEND_PATH = "/api/ops/fulfillment/ap-packet/send";
const DEFAULT_SITE_URL = "https://www.usagummies.com";

function slugFromTargetEntity(approval: ApprovalRequest): string | null {
  const id = approval.targetEntity?.id?.trim();
  if (!id || !id.startsWith(TARGET_ENTITY_PREFIX)) return null;
  const slug = id.slice(TARGET_ENTITY_PREFIX.length).trim();
  return slug.length > 0 ? slug : null;
}

async function appendCloseAudit(
  run: RunContext,
  approval: ApprovalRequest,
  fields: {
    result: "ok" | "error";
    slug: string | null;
    messageId?: string | null;
    threadId?: string | null;
    hubspotLogId?: string | null;
    error?: string;
  },
) {
  const entry = buildAuditEntry(run, {
    action: "ap-packet.approved.send",
    entityType: "ap-packet",
    entityId: fields.slug ? `ap-packet:${fields.slug}` : approval.targetEntity?.id,
    result: fields.result,
    approvalId: approval.id,
    after: {
      slug: fields.slug,
      messageId: fields.messageId,
      threadId: fields.threadId,
      hubspotLogId: fields.hubspotLogId,
    },
    error: fields.error ? { message: fields.error } : undefined,
    sourceCitations: [
      { system: "control-plane:approval", id: approval.id },
      ...(fields.slug
        ? [{ system: "ap-packet", id: fields.slug }]
        : []),
    ],
    confidence: approval.evidence.confidence,
  });
  await auditStore().append(entry);
  await auditSurface()
    .mirror(entry)
    .catch(() => void 0);
}

/**
 * Run the closer for one approval. Strict gating + at-most-one /send
 * dispatch per call.
 *
 * Test seam: pass `fetchImpl` to substitute a mock fetch. Production
 * uses globalThis.fetch.
 */
export async function executeApprovedApPacketSend(
  approval: ApprovalRequest,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<ApPacketApprovalExecutionResult> {
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
      reason: "not an ap-packet approval",
    };
  }
  const slug = slugFromTargetEntity(approval);
  if (!slug) {
    const err = `ap-packet approval ${approval.id} missing valid targetEntity.id (expected "ap-packet:<slug>")`;
    const run: RunContext = {
      runId: approval.runId,
      agentId: "ap-packet-approved-closer",
      division: approval.division,
      startedAt: new Date().toISOString(),
      source: "event",
      trigger: `approval:${approval.id}`,
    };
    await appendCloseAudit(run, approval, {
      result: "error",
      slug: null,
      error: err,
    });
    return {
      ok: false,
      handled: true,
      kind: "ap-packet-send",
      slug: null,
      error: err,
      threadMessage: `:warning: AP packet approval recorded, but closer could not derive slug: ${err}`,
    };
  }

  const run: RunContext = {
    runId: approval.runId,
    agentId: "ap-packet-approved-closer",
    division: approval.division,
    startedAt: new Date().toISOString(),
    source: "event",
    trigger: `approval:${approval.id}`,
  };

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = (
    process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL
  ).replace(/\/$/, "");
  const url = `${baseUrl}${SEND_PATH}`;
  const cronSecret = process.env.CRON_SECRET ?? "";

  let httpStatus = 0;
  let body: SendRouteResponse | null = null;
  let networkError: string | null = null;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({
        slug,
        approvalToken: approval.id,
      }),
    });
    httpStatus = res.status;
    try {
      body = (await res.json()) as SendRouteResponse;
    } catch {
      body = null;
    }
  } catch (err) {
    networkError = err instanceof Error ? err.message : String(err);
  }

  // ---- Failure path -----------------------------------------------------
  if (networkError || !body || body.ok !== true) {
    const errMsg =
      networkError ||
      body?.error ||
      body?.reason ||
      `send route returned HTTP ${httpStatus} without ok=true`;
    await appendCloseAudit(run, approval, {
      result: "error",
      slug,
      error: errMsg,
    });
    return {
      ok: false,
      handled: true,
      kind: "ap-packet-send",
      slug,
      error: errMsg,
      threadMessage: `:warning: AP packet approval recorded for *${slug}*, but the send call failed: ${errMsg}. No \`lastSent\` written. Fix the cause and POST /api/ops/fulfillment/ap-packet/send manually with this approvalToken to retry.`,
    };
  }

  // ---- Success path -----------------------------------------------------
  // The send route already wrote the KV `ap-packets:sent:<slug>` row
  // and audited the send. We add one more audit entry to record the
  // approval-to-send hand-off.
  await appendCloseAudit(run, approval, {
    result: "ok",
    slug,
    messageId: body.messageId ?? null,
    threadId: body.threadId ?? null,
    hubspotLogId: body.hubspotLogId ?? null,
  });

  const apEmail = approval.targetEntity?.label
    ? approval.targetEntity.label.replace(/\s+AP reply$/i, "")
    : slug;
  const sentAtShort = body.sentAt ? body.sentAt.slice(0, 16) : "";
  const threadMessage =
    `:envelope_with_arrow: AP packet *${slug}* sent — ${apEmail}` +
    `${body.messageId ? ` · Gmail message \`${body.messageId}\`` : ""}` +
    `${body.threadId ? ` · thread \`${body.threadId}\`` : ""}` +
    `${body.hubspotLogId ? ` · HubSpot log \`${body.hubspotLogId}\`` : " · HubSpot log pending/unavailable"}` +
    `${sentAtShort ? ` · sent at \`${sentAtShort}\`` : ""}`;

  return {
    ok: true,
    handled: true,
    kind: "ap-packet-send",
    slug,
    messageId: body.messageId!,
    threadId: body.threadId ?? null,
    hubspotLogId: body.hubspotLogId ?? null,
    sentAt: body.sentAt ?? new Date().toISOString(),
    threadMessage,
  };
}
