import { describe, it, expect } from "vitest";

import {
  applyDecision,
  buildApprovalRequest,
  checkExpiry,
  ProhibitedActionError,
  shouldEscalate,
  standDown,
  UnknownActionError,
} from "../approvals";

function baseParams() {
  return {
    runId: "run-1",
    division: "sales" as const,
    actorAgentId: "viktor",
    targetSystem: "gmail",
    payloadPreview: "Reply to Jungle Jim's vendor setup",
    evidence: {
      claim: "Jeffrey Williams asked for a vendor packet on Apr 15",
      sources: [
        { system: "gmail", id: "19d650cb793cc302", retrievedAt: new Date().toISOString() },
      ],
      confidence: 0.95,
    },
    rollbackPlan: "Recall via Gmail if within 30 minutes; otherwise send correction email.",
  };
}

describe("approval state machine", () => {
  it("rejects class-D actions outright", () => {
    expect(() =>
      buildApprovalRequest({
        ...baseParams(),
        actionSlug: "secret.share",
      }),
    ).toThrow(ProhibitedActionError);
  });

  it("rejects unregistered actions (fail-closed)", () => {
    expect(() =>
      buildApprovalRequest({
        ...baseParams(),
        actionSlug: "some.made.up.action",
      }),
    ).toThrow(UnknownActionError);
  });

  it("builds a pending class-B request with single approver", () => {
    const req = buildApprovalRequest({ ...baseParams(), actionSlug: "gmail.send" });
    expect(req.class).toBe("B");
    expect(req.status).toBe("pending");
    expect(req.requiredApprovers).toEqual(["Ben"]);
    expect(req.decisions).toHaveLength(0);
  });

  it("approves a class-B request on first approve", () => {
    const req = buildApprovalRequest({ ...baseParams(), actionSlug: "gmail.send" });
    const next = applyDecision(req, { approver: "Ben", decision: "approve" });
    expect(next.status).toBe("approved");
  });

  it("rejects a class-B request on first reject", () => {
    const req = buildApprovalRequest({ ...baseParams(), actionSlug: "gmail.send" });
    const next = applyDecision(req, { approver: "Ben", decision: "reject", reason: "wrong thread" });
    expect(next.status).toBe("rejected");
  });

  it("class-B: ask leaves status pending and records the decision", () => {
    const req = buildApprovalRequest({ ...baseParams(), actionSlug: "gmail.send" });
    const next = applyDecision(req, { approver: "Ben", decision: "ask", reason: "which template?" });
    expect(next.status).toBe("pending");
    expect(next.decisions).toHaveLength(1);
  });

  it("class-B: after ask, same approver can later approve", () => {
    const req = buildApprovalRequest({ ...baseParams(), actionSlug: "gmail.send" });
    const afterAsk = applyDecision(req, { approver: "Ben", decision: "ask", reason: "which template?" });
    expect(afterAsk.status).toBe("pending");

    const afterApprove = applyDecision(afterAsk, { approver: "Ben", decision: "approve" });
    expect(afterApprove.status).toBe("approved");
    expect(afterApprove.decisions).toHaveLength(2);
    expect(afterApprove.decisions.map((d) => d.decision)).toEqual(["ask", "approve"]);
  });

  it("class-B: after ask, same approver can later reject", () => {
    const req = buildApprovalRequest({ ...baseParams(), actionSlug: "gmail.send" });
    const afterAsk = applyDecision(req, { approver: "Ben", decision: "ask", reason: "confidence?" });
    const afterReject = applyDecision(afterAsk, { approver: "Ben", decision: "reject", reason: "stale context" });
    expect(afterReject.status).toBe("rejected");
    expect(afterReject.decisions).toHaveLength(2);
  });

  it("class-B: multiple asks from same approver are allowed while pending", () => {
    const req = buildApprovalRequest({ ...baseParams(), actionSlug: "gmail.send" });
    const a1 = applyDecision(req, { approver: "Ben", decision: "ask", reason: "which template?" });
    const a2 = applyDecision(a1, { approver: "Ben", decision: "ask", reason: "and which recipient list?" });
    expect(a2.status).toBe("pending");
    expect(a2.decisions).toHaveLength(2);
    expect(a2.decisions.every((d) => d.decision === "ask")).toBe(true);
  });

  it("class-B: duplicate approve from same approver is blocked after status transitions", () => {
    // Once class-B resolves to `approved`, the status guard at the top of applyDecision
    // rejects any further decision regardless of approver.
    const req = buildApprovalRequest({ ...baseParams(), actionSlug: "gmail.send" });
    const approved = applyDecision(req, { approver: "Ben", decision: "approve" });
    expect(() => applyDecision(approved, { approver: "Ben", decision: "approve" })).toThrow();
  });

  it("class-C: duplicate approve from the same approver is blocked while still pending", () => {
    // The request is still pending after one approve (needs two). A second approve
    // from the same approver must be rejected by the duplicate-terminal guard.
    const req = buildApprovalRequest({
      ...baseParams(),
      actionSlug: "qbo.invoice.send",
      division: "financials",
      actorAgentId: "finance-exception",
      targetSystem: "qbo",
      payloadPreview: "Invoice draft",
    });
    const afterBen = applyDecision(req, { approver: "Ben", decision: "approve" });
    expect(afterBen.status).toBe("pending");
    expect(() =>
      applyDecision(afterBen, { approver: "Ben", decision: "approve" }),
    ).toThrow(/already recorded an? approve/);
  });

  it("class-C: after ask, same approver's later approve counts toward the 2-of-2 threshold", () => {
    const req = buildApprovalRequest({
      ...baseParams(),
      actionSlug: "qbo.invoice.send",
      division: "financials",
      actorAgentId: "finance-exception",
      targetSystem: "qbo",
      payloadPreview: "Invoice draft",
    });
    const reneAsk = applyDecision(req, { approver: "Rene", decision: "ask", reason: "terms?" });
    const reneApprove = applyDecision(reneAsk, { approver: "Rene", decision: "approve" });
    expect(reneApprove.status).toBe("pending"); // still needs Ben
    const benApprove = applyDecision(reneApprove, { approver: "Ben", decision: "approve" });
    expect(benApprove.status).toBe("approved");
  });

  it("requires dual approval for class-C (qbo.invoice.send)", () => {
    const req = buildApprovalRequest({
      ...baseParams(),
      actionSlug: "qbo.invoice.send",
      division: "financials",
      actorAgentId: "finance-exception",
      targetSystem: "qbo",
      payloadPreview: "Invoice #1207 to Bryce Glamp & Camp, $117.00",
    });
    expect(req.class).toBe("C");
    expect(req.requiredApprovers).toEqual(["Ben", "Rene"]);

    const afterBen = applyDecision(req, { approver: "Ben", decision: "approve" });
    expect(afterBen.status).toBe("pending"); // still needs Rene

    const afterRene = applyDecision(afterBen, { approver: "Rene", decision: "approve" });
    expect(afterRene.status).toBe("approved");
  });

  it("class-C: a single reject terminates the request", () => {
    const req = buildApprovalRequest({
      ...baseParams(),
      actionSlug: "qbo.invoice.send",
      division: "financials",
      actorAgentId: "finance-exception",
      targetSystem: "qbo",
      payloadPreview: "Invoice draft",
    });
    const afterBen = applyDecision(req, { approver: "Ben", decision: "approve" });
    const afterRene = applyDecision(afterBen, { approver: "Rene", decision: "reject", reason: "amount wrong" });
    expect(afterRene.status).toBe("rejected");
  });

  it("refuses decisions from approvers not on the required list", () => {
    const req = buildApprovalRequest({ ...baseParams(), actionSlug: "gmail.send" });
    expect(() => applyDecision(req, { approver: "Rene", decision: "approve" })).toThrow();
  });

  it("refuses duplicate decisions from the same approver", () => {
    const req = buildApprovalRequest({
      ...baseParams(),
      actionSlug: "qbo.invoice.send",
      division: "financials",
      actorAgentId: "finance-exception",
      targetSystem: "qbo",
      payloadPreview: "Invoice draft",
    });
    const afterBen = applyDecision(req, { approver: "Ben", decision: "approve" });
    expect(() => applyDecision(afterBen, { approver: "Ben", decision: "approve" })).toThrow();
  });

  it("stand-down transitions pending → stood-down without forging a human rejection", () => {
    const req = buildApprovalRequest({ ...baseParams(), actionSlug: "gmail.send" });
    const next = standDown(req, "upstream lead went cold");
    expect(next.status).toBe("stood-down");
    // Audit integrity: no fake human decision is recorded.
    expect(next.decisions).toHaveLength(0);
    expect(next.decisions.some((d) => d.approver === "Ben")).toBe(false);
    // Stand-down metadata is recorded separately so consumers can distinguish
    // real rejection vs agent withdrawal.
    expect(next.standDown).toBeDefined();
    expect(next.standDown?.reason).toBe("upstream lead went cold");
    expect(next.standDown?.byAgentId).toBe("viktor");
    expect(next.standDown?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("stand-down is attributable to a specific agent, overrideable by caller", () => {
    const req = buildApprovalRequest({ ...baseParams(), actionSlug: "gmail.send" });
    const next = standDown(req, "replaced by newer request", new Date(), "orchestrator");
    expect(next.standDown?.byAgentId).toBe("orchestrator");
    expect(next.status).toBe("stood-down");
    expect(next.decisions).toHaveLength(0);
  });

  it("checkExpiry: pending → expired after 72h", () => {
    const req = buildApprovalRequest({ ...baseParams(), actionSlug: "gmail.send" });
    const future = new Date(Date.now() + 73 * 3_600_000);
    expect(checkExpiry(req, future).status).toBe("expired");
  });

  it("shouldEscalate: true after 24h pending", () => {
    const req = buildApprovalRequest({ ...baseParams(), actionSlug: "gmail.send" });
    const after25h = new Date(Date.now() + 25 * 3_600_000);
    expect(shouldEscalate(req, after25h)).toBe(true);
    expect(shouldEscalate(req, new Date())).toBe(false);
  });
});
