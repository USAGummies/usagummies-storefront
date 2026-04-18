import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { composeDailyBrief } from "../daily-brief";
import { POST } from "@/app/api/ops/daily-brief/route";
import { buildApprovalRequest, applyDecision } from "../approvals";
import { buildAuditEntry } from "../audit";
import { newRunContext } from "../run-id";
import {
  __resetStores,
  __setStoresForTest,
  InMemoryApprovalStore,
  InMemoryAuditStore,
} from "../stores";
import { InMemoryPauseSink } from "../enforcement";
import { __setSurfacesForTest, __resetSurfaces } from "../slack";
import type { PausedAgentRecord } from "../enforcement";

// ---------------------------------------------------------------------------
// composeDailyBrief (unit) — pure rendering, deterministic
// ---------------------------------------------------------------------------

describe("composeDailyBrief()", () => {
  const baseInput = () => ({
    kind: "morning" as const,
    asOf: new Date("2026-04-20T14:00:00Z"),
    activeDivisions: [
      { id: "sales", name: "Sales", humanOwner: "Ben" },
      { id: "financials", name: "Financials", humanOwner: "Rene" },
    ],
    pendingApprovals: [],
    pausedAgents: [] as PausedAgentRecord[],
    recentAudit: [],
  });

  it("renders a healthy brief with zero pending + zero paused", () => {
    const out = composeDailyBrief(baseInput());
    expect(out.meta.pendingApprovalCount).toBe(0);
    expect(out.meta.pausedAgentCount).toBe(0);
    expect(out.meta.degraded).toBe(false);
    expect(out.text).toContain("0 pending approval(s), 0 paused agent(s)");
    // Degraded banner NOT present.
    expect(JSON.stringify(out.blocks)).not.toContain("Degraded brief");
  });

  it("degraded banner appears when degradations are provided", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      degradations: ["pause sink unavailable", "approval store unavailable"],
    });
    expect(out.meta.degraded).toBe(true);
    expect(JSON.stringify(out.blocks)).toContain("Degraded brief");
    expect(JSON.stringify(out.blocks)).toContain("pause sink unavailable");
  });

  it("surfaces paused agents as a critical-tier line", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      pausedAgents: [
        {
          agentId: "viktor",
          division: "sales",
          reason: "2 violations",
          violationsInWindow: 2,
          windowStart: "2026-04-13T14:00:00Z",
          windowEnd: "2026-04-20T14:00:00Z",
          scorecardId: "sc-1",
          pausedAt: "2026-04-20T13:30:00Z",
        },
      ],
    });
    expect(out.meta.pausedAgentCount).toBe(1);
    expect(JSON.stringify(out.blocks)).toContain("viktor");
    expect(JSON.stringify(out.blocks)).toContain("🛑");
  });

  it("groups pending approvals by division with action preview", () => {
    const req = buildApprovalRequest({
      actionSlug: "gmail.send",
      runId: "r",
      division: "sales",
      actorAgentId: "viktor",
      targetSystem: "gmail",
      payloadPreview: "follow up",
      evidence: { claim: "c", sources: [], confidence: 0.9 },
      rollbackPlan: "recall",
    });
    const out = composeDailyBrief({
      ...baseInput(),
      pendingApprovals: [req],
    });
    const txt = JSON.stringify(out.blocks);
    expect(txt).toContain("Pending approvals by division");
    expect(txt).toContain("sales");
    expect(txt).toContain("Send outreach email");
  });

  it("refuses to fabricate revenue — renders 'unavailable' when revenueYesterday omitted", () => {
    const out = composeDailyBrief(baseInput());
    expect(JSON.stringify(out.blocks)).toContain("External revenue integrations not wired");
    expect(JSON.stringify(out.blocks)).toContain("rather than fabricated");
  });

  it("shows revenue lines when supplied with a live source", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      revenueYesterday: [
        {
          channel: "Shopify DTC",
          amountUsd: 444.96,
          source: { system: "shopify", id: "order-1016", retrievedAt: "2026-04-20T06:00:00Z" },
        },
        {
          channel: "Amazon",
          amountUsd: null,
          unavailableReason: "SP-API credentials not rotated yet",
        },
      ],
    });
    const txt = JSON.stringify(out.blocks);
    expect(txt).toContain("Shopify DTC");
    expect(txt).toContain("444.96");
    expect(txt).toContain("SP-API credentials not rotated yet");
  });

  it("counts audit activity per division in the last 24h only", () => {
    const entries = [
      buildAuditEntry(
        newRunContext({ agentId: "viktor", division: "sales", source: "on-demand" }),
        { action: "hubspot.task.create", entityType: "task", result: "ok" },
        new Date("2026-04-20T13:00:00Z"), // 1h before asOf
      ),
      buildAuditEntry(
        newRunContext({ agentId: "booke", division: "financials", source: "on-demand" }),
        { action: "qbo.transaction.categorize", entityType: "transaction", result: "ok" },
        new Date("2026-04-20T10:00:00Z"), // 4h before asOf
      ),
      buildAuditEntry(
        newRunContext({ agentId: "viktor", division: "sales", source: "on-demand" }),
        { action: "open-brain.capture", entityType: "thought", result: "ok" },
        new Date("2026-04-17T00:00:00Z"), // 3d+ old → excluded
      ),
    ];
    const out = composeDailyBrief({ ...baseInput(), recentAudit: entries });
    expect(out.meta.activityLast24h).toBe(2);
    const txt = JSON.stringify(out.blocks);
    expect(txt).toContain("Audit activity (last 24h)");
    expect(txt).toContain("sales");
    expect(txt).toContain("financials");
  });

  it("includes the last drift audit summary when provided", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      lastDriftAuditSummary: "samples=10/34 | enforcement=enforced | auto_paused=none",
    });
    expect(JSON.stringify(out.blocks)).toContain("Last drift audit");
    expect(JSON.stringify(out.blocks)).toContain("enforcement=enforced");
  });
});

// ---------------------------------------------------------------------------
// Route — integration with the factory-backed stores + stub Slack surface
// ---------------------------------------------------------------------------

describe("POST /api/ops/daily-brief", () => {
  const PRIOR_CRON = process.env.CRON_SECRET;
  const PRIOR_TOKEN = process.env.SLACK_BOT_TOKEN;

  let approvalStoreRef: InMemoryApprovalStore;
  let auditStoreRef: InMemoryAuditStore;
  let pauseSinkRef: InMemoryPauseSink;

  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
    // Keep Slack in degraded mode so the route doesn't hit the real API.
    delete process.env.SLACK_BOT_TOKEN;
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
    __setSurfacesForTest({ audit: { async mirror() {} } });
  });

  afterEach(() => {
    if (PRIOR_CRON === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = PRIOR_CRON;
    if (PRIOR_TOKEN === undefined) delete process.env.SLACK_BOT_TOKEN;
    else process.env.SLACK_BOT_TOKEN = PRIOR_TOKEN;
  });

  function authed(url = "https://example.test/api/ops/daily-brief"): Request {
    return new Request(url, {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
    });
  }

  it("rejects unauthenticated requests", async () => {
    const res = await POST(
      new Request("https://example.test/api/ops/daily-brief", {
        method: "POST",
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("renders a healthy brief when all stores are reachable and empty", async () => {
    const res = await POST(authed());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.degraded).toBe(false);
    expect(body.brief.meta.kind).toBe("morning");
    expect(body.brief.meta.pendingApprovalCount).toBe(0);
    expect(body.brief.meta.pausedAgentCount).toBe(0);
    // Slack post ran but in degraded mode (no token) → ok:false, degraded flag from client.
    expect(body.post).not.toBeNull();
  });

  it("kind=eod is honored via query param", async () => {
    const res = await POST(authed("https://example.test/api/ops/daily-brief?kind=eod"));
    const body = await res.json();
    expect(body.brief.meta.kind).toBe("eod");
  });

  it("skips Slack post when post=false", async () => {
    const res = await POST(authed("https://example.test/api/ops/daily-brief?post=false"));
    const body = await res.json();
    expect(body.post).toBeNull();
  });

  it("reflects pending approvals + paused agents in the meta block", async () => {
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
    await pauseSinkRef.pauseAgent({
      agentId: "booke",
      division: "financials",
      reason: "2 violations",
      violationsInWindow: 2,
      windowStart: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      windowEnd: new Date().toISOString(),
      scorecardId: "sc-1",
      pausedAt: new Date().toISOString(),
    });

    const res = await POST(authed());
    const body = await res.json();
    expect(body.brief.meta.pendingApprovalCount).toBe(1);
    expect(body.brief.meta.pausedAgentCount).toBe(1);
    expect(JSON.stringify(body.brief.blocks)).toContain("booke");
  });

  it("degrades explicitly when the approval store throws", async () => {
    __setStoresForTest({
      approval: {
        async put() {
          throw new Error("KV down");
        },
        async get() {
          return null;
        },
        async listPending() {
          throw new Error("KV down");
        },
        async listByAgent() {
          return [];
        },
      },
    });
    const res = await POST(authed());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.degraded).toBe(true);
    expect(JSON.stringify(body.brief.blocks)).toContain("Degraded brief");
    expect(JSON.stringify(body.brief.blocks)).toContain("approval store unavailable");
  });

  it("picks up the most recent drift-audit.scorecard summary", async () => {
    const run = newRunContext({ agentId: "drift-audit", division: "executive-control", source: "scheduled" });
    await auditStoreRef.append(
      buildAuditEntry(run, {
        action: "drift-audit.scorecard",
        entityType: "scorecard",
        after: "samples=5/12 | enforcement=not-needed",
        result: "ok",
      }),
    );
    const res = await POST(authed());
    const body = await res.json();
    expect(JSON.stringify(body.brief.blocks)).toContain("samples=5/12");
    expect(JSON.stringify(body.brief.blocks)).toContain("enforcement=not-needed");
  });

  // Consume unused import warnings.
  it("rejects applyDecision() side-effects when approval in terminal state (sanity)", () => {
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
    const approved = applyDecision(req, { approver: "Ben", decision: "approve" });
    expect(approved.status).toBe("approved");
  });
});
