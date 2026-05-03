/**
 * JE approval card renderer — pure markdown for the #ops-approvals
 * card body. Read by the approval-surface; reviewers see the lines,
 * total, txn_date, memo, and rationale.
 */
import type { JeProposal, JeProposalValidationResult } from "./types";

function formatAmount(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function escapeBackticks(s: string): string {
  return s.replace(/`/g, "ʹ");
}

/**
 * Render the markdown body shown on the Slack approval card. Cohesive
 * one-screen view: header, txn_date, lines as a table-like list,
 * totals, rationale, sources.
 */
export function renderJeApprovalCard(
  proposal: JeProposal,
  validation: JeProposalValidationResult,
): string {
  const txnDate = proposal.txn_date ?? "(today on QBO side)";
  const lines = [
    `:ledger: *Manual Journal Entry — ${formatAmount(validation.totalDebitsUsd)}*`,
    `*Date:* \`${txnDate}\``,
    `*Memo:* ${escapeBackticks(proposal.memo)}`,
    "",
    "*Lines:*",
  ];

  for (const l of proposal.lines) {
    const sign =
      l.posting_type === "Debit" ? ":arrow_right: DR" : ":arrow_left: CR";
    const acct = l.account_name
      ? `${l.account_name} (\`${l.account_id}\`)`
      : `\`${l.account_id}\``;
    const desc = l.description ? ` — ${escapeBackticks(l.description)}` : "";
    lines.push(`  • ${sign}  ${acct}  ${formatAmount(l.amount)}${desc}`);
  }

  lines.push("");
  lines.push(
    `*Totals:*  Debits ${formatAmount(validation.totalDebitsUsd)} · Credits ${formatAmount(validation.totalCreditsUsd)}  ${
      validation.ok ? ":white_check_mark: balanced" : ":x: NOT BALANCED"
    }`,
  );

  lines.push("");
  lines.push("*Why:*");
  lines.push(`> ${escapeBackticks(proposal.rationale)}`);

  if (proposal.sources && proposal.sources.length > 0) {
    lines.push("");
    lines.push("*Sources:*");
    for (const s of proposal.sources) {
      const ref = s.url
        ? `<${s.url}|${s.id ?? s.system}>`
        : `\`${s.system}${s.id ? `:${s.id}` : ""}\``;
      lines.push(`  • ${ref}`);
    }
  }

  if (!validation.ok && validation.issues.length > 0) {
    lines.push("");
    lines.push(":warning: *Validation issues — DO NOT APPROVE:*");
    for (const issue of validation.issues) {
      lines.push(`  • \`${issue.field}\` — ${issue.reason}`);
    }
  }

  lines.push("");
  lines.push(
    "_Class C `qbo.journal_entry.post`. Approve = post to QBO. Both Ben + Rene must approve._",
  );

  return lines.join("\n");
}
