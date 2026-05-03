import { describe, expect, it } from "vitest";

import { renderJeApprovalCard } from "../card";
import { validateJeProposal } from "../validate";
import type { JeProposal } from "../types";

const proposal: JeProposal = {
  proposalId: "amex-reclass-1",
  memo: "JE 1505 — AmEx CC payment reclass",
  rationale: "Booke flagged $1,937.61 as expense; per Ben it's a transfer.",
  txn_date: "2026-01-15",
  lines: [
    {
      posting_type: "Debit",
      account_id: "85",
      account_name: "AmEx Liability",
      amount: 1937.61,
      description: "AmEx CC payment",
    },
    {
      posting_type: "Credit",
      account_id: "1",
      account_name: "BoA Checking 7020",
      amount: 1937.61,
    },
  ],
  sources: [
    {
      system: "qbo",
      id: "txn:1234",
      url: "https://qbo.intuit.com/app/transaction/1234",
    },
  ],
};

describe("renderJeApprovalCard", () => {
  const validation = validateJeProposal(proposal);
  const card = renderJeApprovalCard(proposal, validation);

  it("includes the header amount, txn_date, and memo", () => {
    expect(card).toContain(":ledger:");
    expect(card).toContain("$1937.61");
    expect(card).toContain("2026-01-15");
    expect(card).toContain("AmEx CC payment reclass");
  });

  it("renders both lines with DR/CR markers + account name + id + amount", () => {
    expect(card).toContain(":arrow_right: DR");
    expect(card).toContain(":arrow_left: CR");
    expect(card).toContain("AmEx Liability");
    expect(card).toContain("`85`");
    expect(card).toContain("BoA Checking 7020");
    expect(card).toContain("`1`");
  });

  it("shows balanced-totals checkmark when validation passes", () => {
    expect(card).toMatch(/Debits \$1937\.61 · Credits \$1937\.61/);
    expect(card).toContain(":white_check_mark: balanced");
    expect(card).not.toContain(":x: NOT BALANCED");
  });

  it("includes the rationale block", () => {
    expect(card).toContain("Why:");
    expect(card).toContain("Booke flagged");
  });

  it("renders source citations as clickable Slack links when url present", () => {
    expect(card).toContain("Sources:");
    expect(card).toContain("<https://qbo.intuit.com/app/transaction/1234|txn:1234>");
  });

  it("includes the Class C `qbo.journal_entry.post` footer", () => {
    expect(card).toContain("Class C `qbo.journal_entry.post`");
    expect(card).toContain("Both Ben + Rene must approve");
  });

  it("renders the validation-issues block when JE is unbalanced", () => {
    const bad: JeProposal = {
      ...proposal,
      lines: [
        { posting_type: "Debit", account_id: "1", amount: 100 },
        { posting_type: "Credit", account_id: "2", amount: 50 },
      ],
    };
    const v = validateJeProposal(bad);
    const c = renderJeApprovalCard(bad, v);
    expect(c).toContain(":x: NOT BALANCED");
    expect(c).toContain("Validation issues — DO NOT APPROVE");
  });

  it("escapes embedded backticks so the card markdown stays valid", () => {
    const tricky: JeProposal = {
      ...proposal,
      memo: "Reclass `using` backticks in the memo",
      lines: proposal.lines,
    };
    const v = validateJeProposal(tricky);
    const c = renderJeApprovalCard(tricky, v);
    // The escape replaces backticks with a Greek prime mark so the
    // surrounding markdown isn't broken.
    expect(c).toContain("Reclass ʹusingʹ backticks");
  });
});
