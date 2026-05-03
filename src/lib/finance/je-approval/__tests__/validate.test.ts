import { describe, expect, it } from "vitest";

import { validateJeProposal } from "../validate";
import type { JeProposal } from "../types";

function baseProposal(overrides: Partial<JeProposal> = {}): JeProposal {
  return {
    proposalId: "p-1",
    memo: "Reclass JE",
    rationale: "Q1 cleanup",
    txn_date: "2026-01-31",
    lines: [
      {
        posting_type: "Debit",
        account_id: "37",
        account_name: "Owner's Draw",
        amount: 50,
      },
      {
        posting_type: "Credit",
        account_id: "1",
        account_name: "BoA Checking",
        amount: 50,
      },
    ],
    ...overrides,
  };
}

describe("validateJeProposal", () => {
  it("passes a balanced 2-line JE with memo + rationale", () => {
    const r = validateJeProposal(baseProposal());
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.totalDebitsUsd).toBe(50);
    expect(r.totalCreditsUsd).toBe(50);
  });

  it("fails when debits and credits don't balance", () => {
    const r = validateJeProposal(
      baseProposal({
        lines: [
          { posting_type: "Debit", account_id: "1", amount: 50 },
          { posting_type: "Credit", account_id: "2", amount: 25 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(
      r.issues.some(
        (i) => i.field === "lines" && i.reason.includes("does not balance"),
      ),
    ).toBe(true);
  });

  it("fails when memo is empty", () => {
    const r = validateJeProposal(baseProposal({ memo: "  " }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === "memo")).toBe(true);
  });

  it("fails when rationale is empty", () => {
    const r = validateJeProposal(baseProposal({ rationale: "" }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === "rationale")).toBe(true);
  });

  it("fails on bad txn_date format (e.g. 04/12/26 — the 2026-04-13 bug)", () => {
    const r = validateJeProposal(baseProposal({ txn_date: "04/12/26" }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === "txn_date")).toBe(true);
  });

  it("accepts undefined txn_date (falls back to today on QBO side)", () => {
    const r = validateJeProposal(baseProposal({ txn_date: undefined }));
    expect(r.ok).toBe(true);
  });

  it("fails on a single-line JE (must be at least 2)", () => {
    const r = validateJeProposal(
      baseProposal({
        lines: [{ posting_type: "Debit", account_id: "1", amount: 50 }],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === "lines")).toBe(true);
  });

  it("fails on missing account_id", () => {
    const r = validateJeProposal(
      baseProposal({
        lines: [
          { posting_type: "Debit", account_id: "", amount: 50 },
          { posting_type: "Credit", account_id: "2", amount: 50 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(
      r.issues.some((i) => i.field === "lines[0].account_id"),
    ).toBe(true);
  });

  it("fails on negative amount", () => {
    const r = validateJeProposal(
      baseProposal({
        lines: [
          { posting_type: "Debit", account_id: "1", amount: -50 },
          { posting_type: "Credit", account_id: "2", amount: 50 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(
      r.issues.some((i) => i.field === "lines[0].amount"),
    ).toBe(true);
  });

  it("fails on per-line cap breach ($1,000,000+)", () => {
    const r = validateJeProposal(
      baseProposal({
        lines: [
          { posting_type: "Debit", account_id: "1", amount: 1_000_001 },
          { posting_type: "Credit", account_id: "2", amount: 1_000_001 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(
      r.issues.some(
        (i) =>
          i.field.startsWith("lines[") && i.reason.includes("per-line cap"),
      ),
    ).toBe(true);
  });

  it("fails on bad posting_type", () => {
    const r = validateJeProposal(
      baseProposal({
        lines: [
          {
            posting_type: "Sideways" as unknown as "Debit",
            account_id: "1",
            amount: 50,
          },
          { posting_type: "Credit", account_id: "2", amount: 50 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(
      r.issues.some((i) => i.field === "lines[0].posting_type"),
    ).toBe(true);
  });

  it("accepts the half-penny float-tolerance window", () => {
    const r = validateJeProposal(
      baseProposal({
        lines: [
          { posting_type: "Debit", account_id: "1", amount: 50.001 },
          { posting_type: "Credit", account_id: "2", amount: 50.0 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
  });

  // Real-world reclass shape from the 4/12 #financials thread
  // ($1,937.61 AmEx CC payment as transfer, not expense).
  it("validates a real reclass: $1,937.61 AmEx transfer (DR AmEx liability / CR BoA Checking)", () => {
    const r = validateJeProposal({
      proposalId: "amex-jan-payment-1",
      memo: "JE 1505 — January AmEx payment reclassed from expense to transfer",
      rationale:
        "Booke flagged $1,937.61 AmEx CC payment as Misc expense; per Ben's call it's a CC liability transfer, not an expense.",
      txn_date: "2026-01-15",
      lines: [
        {
          posting_type: "Debit",
          account_id: "85",
          account_name: "AmEx Liability",
          amount: 1937.61,
        },
        {
          posting_type: "Credit",
          account_id: "1",
          account_name: "BoA Checking 7020",
          amount: 1937.61,
        },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.totalDebitsUsd).toBe(1937.61);
    expect(r.totalCreditsUsd).toBe(1937.61);
  });
});
