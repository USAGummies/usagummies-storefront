/**
 * Whisper-backed voice transcription for the Sales-Tour booth-visit
 * field workflow (v0.2).
 *
 * Doctrine: `/contracts/sales-tour-field-workflow.md` §2 (capture surfaces).
 * Pairs with the existing Whisper integration in `src/lib/ops/docs.ts`.
 *
 * Two entry points:
 *   1. `transcribeAudioBuffer(buffer, opts)` — pure-ish helper that takes
 *      raw audio bytes + format hint and returns the transcript text.
 *   2. `transcribeSlackVoiceFile(slackFileId, opts)` — fetches a Slack
 *      voice memo via `files.info` (Slack bot token), downloads the
 *      audio with auth, and feeds it to (1).
 *
 * Fail-soft: every error path returns a `TranscriptionResult` with
 * `ok: false` + an error reason, never throws. Callers degrade
 * gracefully (e.g. fall back to typed input or a "send a typed
 * /booth message instead" hint).
 *
 * Auth env:
 *   - OPENAI_API_KEY (required for Whisper)
 *   - SLACK_BOT_TOKEN (required for `transcribeSlackVoiceFile`; the
 *     bot also needs the `files:read` scope)
 */

const WHISPER_MODEL = "whisper-1";
const WHISPER_LANG = "en";
const SLACK_FILES_INFO_URL = "https://slack.com/api/files.info";

export interface TranscriptionResult {
  ok: boolean;
  /** The transcript text (only populated when `ok=true`). */
  text?: string;
  /** Whisper-reported audio duration in seconds. */
  durationSeconds?: number;
  /** Error reason (only populated when `ok=false`). */
  error?: string;
  /** Source citation per `/contracts/governance.md` §1 #2. */
  source: { system: "openai-whisper" | "slack-files-api" | "no-source"; retrievedAt: string };
}

/**
 * POST audio bytes to Whisper. Defaults to `audio.m4a` filename
 * (Slack voice memos are M4A). Caller can override `filename` for
 * other formats.
 *
 * Returns a `TranscriptionResult` — never throws.
 */
export async function transcribeAudioBuffer(
  buffer: ArrayBuffer | Uint8Array,
  opts: { filename?: string; language?: string } = {},
): Promise<TranscriptionResult> {
  const retrievedAt = new Date().toISOString();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error: "OPENAI_API_KEY not configured — Whisper transcription unavailable",
      source: { system: "no-source", retrievedAt },
    };
  }
  const filename = opts.filename ?? "audio.m4a";
  const language = opts.language ?? WHISPER_LANG;

  // ArrayBuffer / Uint8Array → Blob. Uint8Array path makes a fresh
  // ArrayBuffer copy to avoid TS friction with potential SharedArrayBuffer.
  const blob =
    buffer instanceof Uint8Array
      ? new Blob([new Uint8Array(buffer)])
      : new Blob([buffer]);

  const form = new FormData();
  form.append("file", blob, filename);
  form.append("model", WHISPER_MODEL);
  form.append("language", language);

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    return {
      ok: false,
      error: `Whisper fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      source: { system: "openai-whisper", retrievedAt },
    };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      error: `Whisper HTTP ${res.status}: ${body.slice(0, 200)}`,
      source: { system: "openai-whisper", retrievedAt },
    };
  }
  let data: { text?: string; duration?: number };
  try {
    data = (await res.json()) as { text?: string; duration?: number };
  } catch (err) {
    return {
      ok: false,
      error: `Whisper returned non-JSON: ${err instanceof Error ? err.message : String(err)}`,
      source: { system: "openai-whisper", retrievedAt },
    };
  }
  const text = (data.text ?? "").trim();
  if (!text) {
    return {
      ok: false,
      error: "Whisper returned empty transcript",
      source: { system: "openai-whisper", retrievedAt },
    };
  }
  return {
    ok: true,
    text,
    durationSeconds: data.duration,
    source: { system: "openai-whisper", retrievedAt },
  };
}

/**
 * Fetch a Slack file's metadata + download URL, download the audio with
 * the bot token, and transcribe via Whisper.
 *
 * The bot needs the `files:read` scope on its OAuth token. Without
 * that scope, Slack `files.info` returns `missing_scope` — caller sees
 * a `TranscriptionResult { ok: false, error: "Slack files.info: missing_scope" }`.
 */
export async function transcribeSlackVoiceFile(
  slackFileId: string,
): Promise<TranscriptionResult> {
  const retrievedAt = new Date().toISOString();
  const slackToken = process.env.SLACK_BOT_TOKEN?.trim();
  if (!slackToken) {
    return {
      ok: false,
      error: "SLACK_BOT_TOKEN not configured — cannot fetch Slack voice file",
      source: { system: "no-source", retrievedAt },
    };
  }

  // 1. files.info — get the download URL
  let infoRes: Response;
  try {
    infoRes = await fetch(`${SLACK_FILES_INFO_URL}?file=${encodeURIComponent(slackFileId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${slackToken}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return {
      ok: false,
      error: `Slack files.info fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      source: { system: "slack-files-api", retrievedAt },
    };
  }
  if (!infoRes.ok) {
    return {
      ok: false,
      error: `Slack files.info HTTP ${infoRes.status}`,
      source: { system: "slack-files-api", retrievedAt },
    };
  }
  let info: {
    ok?: boolean;
    error?: string;
    file?: {
      id?: string;
      name?: string;
      mimetype?: string;
      url_private_download?: string;
    };
  };
  try {
    info = (await infoRes.json()) as typeof info;
  } catch (err) {
    return {
      ok: false,
      error: `Slack files.info returned non-JSON: ${err instanceof Error ? err.message : String(err)}`,
      source: { system: "slack-files-api", retrievedAt },
    };
  }
  if (!info.ok) {
    return {
      ok: false,
      error: `Slack files.info: ${info.error ?? "unknown error"}`,
      source: { system: "slack-files-api", retrievedAt },
    };
  }
  const url = info.file?.url_private_download;
  if (!url) {
    return {
      ok: false,
      error: "Slack files.info returned no url_private_download",
      source: { system: "slack-files-api", retrievedAt },
    };
  }

  // 2. download with bot auth
  let audioRes: Response;
  try {
    audioRes = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${slackToken}` },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    return {
      ok: false,
      error: `Slack file download failed: ${err instanceof Error ? err.message : String(err)}`,
      source: { system: "slack-files-api", retrievedAt },
    };
  }
  if (!audioRes.ok) {
    return {
      ok: false,
      error: `Slack file download HTTP ${audioRes.status}`,
      source: { system: "slack-files-api", retrievedAt },
    };
  }
  let audioBuffer: ArrayBuffer;
  try {
    audioBuffer = await audioRes.arrayBuffer();
  } catch (err) {
    return {
      ok: false,
      error: `Slack file body read failed: ${err instanceof Error ? err.message : String(err)}`,
      source: { system: "slack-files-api", retrievedAt },
    };
  }

  // 3. transcribe (delegates to Whisper helper)
  const filename = info.file?.name ?? "slack-voice.m4a";
  return transcribeAudioBuffer(audioBuffer, { filename });
}
