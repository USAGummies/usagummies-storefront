/**
 * Phase 28i — `uploadBufferToSlack` resolves channel-message ts via
 * conversations.history.
 *
 * Locks the contract:
 *   - On success, `messageTs` reflects the ts of the channel message
 *     that carries the just-uploaded file. NOT undefined (the
 *     pre-fix bug: `permalinkToMessageTs(file.permalink)` was always
 *     undefined because `file.permalink` is the file URL, not the
 *     message URL).
 *   - The helper queries `conversations.history` with the bot's
 *     existing `channels:history` scope (NOT `files:read` — that
 *     scope isn't on the token).
 *   - Fail-soft: if conversations.history errors, no `files:read`
 *     scope, or the file isn't in the recent 50 messages, the result
 *     falls back to `permalinkToMessageTs(file.permalink)` (which
 *     is undefined for live uploads, matching pre-fix behavior).
 *   - The upload itself never fails because of a history-resolve
 *     error — the file already landed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  process.env.SLACK_BOT_TOKEN = "xoxb-stub";
  // KV mock — uploadBufferToSlack writes a dedupe key on success.
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
});

function mockSlackResponses(opts: {
  fileId: string;
  filePermalink: string;
  channelMessageTs?: string;
  /** When true, conversations.history returns a non-ok response. */
  historyOk?: boolean;
  /** When true, file in history doesn't match the uploaded fileId. */
  historyHasNoMatch?: boolean;
}) {
  const calls: Array<{ url: string; method: string }> = [];
  global.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.startsWith("https://slack.com/api/files.getUploadURLExternal")) {
      return new Response(
        JSON.stringify({
          ok: true,
          upload_url: "https://files.slack.com/upload-presigned-url",
          file_id: opts.fileId,
        }),
        { status: 200 },
      );
    }
    if (url === "https://files.slack.com/upload-presigned-url") {
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
      if (opts.historyOk === false) {
        return new Response(
          JSON.stringify({ ok: false, error: "channel_not_found" }),
          { status: 200 },
        );
      }
      const ts = opts.channelMessageTs ?? "1777298415.214529";
      const messages = opts.historyHasNoMatch
        ? [{ ts: "1777200000.000001", files: [{ id: "F_OTHER" }] }]
        : [{ ts, files: [{ id: opts.fileId, name: "label.pdf" }] }];
      return new Response(
        JSON.stringify({ ok: true, messages }),
        { status: 200 },
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof global.fetch;
  return calls;
}

describe("uploadBufferToSlack — channel-message ts resolution", () => {
  it("returns the channel-message ts when conversations.history finds the file", async () => {
    const calls = mockSlackResponses({
      fileId: "F0B0Y1VF0U8",
      filePermalink:
        "https://usagummies.slack.com/files/U0AUQRVPUN4/F0B0Y1VF0U8/label.pdf",
      channelMessageTs: "1777298415.214529",
    });
    const { uploadBufferToSlack } = await import("@/lib/ops/slack-file-upload");
    const result = await uploadBufferToSlack({
      channelId: "C0AS4635HFG",
      filename: "label.pdf",
      buffer: Buffer.from("PDF-bytes"),
      mimeType: "application/pdf",
      comment: "test",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.messageTs).toBe("1777298415.214529");
      expect(result.fileId).toBe("F0B0Y1VF0U8");
    }
    // Verify the resolver actually called conversations.history with
    // the right channel — defense-in-depth so a future refactor can't
    // silently switch to a different API.
    const historyCall = calls.find((c) =>
      c.url.startsWith("https://slack.com/api/conversations.history"),
    );
    expect(historyCall).toBeDefined();
    expect(historyCall?.url).toContain("channel=C0AS4635HFG");
  });

  it("falls back to undefined when conversations.history returns ok:false (e.g. missing scope)", async () => {
    mockSlackResponses({
      fileId: "F_FALLBACK",
      filePermalink:
        "https://usagummies.slack.com/files/U_X/F_FALLBACK/x.pdf",
      historyOk: false,
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
      // No channel-archive permalink, so the legacy regex returns
      // undefined too. Result: undefined.
      expect(result.messageTs).toBeUndefined();
    }
  });

  it("falls back to undefined when the file isn't in the recent 50 messages", async () => {
    mockSlackResponses({
      fileId: "F_NOT_FOUND",
      filePermalink:
        "https://usagummies.slack.com/files/U_X/F_NOT_FOUND/x.pdf",
      historyHasNoMatch: true,
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

  it("upload itself NEVER fails because of a history-resolve error — the file already landed", async () => {
    // Force conversations.history to throw mid-flight.
    global.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("https://slack.com/api/files.getUploadURLExternal")) {
        return new Response(
          JSON.stringify({
            ok: true,
            upload_url: "https://files.slack.com/u",
            file_id: "F_THROW",
          }),
          { status: 200 },
        );
      }
      if (url === "https://files.slack.com/u") {
        return new Response("OK", { status: 200 });
      }
      if (
        url.startsWith("https://slack.com/api/files.completeUploadExternal")
      ) {
        return new Response(
          JSON.stringify({
            ok: true,
            files: [
              {
                id: "F_THROW",
                permalink:
                  "https://usagummies.slack.com/files/U_X/F_THROW/x.pdf",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.startsWith("https://slack.com/api/conversations.history")) {
        throw new Error("network unreachable");
      }
      return new Response("nope", { status: 404 });
    }) as typeof global.fetch;

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
      // File still came back from completeUploadExternal — this is the
      // pre-fix invariant we're preserving.
      expect(result.fileId).toBe("F_THROW");
    }
  });
});
