import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as postViolation, GET as getViolations } from "@/app/api/ops/control-plane/violations/route";
import { POST as postCorrection, GET as getCorrections } from "@/app/api/ops/control-plane/corrections/route";
import { GET as getPaused } from "@/app/api/ops/control-plane/paused/route";
import { POST as postUnpause } from "@/app/api/ops/control-plane/unpause/route";
import { GET as getScorecards } from "@/app/api/ops/control-plane/scorecards/route";
import { GET as getApprovals } from "@/app/api/ops/control-plane/approvals/route";
import { GET as getAudit } from "@/app/api/ops/control-plane/audit/route";

import { buildAuditEntry } from "../audit";
import { newRunContext } from "../run-id";
import { buildApprovalRequest } from "../approvals";
import {
  InMemoryCorrectionStore,
  InMemoryPauseSink,
  InMemoryViolationStore,
} from "../enforcement";
import {
  __resetStores,
  __setStoresForTest,
  InMemoryApprovalStore,
  InMemoryAuditStore,
} from "../stores";
import { __resetSurfaces, __setSurfacesForTest } from "../slack";

// ---- Fixture plumbing --------------------------------------------------

const PRIOR_CRON = process.env.CRON_SECRET;

let approvalStoreRef: InMemoryApprovalStore;
let auditStoreRef: InMemoryAuditStore;
let pauseSinkRef: InMemoryPauseSink;
let violationStoreRef: InMemoryViolationStore;
let correctionStoreRef: InMemoryCorrectionStore;

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  approvalStoreRef = new InMemoryApprovalStore();
  auditStoreRef = new InMemoryAuditStore();
  pauseSinkRef = new InMemoryPauseSink();
  violationStoreRef = new InMemoryViolationStore();
  correctionStoreRef = new InMemoryCorrectionStore();
  __resetStores();
  __resetSurfaces();
  __setStoresForTest({
    approval: approvalStoreRef,
    audit: auditStoreRef,
    pause: pauseSinkRef,
    violation: violationStoreRef,
    correction: correctionStoreRef,
  });
  __setSurfacesForTest({ audit: { async mirror() {} } });
});

afterEach(() => {
  if (PRIOR_CRON === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = PRIOR_CRON;
  __resetStores();
  __resetSurfaces();
});

function authed(url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", "Bearer test-secret");
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Request(url, { ...init, headers });
}

const BASE = "https://example.test";

// ---- Tests -------------------------------------------------------------

describe("POST /api/ops/control-plane/violations", () => {
  it("rejects unauthenticated", async () => {
    const res = await postViolation(
      new Request(`${BASE}/api/ops/control-plane/violations`, { method: "POST" }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects invalid JSON", async () => {
    const res = await postViolation(
      authed(`${BASE}/api/ops/control-plane/violations`, {
        method: "POST",
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects missing fields", async () => {
    const res = await postViolation(
      authed(`${BASE}/api/ops/control-plane/violations`, {
        method: "POST",
        body: JSON.stringify({ agentId: "viktor" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.missing).toEqual(
      expect.arrayContaining(["division", "kind", "detail"]),
    );
  });

  it("rejects unknown violation kind", async () => {
    const res = await postViolation(
      authed(`${BASE}/api/ops/control-plane/violations`, {
        method: "POST",
        body: JSON.stringify({
          agentId: "viktor",
          division: "sales",
          kind: "made-up-kind",
          detail: "x",
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("appends + returns the violation with a minted id + detectedAt", async () => {
    const res = await postViolation(
      authed(`${BASE}/api/ops/control-plane/violations`, {
        method: "POST",
        body: JSON.stringify({
          agentId: "viktor",
          division: "sales",
          kind: "missing_citation",
          detail: "claimed $ value without source",
          detectedBy: "drift-audit",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.violation.id).toBeTruthy();
    expect(body.violation.detectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const stored = await violationStoreRef.listInWindow(
      new Date(Date.now() - 86_400_000).toISOString(),
      new Date().toISOString(),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].agentId).toBe("viktor");
    expect(await violationStoreRef.hasAnyEverRecorded()).toBe(true);
  });
});

describe("GET /api/ops/control-plane/violations", () => {
  it("returns window + agent filter", async () => {
    await violationStoreRef.append({
      id: "v1",
      runId: "r",
      agentId: "viktor",
      division: "sales",
      kind: "missing_citation",
      detail: "x",
      detectedBy: "drift-audit",
      detectedAt: new Date().toISOString(),
    });
    await violationStoreRef.append({
      id: "v2",
      runId: "r",
      agentId: "booke",
      division: "financials",
      kind: "stale_data",
      detail: "y",
      detectedBy: "drift-audit",
      detectedAt: new Date().toISOString(),
    });
    const res = await getViolations(
      authed(`${BASE}/api/ops/control-plane/violations?agentId=viktor`),
    );
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.violations[0].agentId).toBe("viktor");
  });
});

describe("POST /api/ops/control-plane/corrections", () => {
  it("rejects unauthenticated", async () => {
    const res = await postCorrection(
      new Request(`${BASE}/api/ops/control-plane/corrections`, { method: "POST" }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects missing correctedBy", async () => {
    const res = await postCorrection(
      authed(`${BASE}/api/ops/control-plane/corrections`, {
        method: "POST",
        body: JSON.stringify({ agentId: "viktor", division: "sales" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects unknown correctedBy", async () => {
    const res = await postCorrection(
      authed(`${BASE}/api/ops/control-plane/corrections`, {
        method: "POST",
        body: JSON.stringify({
          agentId: "viktor",
          division: "sales",
          correctedBy: "SomeoneElse",
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("appends + returns the correction", async () => {
    const res = await postCorrection(
      authed(`${BASE}/api/ops/control-plane/corrections`, {
        method: "POST",
        body: JSON.stringify({
          agentId: "viktor",
          division: "sales",
          correctedBy: "Ben",
          field: "deal_stage",
          wrongValue: "Sample Requested",
          correctValue: "Sample Shipped",
          note: "tracking was in thread",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.correction.correctedBy).toBe("Ben");
    expect(await correctionStoreRef.hasAnyEverRecorded()).toBe(true);
  });
});

describe("GET /api/ops/control-plane/corrections", () => {
  it("returns a count for the window", async () => {
    await correctionStoreRef.append({
      id: "c1",
      at: new Date().toISOString(),
      agentId: "viktor",
      division: "sales",
      correctedBy: "Ben",
    });
    const res = await getCorrections(authed(`${BASE}/api/ops/control-plane/corrections`));
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.window.windowDays).toBe(7);
  });
});

describe("GET /api/ops/control-plane/paused + POST /unpause", () => {
  it("lists paused agents", async () => {
    await pauseSinkRef.pauseAgent({
      agentId: "viktor",
      division: "sales",
      reason: "2 violations",
      violationsInWindow: 2,
      windowStart: new Date().toISOString(),
      windowEnd: new Date().toISOString(),
      scorecardId: "sc-1",
      pausedAt: new Date().toISOString(),
    });
    const res = await getPaused(authed(`${BASE}/api/ops/control-plane/paused`));
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.paused[0].agentId).toBe("viktor");
  });

  it("unpause requires reason", async () => {
    const res = await postUnpause(
      authed(`${BASE}/api/ops/control-plane/unpause`, {
        method: "POST",
        body: JSON.stringify({ agentId: "viktor" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("unpause returns 409 when agent is not paused", async () => {
    const res = await postUnpause(
      authed(`${BASE}/api/ops/control-plane/unpause`, {
        method: "POST",
        body: JSON.stringify({ agentId: "viktor", reason: "r" }),
      }),
    );
    expect(res.status).toBe(409);
  });

  it("unpause removes the agent and records a runtime.agent-unpaused audit entry", async () => {
    await pauseSinkRef.pauseAgent({
      agentId: "viktor",
      division: "sales",
      reason: "2 violations",
      violationsInWindow: 2,
      windowStart: new Date().toISOString(),
      windowEnd: new Date().toISOString(),
      scorecardId: "sc-1",
      pausedAt: new Date().toISOString(),
    });
    const res = await postUnpause(
      authed(`${BASE}/api/ops/control-plane/unpause`, {
        method: "POST",
        body: JSON.stringify({
          agentId: "viktor",
          reason: "Reviewed scorecard sc-1",
          actor: "Ben",
        }),
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(await pauseSinkRef.isPaused("viktor")).toBe(false);
    const audit = await auditStoreRef.recent(10);
    const unpauseEntry = audit.find((e) => e.action === "runtime.agent-unpaused");
    expect(unpauseEntry).toBeDefined();
    expect(unpauseEntry?.actorType).toBe("human");
    expect(unpauseEntry?.actorId).toBe("Ben");
    expect(unpauseEntry?.entityId).toBe("viktor");
  });
});

describe("GET /api/ops/control-plane/scorecards", () => {
  it("surfaces drift-audit.scorecard entries newest-first, respecting limit", async () => {
    const run = newRunContext({
      agentId: "drift-audit",
      division: "executive-control",
      source: "scheduled",
    });
    for (let i = 0; i < 3; i++) {
      await auditStoreRef.append(
        buildAuditEntry(
          run,
          {
            action: "drift-audit.scorecard",
            entityType: "scorecard",
            entityId: `sc-${i}`,
            after: `samples=${i}/0 | enforcement=not-needed`,
            result: "ok",
          },
          new Date(Date.now() + i * 1000),
        ),
      );
    }
    // Add a non-scorecard entry that should be filtered out.
    await auditStoreRef.append(
      buildAuditEntry(run, {
        action: "open-brain.capture",
        entityType: "thought",
        result: "ok",
      }),
    );
    const res = await getScorecards(
      authed(`${BASE}/api/ops/control-plane/scorecards?limit=2`),
    );
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.scorecards.every((s: { scorecardId: string }) => s.scorecardId.startsWith("sc-"))).toBe(true);
  });

  it("finds the latest scorecard even when swamped by 600 newer non-scorecard entries (byAction index)", async () => {
    const driftRun = newRunContext({
      agentId: "drift-audit",
      division: "executive-control",
      source: "scheduled",
    });
    await auditStoreRef.append(
      buildAuditEntry(
        driftRun,
        {
          action: "drift-audit.scorecard",
          entityType: "scorecard",
          entityId: "sc-old",
          after: "samples=10/34 | enforcement=enforced",
          result: "ok",
        },
        new Date(2026, 0, 1),
      ),
    );
    const viktorRun = newRunContext({
      agentId: "viktor",
      division: "sales",
      source: "on-demand",
    });
    for (let i = 0; i < 600; i++) {
      await auditStoreRef.append(
        buildAuditEntry(
          viktorRun,
          { action: "hubspot.task.create", entityType: "task", result: "ok" },
          new Date(2026, 3, 1, 0, 0, i),
        ),
      );
    }
    const res = await getScorecards(
      authed(`${BASE}/api/ops/control-plane/scorecards?limit=5`),
    );
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.scorecards[0].scorecardId).toBe("sc-old");
    expect(body.scorecards[0].summary).toContain("samples=");
  });
});

describe("GET /api/ops/control-plane/approvals", () => {
  it("returns pending approvals", async () => {
    const req = buildApprovalRequest({
      actionSlug: "gmail.send",
      runId: "r",
      division: "sales",
      actorAgentId: "viktor",
      targetSystem: "gmail",
      payloadPreview: "p",
      evidence: { claim: "c", sources: [], confidence: 0.9 },
      rollbackPlan: "r",
    });
    await approvalStoreRef.put(req);
    const res = await getApprovals(
      authed(`${BASE}/api/ops/control-plane/approvals?mode=pending`),
    );
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.approvals[0].id).toBe(req.id);
  });

  it("by-agent mode requires agentId", async () => {
    const res = await getApprovals(
      authed(`${BASE}/api/ops/control-plane/approvals?mode=by-agent`),
    );
    expect(res.status).toBe(400);
  });

  it("by-agent mode returns only that agent's approvals", async () => {
    const r1 = buildApprovalRequest({
      actionSlug: "gmail.send",
      runId: "r",
      division: "sales",
      actorAgentId: "viktor",
      targetSystem: "gmail",
      payloadPreview: "p",
      evidence: { claim: "c", sources: [], confidence: 0.9 },
      rollbackPlan: "r",
    });
    const r2 = buildApprovalRequest({
      actionSlug: "gmail.send",
      runId: "r",
      division: "sales",
      actorAgentId: "someone-else",
      targetSystem: "gmail",
      payloadPreview: "p",
      evidence: { claim: "c", sources: [], confidence: 0.9 },
      rollbackPlan: "r",
    });
    await approvalStoreRef.put(r1);
    await approvalStoreRef.put(r2);
    const res = await getApprovals(
      authed(`${BASE}/api/ops/control-plane/approvals?mode=by-agent&agentId=viktor`),
    );
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.approvals[0].actorAgentId).toBe("viktor");
  });
});

describe("GET /api/ops/control-plane/audit", () => {
  it("recent mode clamps limit", async () => {
    const run = newRunContext({ agentId: "viktor", division: "sales", source: "on-demand" });
    for (let i = 0; i < 5; i++) {
      await auditStoreRef.append(
        buildAuditEntry(
          run,
          { action: "hubspot.task.create", entityType: "task", result: "ok" },
          new Date(Date.now() + i * 1000),
        ),
      );
    }
    const res = await getAudit(
      authed(`${BASE}/api/ops/control-plane/audit?mode=recent&limit=3`),
    );
    const body = await res.json();
    expect(body.count).toBe(3);
  });

  it("by-run mode requires runId", async () => {
    const res = await getAudit(
      authed(`${BASE}/api/ops/control-plane/audit?mode=by-run`),
    );
    expect(res.status).toBe(400);
  });

  it("by-run groups entries", async () => {
    const runA = newRunContext({ agentId: "viktor", division: "sales", source: "on-demand" });
    const runB = newRunContext({ agentId: "viktor", division: "sales", source: "on-demand" });
    await auditStoreRef.append(buildAuditEntry(runA, { action: "x.y", entityType: "t", result: "ok" }));
    await auditStoreRef.append(buildAuditEntry(runB, { action: "x.z", entityType: "t", result: "ok" }));
    const res = await getAudit(
      authed(`${BASE}/api/ops/control-plane/audit?mode=by-run&runId=${runA.runId}`),
    );
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.entries[0].runId).toBe(runA.runId);
  });

  it("by-agent respects sinceDays cutoff", async () => {
    const runNew = newRunContext({ agentId: "viktor", division: "sales", source: "on-demand" });
    const runOld = newRunContext({ agentId: "viktor", division: "sales", source: "on-demand" });
    await auditStoreRef.append(buildAuditEntry(runNew, { action: "x", entityType: "t", result: "ok" }));
    await auditStoreRef.append(
      buildAuditEntry(
        runOld,
        { action: "x", entityType: "t", result: "ok" },
        new Date("2020-01-01T00:00:00Z"),
      ),
    );
    const res = await getAudit(
      authed(`${BASE}/api/ops/control-plane/audit?mode=by-agent&agentId=viktor&sinceDays=7`),
    );
    const body = await res.json();
    expect(body.count).toBe(1);
  });
});
