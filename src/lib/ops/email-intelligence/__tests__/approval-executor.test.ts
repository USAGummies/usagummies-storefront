import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  sendGmailDraftDetailed: vi.fn(),
  findContactByEmail: vi.fn(),
  logEmail: vi.fn(),
  append: vi.fn(),
  mirror: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ops/gmail-reader", () => ({
  sendGmailDraftDetailed: mocked.sendGmailDraftDetailed,
}));
vi.mock("@/lib/ops/hubspot-client", () => ({
  findContactByEmail: mocked.findContactByEmail,
  logEmail: mocked.logEmail,
}));
vi.mock("@/lib/ops/control-plane/stores", () => ({
  auditStore: () => ({ append: mocked.append }),
}));
vi.mock("@/lib/ops/control-plane/slack", () => ({
  auditSurface: () => ({ mirror: mocked.mirror }),
}));

import { executeApprovedEmailReply } from "../approval-executor";
import type { ApprovalRequest } from "@/lib/ops/control-plane/types";

function approval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "approval-1",
    runId: "run-1",
    division: "platform-data-automation",
    actorAgentId: "email-intel",
    class: "B",
    action: "Send outreach email",
    targetSystem: "gmail",
    targetEntity: { type: "email-reply", id: "msg-1" },
    payloadPreview: "payload",
    payloadRef: "gmail:draft:draft-1",
    evidence: {
      claim: "reply",
      confidence: 0.91,
      sources: [{ system: "gmail", id: "msg-1", retrievedAt: "2026-04-24T00:00:00.000Z" }],
    },
    rollbackPlan: "correction",
    requiredApprovers: ["Ben"],
    status: "approved",
    createdAt: "2026-04-24T00:00:00.000Z",
    decisions: [],
    escalateAt: "2026-04-25T00:00:00.000Z",
    expiresAt: "2026-04-27T00:00:00.000Z",
    ...overrides,
  };
}

describe("executeApprovedEmailReply", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked.mirror.mockResolvedValue(undefined);
  });

  it("ignores approvals that are not email replies", async () => {
    const result = await executeApprovedEmailReply(
      approval({ targetEntity: { type: "ap-packet", id: "jungle-jims" } }),
    );

    expect(result).toMatchObject({ ok: true, handled: false });
    expect(mocked.sendGmailDraftDetailed).not.toHaveBeenCalled();
  });

  it("sends the approved draft, logs HubSpot, and appends audit", async () => {
    mocked.sendGmailDraftDetailed.mockResolvedValue({
      ok: true,
      draftId: "draft-1",
      messageId: "sent-1",
      threadId: "thread-1",
      to: "Buyer <buyer@example.com>",
      from: "Ben <ben@usagummies.com>",
      subject: "Re: Samples",
      body: "Thanks.",
    });
    mocked.findContactByEmail.mockResolvedValue("contact-1");
    mocked.logEmail.mockResolvedValue("email-log-1");

    const result = await executeApprovedEmailReply(approval());

    expect(result).toMatchObject({
      ok: true,
      handled: true,
      draftId: "draft-1",
      messageId: "sent-1",
      hubspotLogId: "email-log-1",
    });
    expect(mocked.sendGmailDraftDetailed).toHaveBeenCalledWith("draft-1");
    expect(mocked.findContactByEmail).toHaveBeenCalledWith("buyer@example.com");
    expect(mocked.logEmail).toHaveBeenCalledWith(expect.objectContaining({
      contactId: "contact-1",
      subject: "Re: Samples",
      direction: "EMAIL",
    }));
    expect(mocked.append).toHaveBeenCalledWith(expect.objectContaining({
      action: "gmail.send",
      entityId: "sent-1",
      approvalId: "approval-1",
      result: "ok",
    }));
  });

  it("audits failed draft sends", async () => {
    mocked.sendGmailDraftDetailed.mockResolvedValue({
      ok: false,
      error: "missing scope",
    });

    const result = await executeApprovedEmailReply(approval());

    expect(result).toMatchObject({
      ok: false,
      handled: true,
      draftId: "draft-1",
      error: "missing scope",
    });
    expect(mocked.append).toHaveBeenCalledWith(expect.objectContaining({
      action: "gmail.send",
      entityId: "draft-1",
      result: "error",
    }));
  });
});
