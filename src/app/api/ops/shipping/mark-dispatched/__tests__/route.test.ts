/**
 * Phase 28c — mark-dispatched POST route.
 *
 * Locks the contract:
 *   - 401 on auth rejection.
 *   - 400 on invalid JSON, missing/whitespace orderNumber, missing/unknown source.
 *   - 400 on action other than "mark"|"clear".
 *   - "mark" calls markDispatched and (on first-time mark) posts a thread reply
 *     under the slackPermalink-resolved messageTs.
 *   - "mark" idempotency: second call returns firstMark=false, NO thread re-post.
 *   - "clear" calls clearDispatched and never posts a thread reply.
 *   - postMessage failure NEVER blocks the dashboard click (best-effort).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

const markDispatchedMock = vi.fn();
const clearDispatchedMock = vi.fn();
const getShippingArtifactMock = vi.fn();
vi.mock("@/lib/ops/shipping-artifacts", () => ({
  markDispatched: (...a: unknown[]) => markDispatchedMock(...a),
  clearDispatched: (...a: unknown[]) => clearDispatchedMock(...a),
  getShippingArtifact: (...a: unknown[]) => getShippingArtifactMock(...a),
}));

const postMessageMock = vi.fn();
vi.mock("@/lib/ops/control-plane/slack", () => ({
  postMessage: (...a: unknown[]) => postMessageMock(...a),
}));

vi.mock("@/lib/ops/control-plane/channels", () => ({
  getChannel: (id: string) =>
    id === "shipping"
      ? { id: "shipping", name: "shipping", slackChannelId: "C0AS4635HFG" }
      : null,
}));

import { POST } from "../route";

beforeEach(() => {
  isAuthorizedMock.mockReset();
  isAuthorizedMock.mockResolvedValue(true);
  markDispatchedMock.mockReset();
  clearDispatchedMock.mockReset();
  getShippingArtifactMock.mockReset();
  postMessageMock.mockReset();
  postMessageMock.mockResolvedValue({ ok: true });
});

afterEach(() => vi.clearAllMocks());

function makeReq(body: unknown): Request {
  return new Request(
    "https://www.usagummies.com/api/ops/shipping/mark-dispatched",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/ops/shipping/mark-dispatched", () => {
  it("401 on auth rejection", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await POST(makeReq({ orderNumber: "1", source: "amazon" }));
    expect(res.status).toBe(401);
  });

  it("400 on invalid JSON", async () => {
    const req = new Request(
      "https://www.usagummies.com/api/ops/shipping/mark-dispatched",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("400 on missing orderNumber", async () => {
    const res = await POST(makeReq({ source: "amazon" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/orderNumber required/);
  });

  it("400 on whitespace-only orderNumber", async () => {
    const res = await POST(makeReq({ orderNumber: "   ", source: "amazon" }));
    expect(res.status).toBe(400);
  });

  it("400 on unknown source", async () => {
    const res = await POST(
      makeReq({ orderNumber: "1", source: "instagram" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/source required/);
  });

  it("400 on bogus action", async () => {
    const res = await POST(
      makeReq({ orderNumber: "1", source: "amazon", action: "destroy" }),
    );
    expect(res.status).toBe(400);
  });

  it('"mark" first-time: stamps + posts thread reply', async () => {
    markDispatchedMock.mockResolvedValueOnce({
      ok: true,
      before: null,
      after: "2026-04-26T18:00:00Z",
      record: null,
    });
    getShippingArtifactMock.mockResolvedValueOnce({
      orderNumber: "112-1111111-1111111",
      source: "amazon",
      slackPermalink:
        "https://usagummies.slack.com/archives/C0AS4635HFG/p1745000000123456",
    });
    const res = await POST(
      makeReq({ orderNumber: "112-1111111-1111111", source: "amazon" }),
    );
    const body = (await res.json()) as {
      ok: boolean;
      action: string;
      firstMark: boolean;
      dispatchedAt: string;
    };
    expect(body.ok).toBe(true);
    expect(body.action).toBe("mark");
    expect(body.firstMark).toBe(true);
    expect(body.dispatchedAt).toBe("2026-04-26T18:00:00Z");
    expect(postMessageMock).toHaveBeenCalledTimes(1);
    const call = postMessageMock.mock.calls[0][0];
    expect(call.channel).toBe("shipping");
    expect(call.threadTs).toBe("1745000000.123456");
    expect(call.text).toMatch(/Dispatched/);
  });

  it('"mark" re-mark: idempotent, no thread re-post', async () => {
    markDispatchedMock.mockResolvedValueOnce({
      ok: true,
      before: "2026-04-26T17:00:00Z",
      after: "2026-04-26T18:00:00Z",
      record: null,
    });
    const res = await POST(
      makeReq({ orderNumber: "112-2222222-2222222", source: "amazon" }),
    );
    const body = (await res.json()) as { firstMark: boolean };
    expect(body.firstMark).toBe(false);
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it('"clear" calls clearDispatched and never posts', async () => {
    clearDispatchedMock.mockResolvedValueOnce({
      ok: true,
      before: "2026-04-26T18:00:00Z",
    });
    const res = await POST(
      makeReq({
        orderNumber: "112-3333333-3333333",
        source: "amazon",
        action: "clear",
      }),
    );
    const body = (await res.json()) as { action: string; hadStamp: boolean };
    expect(body.action).toBe("clear");
    expect(body.hadStamp).toBe(true);
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it("postMessage failure does NOT block the dashboard click", async () => {
    markDispatchedMock.mockResolvedValueOnce({
      ok: true,
      before: null,
      after: "2026-04-26T18:00:00Z",
      record: null,
    });
    getShippingArtifactMock.mockResolvedValueOnce({
      orderNumber: "112-4444444-4444444",
      source: "amazon",
      slackPermalink:
        "https://usagummies.slack.com/archives/C0AS4635HFG/p1745000000123456",
    });
    postMessageMock.mockRejectedValueOnce(new Error("Slack 500"));
    const res = await POST(
      makeReq({ orderNumber: "112-4444444-4444444", source: "amazon" }),
    );
    const body = (await res.json()) as { ok: boolean; firstMark: boolean };
    expect(body.ok).toBe(true);
    expect(body.firstMark).toBe(true);
  });

  it('"mark" with no slackPermalink: stamps but skips thread reply', async () => {
    markDispatchedMock.mockResolvedValueOnce({
      ok: true,
      before: null,
      after: "2026-04-26T18:00:00Z",
      record: null,
    });
    getShippingArtifactMock.mockResolvedValueOnce({
      orderNumber: "112-5555555-5555555",
      source: "amazon",
      slackPermalink: null,
    });
    const res = await POST(
      makeReq({ orderNumber: "112-5555555-5555555", source: "amazon" }),
    );
    const body = (await res.json()) as { ok: boolean; firstMark: boolean };
    expect(body.ok).toBe(true);
    expect(body.firstMark).toBe(true);
    expect(postMessageMock).not.toHaveBeenCalled();
  });
});
