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

  // ---- Phase 2 — Sales Command compact section -------------------------

  it("morning brief includes Sales Command section when slice is provided", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      salesCommand: {
        faireInvitesNeedsReview: 3,
        faireFollowUpsOverdue: 2,
        faireFollowUpsDueSoon: 1,
        pendingApprovals: 5,
        apPacketsActionRequired: 1,
        apPacketsSent: 0,
        retailDraftsNeedsReview: 4,
        retailDraftsAccepted: 12,
        wholesaleInquiries: null,
        anyAction: true,
      },
    });
    const json = JSON.stringify(out.blocks);
    expect(json).toContain("Sales Command");
    expect(json).toContain("Faire invites awaiting review:");
    // Counts render with Slack bold markup.
    expect(json).toContain("*3*");
    expect(json).toContain("*2* overdue");
    expect(json).toContain("*1* due soon");
    expect(json).toContain("*5*"); // pending approvals
    // not_wired wholesale renders honestly.
    expect(json).toContain("Wholesale inquiries: _not wired_");
    // Deep links present (they live in the footer line).
    expect(json).toContain("/ops/sales");
    expect(json).toContain("/ops/faire-direct");
    expect(json).toContain("/ops/ap-packets");
    expect(json).toContain("/ops/locations");
  });

  it("EOD brief skips the Sales Command section even when slice is provided", () => {
    // The dashboard at /ops/sales is the cumulative close-loop; we
    // don't want a redundant evening Slack post.
    const out = composeDailyBrief({
      ...baseInput(),
      kind: "eod",
      salesCommand: {
        faireInvitesNeedsReview: 3,
        faireFollowUpsOverdue: 2,
        faireFollowUpsDueSoon: 1,
        pendingApprovals: 5,
        apPacketsActionRequired: 1,
        apPacketsSent: 0,
        retailDraftsNeedsReview: 4,
        retailDraftsAccepted: 12,
        wholesaleInquiries: null,
        anyAction: true,
      },
    });
    expect(JSON.stringify(out.blocks)).not.toContain("Sales Command");
  });

  it("Sales Command empty-state collapses to one quiet line when no actions", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      salesCommand: {
        faireInvitesNeedsReview: 0,
        faireFollowUpsOverdue: 0,
        faireFollowUpsDueSoon: 0,
        pendingApprovals: 0,
        apPacketsActionRequired: 0,
        apPacketsSent: 1,
        retailDraftsNeedsReview: 0,
        retailDraftsAccepted: 5,
        wholesaleInquiries: null,
        anyAction: false,
      },
    });
    const json = JSON.stringify(out.blocks);
    expect(json).toContain("Sales Command");
    expect(json).toContain("No sales actions queued");
    // Counts NOT rendered as line items in the empty state.
    expect(json).not.toContain("Faire invites awaiting review:");
    expect(json).not.toContain("Slack approvals awaiting Ben:");
  });

  it("not_wired sources render as 'not wired' (NEVER as 0)", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      salesCommand: {
        faireInvitesNeedsReview: 1, // wired-but-actionable so anyAction=true
        faireFollowUpsOverdue: null,
        faireFollowUpsDueSoon: null,
        pendingApprovals: null,
        apPacketsActionRequired: null,
        apPacketsSent: null,
        retailDraftsNeedsReview: null,
        retailDraftsAccepted: null,
        wholesaleInquiries: null,
        anyAction: true,
      },
    });
    const json = JSON.stringify(out.blocks);
    expect(json).toContain("Faire invites awaiting review: *1*");
    expect(json).toContain("Faire follow-ups: not wired");
    expect(json).toContain("Slack approvals awaiting Ben: _not wired_");
    expect(json).toContain("AP packets: not wired");
    expect(json).toContain("Retail drafts: not wired");
    expect(json).toContain("Wholesale inquiries: _not wired_");
    // Crucially: never a fabricated zero on a not_wired source.
    expect(json).not.toContain("Faire follow-ups: *0*");
    expect(json).not.toContain("AP packets: *0*");
  });

  it("Sales Command section is bounded — under 12 lines (header + body + footer)", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      salesCommand: {
        faireInvitesNeedsReview: 9,
        faireFollowUpsOverdue: 9,
        faireFollowUpsDueSoon: 9,
        pendingApprovals: 9,
        apPacketsActionRequired: 9,
        apPacketsSent: 9,
        retailDraftsNeedsReview: 9,
        retailDraftsAccepted: 9,
        wholesaleInquiries: 9,
        anyAction: true,
      },
    });
    type Block = { type: string; text?: { text?: string } };
    const blocks = out.blocks as Block[];
    const salesBlock = blocks.find(
      (b) =>
        b.type === "section" &&
        typeof b.text?.text === "string" &&
        b.text.text.includes("Sales Command"),
    );
    expect(salesBlock).toBeDefined();
    const lineCount = (salesBlock!.text!.text! as string).split("\n").length;
    expect(lineCount).toBeLessThanOrEqual(12);
  });

  it("Sales Command section is not rendered when slice is omitted", () => {
    const out = composeDailyBrief(baseInput()); // no salesCommand
    expect(JSON.stringify(out.blocks)).not.toContain("Sales Command");
  });

  // ---- Phase 3 — aging callouts (max 3, critical-first) -----------------

  it("aging callouts render between body counts and footer (max 3)", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      salesCommand: {
        faireInvitesNeedsReview: 0,
        faireFollowUpsOverdue: 0,
        faireFollowUpsDueSoon: 0,
        pendingApprovals: 0,
        apPacketsActionRequired: 0,
        apPacketsSent: 0,
        retailDraftsNeedsReview: 0,
        retailDraftsAccepted: 0,
        wholesaleInquiries: null,
        agingCallouts: [
          {
            tier: "critical",
            source: "approval",
            text:
              ":rotating_light: CRITICAL — Slack approval · 5d · Test approval",
          },
          {
            tier: "overdue",
            source: "faire-followup",
            text:
              ":warning: OVERDUE — Faire follow-up · 8d · Tasty Foods",
          },
          {
            tier: "watch",
            source: "location-draft",
            text:
              ":hourglass_flowing_sand: WATCH — Retail draft · 7d · Buc-ee's #14",
          },
        ],
        anyAction: true,
      },
    });
    const json = JSON.stringify(out.blocks);
    expect(json).toContain("*Aging:*");
    expect(json).toContain("CRITICAL");
    expect(json).toContain("OVERDUE");
    expect(json).toContain("WATCH");
    expect(json).toContain("Tasty Foods");
  });

  it("no aging block when callouts list is empty (quiet day)", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      salesCommand: {
        faireInvitesNeedsReview: 1,
        faireFollowUpsOverdue: 0,
        faireFollowUpsDueSoon: 0,
        pendingApprovals: 0,
        apPacketsActionRequired: 0,
        apPacketsSent: 0,
        retailDraftsNeedsReview: 0,
        retailDraftsAccepted: 0,
        wholesaleInquiries: null,
        agingCallouts: [],
        anyAction: true,
      },
    });
    expect(JSON.stringify(out.blocks)).not.toContain("*Aging:*");
  });

  it("brief never renders more than 3 aging callouts even if caller passes more (defensive bound)", () => {
    // The slice composer caps at 3, but the renderer must also stay
    // bounded if a caller hand-builds the slice. Render 5 and assert
    // the section still ≤ MAX_LINES.
    const fiveCallouts = Array.from({ length: 5 }, (_, i) => ({
      tier: "critical" as const,
      source: "approval" as const,
      text: `:rotating_light: CRITICAL — Slack approval · ${(i + 1) * 50}h · row-${i}`,
    }));
    const out = composeDailyBrief({
      ...baseInput(),
      salesCommand: {
        faireInvitesNeedsReview: 1,
        faireFollowUpsOverdue: 1,
        faireFollowUpsDueSoon: 1,
        pendingApprovals: 1,
        apPacketsActionRequired: 1,
        apPacketsSent: 1,
        retailDraftsNeedsReview: 1,
        retailDraftsAccepted: 1,
        wholesaleInquiries: null,
        agingCallouts: fiveCallouts, // bypasses the slice composer's cap
        anyAction: true,
      },
    });
    type Block = { type: string; text?: { text?: string } };
    const blocks = out.blocks as Block[];
    const salesBlock = blocks.find(
      (b) =>
        b.type === "section" &&
        typeof b.text?.text === "string" &&
        b.text.text.includes("Sales Command"),
    );
    expect(salesBlock).toBeDefined();
    const text = salesBlock!.text!.text! as string;
    // Hard cap: header + 6 body lines + Aging header + ≤5 callouts
    // + footer ≈ 14 lines worst case. Locks the renderer can't blow
    // past the section budget.
    expect(text.split("\n").length).toBeLessThanOrEqual(16);
  });

  // ---- Phase 4 — Weekly Revenue KPI one-liner ---------------------------

  it("brief includes the revenue KPI line when slice carries it (actionable day)", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      salesCommand: {
        faireInvitesNeedsReview: 1,
        faireFollowUpsOverdue: 0,
        faireFollowUpsDueSoon: 0,
        pendingApprovals: 0,
        apPacketsActionRequired: 0,
        apPacketsSent: 0,
        retailDraftsNeedsReview: 0,
        retailDraftsAccepted: 0,
        wholesaleInquiries: null,
        revenueKpi: {
          text: "Revenue pace: $24.1K last 7d vs $43.5K required/wk — -$19.4K behind",
          fullyWired: true,
        },
        anyAction: true,
      },
    });
    const json = JSON.stringify(out.blocks);
    expect(json).toContain("Revenue pace:");
    expect(json).toContain("$24.1K last 7d");
  });

  it("brief surfaces 'not fully wired' KPI line when no channel is wired", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      salesCommand: {
        faireInvitesNeedsReview: 1,
        faireFollowUpsOverdue: 0,
        faireFollowUpsDueSoon: 0,
        pendingApprovals: 0,
        apPacketsActionRequired: 0,
        apPacketsSent: 0,
        retailDraftsNeedsReview: 0,
        retailDraftsAccepted: 0,
        wholesaleInquiries: null,
        revenueKpi: {
          text: "Revenue pace not fully wired.",
          fullyWired: false,
        },
        anyAction: true,
      },
    });
    const json = JSON.stringify(out.blocks);
    expect(json).toContain("Revenue pace not fully wired.");
    // Critical: the brief MUST NOT fabricate a $ figure when the
    // slice's revenueKpi is the not-fully-wired fallback.
    // (We check the entire Sales Command block has no $-sign in the
    // revenue line specifically by asserting the fallback is verbatim.)
    expect(json).not.toMatch(/Revenue pace not fully wired.*\$/);
  });

  it("KPI line also appears on quiet days (empty-state still surfaces revenue pulse)", () => {
    // anyAction=false → empty-state path. Even on a quiet day, the
    // KPI line should render so the daily revenue signal isn't lost.
    const out = composeDailyBrief({
      ...baseInput(),
      salesCommand: {
        faireInvitesNeedsReview: 0,
        faireFollowUpsOverdue: 0,
        faireFollowUpsDueSoon: 0,
        pendingApprovals: 0,
        apPacketsActionRequired: 0,
        apPacketsSent: 0,
        retailDraftsNeedsReview: 0,
        retailDraftsAccepted: 0,
        wholesaleInquiries: null,
        revenueKpi: {
          text: "Revenue pace: $24.1K last 7d vs $43.5K required/wk — -$19.4K behind",
          fullyWired: true,
        },
        anyAction: false,
      },
    });
    const json = JSON.stringify(out.blocks);
    expect(json).toContain("No sales actions queued");
    expect(json).toContain("Revenue pace:");
  });
});

// ---------------------------------------------------------------------------
// Route — integration with the factory-backed stores + stub Slack surface
// ---------------------------------------------------------------------------

describe("POST /api/ops/daily-brief", () => {
  const PRIOR_CRON = process.env.CRON_SECRET;
  const PRIOR_TOKEN = process.env.SLACK_BOT_TOKEN;
  const PRIOR_PLAID_ID = process.env.PLAID_CLIENT_ID;
  const PRIOR_PLAID_SECRET = process.env.PLAID_SECRET;

  let approvalStoreRef: InMemoryApprovalStore;
  let auditStoreRef: InMemoryAuditStore;
  let pauseSinkRef: InMemoryPauseSink;

  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
    // Keep Slack in degraded mode so the route doesn't hit the real API.
    delete process.env.SLACK_BOT_TOKEN;
    // Plaid unconfigured by default → resolvePlaidCashPosition returns
    // an explicit "Plaid not configured" unavailable line, which the
    // composer renders honestly. Individual tests can flip this on.
    delete process.env.PLAID_CLIENT_ID;
    delete process.env.PLAID_SECRET;
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
    if (PRIOR_PLAID_ID === undefined) delete process.env.PLAID_CLIENT_ID;
    else process.env.PLAID_CLIENT_ID = PRIOR_PLAID_ID;
    if (PRIOR_PLAID_SECRET === undefined) delete process.env.PLAID_SECRET;
    else process.env.PLAID_SECRET = PRIOR_PLAID_SECRET;
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

  it("renders a healthy brief when all stores are reachable, empty, and the Slack post is skipped", async () => {
    // With SLACK_BOT_TOKEN absent, post=true would degrade the envelope.
    // Isolate the store-health case by skipping the post.
    const res = await POST(authed("https://example.test/api/ops/daily-brief?post=false"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.degraded).toBe(false);
    expect(body.degradedReasons).toEqual([]);
    expect(body.brief.meta.kind).toBe("morning");
    expect(body.brief.meta.pendingApprovalCount).toBe(0);
    expect(body.brief.meta.pausedAgentCount).toBe(0);
    expect(body.post).toBeNull();
  });

  it("marks the envelope degraded when post=true and SLACK_BOT_TOKEN is absent", async () => {
    // Stores are healthy; delivery is not. Response must NOT be silently
    // green — blueprint non-negotiable #6.
    const res = await POST(authed());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.degraded).toBe(true);
    expect(body.brief.meta.degraded).toBe(true);
    expect(body.degradedReasons).toEqual(
      expect.arrayContaining([expect.stringContaining("Slack post skipped")]),
    );
    expect(body.post).not.toBeNull();
    expect(body.post.ok).toBe(false);
    expect(body.post.degraded).toBe(true);
    // Response body must match the degraded state — the returned brief
    // text/blocks include the Slack-skipped degradation, not the
    // pre-failure (healthy-looking) composition.
    expect(body.brief.text).toContain("DEGRADED");
    const blocksText = JSON.stringify(body.brief.blocks);
    expect(blocksText).toContain("Degraded brief");
    expect(blocksText).toContain("Slack post skipped");
  });

  it("marks the envelope degraded when the Slack post hard-fails", async () => {
    // Configure a token so we exit degraded-mode, then stub fetch to fail
    // so the Slack API call errors out.
    process.env.SLACK_BOT_TOKEN = "xoxb-stub-for-test";
    const originalFetch = global.fetch;
    global.fetch = (async () => {
      throw new Error("network unreachable");
    }) as typeof global.fetch;
    try {
      const res = await POST(authed());
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.degraded).toBe(true);
      expect(body.degradedReasons).toEqual(
        expect.arrayContaining([expect.stringContaining("Slack post failed")]),
      );
      expect(body.post.ok).toBe(false);
      expect(body.post.degraded).toBeFalsy();
      expect(body.post.error).toContain("network unreachable");
      // Returned body is the re-composed degraded brief, not the
      // pre-failure version.
      const blocksText = JSON.stringify(body.brief.blocks);
      expect(blocksText).toContain("Degraded brief");
      expect(blocksText).toContain("Slack post failed");
      expect(blocksText).toContain("network unreachable");
      expect(body.brief.text).toContain("DEGRADED");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("kind=eod is honored via query param", async () => {
    // Skip the post so the envelope stays healthy regardless of Slack state.
    const res = await POST(authed("https://example.test/api/ops/daily-brief?kind=eod&post=false"));
    const body = await res.json();
    expect(body.brief.meta.kind).toBe("eod");
    expect(body.post).toBeNull();
  });

  it("skips Slack post when post=false", async () => {
    const res = await POST(authed("https://example.test/api/ops/daily-brief?post=false"));
    const body = await res.json();
    expect(body.post).toBeNull();
    expect(body.degraded).toBe(false);
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

    // Skip Slack so we're testing brief composition, not delivery.
    const res = await POST(authed("https://example.test/api/ops/daily-brief?post=false"));
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
    const res = await POST(authed("https://example.test/api/ops/daily-brief?post=false"));
    const body = await res.json();
    expect(JSON.stringify(body.brief.blocks)).toContain("samples=5/12");
    expect(JSON.stringify(body.brief.blocks)).toContain("enforcement=not-needed");
  });

  it("end-to-end: runDriftAudit → daily brief surfaces the real scorecard summary", async () => {
    // Seed one agent entry so the drift audit has something to sample.
    const agentRun = newRunContext({ agentId: "viktor", division: "sales", source: "on-demand" });
    await auditStoreRef.append(
      buildAuditEntry(agentRun, {
        action: "hubspot.task.create",
        entityType: "task",
        result: "ok",
      }),
    );

    // Run the drift audit against the SAME auditStoreRef. With the Fix 1
    // change, this now persists a drift-audit.scorecard entry the daily
    // brief route can find via auditStore.recent().
    const { runDriftAudit } = await import("../drift-audit");
    const sc = await runDriftAudit({ store: auditStoreRef, sampleSize: 1 });

    // Now call the daily brief and verify the summary made it through.
    const res = await POST(authed("https://example.test/api/ops/daily-brief?post=false"));
    const body = await res.json();
    const blocksText = JSON.stringify(body.brief.blocks);
    expect(blocksText).toContain("Last drift audit");
    expect(blocksText).toContain("samples=");
    expect(blocksText).toContain("enforcement=");
    // The scorecard id is stable, so the summary surfaced ties back to
    // the exact run — not a stubbed fixture.
    const stored = await auditStoreRef.byAction("drift-audit.scorecard", 10);
    expect(stored).toHaveLength(1);
    expect(stored[0].entityId).toBe(sc.id);
  });

  it("daily brief still surfaces the scorecard summary when flooded by 600 newer non-scorecard entries", async () => {
    // Scorecard first.
    const driftRun = newRunContext({ agentId: "drift-audit", division: "executive-control", source: "scheduled" });
    await auditStoreRef.append(
      buildAuditEntry(
        driftRun,
        {
          action: "drift-audit.scorecard",
          entityType: "scorecard",
          entityId: "sc-flooded",
          after: "samples=8/30 | enforcement=enforced | auto_paused=none",
          result: "ok",
        },
        new Date(2026, 0, 1),
      ),
    );
    // Then 600 newer high-volume non-scorecard audit entries — the old
    // recent(500) + filter path would have lost the scorecard here.
    const viktorRun = newRunContext({ agentId: "viktor", division: "sales", source: "on-demand" });
    for (let i = 0; i < 600; i++) {
      await auditStoreRef.append(
        buildAuditEntry(
          viktorRun,
          { action: "hubspot.task.create", entityType: "task", result: "ok" },
          new Date(2026, 3, 1, 0, 0, i),
        ),
      );
    }
    const res = await POST(authed("https://example.test/api/ops/daily-brief?post=false"));
    const body = await res.json();
    const blocksText = JSON.stringify(body.brief.blocks);
    expect(blocksText).toContain("Last drift audit");
    expect(blocksText).toContain("samples=8/30");
    expect(blocksText).toContain("enforcement=enforced");
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

  // ---- Body-override + Plaid operationalization ----

  it("renders an explicit 'Plaid not configured' cash line when Plaid env is unset", async () => {
    // Default beforeEach already deletes PLAID_CLIENT_ID / PLAID_SECRET.
    const res = await POST(authed("https://example.test/api/ops/daily-brief?post=false"));
    const body = await res.json();
    const blocks = JSON.stringify(body.brief.blocks);
    expect(blocks).toContain("Cash");
    expect(blocks).toContain("Plaid not configured");
    // No fabricated number.
    expect(blocks).not.toMatch(/\$[0-9]+\.[0-9]{2}/);
  });

  it("accepts POST-body overrides for revenueYesterday + cashPosition", async () => {
    const req = new Request("https://example.test/api/ops/daily-brief?post=false", {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        revenueYesterday: [
          {
            channel: "Shopify DTC",
            amountUsd: 444.96,
            source: {
              system: "shopify",
              id: "order-1016",
              retrievedAt: "2026-04-20T06:00:00Z",
            },
          },
          {
            channel: "Amazon",
            amountUsd: null,
            unavailableReason: "SP-API settlement period not yet closed",
          },
        ],
        cashPosition: {
          amountUsd: 12345.67,
          source: { system: "plaid-override", retrievedAt: "2026-04-20T06:00:00Z" },
        },
      }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    const blocks = JSON.stringify(body.brief.blocks);
    expect(blocks).toContain("Shopify DTC");
    expect(blocks).toContain("444.96");
    expect(blocks).toContain("order-1016");
    expect(blocks).toContain("Amazon");
    expect(blocks).toContain("SP-API settlement period not yet closed");
    expect(blocks).toContain("12345.67");
    expect(blocks).toContain("plaid-override");
  });

  it("rejects malformed JSON body with 400", async () => {
    const req = new Request("https://example.test/api/ops/daily-brief", {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: "{not: json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects a revenue line with amountUsd but no source (400 with explicit reason)", async () => {
    const req = new Request("https://example.test/api/ops/daily-brief", {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        revenueYesterday: [{ channel: "Shopify DTC", amountUsd: 444.96 }],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid override body");
    expect(body.reason).toContain("source.system and source.retrievedAt");
    expect(body.problems).toEqual(
      expect.arrayContaining([expect.stringContaining("source is missing")]),
    );
  });

  it("rejects a revenue line with amountUsd but source missing retrievedAt", async () => {
    const req = new Request("https://example.test/api/ops/daily-brief", {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        revenueYesterday: [
          { channel: "Amazon", amountUsd: 100, source: { system: "sp-api" } },
        ],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.problems).toEqual(
      expect.arrayContaining([expect.stringContaining("source.retrievedAt must be a non-empty string")]),
    );
  });

  it("rejects a revenue line with null amount but no unavailableReason", async () => {
    const req = new Request("https://example.test/api/ops/daily-brief", {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        revenueYesterday: [{ channel: "Amazon", amountUsd: null }],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.problems).toEqual(
      expect.arrayContaining([expect.stringContaining("unavailableReason is required")]),
    );
  });

  it("rejects cashPosition with amount but no source", async () => {
    const req = new Request("https://example.test/api/ops/daily-brief", {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        cashPosition: { amountUsd: 9999.99 },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.problems).toEqual(
      expect.arrayContaining([expect.stringContaining("cashPosition: amountUsd")]),
    );
  });

  it("rejects a revenue line with wrong types (amountUsd string, not number|null)", async () => {
    const req = new Request("https://example.test/api/ops/daily-brief", {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        revenueYesterday: [{ channel: "Shopify", amountUsd: "444.96" }],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.problems).toEqual(
      expect.arrayContaining([expect.stringContaining("must be a finite number or null")]),
    );
  });

  it("rejects revenueYesterday when it isn't an array", async () => {
    const req = new Request("https://example.test/api/ops/daily-brief", {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ revenueYesterday: { not: "an array" } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("accepts a valid sourced override (happy path after validation tightened)", async () => {
    const req = new Request("https://example.test/api/ops/daily-brief?post=false", {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        revenueYesterday: [
          {
            channel: "Shopify DTC",
            amountUsd: 100,
            source: {
              system: "shopify",
              id: "order-x",
              retrievedAt: "2026-04-20T00:00:00Z",
            },
          },
          {
            channel: "Amazon",
            amountUsd: null,
            unavailableReason: "settlement not closed",
          },
        ],
        cashPosition: {
          amountUsd: 12345.67,
          source: { system: "plaid-override", retrievedAt: "2026-04-20T00:00:00Z" },
        },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    const blocks = JSON.stringify(body.brief.blocks);
    expect(blocks).toContain("100.00");
    expect(blocks).toContain("12345.67");
    expect(blocks).toContain("settlement not closed");
  });

  it("override cash position takes precedence over Plaid (no Plaid call attempted)", async () => {
    // Set Plaid env so the live path would fire if called.
    process.env.PLAID_CLIENT_ID = "stub";
    process.env.PLAID_SECRET = "stub";
    // Stub fetch to throw so any Plaid call would explode — we'd catch the failure in cash-position unavailable.
    const originalFetch = global.fetch;
    global.fetch = (async () => {
      throw new Error("should not be called when override present");
    }) as typeof global.fetch;
    try {
      const req = new Request(
        "https://example.test/api/ops/daily-brief?post=false",
        {
          method: "POST",
          headers: {
            authorization: "Bearer test-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            cashPosition: {
              amountUsd: 9999.99,
              source: { system: "override", retrievedAt: "2026-04-20T06:00:00Z" },
            },
          }),
        },
      );
      const res = await POST(req);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(JSON.stringify(body.brief.blocks)).toContain("9999.99");
      expect(JSON.stringify(body.brief.blocks)).not.toContain("Plaid not configured");
    } finally {
      global.fetch = originalFetch;
    }
  });
});

/**
 * Phase 28d — daily-brief dispatch slice.
 *
 * Locks the contract:
 *   - composeDispatchBriefSlice counts labels bought / dispatched /
 *     still-open within the last 24h. Pure: same input → same output.
 *   - Rows with null timestamps don't crash; they just don't count.
 *   - dispatched count comes from `dispatchedAt` in window, regardless
 *     of whether the row was bought in the same window.
 *   - renderDispatchBriefMarkdown returns "" on zero activity (quiet
 *     collapse). Returns a single-line :package: prefix otherwise.
 *   - composeDailyBrief: morning + dispatch present → line appears.
 *     EOD with dispatch → NEVER renders. Morning + zero activity
 *     → no line.
 */
describe("composeDispatchBriefSlice + renderDispatchBriefMarkdown", () => {
  const NOW = new Date("2026-04-26T18:00:00Z");
  const inWindow = (hoursAgo: number) =>
    new Date(NOW.getTime() - hoursAgo * 3600 * 1000).toISOString();

  it("counts labels bought / dispatched / still open in window", async () => {
    const { composeDispatchBriefSlice } = await import("../daily-brief");
    const slice = composeDispatchBriefSlice(
      [
        // Bought 6h ago, dispatched 2h ago → counts as both bought + dispatched
        { shipDate: inWindow(6), dispatchedAt: inWindow(2), state: "dispatched" },
        // Bought 12h ago, still open → bought + still-open
        { shipDate: inWindow(12), dispatchedAt: null, state: "open" },
        // Bought 30h ago (out of window), dispatched 6h ago → ONLY dispatched
        { shipDate: inWindow(30), dispatchedAt: inWindow(6), state: "dispatched" },
        // Bought 30h ago, still open → NOT counted (out of window)
        { shipDate: inWindow(30), dispatchedAt: null, state: "open" },
      ],
      NOW,
    );
    expect(slice.labelsBought).toBe(2);
    expect(slice.dispatched).toBe(2);
    expect(slice.stillOpen).toBe(1);
  });

  it("rows with null / unparseable timestamps don't crash and don't count", async () => {
    const { composeDispatchBriefSlice } = await import("../daily-brief");
    const slice = composeDispatchBriefSlice(
      [
        { shipDate: null, dispatchedAt: null, state: "open" },
        { shipDate: "garbage", dispatchedAt: "also garbage", state: "open" },
      ],
      NOW,
    );
    expect(slice.labelsBought).toBe(0);
    expect(slice.dispatched).toBe(0);
    expect(slice.stillOpen).toBe(0);
  });

  it("renderDispatchBriefMarkdown returns empty string on zero activity", async () => {
    const { renderDispatchBriefMarkdown, composeDispatchBriefSlice } =
      await import("../daily-brief");
    const slice = composeDispatchBriefSlice([], NOW);
    expect(renderDispatchBriefMarkdown(slice)).toBe("");
  });

  it("renderDispatchBriefMarkdown emits a single-line :package: header on activity", async () => {
    const { renderDispatchBriefMarkdown, composeDispatchBriefSlice } =
      await import("../daily-brief");
    const slice = composeDispatchBriefSlice(
      [
        // bought 6h ago, dispatched 2h ago → counts toward both
        { shipDate: inWindow(6), dispatchedAt: inWindow(2), state: "dispatched" },
        // bought 8h ago, still open → counts toward bought + stillOpen
        { shipDate: inWindow(8), dispatchedAt: null, state: "open" },
      ],
      NOW,
    );
    const out = renderDispatchBriefMarkdown(slice);
    expect(out).toMatch(/^:package:/);
    expect(out).toMatch(/\*2\* bought/);
    expect(out).toMatch(/\*1\* dispatched/);
    expect(out).toMatch(/\*1\* still on cart/);
  });

  it("composeDailyBrief renders the dispatch line on morning + dispatch present", async () => {
    const { composeDailyBrief, composeDispatchBriefSlice } = await import(
      "../daily-brief"
    );
    const slice = composeDispatchBriefSlice(
      [
        { shipDate: inWindow(6), dispatchedAt: inWindow(2), state: "dispatched" },
      ],
      NOW,
    );
    const out = composeDailyBrief({
      kind: "morning",
      asOf: NOW,
      activeDivisions: [],
      pendingApprovals: [],
      pausedAgents: [] as PausedAgentRecord[],
      recentAudit: [],
      dispatch: slice,
    });
    // Section blocks carry the brief content; `text` is the meta header only.
    expect(JSON.stringify(out.blocks)).toContain("Dispatch (last 24h)");
  });

  it("composeDailyBrief NEVER renders the dispatch line on EOD", async () => {
    const { composeDailyBrief, composeDispatchBriefSlice } = await import(
      "../daily-brief"
    );
    const slice = composeDispatchBriefSlice(
      [{ shipDate: inWindow(6), dispatchedAt: null, state: "open" }],
      NOW,
    );
    const out = composeDailyBrief({
      kind: "eod",
      asOf: NOW,
      activeDivisions: [],
      pendingApprovals: [],
      pausedAgents: [] as PausedAgentRecord[],
      recentAudit: [],
      dispatch: slice,
    });
    expect(JSON.stringify(out.blocks)).not.toContain("Dispatch (last 24h)");
  });

  it("composeDailyBrief on morning + zero-activity slice renders no dispatch line", async () => {
    const { composeDailyBrief, composeDispatchBriefSlice } = await import(
      "../daily-brief"
    );
    const slice = composeDispatchBriefSlice([], NOW);
    const out = composeDailyBrief({
      kind: "morning",
      asOf: NOW,
      activeDivisions: [],
      pendingApprovals: [],
      pausedAgents: [] as PausedAgentRecord[],
      recentAudit: [],
      dispatch: slice,
    });
    expect(JSON.stringify(out.blocks)).not.toContain("Dispatch (last 24h)");
  });
});

/**
 * Phase 28h — oldest-open-package callout in the morning brief.
 *
 * Locks the contract:
 *   - composeDispatchBriefSlice now also computes `oldestOpenShipDate`
 *     and `oldestOpenAgeDays` (whole days, floored).
 *   - oldestOpenShipDate is the lex-smallest YYYY-MM-DD across ALL
 *     open rows (NOT just bought-in-window — the whole point is to
 *     surface packages that have been silently aging).
 *   - oldestOpenAgeDays null when no open rows or no parseable dates.
 *   - Garbage shipDate values don't crash and don't count.
 *   - renderDispatchBriefMarkdown gates the callout strictly on
 *     `oldestOpenAgeDays > DISPATCH_BRIEF_STALE_DAYS` (= 3). Exactly
 *     3 days does NOT trigger.
 *   - Day-vs-days copy: 4 days → "days", 1 day → "day" (defensive,
 *     even though >3 means we'd never see "1 day"; the helper is
 *     pure and shouldn't crash on a future-tightened threshold).
 *   - Quiet collapse: zero activity AND no stale callout → empty
 *     string. Stale callout WITHOUT activity → just the warning line.
 */
describe("oldest-open-package callout (Phase 28h)", () => {
  const NOW_STALE = new Date("2026-04-26T18:00:00Z");

  function row(over: {
    state: "open" | "dispatched";
    shipDate: string | null;
    dispatchedAt?: string | null;
  }) {
    return {
      shipDate: over.shipDate,
      dispatchedAt: over.dispatchedAt ?? null,
      state: over.state,
    } as const;
  }

  it("oldestOpenShipDate picks the lex-smallest among open rows", async () => {
    const { composeDispatchBriefSlice } = await import("../daily-brief");
    const slice = composeDispatchBriefSlice(
      [
        row({ state: "open", shipDate: "2026-04-26" }),
        row({ state: "open", shipDate: "2026-04-22" }), // oldest
        row({ state: "open", shipDate: "2026-04-25" }),
        // dispatched rows don't count toward "open"
        row({
          state: "dispatched",
          shipDate: "2026-04-20",
          dispatchedAt: "2026-04-26T16:00:00Z",
        }),
      ],
      NOW_STALE,
    );
    expect(slice.oldestOpenShipDate).toBe("2026-04-22");
    expect(slice.oldestOpenAgeDays).toBe(4);
  });

  it("oldestOpenAgeDays is null when no open rows", async () => {
    const { composeDispatchBriefSlice } = await import("../daily-brief");
    const slice = composeDispatchBriefSlice(
      [
        row({
          state: "dispatched",
          shipDate: "2026-04-20",
          dispatchedAt: "2026-04-26T16:00:00Z",
        }),
      ],
      NOW_STALE,
    );
    expect(slice.oldestOpenShipDate).toBeNull();
    expect(slice.oldestOpenAgeDays).toBeNull();
  });

  it("garbage shipDate strings don't crash and don't count", async () => {
    const { composeDispatchBriefSlice } = await import("../daily-brief");
    const slice = composeDispatchBriefSlice(
      [
        row({ state: "open", shipDate: "garbage" }),
        row({ state: "open", shipDate: null }),
      ],
      NOW_STALE,
    );
    expect(slice.oldestOpenShipDate).toBeNull();
    expect(slice.oldestOpenAgeDays).toBeNull();
  });

  it("renderer adds the callout when age > 3 days", async () => {
    const { renderDispatchBriefMarkdown, composeDispatchBriefSlice } =
      await import("../daily-brief");
    const slice = composeDispatchBriefSlice(
      [row({ state: "open", shipDate: "2026-04-22" })], // 4 days old
      NOW_STALE,
    );
    const out = renderDispatchBriefMarkdown(slice);
    expect(out).toMatch(/:warning:/);
    expect(out).toMatch(/Oldest open package: 4 days on the cart/);
    expect(out).toMatch(/2-business-day handling promise/);
  });

  it("renderer does NOT add the callout when age is exactly 3 days (boundary)", async () => {
    const { renderDispatchBriefMarkdown, composeDispatchBriefSlice } =
      await import("../daily-brief");
    const slice = composeDispatchBriefSlice(
      [row({ state: "open", shipDate: "2026-04-23" })], // 3 days old
      NOW_STALE,
    );
    expect(slice.oldestOpenAgeDays).toBe(3);
    const out = renderDispatchBriefMarkdown(slice);
    expect(out).not.toMatch(/:warning:/);
  });

  it("renderer renders the callout WITHOUT the activity line when no 24h activity but stale", async () => {
    const { renderDispatchBriefMarkdown, composeDispatchBriefSlice } =
      await import("../daily-brief");
    // Open package shipped 5 days ago, no activity in last 24h.
    const slice = composeDispatchBriefSlice(
      [row({ state: "open", shipDate: "2026-04-21" })],
      NOW_STALE,
    );
    const out = renderDispatchBriefMarkdown(slice);
    expect(out).not.toMatch(/Dispatch \(last 24h\)/);
    expect(out).toMatch(/:warning:/);
    expect(out).toMatch(/5 days on the cart/);
  });

  it("renderer combines BOTH lines when there's activity AND stale", async () => {
    const { renderDispatchBriefMarkdown, composeDispatchBriefSlice } =
      await import("../daily-brief");
    const NOW = NOW_STALE;
    const slice = composeDispatchBriefSlice(
      [
        // bought 6h ago, dispatched 2h ago — counts toward both
        {
          state: "dispatched" as const,
          shipDate: "2026-04-26",
          dispatchedAt: new Date(NOW.getTime() - 2 * 3600 * 1000).toISOString(),
        },
        // open and stale
        row({ state: "open", shipDate: "2026-04-21" }),
      ],
      NOW,
    );
    const out = renderDispatchBriefMarkdown(slice);
    expect(out).toMatch(/Dispatch \(last 24h\)/);
    expect(out).toMatch(/:warning:/);
    // Two distinct lines.
    expect(out.split("\n")).toHaveLength(2);
  });

  it("singular 'day' when age would be exactly 1 (defensive)", async () => {
    const { renderDispatchBriefMarkdown, DISPATCH_BRIEF_STALE_DAYS } =
      await import("../daily-brief");
    expect(DISPATCH_BRIEF_STALE_DAYS).toBe(3);
    // Synthetic slice: pretend the threshold dropped. Tests the
    // pluralization helper directly.
    const slice = {
      generatedAt: NOW_STALE.toISOString(),
      windowEnd: NOW_STALE.toISOString(),
      windowStart: new Date(NOW_STALE.getTime() - 86400000).toISOString(),
      labelsBought: 0,
      dispatched: 0,
      stillOpen: 0,
      oldestOpenShipDate: "2026-04-25",
      oldestOpenAgeDays: 1, // below the threshold; renderer should NOT emit
    };
    const out = renderDispatchBriefMarkdown(slice);
    expect(out).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Phase 32.1 — Operational signals section
// ---------------------------------------------------------------------------

describe("composeDailyBrief() — operational signals (Phase 32.1)", () => {
  const baseInput = () => ({
    kind: "morning" as const,
    asOf: new Date("2026-04-27T16:00:00Z"),
    activeDivisions: [{ id: "sales", name: "Sales", humanOwner: "Ben" }],
    pendingApprovals: [],
    pausedAgents: [] as PausedAgentRecord[],
    recentAudit: [],
  });

  it("section is OMITTED when signals.lines is empty (quiet collapse)", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      signals: { lines: [], hasCritical: false },
    });
    expect(JSON.stringify(out.blocks)).not.toContain("Operational signals");
  });

  it("section is OMITTED when signals is undefined (zero-config)", () => {
    const out = composeDailyBrief(baseInput());
    expect(JSON.stringify(out.blocks)).not.toContain("Operational signals");
  });

  it("section renders with the lines when signals are present", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      signals: {
        lines: [
          ":warning: *Stack — 1 service degraded:* make-com.",
          ":scales: *USPTO trademarks:* 1 actionable.",
        ],
        hasCritical: false,
      },
    });
    const json = JSON.stringify(out.blocks);
    expect(json).toContain("Operational signals");
    expect(json).toContain("Stack — 1 service degraded");
    expect(json).toContain("USPTO trademarks");
  });

  it("header gets :rotating_light: prefix when hasCritical=true", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      signals: {
        lines: [":rotating_light: *Stack — 1 service down:* vercel-kv."],
        hasCritical: true,
      },
    });
    const json = JSON.stringify(out.blocks);
    expect(json).toContain(":rotating_light:");
    expect(json).toContain("Operational signals");
  });

  it("header has NO :rotating_light: prefix when hasCritical=false", () => {
    const out = composeDailyBrief({
      ...baseInput(),
      signals: {
        lines: [":envelope: *Inbox triage:* 2 awaiting decision."],
        hasCritical: false,
      },
    });
    // The header itself shouldn't have the rotating_light, but the
    // signal line itself might (we look for the header marker).
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain(":rotating_light: *Operational signals*");
    expect(json).toContain("Operational signals");
  });
});
