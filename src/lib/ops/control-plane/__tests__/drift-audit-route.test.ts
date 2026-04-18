import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/ops/control-plane/drift-audit/route";
import { buildAuditEntry } from "../audit";
import {
  InMemoryCorrectionStore,
  InMemoryPauseSink,
  InMemoryViolationStore,
} from "../enforcement";
import { newRunContext } from "../run-id";
import {
  __resetStores,
  __setStoresForTest,
  InMemoryAuditStore,
} from "../stores";
import { __setSurfacesForTest, __resetSurfaces } from "../slack";
import type { PolicyViolation } from "../types";

/**
 * Route-level tests for POST /api/ops/control-plane/drift-audit.
 * Covers auth, degraded-mode envelope, and end-to-end enforcement via
 * the in-memory stores injected through the factory test hooks.
 */

const PRIOR_CRON = process.env.CRON_SECRET;

let auditStoreRef: InMemoryAuditStore;
let pauseSinkRef: InMemoryPauseSink;
let violationStoreRef: InMemoryViolationStore;
let correctionStoreRef: InMemoryCorrectionStore;

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  auditStoreRef = new InMemoryAuditStore();
  pauseSinkRef = new InMemoryPauseSink();
  violationStoreRef = new InMemoryViolationStore();
  correctionStoreRef = new InMemoryCorrectionStore();
  __resetStores();
  __resetSurfaces();
  __setStoresForTest({
    audit: auditStoreRef,
    pause: pauseSinkRef,
    violation: violationStoreRef,
    correction: correctionStoreRef,
  });
  __setSurfacesForTest({
    audit: { async mirror() {} },
  });
});

afterEach(() => {
  if (PRIOR_CRON === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = PRIOR_CRON;
});

function req(url = "https://example.test/api/ops/control-plane/drift-audit"): Request {
  return new Request(url, {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
  });
}

async function seedAudit(agent = "viktor") {
  const run = newRunContext({ agentId: agent, division: "sales", source: "on-demand" });
  const entry = buildAuditEntry(run, {
    action: "hubspot.task.create",
    entityType: "task",
    result: "ok",
  });
  await auditStoreRef.append(entry);
}

function violation(agentId: string, minutesAgo: number): PolicyViolation {
  return {
    id: `v-${Math.random().toString(36).slice(2, 8)}`,
    runId: "r",
    agentId,
    division: "sales",
    kind: "missing_citation",
    detail: "synthesis without source",
    detectedBy: "drift-audit",
    detectedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

describe("POST /api/ops/control-plane/drift-audit", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await POST(
      new Request("https://example.test/api/ops/control-plane/drift-audit", {
        method: "POST",
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("fails closed when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(req());
    expect(res.status).toBe(401);
  });

  it("returns degraded: true when both stores have never been populated", async () => {
    await seedAudit();
    const res = await POST(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // Explicit degraded flag — route refuses to pretend the audit is clean.
    expect(body.degraded).toBe(true);
    expect(body.degradedReasons).toEqual(expect.arrayContaining([expect.stringContaining("violation store has never")]));
    expect(body.degradedReasons).toEqual(expect.arrayContaining([expect.stringContaining("correction store has never")]));
    expect(body.enforcement.violationStore).toBe("never-populated");
    expect(body.enforcement.correctionStore).toBe("never-populated");
    expect(body.enforcement.violationsEverRecorded).toBe(false);
    expect(body.enforcement.correctionsEverRecorded).toBe(false);
    expect(body.enforcement.pauseSink).toBe("healthy");
    expect(body.scorecard.enforcement.mode).toBe("not-needed"); // no violations → no pause to apply
  });

  it("end-to-end: real violations drive auto-pause via the PauseSink", async () => {
    await seedAudit("viktor");
    // Populate both stores so degraded drops to false.
    await violationStoreRef.append(violation("viktor", 5));
    await violationStoreRef.append(violation("viktor", 10));
    await correctionStoreRef.append({
      id: "c-1",
      at: new Date(Date.now() - 60_000).toISOString(),
      agentId: "viktor",
      division: "sales",
      correctedBy: "Ben",
    });

    const res = await POST(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.degraded).toBe(false);
    expect(body.enforcement.violationStore).toBe("healthy");
    expect(body.enforcement.correctionStore).toBe("healthy");
    expect(body.enforcement.pauseSink).toBe("healthy");
    expect(body.enforcement.inWindowViolations).toBe(2);
    expect(body.enforcement.inWindowCorrections).toBe(1);
    expect(body.scorecard.agentsAutoPaused).toEqual(["viktor"]);
    expect(body.scorecard.enforcement.mode).toBe("enforced");
    expect(body.scorecard.enforcement.pausesApplied).toBe(1);

    // Side-effect: pause actually persisted and queryable.
    expect(await pauseSinkRef.isPaused("viktor")).toBe(true);
    const paused = await pauseSinkRef.listPaused();
    expect(paused).toHaveLength(1);
    expect(paused[0].scorecardId).toBe(body.scorecard.id);
  });

  it("returns degraded when the violation store throws (simulating KV outage)", async () => {
    await seedAudit();
    __setStoresForTest({
      violation: {
        async listInWindow() {
          throw new Error("KV down");
        },
        async hasAnyEverRecorded() {
          throw new Error("KV down");
        },
        async append() {
          throw new Error("KV down");
        },
      },
    });
    const res = await POST(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.degraded).toBe(true);
    expect(body.enforcement.violationStore).toBe("unreachable");
    // The audit still ran — it just did not have real violation inputs.
    expect(body.scorecard).toBeDefined();
  });

  it("honors sampleSize + windowDays query params (clamped to sane ranges)", async () => {
    await seedAudit();
    const url = "https://example.test/api/ops/control-plane/drift-audit?sampleSize=3&windowDays=14";
    const res = await POST(
      new Request(url, { method: "POST", headers: { authorization: "Bearer test-secret" } }),
    );
    const body = await res.json();
    expect(body.scorecard.windowStart).toBeDefined();
    expect(body.scorecard.windowEnd).toBeDefined();
    // 14d window boundary check: the delta is 14 * 86400 * 1000 ms.
    const deltaMs = new Date(body.scorecard.windowEnd).getTime() - new Date(body.scorecard.windowStart).getTime();
    expect(deltaMs).toBe(14 * 86_400_000);
  });
});
