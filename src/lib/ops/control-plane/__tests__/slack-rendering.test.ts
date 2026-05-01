import { afterEach, describe, expect, it, vi } from "vitest";

import { applyDecision, buildApprovalRequest, standDown } from "../approvals";
import { buildAuditEntry } from "../audit";
import { newRunContext } from "../run-id";
import { ApprovalSurface } from "../slack/approval-surface";
import { AuditSurface } from "../slack/audit-surface";

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const ORIGINAL_KV_REST_API_URL = process.env.KV_REST_API_URL;
const ORIGINAL_KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_SLACK_BOT_TOKEN === undefined) delete process.env.SLACK_BOT_TOKEN;
  else process.env.SLACK_BOT_TOKEN = ORIGINAL_SLACK_BOT_TOKEN;
  if (ORIGINAL_KV_REST_API_URL === undefined) delete process.env.KV_REST_API_URL;
  else process.env.KV_REST_API_URL = ORIGINAL_KV_REST_API_URL;
  if (ORIGINAL_KV_REST_API_TOKEN === undefined) delete process.env.KV_REST_API_TOKEN;
  else process.env.KV_REST_API_TOKEN = ORIGINAL_KV_REST_API_TOKEN;
  vi.restoreAllMocks();
});

function mockSlackPostSuccess(calls: Array<{ url: string; body: Record<string, unknown> }>): void {
  process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = init?.body ? JSON.parse(init.body as string) as Record<string, unknown> : {};
    calls.push({ url, body });
    return new Response(JSON.stringify({ ok: true, channel: body.channel, ts: "1.000" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof global.fetch;
}

/**
 * These tests exercise the rendering + state transitions that feed Slack,
 * without actually calling Slack. SLACK_BOT_TOKEN stays unset, so the
 * underlying client returns `{ ok: false, degraded: true }` and the
 * surfaces become graceful no-ops — which is exactly the contract.
 */

function baseRequest() {
  return buildApprovalRequest({
    actionSlug: "gmail.send",
    runId: "run-slack-1",
    division: "sales",
    actorAgentId: "viktor",
    targetSystem: "gmail",
    payloadPreview: "Reply to Jungle Jim's vendor setup",
    evidence: {
      claim: "Warm lead asked for vendor packet",
      sources: [{ system: "gmail", id: "thread-1", retrievedAt: new Date().toISOString() }],
      confidence: 0.92,
    },
    rollbackPlan: "Recall within 30 min if needed",
  });
}

describe("ApprovalSurface", () => {
  it("surfaceApproval returns a ChannelId even in degraded mode", async () => {
    const surface = new ApprovalSurface();
    const req = baseRequest();
    const thread = await surface.surfaceApproval(req);
    // Degraded: ts is "" because no real Slack call happened.
    expect(thread.channel).toBe("ops-approvals");
    expect(typeof thread.ts).toBe("string");
  });

  it("posts to the canonical ops-approvals channel id, not a #name", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    mockSlackPostSuccess(calls);
    const surface = new ApprovalSurface();
    await surface.surfaceApproval(baseRequest());
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://slack.com/api/chat.postMessage");
    expect(calls[0].body.channel).toBe("C0ATWJDHS74");
  });

  it("renders approvals as a decision card instead of a raw payload dump", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    mockSlackPostSuccess(calls);
    const surface = new ApprovalSurface();
    await surface.surfaceApproval({
      ...baseRequest(),
      payloadPreview: "To: buyer@example.com\nSubject: Vendor packet\nBody: Attached is the packet.",
      targetEntity: { type: "email", id: "thread-1", label: "buyer@example.com" },
    });

    const blocksText = JSON.stringify(calls[0].body.blocks);
    expect(blocksText).toContain("Needs decision");
    expect(blocksText).toContain("Decision brief");
    expect(blocksText).toContain("What will happen if approved");
    expect(blocksText).toContain("Safety / rollback");
    expect(blocksText).toContain("buyer@example.com");
    expect(blocksText).toContain("Needs edit");
    expect(blocksText).not.toContain("*Payload*");
    expect(blocksText).not.toContain("*Claim*");
  });

  it("updateApproval is a safe no-op when there is no slackThread yet", async () => {
    const surface = new ApprovalSurface();
    const req = baseRequest();
    // Has no slackThread → update should not throw.
    await expect(surface.updateApproval(req)).resolves.toBeUndefined();
  });

  it("renders pending, approved, rejected, expired, and stood-down without error", async () => {
    const surface = new ApprovalSurface();
    const pending = baseRequest();
    await expect(surface.surfaceApproval(pending)).resolves.toBeDefined();

    const approved = applyDecision(pending, { approver: "Ben", decision: "approve" });
    await expect(
      surface.updateApproval({ ...approved, slackThread: { channel: "ops-approvals", ts: "1.000" } }),
    ).resolves.toBeUndefined();

    const rejected = applyDecision(pending, { approver: "Ben", decision: "reject", reason: "stale" });
    await expect(
      surface.updateApproval({ ...rejected, slackThread: { channel: "ops-approvals", ts: "1.001" } }),
    ).resolves.toBeUndefined();

    const stoodDown = standDown(pending, "upstream lead went cold");
    await expect(
      surface.updateApproval({ ...stoodDown, slackThread: { channel: "ops-approvals", ts: "1.002" } }),
    ).resolves.toBeUndefined();
  });
});

describe("AuditSurface", () => {
  it("mirror() tolerates degraded mode silently", async () => {
    const surface = new AuditSurface();
    const run = newRunContext({
      agentId: "viktor",
      division: "sales",
      source: "on-demand",
    });
    const entry = buildAuditEntry(run, {
      action: "hubspot.task.create",
      entityType: "task",
      entityId: "t-123",
      result: "ok",
      sourceCitations: [{ system: "hubspot", id: "deal-999" }],
      confidence: 0.95,
    });
    await expect(surface.mirror(entry)).resolves.toBeUndefined();
  });

  it("mirrors to the canonical ops-audit channel id, not a #name", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    mockSlackPostSuccess(calls);
    const surface = new AuditSurface();
    const run = newRunContext({
      agentId: "viktor",
      division: "sales",
      source: "on-demand",
    });
    const entry = buildAuditEntry(run, {
      action: "hubspot.task.create",
      entityType: "task",
      entityId: "t-123",
      result: "ok",
      sourceCitations: [{ system: "hubspot", id: "deal-999" }],
      confidence: 0.95,
    });
    await surface.mirror(entry);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://slack.com/api/chat.postMessage");
    expect(calls[0].body.channel).toBe("C0AUQSA66TS");
  });
});
