/**
 * Phase 32.1 — Brief signals aggregator.
 *
 * Locks the contract:
 *   - Each per-source line quiet-collapses to "" when its source
 *     has nothing to surface.
 *   - composeBriefSignals filters empty lines (no leading/trailing
 *     blank entries in the output).
 *   - Order is severity-first: stack-down → agent-red →
 *     stack-degraded → uspto → inbox → reorder.
 *   - Empty input → {lines:[], hasCritical:false}.
 *   - hasCritical fires on stack-down, agent-red, USPTO critical,
 *     OR inbox stale.
 */
import { describe, expect, it } from "vitest";

import type { CoverDaysForecast } from "../inventory-forecast";
import type { AgentHealthRow } from "../agent-health";
import type { BacklogRow } from "../inbox-triage-backlog";
import type { StackServiceRow } from "../stack-readiness";
import type { TrademarkRow } from "../uspto-trademarks";

import {
  composeBriefSignals,
  renderAgentHealthRedLine,
  renderReorderLine,
  renderStackDegradedLine,
  renderStackDownLine,
} from "../brief-signals";

function stackRow(overrides: Partial<StackServiceRow>): StackServiceRow {
  return {
    id: "x",
    name: "X",
    layer: "integration",
    envVars: [],
    maturity: 1,
    degradedMode: "",
    replacement: "",
    status: "ok",
    message: "",
    latencyMs: null,
    probedAt: "",
    envOk: true,
    envMissing: [],
    ...overrides,
  };
}

function agentRow(overrides: Partial<AgentHealthRow>): AgentHealthRow {
  return {
    id: "x",
    name: "X",
    contract: "",
    classification: "job",
    approvalClass: "A",
    owner: "ben",
    approver: null,
    lifecycle: "active",
    purpose: "",
    health: "green",
    doctrineFlags: [],
    ...overrides,
  };
}

function tmRow(overrides: Partial<TrademarkRow>): TrademarkRow {
  return {
    id: "wm",
    mark: "USA GUMMIES",
    serialNumber: null,
    registrationNumber: null,
    status: "registered",
    filedAt: null,
    registeredAt: null,
    officeActionResponseDueAt: null,
    nextAction: {
      label: "x",
      dueAt: null,
      daysUntilDue: null,
      urgency: "low",
    },
    ...overrides,
  };
}

function backlogRow(overrides: Partial<BacklogRow>): BacklogRow {
  return {
    emailId: "msg-1",
    receivedAt: "2026-04-27T16:00:00Z",
    category: "b2b_sales",
    urgency: "high",
    state: "awaiting-decision",
    hasDraft: false,
    hasApproval: false,
    approvalId: null,
    subject: "",
    from: "",
    ageHours: 5,
    ...overrides,
  };
}

function forecast(
  reorder: Array<{ sku: string; coverDays: number; urgency: "urgent" | "soon" | "ok" | "unknown" }>,
): CoverDaysForecast {
  return {
    generatedAt: "2026-04-27T16:00:00Z",
    defaultBurnRate: 250,
    burnRateSource: "default",
    totalOnHand: 1000,
    totalBurnRate: 250 * reorder.length,
    fleetCoverDays: 30,
    rows: reorder.map((r) => ({
      sku: r.sku,
      productTitle: r.sku,
      variantTitle: "",
      onHand: 100,
      burnRatePerDay: 250,
      coverDays: r.coverDays,
      urgency: r.urgency,
      expectedStockoutDate: null,
    })),
    reorderRecommended: reorder
      .filter((r) => r.urgency === "urgent" || r.urgency === "soon")
      .map((r) => ({
        sku: r.sku,
        productTitle: r.sku,
        variantTitle: "",
        onHand: 100,
        burnRatePerDay: 250,
        coverDays: r.coverDays,
        urgency: r.urgency,
        expectedStockoutDate: null,
      })),
  };
}

describe("renderStackDownLine", () => {
  it("empty when nothing is down", () => {
    expect(
      renderStackDownLine([
        stackRow({ id: "a", status: "ok" }),
        stackRow({ id: "b", status: "degraded" }),
      ]),
    ).toBe("");
  });

  it("renders count + top 3 ids when services are down", () => {
    const line = renderStackDownLine([
      stackRow({ id: "vercel-kv", status: "down" }),
      stackRow({ id: "shipstation", status: "down" }),
    ]);
    expect(line).toContain("Stack");
    expect(line).toContain("2 services down");
    expect(line).toContain("vercel-kv");
    expect(line).toContain("shipstation");
  });

  it("truncates with '+N more' when more than 5 are down", () => {
    const line = renderStackDownLine([
      stackRow({ id: "a", status: "down" }),
      stackRow({ id: "b", status: "down" }),
      stackRow({ id: "c", status: "down" }),
      stackRow({ id: "d", status: "down" }),
      stackRow({ id: "e", status: "down" }),
      stackRow({ id: "f", status: "down" }),
      stackRow({ id: "g", status: "down" }),
    ]);
    expect(line).toContain("+2 more");
  });

  it("does NOT truncate when 4 are down (post-2026-05-03 cap=5)", () => {
    const line = renderStackDownLine([
      stackRow({ id: "make-com", status: "down" }),
      stackRow({ id: "quickbooks-online", status: "down" }),
      stackRow({ id: "nextauth", status: "down" }),
      stackRow({ id: "shipstation", status: "down" }),
    ]);
    expect(line).not.toContain("+1 more");
    expect(line).toContain("shipstation");
  });
});

describe("renderStackDegradedLine", () => {
  it("empty when nothing is degraded", () => {
    expect(
      renderStackDegradedLine([stackRow({ id: "a", status: "ok" })]),
    ).toBe("");
  });

  it("renders count + ids when services are degraded", () => {
    const line = renderStackDegradedLine([
      stackRow({ id: "make-com", status: "degraded" }),
    ]);
    expect(line).toContain("1 service degraded");
    expect(line).toContain("make-com");
  });
});

describe("renderAgentHealthRedLine", () => {
  it("empty when nothing is red", () => {
    expect(
      renderAgentHealthRedLine([agentRow({ id: "x", health: "green" })]),
    ).toBe("");
  });

  it("renders count + ids when agents have doctrinal red", () => {
    const line = renderAgentHealthRedLine([
      agentRow({ id: "rogue", health: "red" }),
      agentRow({ id: "another", health: "red" }),
    ]);
    expect(line).toContain("2 doctrinal red flags");
    expect(line).toContain("rogue");
    expect(line).toContain("another");
  });

  it("yellows do NOT trigger the red line (separate concern)", () => {
    expect(
      renderAgentHealthRedLine([agentRow({ id: "x", health: "yellow" })]),
    ).toBe("");
  });
});

describe("renderReorderLine", () => {
  it("empty when forecast is missing", () => {
    expect(renderReorderLine()).toBe("");
  });

  it("empty when no urgent/soon SKUs", () => {
    const f = forecast([{ sku: "A", coverDays: 60, urgency: "ok" }]);
    expect(renderReorderLine(f)).toBe("");
  });

  it("renders SKU list + urgency tag when urgent SKUs exist", () => {
    const f = forecast([
      { sku: "USG-FBM-1PK", coverDays: 5, urgency: "urgent" },
      { sku: "USG-WS-CASE", coverDays: 18, urgency: "soon" },
    ]);
    const line = renderReorderLine(f);
    expect(line).toContain("Reorder");
    expect(line).toContain("USG-FBM-1PK");
    expect(line).toContain("1 urgent");
  });
});

describe("composeBriefSignals — aggregator", () => {
  it("empty input → empty lines + hasCritical=false", () => {
    expect(composeBriefSignals({})).toEqual({ lines: [], hasCritical: false });
  });

  it("filters empty per-source contributions out (no blank entries)", () => {
    const out = composeBriefSignals({
      stackRows: [stackRow({ id: "a", status: "ok" })],
      agentRows: [agentRow({ id: "b", health: "green" })],
    });
    expect(out.lines).toEqual([]);
    expect(out.hasCritical).toBe(false);
  });

  it("severity-first ordering: stack-down > agent-red > stack-degraded > uspto > inbox > reorder", () => {
    const out = composeBriefSignals({
      stackRows: [
        stackRow({ id: "kv", status: "down" }),
        stackRow({ id: "make", status: "degraded" }),
      ],
      agentRows: [agentRow({ id: "rogue", health: "red" })],
      trademarkRows: [
        tmRow({
          mark: "USA GUMMIES",
          nextAction: {
            label: "Respond to office action",
            dueAt: "2026-05-15",
            daysUntilDue: 18,
            urgency: "critical",
          },
        }),
      ],
      backlogRows: [backlogRow({ emailId: "stale", ageHours: 30 })], // critical-tier 1h, but high tier =4h, so 30h is stale-high
      inventoryForecast: forecast([
        { sku: "USG-FBM-1PK", coverDays: 4, urgency: "urgent" },
      ]),
    });
    expect(out.lines.length).toBeGreaterThanOrEqual(5);
    // Stack-down line first.
    expect(out.lines[0]).toMatch(/Stack — 1 service down/);
    // Agent-red second.
    expect(out.lines[1]).toMatch(/Agents — 1 doctrinal/);
    // Stack-degraded third.
    expect(out.lines[2]).toMatch(/1 service degraded/);
    // USPTO fourth.
    expect(out.lines[3]).toMatch(/USPTO trademarks/);
    // Inbox fifth.
    expect(out.lines[4]).toMatch(/Inbox triage/);
    // Reorder last.
    expect(out.lines[5]).toMatch(/Reorder/);
  });

  it("hasCritical=true when stack has any down service", () => {
    const out = composeBriefSignals({
      stackRows: [stackRow({ id: "x", status: "down" })],
    });
    expect(out.hasCritical).toBe(true);
  });

  it("hasCritical=true when any agent is red", () => {
    const out = composeBriefSignals({
      agentRows: [agentRow({ health: "red" })],
    });
    expect(out.hasCritical).toBe(true);
  });

  it("hasCritical=true when USPTO has a critical-tier action", () => {
    const out = composeBriefSignals({
      trademarkRows: [
        tmRow({
          nextAction: {
            label: "x",
            dueAt: "2026-04-30",
            daysUntilDue: 3,
            urgency: "critical",
          },
        }),
      ],
    });
    expect(out.hasCritical).toBe(true);
  });

  it("hasCritical=true when inbox has stale items", () => {
    const out = composeBriefSignals({
      backlogRows: [backlogRow({ ageHours: 30, urgency: "high" })], // stale (high>4h)
    });
    expect(out.hasCritical).toBe(true);
  });

  it("hasCritical=false when only mediums + degradeds present", () => {
    const out = composeBriefSignals({
      stackRows: [stackRow({ status: "degraded" })],
      // No down, no red, no critical USPTO, no stale inbox.
    });
    expect(out.hasCritical).toBe(false);
    expect(out.lines.length).toBe(1); // just the degraded line
  });
});
