/**
 * JE approval types — Class C `qbo.journal_entry.post`.
 *
 * Mirrors the `/api/ops/qbo/journal-entry` POST body shape so the
 * closer's payload pass-through is 1:1.
 */

export type PostingType = "Debit" | "Credit";

export interface JeLine {
  /** "Debit" | "Credit" — direction relative to AccountRef. */
  posting_type: PostingType;
  /** QBO Account.Id (string). Caller resolves account_name → id beforehand. */
  account_id: string;
  /** Optional human-readable account name for the card preview only. */
  account_name?: string;
  /** Always positive; the posting_type determines the sign. */
  amount: number;
  /** Per-line memo (shown in QBO line memo + on the card). */
  description?: string;
}

export interface JeProposal {
  /** Lines must balance: sum(debits) === sum(credits). */
  lines: JeLine[];
  /** ISO date `YYYY-MM-DD`. Defaults to today on QBO side if absent. */
  txn_date?: string;
  /** PrivateNote on the JournalEntry header. Required for audit. */
  memo: string;
  /** Free-form caller tag — defaults to "claude" / "viktor" / explicit human. */
  caller?: string;
  /** Opaque request id for idempotency on the propose route. */
  proposalId: string;
  /**
   * Why this JE is being posted — surfaced on the card so reviewers
   * understand the WHY, not just the WHAT. Skipping this is a code
   * smell ("why are we posting?") so the propose route requires it.
   */
  rationale: string;
  /** Source citations passed through to the audit envelope. */
  sources?: Array<{ system: string; id?: string; url?: string }>;
}

export interface JeProposalValidationIssue {
  field: string;
  reason: string;
}

export interface JeProposalValidationResult {
  ok: boolean;
  issues: JeProposalValidationIssue[];
  /** Sum of debits in USD. */
  totalDebitsUsd: number;
  /** Sum of credits in USD. */
  totalCreditsUsd: number;
}

export type JeApprovalExecutionResult =
  | {
      ok: true;
      handled: true;
      kind: "qbo-journal-entry-posted";
      approvalId: string;
      qboJournalEntryId: string;
      threadMessage: string;
    }
  | {
      ok: false;
      handled: true;
      kind: "qbo-journal-entry-post-failed";
      approvalId: string;
      error: string;
      threadMessage: string;
    }
  | { ok: true; handled: false; reason: string };
