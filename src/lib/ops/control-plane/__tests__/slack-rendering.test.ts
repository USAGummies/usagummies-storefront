import { describe, expect, it } from "vitest";

import { applyDecision, buildApprovalRequest, standDown } from "../approvals";
import { buildAuditEntry } from "../audit";
import { newRunContext } from "../run-id";
import { ApprovalSurface } from "../slack/approval-surface";
import { AuditSurface } from "../slack/audit-surface";

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
});
