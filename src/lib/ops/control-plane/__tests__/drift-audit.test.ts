import { describe, expect, it, beforeEach } from "vitest";

import { buildAuditEntry, buildHumanAuditEntry } from "../audit";
import { runDriftAudit, type Validator } from "../drift-audit";
import { InMemoryPauseSink, type PauseSink, type PausedAgentRecord } from "../enforcement";
import { newRunContext } from "../run-id";
import { InMemoryAuditStore } from "../stores/memory-stores";
import type { PolicyViolation, AuditLogEntry } from "../types";

function entryAt(agentId: string, minutesAgo: number, action = "hubspot.task.create"): AuditLogEntry {
  const run = newRunContext({ agentId, division: "sales", source: "on-demand" });
  return buildAuditEntry(
    run,
    { action, entityType: "task", result: "ok" },
    new Date(Date.now() - minutesAgo * 60_000),
  );
}

function violation(agentId: string, detectedAtMinutesAgo: number): PolicyViolation {
  return {
    id: `v-${Math.random().toString(36).slice(2, 8)}`,
    runId: "r",
    agentId,
    division: "sales",
    kind: "missing_citation",
    detail: "synthesis without source",
    detectedBy: "drift-audit",
    detectedAt: new Date(Date.now() - detectedAtMinutesAgo * 60_000).toISOString(),
  };
}

let store: InMemoryAuditStore;
beforeEach(() => {
  store = new InMemoryAuditStore();
});

describe("runDriftAudit()", () => {
  it("returns an empty scorecard when no entries exist", async () => {
    const sc = await runDriftAudit({ store });
    expect(sc.totalEligibleEntries).toBe(0);
    expect(sc.sampleSize).toBe(0);
    expect(sc.samples).toEqual([]);
    expect(sc.totalViolations).toBe(0);
    expect(sc.agentsAutoPaused).toEqual([]);
  });

  it("samples at most sampleSize entries and only from the window", async () => {
    // 12 entries inside 7d window, 3 older.
    for (let i = 0; i < 12; i++) {
      await store.append(entryAt("viktor", i * 60));
    }
    for (let i = 0; i < 3; i++) {
      await store.append(entryAt("viktor", 10 * 24 * 60 + i)); // 10+ days old
    }
    const sc = await runDriftAudit({
      store,
      sampleSize: 10,
      windowDays: 7,
      rng: () => 0, // deterministic first-index picks
    });
    expect(sc.totalEligibleEntries).toBe(12);
    expect(sc.samples).toHaveLength(10);
    // All sampled are viktor, within window, never human-authored.
    for (const s of sc.samples) {
      expect(s.agent).toBe("viktor");
    }
  });

  it("ignores human-authored entries (actorType=human)", async () => {
    await store.append(entryAt("viktor", 30));
    await store.append(
      buildHumanAuditEntry({
        runId: "r",
        division: "sales",
        actorId: "Ben",
        action: "approval.approve",
        entityType: "approval",
        result: "ok",
      }),
    );
    const sc = await runDriftAudit({ store, sampleSize: 10 });
    expect(sc.totalEligibleEntries).toBe(1);
    expect(sc.samples.every((s) => s.agent === "viktor")).toBe(true);
  });

  it("auto-pauses agents with ≥2 violations in the window", async () => {
    await store.append(entryAt("viktor", 30));
    await store.append(entryAt("booke", 30));
    const violations: PolicyViolation[] = [
      violation("viktor", 10),
      violation("viktor", 20),
      violation("viktor", 30),
      violation("booke", 40),
    ];
    const sc = await runDriftAudit({ store, violations, sampleSize: 0 });
    expect(sc.totalViolations).toBe(4);
    expect(sc.violationsByAgent).toEqual({ viktor: 3, booke: 1 });
    expect(sc.agentsAutoPaused).toEqual(["viktor"]); // booke at 1 violation is under threshold
    // No pauseSink provided → enforcement.mode is "skipped" and the
    // scorecard explicitly warns that pause state was NOT persisted.
    expect(sc.enforcement.mode).toBe("skipped");
    expect(sc.enforcement.pauseSinkPresent).toBe(false);
    expect(sc.enforcement.pausesApplied).toBe(0);
    expect(sc.enforcement.notes.some((n) => /NOT persisted/.test(n))).toBe(true);
  });

  it("excludes out-of-window violations from counts", async () => {
    await store.append(entryAt("viktor", 30));
    const violations: PolicyViolation[] = [
      violation("viktor", 10),
      violation("viktor", 60 * 24 * 10), // 10d ago — outside 7d window
    ];
    const sc = await runDriftAudit({ store, violations, sampleSize: 0 });
    expect(sc.totalViolations).toBe(1);
    expect(sc.agentsAutoPaused).toEqual([]);
  });

  it("applies an optional validator to each sample", async () => {
    for (let i = 0; i < 5; i++) {
      await store.append(entryAt("viktor", i));
    }
    const v: Validator = async (e) => ({
      assessment: e.action === "hubspot.task.create" ? "correct" : "needs-review",
      note: "validated by test stub",
    });
    const sc = await runDriftAudit({ store, sampleSize: 5, validate: v });
    expect(sc.samples).toHaveLength(5);
    expect(sc.samples.every((s) => s.assessment === "correct")).toBe(true);
    expect(sc.samples.every((s) => s.note === "validated by test stub")).toBe(true);
  });

  it("falls back to needs-review when a validator throws", async () => {
    await store.append(entryAt("viktor", 5));
    const v: Validator = async () => {
      throw new Error("source unreachable");
    };
    const sc = await runDriftAudit({ store, sampleSize: 1, validate: v });
    expect(sc.samples[0].assessment).toBe("needs-review");
  });

  it("calls the Slack surface once with a scorecard summary (best-effort)", async () => {
    await store.append(entryAt("viktor", 30));
    const mirrored: AuditLogEntry[] = [];
    const surface = {
      async mirror(entry: AuditLogEntry) {
        mirrored.push(entry);
      },
    };
    await runDriftAudit({ store, sampleSize: 1, surface });
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0].actorType).toBe("agent");
    expect(mirrored[0].actorId).toBe("drift-audit");
    expect(mirrored[0].action).toBe("drift-audit.scorecard");
    // Summary goes in the `after` field.
    expect(typeof mirrored[0].after).toBe("string");
    expect(String(mirrored[0].after)).toContain("samples=");
    expect(String(mirrored[0].after)).toContain("auto_paused=");
  });

  it("persists the scorecard summary into the AuditStore (daily brief can find it)", async () => {
    await store.append(entryAt("viktor", 30));
    const sc = await runDriftAudit({ store, sampleSize: 1 });
    // Even without a Slack surface, the scorecard entry must be persisted
    // so auditStore.recent() returns it — that's the path the daily brief
    // walks via findLastDriftAuditSummary().
    const recent = await store.recent(100);
    const summaries = recent.filter((e) => e.action === "drift-audit.scorecard");
    expect(summaries).toHaveLength(1);
    expect(summaries[0].entityType).toBe("scorecard");
    expect(summaries[0].entityId).toBe(sc.id);
    expect(summaries[0].actorType).toBe("agent");
    expect(summaries[0].actorId).toBe("drift-audit");
    expect(typeof summaries[0].after).toBe("string");
    expect(String(summaries[0].after)).toContain("samples=");
    expect(String(summaries[0].after)).toContain("enforcement=");
  });

  it("store-append failure does not collapse the run (Slack mirror still attempted)", async () => {
    await store.append(entryAt("viktor", 30));
    const mirrored: AuditLogEntry[] = [];
    // Wrap the real store: the scorecard append fails once; all other
    // appends (test seed + pause entries) pass through.
    const wrappedStore = {
      recent: store.recent.bind(store),
      byRun: store.byRun.bind(store),
      byAgent: store.byAgent.bind(store),
      append: async (entry: AuditLogEntry) => {
        if (entry.action === "drift-audit.scorecard") {
          throw new Error("KV down");
        }
        return store.append(entry);
      },
    };
    const surface = {
      async mirror(entry: AuditLogEntry) {
        mirrored.push(entry);
      },
    };
    const sc = await runDriftAudit({ store: wrappedStore, sampleSize: 1, surface });
    expect(sc).toBeDefined();
    // Mirror still got called with the scorecard entry even though the
    // store append failed.
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0].action).toBe("drift-audit.scorecard");
  });

  it("a surface failure does not fail the run", async () => {
    await store.append(entryAt("viktor", 30));
    const surface = {
      async mirror() {
        throw new Error("slack down");
      },
    };
    await expect(
      runDriftAudit({ store, sampleSize: 1, surface }),
    ).resolves.toBeDefined();
  });

  it("deterministic rng produces a stable sample ordering", async () => {
    for (let i = 0; i < 20; i++) {
      await store.append(entryAt("viktor", i));
    }
    // Controlled rng that always picks index 0.
    const rng = () => 0;
    const a = await runDriftAudit({ store, sampleSize: 5, rng });
    const b = await runDriftAudit({ store, sampleSize: 5, rng });
    expect(a.samples.map((s) => s.entryId)).toEqual(b.samples.map((s) => s.entryId));
  });
});

describe("runDriftAudit() — enforcement", () => {
  it("with PauseSink wired, persists a PausedAgentRecord per auto-paused agent", async () => {
    const store = new InMemoryAuditStore();
    await store.append(entryAt("viktor", 30));
    await store.append(entryAt("booke", 30));
    const pauseSink = new InMemoryPauseSink();

    const violations: PolicyViolation[] = [
      violation("viktor", 5),
      violation("viktor", 10),
      violation("viktor", 15),
      violation("booke", 5),
    ];
    const sc = await runDriftAudit({
      store,
      pauseSink,
      violations,
      sampleSize: 0,
    });

    expect(sc.enforcement.mode).toBe("enforced");
    expect(sc.enforcement.pauseSinkPresent).toBe(true);
    expect(sc.enforcement.pausesApplied).toBe(1);
    expect(sc.enforcement.pausesFailed).toBe(0);
    expect(sc.agentsPauseErrored).toEqual([]);

    const paused = await pauseSink.listPaused();
    expect(paused).toHaveLength(1);
    expect(paused[0].agentId).toBe("viktor");
    expect(paused[0].violationsInWindow).toBe(3);
    expect(paused[0].scorecardId).toBe(sc.id);
    expect(await pauseSink.isPaused("viktor")).toBe(true);
    expect(await pauseSink.isPaused("booke")).toBe(false);
  });

  it("writes a drift-audit.agent-paused audit entry for each persisted pause", async () => {
    const store = new InMemoryAuditStore();
    await store.append(entryAt("viktor", 30));
    const pauseSink = new InMemoryPauseSink();

    await runDriftAudit({
      store,
      pauseSink,
      violations: [violation("viktor", 5), violation("viktor", 10)],
      sampleSize: 0,
    });

    const recent = await store.recent(100);
    const pauseEntries = recent.filter((e) => e.action === "drift-audit.agent-paused");
    expect(pauseEntries).toHaveLength(1);
    expect(pauseEntries[0].actorId).toBe("drift-audit");
    expect(pauseEntries[0].entityType).toBe("agent");
    expect(pauseEntries[0].entityId).toBe("viktor");
    expect(pauseEntries[0].result).toBe("ok");
  });

  it("captures per-agent pause failures without collapsing the run (enforcement.mode = 'partial')", async () => {
    const store = new InMemoryAuditStore();
    await store.append(entryAt("viktor", 30));
    await store.append(entryAt("booke", 30));
    // Sink that throws for viktor, succeeds for booke.
    const okSink = new InMemoryPauseSink();
    const sink: PauseSink = {
      async pauseAgent(rec: PausedAgentRecord) {
        if (rec.agentId === "viktor") throw new Error("KV timeout");
        return okSink.pauseAgent(rec);
      },
      isPaused: (id) => okSink.isPaused(id),
      listPaused: () => okSink.listPaused(),
      unpauseAgent: (id, reason) => okSink.unpauseAgent(id, reason),
    };

    const sc = await runDriftAudit({
      store,
      pauseSink: sink,
      violations: [
        violation("viktor", 5),
        violation("viktor", 10),
        violation("booke", 5),
        violation("booke", 10),
      ],
      sampleSize: 0,
    });

    expect(sc.agentsAutoPaused.sort()).toEqual(["booke", "viktor"]);
    expect(sc.agentsPauseErrored).toHaveLength(1);
    expect(sc.agentsPauseErrored[0].agentId).toBe("viktor");
    expect(sc.agentsPauseErrored[0].error).toContain("KV timeout");
    expect(sc.enforcement.mode).toBe("partial");
    expect(sc.enforcement.pausesApplied).toBe(1);
    expect(sc.enforcement.pausesFailed).toBe(1);

    const recent = await store.recent(100);
    expect(recent.some((e) => e.action === "drift-audit.agent-paused" && e.entityId === "booke")).toBe(true);
    expect(
      recent.some((e) => e.action === "drift-audit.agent-pause-failed" && e.entityId === "viktor" && e.result === "error"),
    ).toBe(true);
  });

  it("enforcement.mode = 'not-needed' when no agent crosses the threshold", async () => {
    const store = new InMemoryAuditStore();
    await store.append(entryAt("viktor", 30));
    const sc = await runDriftAudit({
      store,
      pauseSink: new InMemoryPauseSink(),
      violations: [violation("viktor", 5)],
      sampleSize: 0,
    });
    expect(sc.agentsAutoPaused).toEqual([]);
    expect(sc.enforcement.mode).toBe("not-needed");
    expect(sc.enforcement.pausesApplied).toBe(0);
    expect(sc.enforcement.pausesFailed).toBe(0);
  });

  it("enforcement summary is present in the Slack mirror payload", async () => {
    const store = new InMemoryAuditStore();
    await store.append(entryAt("viktor", 30));
    const mirrored: AuditLogEntry[] = [];
    const surface = {
      async mirror(entry: AuditLogEntry) {
        mirrored.push(entry);
      },
    };
    await runDriftAudit({
      store,
      pauseSink: new InMemoryPauseSink(),
      violations: [violation("viktor", 5), violation("viktor", 10)],
      sampleSize: 0,
      surface,
    });
    const summary = String(mirrored[0].after);
    expect(summary).toContain("enforcement=");
    expect(summary).toContain("auto_paused=viktor");
  });

  it("resolveDivision override lets callers place a pause under the right division", async () => {
    const store = new InMemoryAuditStore();
    // The violating agent produced zero audit entries this window.
    const pauseSink = new InMemoryPauseSink();
    await runDriftAudit({
      store,
      pauseSink,
      violations: [violation("finance-exception", 5), violation("finance-exception", 10)],
      sampleSize: 0,
      resolveDivision: (id) => (id === "finance-exception" ? "financials" : undefined),
    });
    const [rec] = await pauseSink.listPaused();
    expect(rec.division).toBe("financials");
  });
});
