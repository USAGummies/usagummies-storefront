/**
 * Phase 28i+ — `resolveChannelMessageTs` propagation-race retry.
 *
 * Live regression 2026-04-27 11:30 PT (Amazon order
 * 111-1502722-7838646, Amy Catalano): `files.completeUploadExternal`
 * returned ok+permalink, the Phase 28i fix queried
 * `conversations.history` immediately, but Slack hadn't yet indexed
 * the file in channel history. Result: `messageTs=undefined` → no
 * thread reply → Ben got a label with no packing slip.
 *
 * Same class as Phase 28i (silent thread-reply failure) but a
 * different mechanism — propagation race vs wrong permalink shape.
 *
 * Locks the contract:
 *   - First conversations.history miss → retry with backoff.
 *   - Backoff schedule is exported (`RESOLVE_CHANNEL_TS_BACKOFF_MS`)
 *     so this test can drive it deterministically with fake timers.
 *   - On second-or-third attempt finding the file → returns the ts
 *     (the auto-ship route's thread reply still lands).
 *   - Slack scope: still uses `conversations.history` (NOT
 *     `files.info` — that needs a `files:read` scope the bot
 *     doesn't have).
 *   - Worst case: 3 attempts (0ms + 600ms + 1500ms = 2.1s wall),
 *     which fits in the auto-ship route's 30s budget.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  process.env.SLACK_BOT_TOKEN = "xoxb-stub";
  vi.doMock("@vercel/kv", () => ({
    kv: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => "OK"),
    },
  }));
});

afterEach(() => {
  delete process.env.SLACK_BOT_TOKEN;
  vi.resetModules();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

interface MockOpts {
  fileId: string;
  filePermalink: string;
  /** Index of the conversations.history call (0-based) at which the file appears. */
  appearsAtAttempt: number;
  /** Eventual ts the history returns. */
  channelMessageTs: string;
}

function setupRetryMocks(opts: MockOpts): {
  historyAttempts: number;
} {
  let historyAttempts = 0;
  global.fetch = (async (input: unknown, _init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://slack.com/api/files.getUploadURLExternal")) {
      return new Response(
        JSON.stringify({
          ok: true,
          upload_url: "https://files.slack.com/upload",
          file_id: opts.fileId,
        }),
        { status: 200 },
      );
    }
    if (url === "https://files.slack.com/upload") {
      return new Response("OK", { status: 200 });
    }
    if (url.startsWith("https://slack.com/api/files.completeUploadExternal")) {
      return new Response(
        JSON.stringify({
          ok: true,
          files: [{ id: opts.fileId, permalink: opts.filePermalink }],
        }),
        { status: 200 },
      );
    }
    if (url.startsWith("https://slack.com/api/conversations.history")) {
      const attempt = historyAttempts;
      historyAttempts += 1;
      if (attempt < opts.appearsAtAttempt) {
        // File not yet indexed — return messages without our fileId.
        return new Response(
          JSON.stringify({
            ok: true,
            messages: [
              { ts: "1777200000.000001", files: [{ id: "F_OTHER" }] },
            ],
          }),
          { status: 200 },
        );
      }
      // File now indexed.
      return new Response(
        JSON.stringify({
          ok: true,
          messages: [
            { ts: opts.channelMessageTs, files: [{ id: opts.fileId }] },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response("nope", { status: 404 });
  }) as typeof global.fetch;
  return new Proxy(
    {} as { historyAttempts: number },
    {
      get: () => historyAttempts,
    },
  );
}

describe("resolveChannelMessageTs — propagation-race retry", () => {
  it("RESOLVE_CHANNEL_TS_BACKOFF_MS is exported, three attempts, monotonic non-decreasing", async () => {
    const { RESOLVE_CHANNEL_TS_BACKOFF_MS } = await import(
      "@/lib/ops/slack-file-upload"
    );
    expect(RESOLVE_CHANNEL_TS_BACKOFF_MS.length).toBe(3);
    expect(RESOLVE_CHANNEL_TS_BACKOFF_MS[0]).toBe(0); // first attempt is immediate
    expect(RESOLVE_CHANNEL_TS_BACKOFF_MS[1]).toBeGreaterThanOrEqual(
      RESOLVE_CHANNEL_TS_BACKOFF_MS[0],
    );
    expect(RESOLVE_CHANNEL_TS_BACKOFF_MS[2]).toBeGreaterThanOrEqual(
      RESOLVE_CHANNEL_TS_BACKOFF_MS[1],
    );
    // Total budget under 3s — auto-ship route has 30s overall, this
    // resolution path can't be allowed to dominate that budget.
    const total = RESOLVE_CHANNEL_TS_BACKOFF_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(3000);
  });

  it("retries when first conversations.history call misses the file", async () => {
    setupRetryMocks({
      fileId: "F_RACE",
      filePermalink:
        "https://usagummies.slack.com/files/U_X/F_RACE/label.pdf",
      appearsAtAttempt: 1, // miss attempt 0, find at attempt 1
      channelMessageTs: "1777314642.347809",
    });

    const { uploadBufferToSlack } = await import("@/lib/ops/slack-file-upload");
    const result = await uploadBufferToSlack({
      channelId: "C0AS4635HFG",
      filename: "label.pdf",
      buffer: Buffer.from("PDF-bytes"),
      mimeType: "application/pdf",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Even though attempt 0 missed, the retry succeeded.
      expect(result.messageTs).toBe("1777314642.347809");
    }
  });

  it("eventually-found at the third attempt still returns the ts", async () => {
    setupRetryMocks({
      fileId: "F_LATE",
      filePermalink: "https://usagummies.slack.com/files/U_X/F_LATE/x.pdf",
      appearsAtAttempt: 2, // miss attempts 0 + 1, find at attempt 2
      channelMessageTs: "1777314650.000001",
    });

    const { uploadBufferToSlack } = await import("@/lib/ops/slack-file-upload");
    const result = await uploadBufferToSlack({
      channelId: "C0AS4635HFG",
      filename: "x.pdf",
      buffer: Buffer.from("x"),
      mimeType: "application/pdf",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.messageTs).toBe("1777314650.000001");
    }
  });

  it("after backoff exhausted with all misses, falls back to undefined (still no fabrication)", async () => {
    setupRetryMocks({
      fileId: "F_NEVER",
      filePermalink: "https://usagummies.slack.com/files/U_X/F_NEVER/x.pdf",
      appearsAtAttempt: 99, // never appears
      channelMessageTs: "irrelevant",
    });

    const { uploadBufferToSlack } = await import("@/lib/ops/slack-file-upload");
    const result = await uploadBufferToSlack({
      channelId: "C0AS4635HFG",
      filename: "x.pdf",
      buffer: Buffer.from("x"),
      mimeType: "application/pdf",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.messageTs).toBeUndefined();
    }
  });
});
