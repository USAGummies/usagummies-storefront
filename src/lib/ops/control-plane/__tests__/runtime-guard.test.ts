import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { guardAgent, runWithGuard, PausedAgentError } from "../runtime-guard";
import { record, requestApproval } from "../record";
import { newRunContext } from "../run-id";
import {
  InMemoryPauseSink,
  type PauseSink,
  type PausedAgentRecord,
} from "../enforcement";
import {
  InMemoryApprovalStore,
  InMemoryAuditStore,
} from "../stores/memory-stores";
import {
  __resetStores,
  __setStoresForTest,
} from "../stores";
import { __resetSurfaces, __setSurfacesForTest } from "../slack";

function baseRun(agentId = "viktor") {
  return newRunContext({
    agentId,
    division: "sales",
    source: "on-demand",
  });
}

function pausedRecord(agentId: string): PausedAgentRecord {
  const now = new Date();
  return {
    agentId,
    division: "sales",
    reason: "auto-pause: 2 violations in 7d",
    violationsInWindow: 2,
    windowStart: new Date(now.getTime() - 7 * 86_400_000).toISOString(),
    windowEnd: now.toISOString(),
    scorecardId: "sc-test",
    pausedAt: now.toISOString(),
  };
}

// ---- guardAgent() unit tests ------------------------------------------

describe("guardAgent()", () => {
  let pauseSink: InMemoryPauseSink;
  let auditStoreRef: InMemoryAuditStore;

  beforeEach(() => {
    pauseSink = new InMemoryPauseSink();
    auditStoreRef = new InMemoryAuditStore();
  });

  it("returns normally for an unpaused agent", async () => {
    await expect(
      guardAgent(baseRun(), { pauseSink, auditStore: auditStoreRef }),
    ).resolves.toBeUndefined();
    expect(auditStoreRef._size).toBe(0);
  });

  it("throws PausedAgentError for a paused agent", async () => {
    await pauseSink.pauseAgent(pausedRecord("viktor"));
    const run = baseRun("viktor");
    await expect(
      guardAgent(run, { pauseSink, auditStore: auditStoreRef }),
    ).rejects.toBeInstanceOf(PausedAgentError);
  });

  it("writes a runtime.blocked-paused audit entry on refusal", async () => {
    await pauseSink.pauseAgent(pausedRecord("viktor"));
    const run = baseRun("viktor");
    try {
      await guardAgent(run, { pauseSink, auditStore: auditStoreRef });
    } catch {
      // expected
    }
    const recent = await auditStoreRef.recent(10);
    expect(recent).toHaveLength(1);
    expect(recent[0].action).toBe("runtime.blocked-paused");
    expect(recent[0].entityType).toBe("agent");
    expect(recent[0].entityId).toBe("viktor");
    expect(recent[0].result).toBe("skipped");
    expect(recent[0].runId).toBe(run.runId);
  });

  it("fails closed when the pause-sink throws (cannot verify → assume paused)", async () => {
    const brokenSink: PauseSink = {
      async isPaused() {
        throw new Error("KV timeout");
      },
      async pauseAgent() {},
      async listPaused() {
        return [];
      },
      async unpauseAgent() {},
    };
    await expect(
      guardAgent(baseRun(), { pauseSink: brokenSink, auditStore: auditStoreRef }),
    ).rejects.toBeInstanceOf(PausedAgentError);
    const recent = await auditStoreRef.recent(10);
    expect(recent).toHaveLength(1);
    expect(recent[0].action).toBe("runtime.blocked-paused");
    // The after-block carries the reason so operators can see whether
    // the refusal was "really paused" vs "sink unavailable."
    const after = recent[0].after as { reason: string; detail: string };
    expect(after.reason).toBe("pause-sink-unavailable");
    expect(after.detail).toContain("KV timeout");
  });

  it("a failing audit append does not block the refusal (still throws PausedAgentError)", async () => {
    await pauseSink.pauseAgent(pausedRecord("viktor"));
    const brokenAudit = {
      async append() {
        throw new Error("audit KV down");
      },
      async recent() {
        return [];
      },
      async byRun() {
        return [];
      },
      async byAgent() {
        return [];
      },
      async byAction() {
        return [];
      },
    };
    await expect(
      guardAgent(baseRun("viktor"), { pauseSink, auditStore: brokenAudit }),
    ).rejects.toBeInstanceOf(PausedAgentError);
  });

  it("audit store is optional (some call sites deliberately elide it)", async () => {
    await pauseSink.pauseAgent(pausedRecord("viktor"));
    await expect(
      guardAgent(baseRun("viktor"), { pauseSink }),
    ).rejects.toBeInstanceOf(PausedAgentError);
  });

  it("mirrors the runtime.blocked-paused entry to the audit Slack surface when one is provided", async () => {
    await pauseSink.pauseAgent(pausedRecord("viktor"));
    const mirrored: Array<{ action: string; entityId?: string }> = [];
    const surface = {
      async mirror(entry: { action: string; entityId?: string }) {
        mirrored.push(entry);
      },
    };
    await expect(
      guardAgent(baseRun("viktor"), {
        pauseSink,
        auditStore: auditStoreRef,
        auditSurface: surface,
      }),
    ).rejects.toBeInstanceOf(PausedAgentError);
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0].action).toBe("runtime.blocked-paused");
    expect(mirrored[0].entityId).toBe("viktor");
  });

  it("a Slack surface failure does not suppress the PausedAgentError", async () => {
    await pauseSink.pauseAgent(pausedRecord("viktor"));
    const failingSurface = {
      async mirror() {
        throw new Error("slack down");
      },
    };
    await expect(
      guardAgent(baseRun("viktor"), {
        pauseSink,
        auditStore: auditStoreRef,
        auditSurface: failingSurface,
      }),
    ).rejects.toBeInstanceOf(PausedAgentError);
    // Store still captured the entry.
    const recent = await auditStoreRef.recent(10);
    expect(recent.some((e) => e.action === "runtime.blocked-paused")).toBe(true);
  });

  it("does not attempt a mirror when the audit store failed (nothing to mirror)", async () => {
    await pauseSink.pauseAgent(pausedRecord("viktor"));
    const brokenAudit = {
      async append() {
        throw new Error("audit KV down");
      },
      async recent() {
        return [];
      },
      async byRun() {
        return [];
      },
      async byAgent() {
        return [];
      },
      async byAction() {
        return [];
      },
    };
    const mirrored: unknown[] = [];
    const surface = {
      async mirror(entry: unknown) {
        mirrored.push(entry);
      },
    };
    await expect(
      guardAgent(baseRun("viktor"), {
        pauseSink,
        auditStore: brokenAudit,
        auditSurface: surface,
      }),
    ).rejects.toBeInstanceOf(PausedAgentError);
    // When the store fails, the mirror is skipped — the entry never
    // existed to mirror. The refusal still propagates.
    expect(mirrored).toHaveLength(0);
  });
});

// ---- runWithGuard() ---------------------------------------------------

describe("runWithGuard()", () => {
  it("runs fn when the agent is unpaused", async () => {
    const pauseSink = new InMemoryPauseSink();
    const result = await runWithGuard(baseRun(), { pauseSink }, async () => 42);
    expect(result).toBe(42);
  });

  it("throws PausedAgentError before fn runs when the agent is paused", async () => {
    const pauseSink = new InMemoryPauseSink();
    await pauseSink.pauseAgent(pausedRecord("viktor"));
    let ran = false;
    await expect(
      runWithGuard(baseRun("viktor"), { pauseSink }, async () => {
        ran = true;
        return 1;
      }),
    ).rejects.toBeInstanceOf(PausedAgentError);
    expect(ran).toBe(false);
  });
});

// ---- Integration: record() + requestApproval() fail closed for paused agents --

describe("record() + requestApproval() use guardAgent internally", () => {
  let approvalStoreRef: InMemoryApprovalStore;
  let auditStoreRef: InMemoryAuditStore;
  let pauseSinkRef: InMemoryPauseSink;

  beforeEach(() => {
    approvalStoreRef = new InMemoryApprovalStore();
    auditStoreRef = new InMemoryAuditStore();
    pauseSinkRef = new InMemoryPauseSink();
    __resetStores();
    __resetSurfaces();
    __setStoresForTest({
      approval: approvalStoreRef,
      audit: auditStoreRef,
      pause: pauseSinkRef,
    });
    __setSurfacesForTest({
      approval: {
        async surfaceApproval() {
          return { channel: "ops-approvals", ts: "ts-test" };
        },
        async updateApproval() {},
      },
      audit: {
        async mirror() {},
      },
    });
  });

  afterEach(() => {
    __resetStores();
    __resetSurfaces();
  });

  it("record() refuses when the agent is paused — no audit entry written for the refused action", async () => {
    await pauseSinkRef.pauseAgent(pausedRecord("viktor"));
    await expect(
      record(baseRun("viktor"), {
        actionSlug: "hubspot.task.create",
        entityType: "task",
        result: "ok",
      }),
    ).rejects.toBeInstanceOf(PausedAgentError);
    // Only the guard's runtime.blocked-paused entry lands. The refused
    // hubspot.task.create never made it to the store.
    const recent = await auditStoreRef.recent(10);
    expect(recent).toHaveLength(1);
    expect(recent[0].action).toBe("runtime.blocked-paused");
  });

  it("requestApproval() refuses when the agent is paused", async () => {
    await pauseSinkRef.pauseAgent(pausedRecord("viktor"));
    await expect(
      requestApproval(baseRun("viktor"), {
        actionSlug: "gmail.send",
        targetSystem: "gmail",
        payloadPreview: "p",
        evidence: { claim: "c", sources: [], confidence: 0.9 },
        rollbackPlan: "r",
      }),
    ).rejects.toBeInstanceOf(PausedAgentError);
    // No approval was opened.
    const pending = await approvalStoreRef.listPending();
    expect(pending).toHaveLength(0);
    // Only runtime.blocked-paused in audit.
    const recent = await auditStoreRef.recent(10);
    expect(recent.every((e) => e.action === "runtime.blocked-paused")).toBe(true);
  });

  it("unpause lets the agent run again", async () => {
    await pauseSinkRef.pauseAgent(pausedRecord("viktor"));
    await expect(
      record(baseRun("viktor"), {
        actionSlug: "hubspot.task.create",
        entityType: "task",
        result: "ok",
      }),
    ).rejects.toBeInstanceOf(PausedAgentError);

    await pauseSinkRef.unpauseAgent("viktor", "reviewed by Ben");
    const entry = await record(baseRun("viktor"), {
      actionSlug: "hubspot.task.create",
      entityType: "task",
      result: "ok",
    });
    expect(entry.action).toBe("hubspot.task.create");
  });
});
