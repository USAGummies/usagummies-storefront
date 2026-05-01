import { beforeEach, describe, expect, it, vi } from "vitest";

const approvalRequest = {
  id: "appr_1",
  runId: "run_1",
  division: "sales",
  actorAgentId: "agent_1",
  class: "B",
  action: "Send email",
  targetSystem: "gmail",
  targetEntity: { type: "email-reply", id: "msg_1", label: "Buyer reply" },
  payloadPreview: "Draft email",
  evidence: [{ type: "system", label: "Gmail", ref: "msg_1" }],
  rollbackPlan: "Send a correction email.",
  requiredApprovers: ["Ben"],
  status: "pending",
  createdAt: "2026-05-01T12:00:00Z",
  decisions: [],
  escalateAt: "2026-05-02T12:00:00Z",
  expiresAt: "2026-05-04T12:00:00Z",
  slackThread: { channel: "ops-approvals", ts: "1777777777.000100" },
} as const;

const storeGetMock = vi.fn();
const storePutMock = vi.fn();
const auditAppendMock = vi.fn();
const approvalSurfaceMock = {};
const auditMirrorMock = vi.fn();
const verifySlackSignatureMock = vi.fn();
const recordDecisionMock = vi.fn();
const openViewMock = vi.fn();
const postMessageMock = vi.fn();

vi.mock("@/lib/ops/control-plane/stores", () => ({
  approvalStore: () => ({ get: storeGetMock, put: storePutMock }),
  auditStore: () => ({ append: auditAppendMock }),
}));

vi.mock("@/lib/ops/control-plane/slack", () => ({
  approvalSurface: () => approvalSurfaceMock,
  auditSurface: () => ({ mirror: auditMirrorMock }),
  slackUserIdToHumanOwner: (id: string) => (id === "U_BEN" ? "Ben" : null),
  verifySlackSignature: (...args: unknown[]) => verifySlackSignatureMock(...args),
}));

vi.mock("@/lib/ops/control-plane/channels", () => ({
  slackChannelRef: (id: string) => (id === "ops-approvals" ? "C0ATWJDHS74" : `#${id}`),
}));

vi.mock("@/lib/ops/control-plane/slack/client", () => ({
  openView: (...args: unknown[]) => openViewMock(...args),
  postMessage: (...args: unknown[]) => postMessageMock(...args),
}));

vi.mock("@/lib/ops/control-plane/approvals", () => ({
  recordDecision: (...args: unknown[]) => recordDecisionMock(...args),
}));

vi.mock("@/lib/ops/control-plane/audit", () => ({
  buildHumanAuditEntry: (entry: unknown) => ({ id: "audit_1", ...(entry as object) }),
}));

vi.mock("@/lib/ops/email-intelligence/approval-executor", () => ({
  executeApprovedEmailReply: vi.fn(async () => ({ handled: false })),
}));
vi.mock("@/lib/ops/sample-order-dispatch/approval-closer", () => ({
  executeApprovedShipmentCreate: vi.fn(async () => ({ handled: false })),
}));
vi.mock("@/lib/ops/vendor-onboarding", () => ({
  executeApprovedVendorMasterCreate: vi.fn(async () => ({ handled: false })),
}));
vi.mock("@/lib/ops/ap-packets/approval-closer", () => ({
  executeApprovedApPacketSend: vi.fn(async () => ({ handled: false })),
}));
vi.mock("@/lib/faire/approval-closer", () => ({
  executeApprovedFaireDirectInvite: vi.fn(async () => ({ handled: false })),
}));
vi.mock("@/lib/faire/follow-up-closer", () => ({
  executeApprovedFaireDirectFollowUp: vi.fn(async () => ({ handled: false })),
}));
vi.mock("@/lib/ops/receipt-review-closer", () => ({
  executeApprovedReceiptReviewPromote: vi.fn(async () => ({ handled: false })),
}));

import { POST } from "../route";

function makeReq(payload: unknown): Request {
  return new Request("https://www.usagummies.com/api/slack/approvals", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": "1777777777",
      "x-slack-signature": "v0=test",
    },
    body: new URLSearchParams({ payload: JSON.stringify(payload) }).toString(),
  });
}

describe("Slack approval interactions", () => {
  beforeEach(() => {
    storeGetMock.mockReset();
    storePutMock.mockReset();
    auditAppendMock.mockReset();
    auditMirrorMock.mockReset();
    verifySlackSignatureMock.mockReset();
    recordDecisionMock.mockReset();
    openViewMock.mockReset();
    postMessageMock.mockReset();

    verifySlackSignatureMock.mockResolvedValue({ ok: true });
    storeGetMock.mockResolvedValue(approvalRequest);
    auditMirrorMock.mockResolvedValue(undefined);
    openViewMock.mockResolvedValue({ ok: true });
    postMessageMock.mockResolvedValue({ ok: true, ts: "1777777777.000200" });
    recordDecisionMock.mockResolvedValue({
      ...approvalRequest,
      decisions: [
        {
          approver: "Ben",
          decision: "ask",
          reason: "Edit requested",
          decidedAt: "2026-05-01T12:01:00Z",
        },
      ],
    });
  });

  it("opens an edit-request modal for Needs edit without recording a decision yet", async () => {
    const res = await POST(
      makeReq({
        type: "block_actions",
        trigger_id: "trigger_123",
        user: { id: "U_BEN", username: "ben" },
        actions: [{ action_id: "approval::ask::appr_1", value: "appr_1" }],
      }),
    );
    const body = (await res.json()) as { ok: boolean; modal: string };

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, approvalId: "appr_1", modal: "opened" });
    expect(openViewMock).toHaveBeenCalledTimes(1);
    expect(openViewMock.mock.calls[0][0]).toMatchObject({
      triggerId: "trigger_123",
      view: {
        type: "modal",
        callback_id: "approval_edit_request",
        private_metadata: "appr_1",
      },
    });
    expect(recordDecisionMock).not.toHaveBeenCalled();
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it("records a submitted edit request and posts it into the approval thread", async () => {
    const res = await POST(
      makeReq({
        type: "view_submission",
        user: { id: "U_BEN", username: "ben" },
        view: {
          callback_id: "approval_edit_request",
          private_metadata: "appr_1",
          state: {
            values: {
              approval_edit_request: {
                approval_edit_request: {
                  value: "Remove the discount claim and soften the opener.",
                },
              },
            },
          },
        },
      }),
    );
    const body = (await res.json()) as { response_action: string };

    expect(res.status).toBe(200);
    expect(body).toEqual({ response_action: "clear" });
    expect(recordDecisionMock).toHaveBeenCalledWith(
      expect.anything(),
      approvalSurfaceMock,
      "appr_1",
      {
        approver: "Ben",
        decision: "ask",
        reason: "Edit requested: Remove the discount claim and soften the opener.",
      },
    );
    expect(auditAppendMock).toHaveBeenCalledTimes(1);
    expect(postMessageMock).toHaveBeenCalledWith({
      channel: "C0ATWJDHS74",
      threadTs: "1777777777.000100",
      text: expect.stringContaining("Remove the discount claim"),
    });
  });
});
