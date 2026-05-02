import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
const postMessageMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

vi.mock("@/lib/ops/control-plane/slack/client", () => ({
  postMessage: (params: unknown) => postMessageMock(params),
}));

import { GET, POST } from "../route";

beforeEach(() => {
  isAuthorizedMock.mockReset();
  postMessageMock.mockReset();
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_SIGNING_SECRET;
});

function req(body?: unknown) {
  return new Request("https://www.usagummies.com/api/ops/slack/self-test", {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("/api/ops/slack/self-test", () => {
  it("auth-gates GET and POST", async () => {
    isAuthorizedMock.mockResolvedValue(false);
    expect((await GET(req())).status).toBe(401);
    expect((await POST(req({}))).status).toBe(401);
  });

  it("GET returns boolean-only Slack readiness without leaking secrets", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-real-looking-secret";
    process.env.SLACK_SIGNING_SECRET = "signing-secret-value";
    isAuthorizedMock.mockResolvedValueOnce(true);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("xoxb-real-looking-secret");
    expect(text).not.toContain("signing-secret-value");
    const body = JSON.parse(text);
    expect(body.env.slackBotTokenPresent).toBe(true);
    expect(body.env.slackSigningSecretPresent).toBe(true);
    expect(body.urls.events).toBe("https://www.usagummies.com/api/ops/slack/events");
    expect(body.activeChannels.some((c: { id: string }) => c.id === "ops-daily")).toBe(true);
  });

  it("POST defaults to the live ops-daily channel and posts Block Kit", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    postMessageMock.mockResolvedValueOnce({
      ok: true,
      channel: "C0ATWJDKLTU",
      ts: "1.234",
    });
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C0ATWJDKLTU",
        text: "Slack self-test — repo bot post",
        blocks: expect.arrayContaining([
          expect.objectContaining({ type: "header" }),
        ]),
      }),
    );
  });

  it("POST refuses unknown or inactive channels", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    const res = await POST(req({ channel: "abra-control" }));
    expect(res.status).toBe(400);
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it("POST surfaces Slack token/channel failures honestly", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    postMessageMock.mockResolvedValueOnce({ ok: false, error: "account_inactive" });
    const res = await POST(req({ channel: "ops-daily" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("account_inactive");
  });
});
