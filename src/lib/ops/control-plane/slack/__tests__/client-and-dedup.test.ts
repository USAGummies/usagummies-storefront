/**
 * Coverage for the two surfaces shipped with the Slack signal-to-noise
 * pass (Cuts A–D + brand-voice push):
 *
 *   1. `postMessage()` auto-recovers from `not_in_channel` by calling
 *      `conversations.join` and retrying ONCE. Eliminates the second
 *      class of #ops-alerts file-upload-failure noise.
 *   2. `joinChannel()` resolves a `#name` (or bare `name`) string to a
 *      channel id and joins it. Returns `{ok:true}` on already-member
 *      since `conversations.join` is idempotent server-side.
 *   3. `mirror-dedup.digestContentFingerprint()` normalizes timestamps
 *      + UUIDs + relative-time markers so semantically-identical
 *      digest reruns collide and the second mirror is suppressed.
 *   4. `mirror-dedup.shouldMirror()` fails OPEN when KV is unconfigured
 *      — Slack-mirror visibility wins over silence.
 *
 * No live Slack API calls — `global.fetch` is mocked per test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  digestContentFingerprint,
  fingerprintHash,
  shouldMirror,
} from "../mirror-dedup";

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_TOKEN = process.env.SLACK_BOT_TOKEN;
const ORIGINAL_KV_URL = process.env.KV_REST_API_URL;
const ORIGINAL_KV_TOKEN = process.env.KV_REST_API_TOKEN;

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;

function mockFetch(handler: FetchHandler): void {
  global.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init);
  }) as typeof global.fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_TOKEN === undefined) delete process.env.SLACK_BOT_TOKEN;
  else process.env.SLACK_BOT_TOKEN = ORIGINAL_TOKEN;
  if (ORIGINAL_KV_URL === undefined) delete process.env.KV_REST_API_URL;
  else process.env.KV_REST_API_URL = ORIGINAL_KV_URL;
  if (ORIGINAL_KV_TOKEN === undefined) delete process.env.KV_REST_API_TOKEN;
  else process.env.KV_REST_API_TOKEN = ORIGINAL_KV_TOKEN;
  vi.restoreAllMocks();
});

describe("postMessage auto-recovery on not_in_channel", () => {
  it("retries after auto-join and returns success", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    mockFetch(async (url, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : null;
      calls.push({ url, body });
      if (url === "https://slack.com/api/chat.postMessage" && calls.filter((c) => c.url === url).length === 1) {
        return jsonResponse({ ok: false, error: "not_in_channel" });
      }
      if (url.startsWith("https://slack.com/api/conversations.list")) {
        return jsonResponse({
          ok: true,
          channels: [{ id: "C123ABC", name: "ops-audit" }],
          response_metadata: { next_cursor: "" },
        });
      }
      if (url === "https://slack.com/api/conversations.join") {
        return jsonResponse({ ok: true, channel: { id: "C123ABC" } });
      }
      if (url === "https://slack.com/api/chat.postMessage") {
        // Retry attempt
        return jsonResponse({ ok: true, channel: "C123ABC", ts: "1.0" });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const { postMessage } = await import("../client");
    const out = await postMessage({ channel: "#ops-audit", text: "hello" });
    expect(out.ok).toBe(true);
    expect(out.ts).toBe("1.0");
    // Two postMessage attempts were made, plus one list + one join.
    const postAttempts = calls.filter(
      (c) => c.url === "https://slack.com/api/chat.postMessage",
    );
    expect(postAttempts.length).toBe(2);
    const join = calls.find(
      (c) => c.url === "https://slack.com/api/conversations.join",
    );
    expect(join).toBeDefined();
    expect((join!.body as { channel: string }).channel).toBe("C123ABC");
  });

  it("returns clean success without auto-join when post succeeds first try", async () => {
    let attempts = 0;
    mockFetch(async (url) => {
      if (url === "https://slack.com/api/chat.postMessage") {
        attempts += 1;
        return jsonResponse({ ok: true, channel: "Cabc", ts: "2.0" });
      }
      throw new Error("should not call any other endpoint");
    });
    const { postMessage } = await import("../client");
    const out = await postMessage({ channel: "Cabc", text: "yo" });
    expect(out.ok).toBe(true);
    expect(attempts).toBe(1); // no retry
  });

  it("surfaces unrecoverable join failure clearly", async () => {
    mockFetch(async (url) => {
      if (url === "https://slack.com/api/chat.postMessage") {
        return jsonResponse({ ok: false, error: "not_in_channel" });
      }
      if (url.startsWith("https://slack.com/api/conversations.list")) {
        return jsonResponse({
          ok: true,
          channels: [{ id: "C999", name: "private-chan" }],
          response_metadata: { next_cursor: "" },
        });
      }
      if (url === "https://slack.com/api/conversations.join") {
        return jsonResponse({ ok: false, error: "channel_is_private" });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const { postMessage } = await import("../client");
    const out = await postMessage({ channel: "#private-chan", text: "x" });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("not_in_channel + auto-join failed");
    expect(out.error).toContain("channel_is_private");
  });

  it("does NOT retry on errors other than not_in_channel (e.g. missing_scope is a config bug — handled by Cut D dedup)", async () => {
    let attempts = 0;
    mockFetch(async (url) => {
      if (url === "https://slack.com/api/chat.postMessage") {
        attempts += 1;
        return jsonResponse({ ok: false, error: "missing_scope" });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const { postMessage } = await import("../client");
    const out = await postMessage({ channel: "Cabc", text: "x" });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("missing_scope");
    expect(attempts).toBe(1); // no retry, no join attempt
  });
});

describe("digestContentFingerprint normalization", () => {
  it("strips ISO timestamps so morning + afternoon reruns collide", () => {
    const a = "Generated 2026-04-30T15:00:30.123Z — wallet $147";
    const b = "Generated 2026-04-30T22:14:09.000Z — wallet $147";
    expect(digestContentFingerprint(a)).toBe(digestContentFingerprint(b));
  });

  it("strips UUIDs (run ids) so per-run identifiers don't break dedup", () => {
    const a = "run 123e4567-e89b-12d3-a456-426614174000 — same payload";
    const b = "run f47ac10b-58cc-4372-a567-0e02b2c3d479 — same payload";
    expect(digestContentFingerprint(a)).toBe(digestContentFingerprint(b));
  });

  it("strips relative-time markers (`Xh ago` / `Xd ago`) — same stale voids on different days collide", () => {
    const a = "Powers stale 7d ago, void 112.47h ago";
    const b = "Powers stale 14d ago, void 184.48h ago";
    expect(digestContentFingerprint(a)).toBe(digestContentFingerprint(b));
  });

  it("differs when actual content changes (new vendor in the list)", () => {
    const a = "Watched vendors: Powers, Belmark, Albanese";
    const b = "Watched vendors: Powers, Belmark, Albanese, Inderbitzin";
    expect(digestContentFingerprint(a)).not.toBe(digestContentFingerprint(b));
  });

  it("is deterministic and short (16 hex chars)", () => {
    const fp = digestContentFingerprint("anything");
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(digestContentFingerprint("anything")).toBe(fp);
  });
});

describe("fingerprintHash determinism", () => {
  it("same parts → same hash", () => {
    expect(fingerprintHash(["a", "b", "c"])).toBe(fingerprintHash(["a", "b", "c"]));
  });
  it("different order → different hash (parts are positional)", () => {
    expect(fingerprintHash(["a", "b"])).not.toBe(fingerprintHash(["b", "a"]));
  });
  it("returns 16-char hex", () => {
    expect(fingerprintHash(["x"])).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("shouldMirror fails OPEN when KV unconfigured", () => {
  it("returns true when KV env vars are missing — visibility over silence", async () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    const ok = await shouldMirror({ fingerprint: ["x", "y"], ttlSeconds: 60 });
    expect(ok).toBe(true);
  });

  it("returns true when fingerprint is empty (degenerate case)", async () => {
    process.env.KV_REST_API_URL = "https://kv.example";
    process.env.KV_REST_API_TOKEN = "tok";
    const ok = await shouldMirror({ fingerprint: [], ttlSeconds: 60 });
    expect(ok).toBe(true);
  });
});
