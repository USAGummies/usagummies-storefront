import { describe, expect, it, beforeEach } from "vitest";

import { buildAuditEntry, buildHumanAuditEntry } from "../audit";
import { runDriftAudit, type Validator } from "../drift-audit";
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
