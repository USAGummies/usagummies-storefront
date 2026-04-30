/**
 * Tests for the Sales-Tour Whisper transcription helper (v0.2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  transcribeAudioBuffer,
  transcribeSlackVoiceFile,
} from "@/lib/sales-tour/transcribe-voice";

const ORIGINAL_FETCH = global.fetch;
const SAVED_OPENAI = process.env.OPENAI_API_KEY;
const SAVED_SLACK = process.env.SLACK_BOT_TOKEN;

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.SLACK_BOT_TOKEN;
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  if (SAVED_OPENAI === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = SAVED_OPENAI;
  if (SAVED_SLACK === undefined) delete process.env.SLACK_BOT_TOKEN;
  else process.env.SLACK_BOT_TOKEN = SAVED_SLACK;
});

const FAKE_AUDIO = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // RIFF header bytes

describe("transcribeAudioBuffer — Whisper round-trip", () => {
  it("returns ok:false when OPENAI_API_KEY is unset", async () => {
    const r = await transcribeAudioBuffer(FAKE_AUDIO);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/OPENAI_API_KEY/);
    expect(r.source.system).toBe("no-source");
  });

  it("POSTs multipart to /v1/audio/transcriptions with model=whisper-1", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ text: "3 pallets to Bryce Glamp UT, anchor", duration: 6.5 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    global.fetch = fetchSpy as unknown as typeof global.fetch;
    const r = await transcribeAudioBuffer(FAKE_AUDIO);
    expect(r.ok).toBe(true);
    expect(r.text).toBe("3 pallets to Bryce Glamp UT, anchor");
    expect(r.durationSeconds).toBe(6.5);
    expect(r.source.system).toBe("openai-whisper");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("returns ok:false on Whisper 4xx (does not throw)", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    global.fetch = (async () =>
      new Response("Invalid file", { status: 400 })) as unknown as typeof global.fetch;
    const r = await transcribeAudioBuffer(FAKE_AUDIO);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Whisper HTTP 400/);
  });

  it("returns ok:false on empty transcript (whitespace-only)", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    global.fetch = (async () =>
      new Response(JSON.stringify({ text: "   " }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof global.fetch;
    const r = await transcribeAudioBuffer(FAKE_AUDIO);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty transcript/);
  });

  it("returns ok:false on network error", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    global.fetch = (async () => {
      throw new Error("ENETUNREACH");
    }) as unknown as typeof global.fetch;
    const r = await transcribeAudioBuffer(FAKE_AUDIO);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Whisper fetch failed.*ENETUNREACH/);
  });
});

describe("transcribeSlackVoiceFile — Slack files.info → Whisper chain", () => {
  it("returns ok:false when SLACK_BOT_TOKEN is unset", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const r = await transcribeSlackVoiceFile("F1234");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/SLACK_BOT_TOKEN/);
  });

  it("returns ok:false on Slack files.info missing_scope", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.SLACK_BOT_TOKEN = "xoxb-fake";
    global.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, error: "missing_scope" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof global.fetch;
    const r = await transcribeSlackVoiceFile("F1234");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing_scope/);
    expect(r.source.system).toBe("slack-files-api");
  });

  it("end-to-end happy path: files.info → download → Whisper", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.SLACK_BOT_TOKEN = "xoxb-fake";
    let call = 0;
    global.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      call += 1;
      if (call === 1) {
        // files.info response
        expect(url).toContain("/api/files.info");
        return new Response(
          JSON.stringify({
            ok: true,
            file: {
              id: "F1234",
              name: "voice-memo.m4a",
              mimetype: "audio/mp4",
              url_private_download: "https://files.slack.com/abc/voice-memo.m4a",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (call === 2) {
        // audio download
        expect(url).toBe("https://files.slack.com/abc/voice-memo.m4a");
        return new Response(FAKE_AUDIO, {
          status: 200,
          headers: { "content-type": "audio/mp4" },
        });
      }
      // whisper
      expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
      return new Response(
        JSON.stringify({ text: "36 to Mike at Thanksgiving Point UT, landed", duration: 4.2 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof global.fetch;
    const r = await transcribeSlackVoiceFile("F1234");
    expect(r.ok).toBe(true);
    expect(r.text).toBe("36 to Mike at Thanksgiving Point UT, landed");
    expect(call).toBe(3);
  });

  it("returns ok:false when files.info has no url_private_download", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.SLACK_BOT_TOKEN = "xoxb-fake";
    global.fetch = (async () =>
      new Response(
        JSON.stringify({ ok: true, file: { id: "F1234", name: "voice.m4a" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof global.fetch;
    const r = await transcribeSlackVoiceFile("F1234");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no url_private_download/);
  });

  it("returns ok:false on audio download HTTP error", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.SLACK_BOT_TOKEN = "xoxb-fake";
    let call = 0;
    global.fetch = (async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            ok: true,
            file: { id: "F1", name: "v.m4a", url_private_download: "https://files.slack.com/v.m4a" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("forbidden", { status: 403 });
    }) as unknown as typeof global.fetch;
    const r = await transcribeSlackVoiceFile("F1");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Slack file download HTTP 403/);
  });
});
