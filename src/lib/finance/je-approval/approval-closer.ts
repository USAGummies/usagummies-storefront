/**
 * Closer for approved Class C `qbo.journal_entry.post` approvals.
 *
 * When BOTH Ben and Rene click Approve on a JE card, the Slack
 * interactive route flips status to "approved" and dispatches here.
 * The closer:
 *
 *   1. Loads the persisted JE proposal (kept under approval id at
 *      propose-time so the line-level structured data survives).
 *   2. POSTs to the existing `/api/ops/qbo/journal-entry` route with
 *      the proposal lines + memo + txn_date. That route's existing
 *      guardrail layer (`validateQBOWrite`) runs again — defense in
 *      depth — before QBO writes.
 *   3. Audits the post via the audit store. Source citations include
 *      the approval id, the propose-route source citations, and the
 *      QBO journal-entry id once we have it.
 *
 * Hard rules:
 *   - The closer NEVER computes lines on its own. If the persisted
 *     payload is missing, the closer fails closed with a clear error
 *     in the thread message — Ben + Rene re-propose if they want to
 *     retry.
 *   - The closer does NOT bypass the QBO endpoint's own validation.
 *     A second-pass validation failure still rejects with 422.
 *
 * Strict gating: targetEntity.type === "qbo-journal-entry" AND
 * action slug equals `qbo.journal_entry.post`. Either gate failing
 * means a different closer should handle the approval (or none).
 */
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { auditSurface } from "@/lib/ops/control-plane/slack";
import type {
  ApprovalRequest,
  RunContext,
} from "@/lib/ops/control-plane/types";

import { loadJeProposalPayload } from "./payload-store";
import type { JeApprovalExecutionResult } from "./types";

const TARGET_ENTITY_TYPE = "qbo-journal-entry";
const ACTION_SLUG = "qbo.journal_entry.post";
const QBO_JE_PATH = "/api/ops/qbo/journal-entry";
const DEFAULT_SITE_URL = "https://www.usagummies.com";

interface CloseAuditFields {
  result: "ok" | "error";
  qboJournalEntryId?: string;
  validationIssues?: unknown;
  error?: string;
}

async function appendCloseAudit(
  run: RunContext,
  approval: ApprovalRequest,
  fields: CloseAuditFields,
) {
  const action =
    fields.result === "ok"
      ? "qbo.journal_entry.post.success"
      : "qbo.journal_entry.post.failed";
  const entry = buildAuditEntry(run, {
    action,
    entityType: "qbo.journal-entry",
    entityId: fields.qboJournalEntryId ?? approval.targetEntity?.id,
    result: fields.result,
    approvalId: approval.id,
    after: {
      qboJournalEntryId: fields.qboJournalEntryId,
      validationIssues: fields.validationIssues,
    },
    error: fields.error ? { message: fields.error } : undefined,
    sourceCitations: [
      { system: "control-plane:approval", id: approval.id },
      ...(fields.qboJournalEntryId
        ? [
            {
              system: "qbo:journal-entry",
              id: fields.qboJournalEntryId,
            },
          ]
        : []),
    ],
    confidence: approval.evidence.confidence,
  });
  await auditStore().append(entry);
  await auditSurface()
    .mirror(entry)
    .catch(() => void 0);
}

interface QboJeRouteResponse {
  ok?: boolean;
  blocked?: boolean;
  validation?: { issues?: unknown; summary?: string };
  journal_entry?: { Id?: string };
  error?: string;
  message?: string;
}

/**
 * Run the closer for an approved JE post. Returns `handled=false`
 * if this isn't a JE approval (caller falls through to other closers).
 *
 * Test seam: pass `fetchImpl` to substitute a mock fetch.
 */
export async function executeApprovedJournalEntryPost(
  approval: ApprovalRequest,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<JeApprovalExecutionResult> {
  // ---- Strict gating ----
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
      reason: "not a journal-entry approval",
    };
  }
  if (approval.action !== ACTION_SLUG) {
    return {
      ok: true,
      handled: false,
      reason: `action ${approval.action} is not ${ACTION_SLUG}`,
    };
  }

  const run: RunContext = {
    runId: approval.runId,
    agentId: "qbo-journal-entry-approved-closer",
    division: approval.division,
    startedAt: new Date().toISOString(),
    source: "event",
    trigger: `approval:${approval.id}`,
  };

  const stored = await loadJeProposalPayload(approval.id);
  if (!stored) {
    const err = `JE approval ${approval.id} has no persisted payload — propose route may have skipped persist, or the 30d TTL expired. Re-propose to retry.`;
    await appendCloseAudit(run, approval, { result: "error", error: err });
    return {
      ok: false,
      handled: true,
      kind: "qbo-journal-entry-post-failed",
      approvalId: approval.id,
      error: err,
      threadMessage: `:warning: JE approval recorded, but closer could not load the proposal payload: ${err}`,
    };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = (
    process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL
  ).replace(/\/$/, "");
  const url = `${baseUrl}${QBO_JE_PATH}`;
  const cronSecret = process.env.CRON_SECRET ?? "";

  // The /api/ops/qbo/journal-entry endpoint already exists and runs
  // its own guardrails. Call it as a thin pass-through; we don't
  // reimplement the QBO write logic.
  let httpStatus = 0;
  let body: QboJeRouteResponse | null = null;
  let networkError: string | null = null;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({
        lines: stored.proposal.lines,
        txn_date: stored.proposal.txn_date,
        memo: stored.proposal.memo,
        caller: `je-approval-closer:${approval.id}`,
      }),
    });
    httpStatus = res.status;
    try {
      body = (await res.json()) as QboJeRouteResponse;
    } catch {
      body = null;
    }
  } catch (err) {
    networkError = err instanceof Error ? err.message : String(err);
  }

  // Failure paths: network error, non-OK body, validation block.
  if (networkError || !body || body.ok !== true) {
    const errMsg =
      networkError ||
      body?.error ||
      body?.message ||
      `QBO journal-entry route returned HTTP ${httpStatus} without ok=true`;
    await appendCloseAudit(run, approval, {
      result: "error",
      validationIssues: body?.validation?.issues,
      error: errMsg,
    });
    const blocked = body?.blocked === true;
    const blockedSuffix = blocked
      ? ` Validation blocked by guardrails: ${body?.validation?.summary ?? errMsg}.`
      : "";
    return {
      ok: false,
      handled: true,
      kind: "qbo-journal-entry-post-failed",
      approvalId: approval.id,
      error: errMsg,
      threadMessage: `:warning: JE approval recorded, but the QBO post call failed: ${errMsg}.${blockedSuffix} The proposal payload is preserved (KV ${approval.id}); fix the cause and re-propose if needed.`,
    };
  }

  // Success path.
  const qboJeId = body.journal_entry?.Id ?? "(id not returned)";
  await appendCloseAudit(run, approval, {
    result: "ok",
    qboJournalEntryId: qboJeId,
  });
  return {
    ok: true,
    handled: true,
    kind: "qbo-journal-entry-posted",
    approvalId: approval.id,
    qboJournalEntryId: qboJeId,
    threadMessage: `:ledger: Journal entry posted to QBO — id \`${qboJeId}\` · txn_date \`${stored.proposal.txn_date ?? "(today)"}\` · totals balanced. Memo: _${stored.proposal.memo}_.`,
  };
}
