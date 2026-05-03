import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
const getWorkpackMock = vi.fn();
const updateWorkpackMock = vi.fn();
const postMessageMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

vi.mock("@/lib/ops/workpacks", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ops/workpacks")>(
    "@/lib/ops/workpacks",
  );
  return {
    ...actual,
    getWorkpack: (id: string) => getWorkpackMock(id),
    updateWorkpack: (id: string, patch: unknown) => updateWorkpackMock(id, patch),
  };
});

vi.mock("@/lib/ops/control-plane/slack", () => ({
  postMessage: (args: unknown) => postMessageMock(args),
}));

import { WorkpackUpdateError } from "@/lib/ops/workpacks";
import { GET, PATCH } from "../route";

beforeEach(() => {
  isAuthorizedMock.mockReset();
  getWorkpackMock.mockReset();
  updateWorkpackMock.mockReset();
  postMessageMock.mockReset().mockResolvedValue({ ok: true });
});

function req(body?: unknown) {
  return new Request("https://www.usagummies.com/api/ops/workpacks/wp_1", {
    method: body === undefined ? "GET" : "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function ctx(id = "wp_1") {
  return { params: Promise.resolve({ id }) };
}

describe("/api/ops/workpacks/[id]", () => {
  it("auth-gates GET and PATCH", async () => {
    isAuthorizedMock.mockResolvedValue(false);
    expect((await GET(req(), ctx())).status).toBe(401);
    expect((await PATCH(req({ status: "running" }), ctx())).status).toBe(401);
  });

  it("GET returns one workpack or 404", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    getWorkpackMock.mockResolvedValueOnce({ id: "wp_1", status: "queued" });
    expect((await GET(req(), ctx())).status).toBe(200);

    isAuthorizedMock.mockResolvedValueOnce(true);
    getWorkpackMock.mockResolvedValueOnce(null);
    const missing = await GET(req(), ctx("missing"));
    expect(missing.status).toBe(404);
  });

  it("PATCH updates status/result metadata", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    updateWorkpackMock.mockResolvedValueOnce({
      id: "wp_1",
      status: "needs_review",
      resultSummary: "Done",
    });
    const res = await PATCH(
      req({ status: "needs_review", resultSummary: "Done" }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(updateWorkpackMock).toHaveBeenCalledWith("wp_1", {
      status: "needs_review",
      resultSummary: "Done",
    });
  });

  it("PATCH maps update errors to stable statuses", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    updateWorkpackMock.mockRejectedValueOnce(
      new WorkpackUpdateError("invalid_links", "bad links"),
    );
    const res = await PATCH(req({ resultLinks: ["slack://x"] }), ctx());
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("invalid_links");
  });

  it("PATCH posts a result card to the source thread when status moves to done", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    getWorkpackMock.mockResolvedValueOnce({
      id: "wp_1",
      status: "running",
      sourceUrl:
        "https://usagummies.slack.com/archives/C0AKG9FSC2J/p1777758790850549",
      title: "x",
      department: "email",
      intent: "draft_reply",
      riskClass: "read_only",
      allowedActions: [],
      prohibitedActions: [],
      sourceText: "x",
      createdAt: "2026-05-02T18:00:00.000Z",
      updatedAt: "2026-05-02T18:00:00.000Z",
    });
    updateWorkpackMock.mockResolvedValueOnce({
      id: "wp_1",
      status: "done",
      resultSummary: "Drafted",
      sourceUrl:
        "https://usagummies.slack.com/archives/C0AKG9FSC2J/p1777758790850549",
      title: "x",
      department: "email",
      intent: "draft_reply",
      riskClass: "read_only",
      allowedActions: [],
      prohibitedActions: [],
      sourceText: "x",
      createdAt: "2026-05-02T18:00:00.000Z",
      updatedAt: "2026-05-02T18:00:00.000Z",
    });
    const res = await PATCH(
      req({ status: "done", resultSummary: "Drafted" }),
      ctx(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { slackPost: { posted: boolean } };
    expect(body.slackPost.posted).toBe(true);
    expect(postMessageMock).toHaveBeenCalledTimes(1);
    const call = postMessageMock.mock.calls[0][0] as {
      channel: string;
      threadTs?: string;
    };
    expect(call.channel).toBe("C0AKG9FSC2J");
    expect(call.threadTs).toMatch(/^\d+\.\d+$/);
  });

  it("PATCH skips slack post when status didn't change", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    getWorkpackMock.mockResolvedValueOnce({
      id: "wp_1",
      status: "needs_review",
    });
    updateWorkpackMock.mockResolvedValueOnce({
      id: "wp_1",
      status: "needs_review",
      resultSummary: "Updated",
    });
    const res = await PATCH(
      req({ resultSummary: "Updated" }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it("PATCH skips slack post on terminal-status transition with no source URL", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    getWorkpackMock.mockResolvedValueOnce({ id: "wp_1", status: "running" });
    updateWorkpackMock.mockResolvedValueOnce({
      id: "wp_1",
      status: "done",
      resultSummary: "Drafted",
      title: "x",
      department: "email",
      intent: "draft_reply",
      riskClass: "read_only",
      allowedActions: [],
      prohibitedActions: [],
      sourceText: "x",
      createdAt: "2026-05-02T18:00:00.000Z",
      updatedAt: "2026-05-02T18:00:00.000Z",
    });
    const res = await PATCH(
      req({ status: "done", resultSummary: "Drafted" }),
      ctx(),
    );
    const body = (await res.json()) as { slackPost: { posted: boolean; reason?: string } };
    expect(body.slackPost.posted).toBe(false);
    expect(body.slackPost.reason).toBe("no-source-url");
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it("PATCH does not fail when slack post throws — best-effort only", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    postMessageMock.mockRejectedValueOnce(new Error("slack-down"));
    getWorkpackMock.mockResolvedValueOnce({
      id: "wp_1",
      status: "running",
      sourceUrl:
        "https://usagummies.slack.com/archives/C0AKG9FSC2J/p1777758790850549",
    });
    updateWorkpackMock.mockResolvedValueOnce({
      id: "wp_1",
      status: "done",
      resultSummary: "x",
      sourceUrl:
        "https://usagummies.slack.com/archives/C0AKG9FSC2J/p1777758790850549",
      title: "x",
      department: "email",
      intent: "draft_reply",
      riskClass: "read_only",
      allowedActions: [],
      prohibitedActions: [],
      sourceText: "x",
      createdAt: "2026-05-02T18:00:00.000Z",
      updatedAt: "2026-05-02T18:00:00.000Z",
    });
    const res = await PATCH(req({ status: "done", resultSummary: "x" }), ctx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { slackPost: { posted: boolean; reason?: string } };
    expect(body.slackPost.posted).toBe(false);
    expect(body.slackPost.reason).toMatch(/slack-post-failed/);
  });

  it("PATCH rejects invalid json", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    const res = await PATCH(
      new Request("https://www.usagummies.com/api/ops/workpacks/wp_1", {
        method: "PATCH",
        body: "{",
      }),
      ctx(),
    );
    expect(res.status).toBe(400);
  });
});
