import { beforeEach, describe, expect, it, vi } from "vitest";

const verifySlackSignatureMock = vi.fn();
const createWorkpackMock = vi.fn();
const appendReceiptMock = vi.fn();

vi.mock("@/lib/ops/control-plane/slack", () => ({
  verifySlackSignature: (params: unknown) => verifySlackSignatureMock(params),
}));

vi.mock("@/lib/ops/workpacks", () => ({
  createWorkpack: (input: unknown) => createWorkpackMock(input),
}));

vi.mock("@/lib/ops/slack-event-ledger", () => ({
  appendSlackEventReceipt: (input: unknown) => appendReceiptMock(input),
}));

import { POST } from "../route";

beforeEach(() => {
  verifySlackSignatureMock.mockReset();
  createWorkpackMock.mockReset();
  appendReceiptMock.mockReset();
  verifySlackSignatureMock.mockResolvedValue({
    ok: false,
    reason: "SLACK_SIGNING_SECRET not configured",
  });
  appendReceiptMock.mockResolvedValue(undefined);
  createWorkpackMock.mockResolvedValue({
    id: "wp_slash_1",
    status: "queued",
    intent: "prepare_codex_prompt",
    department: "ops",
    title: "Codex implementation prompt",
    sourceText: "build this",
    requestedBy: "U_BEN",
    allowedActions: ["prepare_prompt"],
    prohibitedActions: ["send_email", "write_qbo"],
    riskClass: "read_only",
    createdAt: "2026-05-02T12:00:00.000Z",
    updatedAt: "2026-05-02T12:00:00.000Z",
  });
});

function req(params: Record<string, string>) {
  const body = new URLSearchParams({
    command: "/ops",
    channel_id: "C0ATWJDKLTU",
    user_id: "U_BEN",
    ...params,
  }).toString();
  return new Request("https://www.usagummies.com/api/ops/slack/commands", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

describe("/api/ops/slack/commands", () => {
  it("rejects bad Slack signatures when signing secret is configured", async () => {
    verifySlackSignatureMock.mockResolvedValueOnce({
      ok: false,
      reason: "bad signature",
    });
    const res = await POST(req({ text: "ask codex build this" }));
    expect(res.status).toBe(401);
    expect(createWorkpackMock).not.toHaveBeenCalled();
  });

  it("creates a workpack from /ops ask codex", async () => {
    const res = await POST(req({ text: "ask codex build this" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response_type).toBe("ephemeral");
    expect(body.workpackId).toBe("wp_slash_1");
    expect(createWorkpackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "prepare_codex_prompt",
        sourceText: "build this",
        requestedBy: "U_BEN",
      }),
    );
  });

  it("returns help without creating workpack for unknown command text", async () => {
    const res = await POST(req({ text: "hello there" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toContain("USA Gummies ops commands");
    expect(createWorkpackMock).not.toHaveBeenCalled();
  });

  it("records a safe diagnostic receipt and tolerates ledger failure", async () => {
    appendReceiptMock.mockRejectedValueOnce(new Error("kv down"));
    const res = await POST(req({ text: "ask codex build this" }));
    expect(res.status).toBe(200);
    expect(appendReceiptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "slash_command",
        channel: "C0ATWJDKLTU",
        recognizedCommand: "slash-command",
      }),
    );
  });
});
