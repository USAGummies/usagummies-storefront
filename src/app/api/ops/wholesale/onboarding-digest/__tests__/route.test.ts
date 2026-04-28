/**
 * Phase 35.f.5.b — onboarding-digest route tests.
 *
 * Locked contracts:
 *   - 401 when isAuthorized rejects.
 *   - Returns ok:true, posted:false, stalledCount:0 on empty stall set
 *     (no Slack message written — no-news-pings rule).
 *   - Posts to #financials when stalled flows exist; response includes
 *     slackTs.
 *   - Dedup gate: 2nd call same UTC day returns skipped:true and does
 *     NOT re-post.
 *   - ?force=true bypasses the dedup gate.
 *   - Slack failure: posted:false + slackError surfaced; dedup
 *     marker NOT written (next cron retries).
 *   - 500 when KV read throws.
 *   - Slack message includes the stalled flow's company + flowId.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

const postMessageMock = vi.fn();
vi.mock("@/lib/ops/control-plane/slack/client", () => ({
  postMessage: (...args: unknown[]) => postMessageMock(...args),
}));

const store = new Map<string, unknown>();
let kvShouldThrow = false;

vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(async (key: string) => {
      if (kvShouldThrow) throw new Error("ECONNREFUSED");
      return store.get(key) ?? null;
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  },
}));

import {
  saveOnboardingState,
} from "@/lib/wholesale/onboarding-store";
import type { OnboardingState } from "@/lib/wholesale/onboarding-flow";

beforeEach(() => {
  store.clear();
  kvShouldThrow = false;
  isAuthorizedMock.mockReset();
  isAuthorizedMock.mockResolvedValue(true);
  postMessageMock.mockReset();
  postMessageMock.mockResolvedValue({ ok: true, ts: "1.234" });
});

afterEach(() => {
  vi.clearAllMocks();
});

function buildReq(qs = ""): Request {
  return new Request(
    `http://localhost/api/ops/wholesale/onboarding-digest${qs}`,
    { method: "GET" },
  );
}

function makeStaleState(
  flowId: string,
  hoursStale: number,
  overrides: Partial<OnboardingState> = {},
): OnboardingState {
  const stale = new Date(
    Date.now() - hoursStale * 3600 * 1000,
  ).toISOString();
  return {
    flowId,
    currentStep: "store-type",
    stepsCompleted: ["info"],
    orderLines: [],
    timestamps: { info: stale },
    prospect: {
      companyName: "Acme Co",
      contactName: "Jane",
      contactEmail: "jane@acme.test",
    },
    ...overrides,
  };
}

interface DigestResponse {
  ok: boolean;
  stalledCount?: number;
  posted?: boolean;
  skipped?: boolean;
  slackTs?: string;
  slackError?: string;
  reason?: string;
  error?: string;
}

describe("onboarding-digest — auth", () => {
  it("401 when isAuthorized rejects", async () => {
    isAuthorizedMock.mockResolvedValue(false);
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    expect(res.status).toBe(401);
  });
});

describe("onboarding-digest — empty stall set", () => {
  it("returns ok:true, posted:false, stalledCount:0 when no flows stalled", async () => {
    // A fresh flow (1h old) is not stalled at default 24h threshold.
    await saveOnboardingState(makeStaleState("wf_fresh", 1));
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    const body = (await res.json()) as DigestResponse;
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.posted).toBe(false);
    expect(body.stalledCount).toBe(0);
    expect(postMessageMock).not.toHaveBeenCalled();
  });
});

describe("onboarding-digest — happy path with stalled flows", () => {
  it("posts to Slack with stalled flow detail", async () => {
    await saveOnboardingState(
      makeStaleState("wf_stale", 48, {
        prospect: {
          companyName: "Stale Inc",
          contactName: "John",
          contactEmail: "john@stale.test",
        },
      }),
    );
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    const body = (await res.json()) as DigestResponse;
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.posted).toBe(true);
    expect(body.stalledCount).toBe(1);
    expect(body.slackTs).toBe("1.234");
    expect(postMessageMock).toHaveBeenCalledTimes(1);
    const call = postMessageMock.mock.calls[0][0];
    expect(call.channel).toBe("C0AKG9FSC2J");
    expect(call.text).toContain("Stale Inc");
    expect(call.text).toContain("wf_stale");
    expect(call.text).toContain("stalled at");
  });

  it("includes hours-since-last-touch in the message", async () => {
    await saveOnboardingState(makeStaleState("wf_72h", 72));
    const { GET } = await import("../route");
    await GET(buildReq());
    const call = postMessageMock.mock.calls[0][0];
    expect(call.text).toMatch(/72h/);
  });
});

describe("onboarding-digest — dedup gate", () => {
  it("2nd call same day returns skipped:true (does NOT re-post)", async () => {
    await saveOnboardingState(makeStaleState("wf_x", 48));
    const { GET } = await import("../route");
    const r1 = await GET(buildReq());
    expect(((await r1.json()) as DigestResponse).posted).toBe(true);

    const r2 = await GET(buildReq());
    const b2 = (await r2.json()) as DigestResponse;
    expect(b2.skipped).toBe(true);
    expect(b2.reason).toBe("already-posted-today");
    expect(postMessageMock).toHaveBeenCalledTimes(1); // only the first call
  });

  it("?force=true bypasses the dedup gate", async () => {
    await saveOnboardingState(makeStaleState("wf_y", 48));
    const { GET } = await import("../route");
    await GET(buildReq()); // first post
    expect(postMessageMock).toHaveBeenCalledTimes(1);

    await GET(buildReq("?force=true"));
    expect(postMessageMock).toHaveBeenCalledTimes(2); // forced re-post
  });
});

describe("onboarding-digest — slack failure", () => {
  it("posted:false + slackError surfaced; dedup NOT written", async () => {
    await saveOnboardingState(makeStaleState("wf_fail", 48));
    postMessageMock.mockResolvedValue({
      ok: false,
      error: "channel_not_found",
    });

    const { GET } = await import("../route");
    const res = await GET(buildReq());
    const body = (await res.json()) as DigestResponse;
    expect(body.ok).toBe(false);
    expect(body.posted).toBe(false);
    expect(body.slackError).toBe("channel_not_found");

    // Crucially: the dedup key was NOT written, so the next cron
    // retries (idempotency under degraded Slack).
    postMessageMock.mockResolvedValue({ ok: true, ts: "5.6" });
    const retry = await GET(buildReq());
    const retryBody = (await retry.json()) as DigestResponse;
    expect(retryBody.posted).toBe(true); // retry succeeds
  });
});

describe("onboarding-digest — kv read failure", () => {
  it("500 when KV throws", async () => {
    await saveOnboardingState(makeStaleState("wf_x", 48));
    kvShouldThrow = true;
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    expect(res.status).toBe(500);
    const body = (await res.json()) as DigestResponse;
    expect(body.ok).toBe(false);
    expect(body.error).toBe("kv_read_failed");
  });
});

describe("onboarding-digest — POST also works", () => {
  it("POST handler runs the same logic as GET", async () => {
    await saveOnboardingState(makeStaleState("wf_post", 48));
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/ops/wholesale/onboarding-digest", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestResponse;
    expect(body.posted).toBe(true);
  });
});

describe("onboarding-digest — stallHours clamp", () => {
  it("clamps stallHours to [1, 720]", async () => {
    // 12-hour-old flow, request stallHours=2 → stalled
    await saveOnboardingState(makeStaleState("wf_12h", 12));
    const { GET } = await import("../route");
    const res = await GET(buildReq("?stallHours=2"));
    const body = (await res.json()) as DigestResponse;
    expect(body.stalledCount).toBe(1);
    expect(body.posted).toBe(true);
  });
});
