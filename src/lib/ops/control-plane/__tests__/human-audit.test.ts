import { describe, expect, it } from "vitest";

import { buildAuditEntry, buildHumanAuditEntry } from "../audit";
import { newRunContext } from "../run-id";

describe("buildHumanAuditEntry", () => {
  it("sets actorType to 'human' and actorId to a HumanOwner", () => {
    const entry = buildHumanAuditEntry({
      runId: "run-123",
      division: "sales",
      actorId: "Ben",
      action: "approval.approve",
      entityType: "approval",
      entityId: "app-456",
      before: { status: "pending", decisions: 0 },
      after: { status: "approved", decisions: 1 },
      result: "ok",
      approvalId: "app-456",
      sourceCitations: [{ system: "slack", id: "U08JY86Q508" }],
    });
    expect(entry.actorType).toBe("human");
    expect(entry.actorId).toBe("Ben");
    expect(entry.runId).toBe("run-123");
    expect(entry.division).toBe("sales");
    expect(entry.approvalId).toBe("app-456");
    expect(entry.before).toEqual({ status: "pending", decisions: 0 });
    expect(entry.after).toEqual({ status: "approved", decisions: 1 });
    expect(entry.sourceCitations).toEqual([
      { system: "slack", id: "U08JY86Q508" },
    ]);
  });

  it("mints a fresh id per call (never duplicates)", () => {
    const e1 = buildHumanAuditEntry({
      runId: "r",
      division: "financials",
      actorId: "Rene",
      action: "approval.reject",
      entityType: "approval",
      result: "ok",
    });
    const e2 = buildHumanAuditEntry({
      runId: "r",
      division: "financials",
      actorId: "Rene",
      action: "approval.reject",
      entityType: "approval",
      result: "ok",
    });
    expect(e1.id).not.toBe(e2.id);
  });

  it("is distinguishable from buildAuditEntry (agent) on actorType", () => {
    const run = newRunContext({
      agentId: "viktor",
      division: "sales",
      source: "on-demand",
    });
    const agentEntry = buildAuditEntry(run, {
      action: "open-brain.capture",
      entityType: "thought",
      result: "ok",
    });
    const humanEntry = buildHumanAuditEntry({
      runId: run.runId,
      division: run.division,
      actorId: "Ben",
      action: "approval.approve",
      entityType: "approval",
      result: "ok",
    });
    expect(agentEntry.actorType).toBe("agent");
    expect(humanEntry.actorType).toBe("human");
    // Both share the runId so the audit trail links them.
    expect(agentEntry.runId).toBe(humanEntry.runId);
  });

  it("defaults empty sourceCitations if omitted", () => {
    const entry = buildHumanAuditEntry({
      runId: "r",
      division: "production-supply-chain",
      actorId: "Drew",
      action: "approval.ask",
      entityType: "approval",
      result: "ok",
    });
    expect(entry.sourceCitations).toEqual([]);
  });
});
