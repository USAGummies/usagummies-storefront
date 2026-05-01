/**
 * Today-digest aggregator coverage.
 *
 * Pins:
 *   - rollUpApprovals counts by class + escalating + expiring,
 *     surfaces the 5 oldest.
 *   - countSampleApprovals matches sample tags + whale substrings.
 *   - rollUpOffGrid counts severity + sorts top by deviation.
 *   - rollUpAgents extracts red-light + ready-to-graduate.
 *   - computePosture honors the priority chain
 *     (below_floor > expiring > red-light > yellow signals > green).
 *   - buildTodayDigest wires it all together.
 */
import { describe, expect, it } from "vitest";

import {
  buildTodayDigest,
  computePosture,
  countSampleApprovals,
  rollUpAgents,
  rollUpApprovals,
  rollUpOffGrid,
} from "../today-digest";
import type { ApprovalRequest } from "../control-plane/types";
import type { OffGridQuote } from "@/lib/finance/off-grid-quotes";
import type { AgentGraduationGauge } from "../agent-graduation";
import type { AgentHealthSummary } from "../agent-health";

const NOW = new Date("2026-05-01T18:00:00Z");

function approval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "appr-1",
    runId: "run-1",
    division: "production-supply-chain" as never,
    actorAgentId: "ops",
    class: "B",
    action: "ship sample to Greg Kroetch",
    targetSystem: "shipstation",
    payloadPreview: "Ship 1 case sample to Powers Confections",
    evidence: { claim: "x", sources: [], confidence: 0.9 },
    rollbackPlan: "x",
    requiredApprovers: ["ben"] as never,
    status: "pending" as never,
    createdAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    decisions: [],
    escalateAt: new Date(NOW.getTime() + 22 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(NOW.getTime() + 70 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function offGrid(overrides: Partial<OffGridQuote> = {}): OffGridQuote {
  return {
    candidate: {
      id: "deal-1",
      source: "hubspot_deal",
      customerName: "ACME",
      pricePerBagUsd: 3.1,
      bagCount: 100,
      createdAt: NOW.toISOString(),
    },
    severity: "between_grid_lines",
    nearestGridPrice: 3.0,
    deviationPerBagUsd: 0.1,
    totalDeviationUsd: 10,
    reason: "x",
    ...overrides,
  };
}

function gauge(overrides: Partial<AgentGraduationGauge> = {}): AgentGraduationGauge {
  return {
    agentId: "ops",
    agentName: "Ops Agent",
    currentStage: "active",
    nextStage: "graduated",
    criteria: [],
    passed: 8,
    total: 8,
    readiness: 1,
    readyToGraduate: true,
    summary: "ready",
    ...overrides,
  };
}

const HEALTH_BLANK: AgentHealthSummary = {
  total: 0,
  green: 0,
  yellow: 0,
  red: 0,
  jobs: 0,
  tasks: 0,
  byLifecycle: { proposed: 0, active: 0, graduated: 0, retired: 0, parked: 0 },
  byApprovalClass: { A: 0, B: 0, C: 0, D: 0 },
  drewOwnedCount: 0,
};

describe("rollUpApprovals", () => {
  it("counts B + C class buckets", () => {
    const r = rollUpApprovals(
      [approval({ class: "B" }), approval({ id: "a2", class: "B" }), approval({ id: "a3", class: "C" })],
      NOW,
    );
    expect(r.total).toBe(3);
    expect(r.byClass.B).toBe(2);
    expect(r.byClass.C).toBe(1);
  });

  it("counts escalating (escalateAt passed) and expiring (expiresAt passed) separately", () => {
    const escalating = approval({
      id: "esc",
      escalateAt: new Date(NOW.getTime() - 60_000).toISOString(),
      expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
    });
    const expired = approval({
      id: "exp",
      escalateAt: new Date(NOW.getTime() - 60_000).toISOString(),
      expiresAt: new Date(NOW.getTime() - 60_000).toISOString(),
    });
    const r = rollUpApprovals([escalating, expired], NOW);
    expect(r.escalating).toBe(1);
    expect(r.expiring).toBe(1);
  });

  it("returns the 5 oldest by createdAt", () => {
    const arr: ApprovalRequest[] = [];
    for (let i = 0; i < 8; i++) {
      arr.push(
        approval({
          id: `a-${i}`,
          createdAt: new Date(NOW.getTime() - (i + 1) * 60_000).toISOString(),
        }),
      );
    }
    const r = rollUpApprovals(arr, NOW);
    expect(r.oldest).toHaveLength(5);
    // oldest first — a-7 is created earliest in the loop
    expect(r.oldest[0].id).toBe("a-7");
  });
});

describe("countSampleApprovals", () => {
  it("matches sample tag in payload", () => {
    const r = countSampleApprovals([
      approval({ action: "ship to ACME", payloadPreview: "Ship sample to Greg" }),
      approval({ id: "x", action: "tag:sample", payloadPreview: "ship out" }),
      approval({ id: "y", action: "ship MC to ACME", payloadPreview: "no match" }),
    ]);
    expect(r.pendingApprovals).toBe(2);
  });

  it("flags whale matches inside sample approvals", () => {
    const r = countSampleApprovals([
      approval({
        action: "ship sample",
        payloadPreview: "Sample drop to Buc-ee's HQ",
        targetEntity: { type: "shipment", id: "x", label: "Buc-ee's" },
      }),
      approval({
        id: "kehe",
        action: "ship sample",
        payloadPreview: "Sample to KeHE category buyer",
      }),
      approval({
        id: "no",
        action: "ship sample",
        payloadPreview: "Sample to Joe's Corner Store",
      }),
    ]);
    expect(r.pendingApprovals).toBe(3);
    expect(r.whaleApprovals).toBe(2);
  });
});

describe("rollUpOffGrid", () => {
  it("counts by severity", () => {
    const r = rollUpOffGrid([
      offGrid({ severity: "below_floor" }),
      offGrid({ severity: "between_grid_lines" }),
      offGrid({ severity: "between_grid_lines" }),
    ]);
    expect(r.bySeverity.below_floor).toBe(1);
    expect(r.bySeverity.between_grid_lines).toBe(2);
    expect(r.hasHardBlock).toBe(true);
  });

  it("hasHardBlock=false when no below_floor", () => {
    const r = rollUpOffGrid([offGrid({ severity: "above_grid" })]);
    expect(r.hasHardBlock).toBe(false);
  });

  it("top is sorted severity-first then by abs(totalDeviationUsd)", () => {
    const r = rollUpOffGrid([
      offGrid({ candidate: { ...offGrid().candidate, id: "above-big" }, severity: "above_grid", totalDeviationUsd: 50 }),
      offGrid({ candidate: { ...offGrid().candidate, id: "floor-small" }, severity: "below_floor", totalDeviationUsd: 5 }),
      offGrid({ candidate: { ...offGrid().candidate, id: "between-medium" }, severity: "between_grid_lines", totalDeviationUsd: 25 }),
    ]);
    expect(r.top[0].candidate.id).toBe("floor-small");
    expect(r.top[1].candidate.id).toBe("between-medium");
    expect(r.top[2].candidate.id).toBe("above-big");
  });

  it("caps at 3", () => {
    const arr: OffGridQuote[] = [];
    for (let i = 0; i < 10; i++) {
      arr.push(offGrid({ candidate: { ...offGrid().candidate, id: `q-${i}` } }));
    }
    expect(rollUpOffGrid(arr).top).toHaveLength(3);
  });
});

describe("rollUpAgents", () => {
  it("extracts red-light agents with reasons", () => {
    const r = rollUpAgents(
      HEALTH_BLANK,
      [],
      [
        {
          id: "drew-agent",
          name: "Drew Agent",
          health: "red",
          doctrineFlags: [{ flag: "drew-owns", message: "x" }],
        },
        { id: "ok", name: "OK", health: "green", doctrineFlags: [] },
      ],
    );
    expect(r.redLight).toHaveLength(1);
    expect(r.redLight[0].id).toBe("drew-agent");
    expect(r.redLight[0].reason).toContain("drew-owns");
  });

  it("extracts ready-to-graduate gauges (skips terminal)", () => {
    const r = rollUpAgents(
      HEALTH_BLANK,
      [
        gauge({ agentId: "ready", readyToGraduate: true }),
        gauge({ agentId: "term", currentStage: "graduated", nextStage: null, readyToGraduate: false }),
        gauge({ agentId: "blocked", passed: 5, total: 8, readyToGraduate: false, readiness: 5 / 8 }),
      ],
      [],
    );
    expect(r.readyToGraduate).toHaveLength(1);
    expect(r.readyToGraduate[0].id).toBe("ready");
  });
});

describe("computePosture", () => {
  const empty = (): { approvals: ReturnType<typeof rollUpApprovals>; offGrid: ReturnType<typeof rollUpOffGrid>; agents: ReturnType<typeof rollUpAgents> } => ({
    approvals: rollUpApprovals([], NOW),
    offGrid: rollUpOffGrid([]),
    agents: rollUpAgents(HEALTH_BLANK, [], []),
  });

  it("green when nothing waiting", () => {
    const e = empty();
    expect(computePosture(e.approvals, e.offGrid, e.agents)).toBe("green");
  });

  it("yellow when there are pending approvals", () => {
    const a = rollUpApprovals([approval()], NOW);
    const og = rollUpOffGrid([]);
    const ag = rollUpAgents(HEALTH_BLANK, [], []);
    expect(computePosture(a, og, ag)).toBe("yellow");
  });

  it("red when below_floor off-grid exists", () => {
    const e = empty();
    const og = rollUpOffGrid([offGrid({ severity: "below_floor" })]);
    expect(computePosture(e.approvals, og, e.agents)).toBe("red");
  });

  it("red when an approval is expiring (expiresAt passed)", () => {
    const a = rollUpApprovals(
      [
        approval({
          id: "exp",
          escalateAt: new Date(NOW.getTime() - 60_000).toISOString(),
          expiresAt: new Date(NOW.getTime() - 60_000).toISOString(),
        }),
      ],
      NOW,
    );
    const e = empty();
    expect(computePosture(a, e.offGrid, e.agents)).toBe("red");
  });

  it("red when there's a red-light agent", () => {
    const e = empty();
    const ag = rollUpAgents(
      HEALTH_BLANK,
      [],
      [
        {
          id: "x",
          name: "x",
          health: "red",
          doctrineFlags: [{ flag: "drew-owns", message: "x" }],
        },
      ],
    );
    expect(computePosture(e.approvals, e.offGrid, ag)).toBe("red");
  });
});

describe("buildTodayDigest", () => {
  it("wires together approvals + off-grid + agents + samples and emits posture + degraded", () => {
    const d = buildTodayDigest({
      pendingApprovals: [
        approval({ id: "a", payloadPreview: "Sample to Buc-ee's" }),
      ],
      offGridQuotes: [],
      health: HEALTH_BLANK,
      gauges: [],
      rows: [],
      degraded: ["audit-fetch: timeout"],
      now: NOW,
    });
    expect(d.posture).toBe("yellow"); // pending approvals → yellow
    expect(d.approvals.total).toBe(1);
    expect(d.samples.pendingApprovals).toBe(1);
    expect(d.samples.whaleApprovals).toBe(1);
    expect(d.degraded).toEqual(["audit-fetch: timeout"]);
    expect(d.generatedAt).toBe(NOW.toISOString());
  });
});
