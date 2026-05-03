/**
 * JE proposal validator.
 *
 * Pure function. Catches the common mistakes that a Class C
 * dual-approval gate is supposed to catch:
 *   • Lines don't balance (debits ≠ credits)
 *   • Empty lines / 0-amount lines
 *   • Missing account_id on a line
 *   • Wrong txn_date format (the 2026-04-13 month-rollover bug)
 *   • Missing memo (audit blind spot)
 *
 * Validation runs BEFORE the approval card is posted. Validation
 * issues fail the propose route with 400; the approval card never
 * lands in #ops-approvals if the JE doesn't balance.
 */
import type {
  JeProposal,
  JeProposalValidationResult,
  JeProposalValidationIssue,
} from "./types";

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
/** Cap on raw amount magnitude per line to catch fat-finger errors (e.g. extra 0). */
const MAX_LINE_AMOUNT_USD = 1_000_000;
const BALANCE_TOLERANCE_USD = 0.005; // half a penny — float-safe equality

export function validateJeProposal(
  proposal: JeProposal,
): JeProposalValidationResult {
  const issues: JeProposalValidationIssue[] = [];

  if (!proposal.memo || proposal.memo.trim().length === 0) {
    issues.push({
      field: "memo",
      reason: "memo is required (header PrivateNote — audit blind spot without it)",
    });
  }
  if (!proposal.rationale || proposal.rationale.trim().length === 0) {
    issues.push({
      field: "rationale",
      reason: "rationale is required (why this JE is being posted)",
    });
  }
  if (proposal.txn_date && !ISO_DATE_REGEX.test(proposal.txn_date)) {
    issues.push({
      field: "txn_date",
      reason: `txn_date must be YYYY-MM-DD; got "${proposal.txn_date}"`,
    });
  }

  if (!Array.isArray(proposal.lines) || proposal.lines.length === 0) {
    issues.push({
      field: "lines",
      reason: "lines must be a non-empty array",
    });
    return {
      ok: false,
      issues,
      totalDebitsUsd: 0,
      totalCreditsUsd: 0,
    };
  }
  if (proposal.lines.length < 2) {
    issues.push({
      field: "lines",
      reason: `journal entry needs at least 2 lines (got ${proposal.lines.length}) — debits must equal credits`,
    });
  }

  let totalDebitsUsd = 0;
  let totalCreditsUsd = 0;
  proposal.lines.forEach((line, i) => {
    const here = `lines[${i}]`;
    if (!line || typeof line !== "object") {
      issues.push({ field: here, reason: "line entry must be an object" });
      return;
    }
    if (line.posting_type !== "Debit" && line.posting_type !== "Credit") {
      issues.push({
        field: `${here}.posting_type`,
        reason: `must be "Debit" or "Credit"; got ${JSON.stringify(line.posting_type)}`,
      });
    }
    if (!line.account_id || typeof line.account_id !== "string") {
      issues.push({
        field: `${here}.account_id`,
        reason: "QBO account_id is required (string)",
      });
    }
    if (
      typeof line.amount !== "number" ||
      !Number.isFinite(line.amount) ||
      line.amount <= 0
    ) {
      issues.push({
        field: `${here}.amount`,
        reason: `amount must be a positive finite number; got ${JSON.stringify(line.amount)}`,
      });
      return;
    }
    if (line.amount > MAX_LINE_AMOUNT_USD) {
      issues.push({
        field: `${here}.amount`,
        reason: `amount $${line.amount} exceeds per-line cap ($${MAX_LINE_AMOUNT_USD}) — confirm this isn't a typo`,
      });
    }
    if (line.posting_type === "Debit") totalDebitsUsd += line.amount;
    if (line.posting_type === "Credit") totalCreditsUsd += line.amount;
  });

  // Balance check is the load-bearing one.
  const delta = Math.abs(totalDebitsUsd - totalCreditsUsd);
  if (delta > BALANCE_TOLERANCE_USD) {
    issues.push({
      field: "lines",
      reason: `JE does not balance: debits $${totalDebitsUsd.toFixed(2)} vs credits $${totalCreditsUsd.toFixed(2)} (delta $${delta.toFixed(2)})`,
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    totalDebitsUsd: Math.round(totalDebitsUsd * 100) / 100,
    totalCreditsUsd: Math.round(totalCreditsUsd * 100) / 100,
  };
}
