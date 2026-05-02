/**
 * Phase 28 — Slack `:white_check_mark:` reaction → mark-dispatched flow.
 *
 * Locks the contract for /api/ops/slack/events when a reaction event
 * arrives:
 *   - Only `:white_check_mark:` reactions trigger the mark. Other emoji
 *     are ignored (returns ok with `skipped: "non-dispatch-reaction"`).
 *   - Only reactions in `#shipping` (channel registry's slackChannelId)
 *     count. Same emoji elsewhere is `skipped: "non-shipping-channel"`.
 *   - Reactions on messages that DON'T have a stored shipping artifact
 *     are `skipped: "no-matching-artifact"` (no false-positive marks).
 *   - First-time mark posts a thread reply; duplicate reaction events
 *     (e.g. multiple users reacting) are idempotent and don't re-post.
 *   - reaction_removed clears the dispatchedAt stamp.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory KV mock — same shape as shipping-artifacts.test.ts so the
// underlying module can mark + look up records.
vi.mock("@vercel/kv", () => {
  const map = new Map<string, string>();
  return {
    kv: {
      get: vi.fn(async (k: string) => map.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => {
        map.set(k, v);
        return "OK";
      }),
      scan: vi.fn(async (_cursor: number, opts: { match?: string }) => {
        const pat = opts.match ?? "*";
        const re = new RegExp(`^${pat.replace(/\*/g, ".*")}$`);
        const keys = Array.from(map.keys()).filter((k) => re.test(k));
        return [0, keys];
      }),
      __store: map,
    },
  };
});

// Stub Slack signing — verifySlackSignature returns "not configured"
// when SLACK_SIGNING_SECRET is unset, which the route accepts.
const postMessageMock = vi.fn();
const buildSlackCommandCenterReportMock = vi.fn();
const renderSalesCommandCenterSlackMock = vi.fn();
const createWorkpackMock = vi.fn();
vi.mock("@/lib/ops/control-plane/slack", () => ({
  verifySlackSignature: vi.fn(async () => ({
    ok: false,
    reason: "SLACK_SIGNING_SECRET not configured",
  })),
  postMessage: (...args: unknown[]) => postMessageMock(...args),
}));

vi.mock("@/lib/ops/slack-command-center-report", () => ({
  buildSlackCommandCenterReport: (...args: unknown[]) =>
    buildSlackCommandCenterReportMock(...args),
}));

vi.mock("@/lib/ops/slack-command-center", () => ({
  renderSalesCommandCenterSlack: (...args: unknown[]) =>
    renderSalesCommandCenterSlackMock(...args),
}));

vi.mock("@/lib/ops/workpacks", () => ({
  createWorkpack: (...args: unknown[]) => createWorkpackMock(...args),
}));

// Channel registry — return shipping with the canonical Slack ID.
vi.mock("@/lib/ops/control-plane/channels", () => ({
  getChannel: (id: string) => {
    if (id === "shipping") {
      return { id: "shipping", name: "shipping", slackChannelId: "C0AS4635HFG" };
    }
    if (id === "operations") {
      return { id: "operations", name: "ops", slackChannelId: "C_OPS" };
    }
    if (id === "sales") {
      return { id: "sales", name: "sales", slackChannelId: "C_SALES" };
    }
    return null;
  },
  slackChannelRef: (id: string) => {
    if (id === "shipping") return "C0AS4635HFG";
    if (id === "operations") return "C_OPS";
    if (id === "sales") return "C_SALES";
    return `#${id}`;
  },
}));

const SHIPPING_CHANNEL = "C0AS4635HFG";
const OTHER_CHANNEL = "C_RANDOM";

function makeReactionReq(payload: unknown): Request {
  return new Request("https://www.usagummies.com/api/ops/slack/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

beforeEach(async () => {
  postMessageMock.mockReset();
  postMessageMock.mockResolvedValue({ ok: true });
  buildSlackCommandCenterReportMock.mockReset();
  buildSlackCommandCenterReportMock.mockResolvedValue({ fake: "report" });
  renderSalesCommandCenterSlackMock.mockReset();
  renderSalesCommandCenterSlackMock.mockReturnValue({
    text: "USA Gummies Command Center",
    blocks: [{ type: "header", text: { type: "plain_text", text: "Command Center" } }],
  });
  createWorkpackMock.mockReset();
  createWorkpackMock.mockResolvedValue({
    id: "wp_1",
    status: "queued",
    intent: "prepare_codex_prompt",
    department: "ops",
    title: "Codex implementation prompt",
    sourceText: "Build it",
    sourceUrl: "https://usagummies.slack.com/archives/C_OPS/p1777300000444444",
    requestedBy: "U_BEN",
    allowedActions: ["prepare_prompt"],
    prohibitedActions: ["send_email", "write_qbo"],
    riskClass: "read_only",
    createdAt: "2026-05-02T12:00:00.000Z",
    updatedAt: "2026-05-02T12:00:00.000Z",
  });
  // Wipe KV between tests.
  const { kv } = (await import("@vercel/kv")) as unknown as {
    kv: { __store: Map<string, string> };
  };
  kv.__store.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

async function seedArtifact(opts: {
  source: string;
  orderNumber: string;
  channel: string;
  ts: string;
}) {
  const { attachSlackPermalink } = await import(
    "@/lib/ops/shipping-artifacts"
  );
  const tsCompact = opts.ts.replace(".", "");
  await attachSlackPermalink({
    source: opts.source,
    orderNumber: opts.orderNumber,
    slackPermalink: `https://usagummies.slack.com/archives/${opts.channel}/p${tsCompact}`,
  });
}

describe("reaction → dispatch flow", () => {
  it("posts the command-center card in-thread when Ben asks for ops dashboard", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      makeReactionReq({
        type: "event_callback",
        event: {
          type: "message",
          text: "ops dashboard",
          channel: "C_OPS",
          ts: "1777300000.444444",
        },
      }),
    );
    const body = (await res.json()) as { handled?: string };

    expect(body.handled).toBe("command-center");
    expect(buildSlackCommandCenterReportMock).toHaveBeenCalledTimes(1);
    expect(renderSalesCommandCenterSlackMock).toHaveBeenCalledWith({ fake: "report" });
    expect(postMessageMock).toHaveBeenCalledWith({
      channel: "C_OPS",
      text: "USA Gummies Command Center",
      blocks: [{ type: "header", text: { type: "plain_text", text: "Command Center" } }],
      threadTs: "1777300000.444444",
    });
  });

  it("creates a workpack and posts a visual card when Ben asks Codex in Slack", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      makeReactionReq({
        type: "event_callback",
        event: {
          type: "message",
          text: "ask codex build the safe email queue",
          channel: "C_OPS",
          user: "U_BEN",
          ts: "1777300000.444444",
        },
      }),
    );
    const body = (await res.json()) as { handled?: string; workpackId?: string };

    expect(body.handled).toBe("workpack");
    expect(body.workpackId).toBe("wp_1");
    expect(createWorkpackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "prepare_codex_prompt",
        sourceText: "build the safe email queue",
        requestedBy: "U_BEN",
      }),
    );
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C_OPS",
        text: expect.stringContaining("Workpack queued"),
        threadTs: "1777300000.444444",
      }),
    );
    const call = postMessageMock.mock.calls.at(-1)?.[0] as { blocks?: unknown[] };
    expect(JSON.stringify(call.blocks)).toContain("Open workpacks");
  });

  it("allows workpack commands inside existing threads and replies to the parent", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      makeReactionReq({
        type: "event_callback",
        event: {
          type: "message",
          text: "draft reply: ask them for the best delivery date",
          channel: "C_SALES",
          user: "U_BEN",
          ts: "1777300000.555555",
          thread_ts: "1777300000.111111",
        },
      }),
    );
    const body = (await res.json()) as { handled?: string };
    expect(body.handled).toBe("workpack");
    expect(createWorkpackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "draft_reply",
        department: "email",
        sourceUrl: "https://usagummies.slack.com/archives/C_SALES/p1777300000111111",
      }),
    );
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C_SALES",
        threadTs: "1777300000.111111",
      }),
    );
  });

  it("ignores non-:white_check_mark: reactions", async () => {
    const { POST } = await import("../route");
    await seedArtifact({
      source: "amazon",
      orderNumber: "112-1111111-1111111",
      channel: SHIPPING_CHANNEL,
      ts: "1777300000.111111",
    });
    const res = await POST(
      makeReactionReq({
        type: "event_callback",
        event: {
          type: "reaction_added",
          user: "U_OPERATOR",
          reaction: "thumbsup",
          item: { type: "message", channel: SHIPPING_CHANNEL, ts: "1777300000.111111" },
        },
      }),
    );
    const body = (await res.json()) as { ok: boolean; skipped?: string };
    expect(body.ok).toBe(true);
    expect(body.skipped).toBe("non-dispatch-reaction");
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it("ignores reactions outside #shipping", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      makeReactionReq({
        type: "event_callback",
        event: {
          type: "reaction_added",
          user: "U_OPERATOR",
          reaction: "white_check_mark",
          item: { type: "message", channel: OTHER_CHANNEL, ts: "1777300000.222222" },
        },
      }),
    );
    const body = (await res.json()) as { ok: boolean; skipped?: string };
    expect(body.skipped).toBe("non-shipping-channel");
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it("ignores reactions on messages with no stored artifact", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      makeReactionReq({
        type: "event_callback",
        event: {
          type: "reaction_added",
          user: "U_OPERATOR",
          reaction: "white_check_mark",
          item: { type: "message", channel: SHIPPING_CHANNEL, ts: "9999999999.999999" },
        },
      }),
    );
    const body = (await res.json()) as { ok: boolean; skipped?: string };
    expect(body.skipped).toBe("no-matching-artifact");
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it("marks dispatched + posts thread reply on first reaction", async () => {
    const { POST } = await import("../route");
    await seedArtifact({
      source: "amazon",
      orderNumber: "112-FIRSTMARK-1",
      channel: SHIPPING_CHANNEL,
      ts: "1777300000.333333",
    });
    const res = await POST(
      makeReactionReq({
        type: "event_callback",
        event: {
          type: "reaction_added",
          user: "U_OPERATOR",
          reaction: "white_check_mark",
          item: { type: "message", channel: SHIPPING_CHANNEL, ts: "1777300000.333333" },
        },
      }),
    );
    const body = (await res.json()) as {
      ok: boolean;
      handled?: string;
      orderNumber?: string;
      firstMark?: boolean;
    };
    expect(body.handled).toBe("reaction_added");
    expect(body.orderNumber).toBe("112-FIRSTMARK-1");
    expect(body.firstMark).toBe(true);
    expect(postMessageMock).toHaveBeenCalledTimes(1);
    const [call] = postMessageMock.mock.calls;
    expect(call[0].threadTs).toBe("1777300000.333333");
    expect(call[0].text).toMatch(/Dispatched/);
    // Verify the artifact got stamped.
    const { getShippingArtifact } = await import(
      "@/lib/ops/shipping-artifacts"
    );
    const stored = await getShippingArtifact("amazon", "112-FIRSTMARK-1");
    expect(stored?.dispatchedAt).toBeTypeOf("string");
    expect(stored?.dispatchedBy).toBe("U_OPERATOR");
  });

  it("idempotent — duplicate reaction event doesn't re-post thread reply", async () => {
    const { POST } = await import("../route");
    await seedArtifact({
      source: "amazon",
      orderNumber: "112-IDEMP-2",
      channel: SHIPPING_CHANNEL,
      ts: "1777300000.444444",
    });
    const reactionPayload = {
      type: "event_callback",
      event: {
        type: "reaction_added",
        user: "U_OPERATOR",
        reaction: "white_check_mark",
        item: { type: "message", channel: SHIPPING_CHANNEL, ts: "1777300000.444444" },
      },
    };
    await POST(makeReactionReq(reactionPayload));
    const res2 = await POST(makeReactionReq(reactionPayload));
    const body2 = (await res2.json()) as { firstMark?: boolean };
    expect(body2.firstMark).toBe(false);
    // Only the FIRST event should have posted a thread reply.
    expect(postMessageMock).toHaveBeenCalledTimes(1);
  });

  it("reaction_removed clears the dispatchedAt stamp", async () => {
    const { POST } = await import("../route");
    await seedArtifact({
      source: "shopify",
      orderNumber: "1099",
      channel: SHIPPING_CHANNEL,
      ts: "1777300000.555555",
    });
    // Mark it
    await POST(
      makeReactionReq({
        type: "event_callback",
        event: {
          type: "reaction_added",
          user: "U_OPERATOR",
          reaction: "white_check_mark",
          item: { type: "message", channel: SHIPPING_CHANNEL, ts: "1777300000.555555" },
        },
      }),
    );
    // Then unmark it
    const res = await POST(
      makeReactionReq({
        type: "event_callback",
        event: {
          type: "reaction_removed",
          user: "U_OPERATOR",
          reaction: "white_check_mark",
          item: { type: "message", channel: SHIPPING_CHANNEL, ts: "1777300000.555555" },
        },
      }),
    );
    const body = (await res.json()) as { handled?: string; hadStamp?: boolean };
    expect(body.handled).toBe("reaction_removed");
    expect(body.hadStamp).toBe(true);
    const { getShippingArtifact } = await import(
      "@/lib/ops/shipping-artifacts"
    );
    const stored = await getShippingArtifact("shopify", "1099");
    expect(stored?.dispatchedAt).toBeNull();
    expect(stored?.dispatchedBy).toBeNull();
  });
});
