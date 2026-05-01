/**
 * Agent-graduation gauge coverage.
 *
 * Pins:
 *   - getNextStage / isAdvanceable correctly identify terminal stages.
 *   - Each criterion fires the right pass/fail on the right input.
 *   - readiness = passed/total; readyToGraduate iff all pass + non-terminal.
 *   - summarizeGraduations rolls up correctly.
 *   - groupAuditByAgent slices the audit log by actorId, ignores
 *     human entries + unknown agents.
 */
import { describe, expect, it } from "vitest";

import {
  GRADUATION_WINDOW_DAYS,
  evaluateAgentGraduation,
  evaluateAllGraduations,
  getNextStage,
  groupAuditByAgent,
  isAdvanceable,
  summarizeGraduations,
  type AgentGraduationGauge,
} from "../agent-graduation";
import type { AgentHealthRow, AgentManifestEntry } from "../agent-health";
import type { AuditLogEntry } from "../control-plane/types";

const NOW = new Date("2026-04-30T12:00:00Z");

function rec(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: "audit-1",
    runId: "run-1",
    division: "production-supply-chain" as never,
    actorType: "agent",
    actorId: "ops",
    action: "approval.create",
    entityType: "approval",
    result: "ok",
    sourceCitations: [{ system: "test" }],
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

function row(overrides: Partial<AgentHealthRow> = {}): AgentHealthRow {
  return {
    id: "ops",
    name: "Ops Agent",
    contract: "/contracts/agents/ops.md",
    classification: "job",
    approvalClass: "B",
    owner: "ben",
    approver: "ben",
    lifecycle: "active",
    purpose: "x",
    doctrineFlags: [],
    health: "green",
    ...overrides,
  };
}

describe("getNextStage / isAdvanceable", () => {
  it("proposed → active", () => {
    expect(getNextStage("proposed")).toBe("active");
    expect(isAdvanceable("proposed")).toBe(true);
  });
  it("active → graduated", () => {
    expect(getNextStage("active")).toBe("graduated");
    expect(isAdvanceable("active")).toBe(true);
  });
  it("graduated, retired, parked are terminal", () => {
    expect(getNextStage("graduated")).toBeNull();
    expect(getNextStage("retired")).toBeNull();
    expect(getNextStage("parked")).toBeNull();
    expect(isAdvanceable("graduated")).toBe(false);
    expect(isAdvanceable("retired")).toBe(false);
    expect(isAdvanceable("parked")).toBe(false);
  });
});

describe("evaluateAgentGraduation — criteria firing", () => {
  it("happy-path active job with healthy audit → all 8 criteria pass", () => {
    const audit: AuditLogEntry[] = [
      rec({ id: "a1", action: "approval.create", result: "ok", createdAt: NOW.toISOString() }),
      rec({ id: "a2", action: "shipment.create.dispatch", result: "ok", createdAt: NOW.toISOString() }),
      rec({ id: "a3", action: "hubspot.deal.update", result: "ok", createdAt: NOW.toISOString() }),
    ];
    const g = evaluateAgentGraduation({ row: row(), audit, now: NOW });
    expect(g.passed).toBe(g.total);
    expect(g.readyToGraduate).toBe(true);
    expect(g.nextStage).toBe("graduated");
    expect(g.summary).toMatch(/Ready to graduate/);
  });

  it("missing contract → has-contract fails", () => {
    const g = evaluateAgentGraduation({
      row: row({ contract: "" }),
      audit: [rec()],
      now: NOW,
    });
    const c = g.criteria.find((c) => c.id === "has-contract")!;
    expect(c.passed).toBe(false);
  });

  it("drew-owns flags has-named-owner fail", () => {
    const g = evaluateAgentGraduation({
      row: row({ owner: "drew", doctrineFlags: [{ flag: "drew-owns", message: "x" }] }),
      audit: [rec()],
      now: NOW,
    });
    expect(g.criteria.find((c) => c.id === "has-named-owner")!.passed).toBe(false);
    expect(g.criteria.find((c) => c.id === "no-doctrine-flags")!.passed).toBe(false);
  });

  it("Class B job without approver → has-approver-when-required fails", () => {
    const g = evaluateAgentGraduation({
      row: row({ approver: null }),
      audit: [rec()],
      now: NOW,
    });
    expect(g.criteria.find((c) => c.id === "has-approver-when-required")!.passed).toBe(false);
  });

  it("Class A task: approver criterion auto-passes (not required)", () => {
    const g = evaluateAgentGraduation({
      row: row({
        classification: "task",
        approvalClass: "A",
        approver: null,
        notes: "intentional task",
      }),
      audit: [rec()],
      now: NOW,
    });
    expect(g.criteria.find((c) => c.id === "has-approver-when-required")!.passed).toBe(true);
  });

  it("no recent audit entries → has-recent-runs fails", () => {
    const g = evaluateAgentGraduation({
      row: row(),
      audit: [],
      now: NOW,
    });
    expect(g.criteria.find((c) => c.id === "has-recent-runs")!.passed).toBe(false);
    expect(g.criteria.find((c) => c.id === "low-error-rate")!.passed).toBe(false);
  });

  it("audit older than window → still no recent runs", () => {
    const old = new Date(NOW.getTime() - (GRADUATION_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);
    const g = evaluateAgentGraduation({
      row: row(),
      audit: [rec({ createdAt: old.toISOString() })],
      now: NOW,
    });
    expect(g.criteria.find((c) => c.id === "has-recent-runs")!.passed).toBe(false);
  });

  it("error rate > 20% with ≥5 runs → low-error-rate fails", () => {
    const audit: AuditLogEntry[] = [];
    // 7 runs, 3 errors = 43% error rate
    for (let i = 0; i < 4; i++) {
      audit.push(rec({ id: `ok-${i}`, action: "post.message", result: "ok" }));
    }
    for (let i = 0; i < 3; i++) {
      audit.push(rec({ id: `err-${i}`, action: "post.message", result: "error" }));
    }
    const g = evaluateAgentGraduation({ row: row(), audit, now: NOW });
    expect(g.criteria.find((c) => c.id === "low-error-rate")!.passed).toBe(false);
  });

  it("with <5 runs, low-error-rate passes if at least one OK", () => {
    const g = evaluateAgentGraduation({
      row: row(),
      audit: [rec({ result: "ok" }), rec({ id: "x", result: "error" })],
      now: NOW,
    });
    expect(g.criteria.find((c) => c.id === "low-error-rate")!.passed).toBe(true);
  });

  it("job with no loop-closing actions → closes-loops fails", () => {
    const g = evaluateAgentGraduation({
      row: row(),
      audit: [rec({ action: "noop.heartbeat", result: "ok" })],
      now: NOW,
    });
    expect(g.criteria.find((c) => c.id === "closes-loops")!.passed).toBe(false);
  });

  it("task auto-passes closes-loops criterion", () => {
    const g = evaluateAgentGraduation({
      row: row({ classification: "task", approvalClass: "A", approver: null, notes: "by design" }),
      audit: [rec({ action: "noop.heartbeat" })],
      now: NOW,
    });
    expect(g.criteria.find((c) => c.id === "closes-loops")!.passed).toBe(true);
  });

  it("active task without notes → task-justification fails", () => {
    const g = evaluateAgentGraduation({
      row: row({
        classification: "task",
        approvalClass: "A",
        approver: null,
        notes: undefined,
      }),
      audit: [rec()],
      now: NOW,
    });
    expect(g.criteria.find((c) => c.id === "task-justification")!.passed).toBe(false);
  });

  it("graduated agent → nextStage=null + summary says terminal", () => {
    const g = evaluateAgentGraduation({
      row: row({ lifecycle: "graduated" }),
      audit: [rec()],
      now: NOW,
    });
    expect(g.nextStage).toBeNull();
    expect(g.readyToGraduate).toBe(false);
    expect(g.summary).toMatch(/Terminal/);
  });
});

describe("evaluateAllGraduations + summarizeGraduations", () => {
  it("rolls up readyToGraduate + byStage", () => {
    const a = row({ id: "a", name: "A", lifecycle: "proposed" });
    const b = row({ id: "b", name: "B", lifecycle: "active" });
    const c = row({ id: "c", name: "C", lifecycle: "graduated" });

    const audit: AuditLogEntry[] = [
      rec({ actorId: "a", action: "approval.create" }),
      rec({ actorId: "b", action: "approval.create" }),
    ];
    const grouped = groupAuditByAgent(audit, [a, b, c] as unknown as AgentManifestEntry[]);

    const gauges = evaluateAllGraduations({
      rows: [a, b, c],
      auditByAgent: grouped,
      now: NOW,
    });
    expect(gauges).toHaveLength(3);

    const sum = summarizeGraduations(gauges);
    expect(sum.total).toBe(3);
    expect(sum.byStage.proposed).toBe(1);
    expect(sum.byStage.active).toBe(1);
    expect(sum.byStage.graduated).toBe(1);
    expect(sum.atTerminal).toBe(1);
  });

  it("readyToGraduate count never includes terminals", () => {
    const grad = row({ id: "z", lifecycle: "graduated" });
    const gauges: AgentGraduationGauge[] = [
      evaluateAgentGraduation({
        row: grad,
        audit: [rec({ actorId: "z" })],
        now: NOW,
      }),
    ];
    expect(gauges[0].readyToGraduate).toBe(false);
    expect(summarizeGraduations(gauges).readyToGraduate).toBe(0);
  });
});

describe("groupAuditByAgent", () => {
  const manifest: AgentManifestEntry[] = [
    {
      id: "a",
      name: "A",
      contract: "",
      classification: "job",
      approvalClass: "A",
      owner: "ben",
      approver: null,
      lifecycle: "active",
      purpose: "x",
    },
    {
      id: "b",
      name: "B",
      contract: "",
      classification: "job",
      approvalClass: "A",
      owner: "ben",
      approver: null,
      lifecycle: "active",
      purpose: "x",
    },
  ];

  it("groups entries by actorId", () => {
    const audit: AuditLogEntry[] = [
      rec({ actorId: "a", id: "1" }),
      rec({ actorId: "a", id: "2" }),
      rec({ actorId: "b", id: "3" }),
    ];
    const grouped = groupAuditByAgent(audit, manifest);
    expect(grouped["a"]).toHaveLength(2);
    expect(grouped["b"]).toHaveLength(1);
  });

  it("ignores human entries and unknown agents", () => {
    const audit: AuditLogEntry[] = [
      rec({ actorId: "a", id: "1" }),
      rec({ actorType: "human", actorId: "ben", id: "2" }),
      rec({ actorId: "unknown-agent", id: "3" }),
    ];
    const grouped = groupAuditByAgent(audit, manifest);
    expect(grouped["a"]).toHaveLength(1);
    expect(grouped["b"]).toHaveLength(0);
    expect(grouped["unknown-agent"]).toBeUndefined();
  });

  it("manifest agents with no audit get an empty array (not undefined)", () => {
    const grouped = groupAuditByAgent([], manifest);
    expect(grouped["a"]).toEqual([]);
    expect(grouped["b"]).toEqual([]);
  });
});
