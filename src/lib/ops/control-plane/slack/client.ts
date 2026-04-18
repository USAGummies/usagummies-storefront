/**
 * Slack Web API client — minimal. Used by the 3.0 control-plane surfaces.
 *
 * Scope: chat.postMessage + chat.update + chat.postEphemeral.
 * Zero imports from legacy abra-* modules.
 *
 * Environment:
 *   SLACK_BOT_TOKEN — xoxb-… token for the 3.0 ops bot (separate Slack
 *   app from the now-deactivated Paperclip bot; Ben provisions before
 *   Monday per /ops/blocked-items.md).
 *
 * Degraded mode (per /contracts/governance.md §1 non-negotiable #6):
 * if the token is missing, every method returns an error envelope and
 * logs — it does NOT throw. Callers treat Slack as a best-effort mirror;
 * the approval store and audit store are authoritative.
 */

export interface SlackResult {
  ok: boolean;
  channel?: string;
  ts?: string;
  error?: string;
  /**
   * True iff no call was made (env missing). Differentiated from
   * Slack-side errors so the control plane can track degraded state.
   */
  degraded?: boolean;
}

interface PostMessageParams {
  channel: string; // `#name` or `C123...` id
  text: string; // fallback text for notifications
  blocks?: unknown[];
  threadTs?: string;
}

interface UpdateMessageParams {
  channel: string;
  ts: string;
  text: string;
  blocks?: unknown[];
}

function token(): string | null {
  const t = process.env.SLACK_BOT_TOKEN?.trim();
  return t && t.length > 0 ? t : null;
}

async function call(
  method: "chat.postMessage" | "chat.update" | "chat.postEphemeral",
  body: Record<string, unknown>,
): Promise<SlackResult> {
  const bot = token();
  if (!bot) {
    return { ok: false, degraded: true, error: "SLACK_BOT_TOKEN not configured (degraded mode)" };
  }
  try {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bot}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as SlackResult;
    if (!json.ok) {
      return { ok: false, error: json.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, channel: json.channel, ts: json.ts };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown slack error",
    };
  }
}

export async function postMessage(params: PostMessageParams): Promise<SlackResult> {
  return call("chat.postMessage", {
    channel: params.channel,
    text: params.text,
    blocks: params.blocks,
    thread_ts: params.threadTs,
  });
}

export async function updateMessage(params: UpdateMessageParams): Promise<SlackResult> {
  return call("chat.update", {
    channel: params.channel,
    ts: params.ts,
    text: params.text,
    blocks: params.blocks,
  });
}

/**
 * Slack signing-secret verification for inbound interactive payloads.
 * Callers: src/app/api/slack/approvals/route.ts.
 *
 * The signature scheme is `v0:timestamp:rawBody` → HMAC-SHA256 with the
 * Slack signing secret → hex → prefix `v0=`.
 */
export async function verifySlackSignature(params: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  maxAgeSeconds?: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const secret = process.env.SLACK_SIGNING_SECRET?.trim();
  if (!secret) {
    return { ok: false, reason: "SLACK_SIGNING_SECRET not configured" };
  }
  if (!params.timestamp || !params.signature) {
    return { ok: false, reason: "missing timestamp or signature header" };
  }
  const maxAge = params.maxAgeSeconds ?? 300;
  const tsNum = Number.parseInt(params.timestamp, 10);
  if (!Number.isFinite(tsNum)) return { ok: false, reason: "invalid timestamp" };
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > maxAge) {
    return { ok: false, reason: "timestamp outside tolerance window" };
  }
  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const basestring = `v0:${params.timestamp}:${params.rawBody}`;
  const expected = `v0=${createHmac("sha256", secret).update(basestring).digest("hex")}`;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(params.signature, "utf8");
  if (a.length !== b.length) return { ok: false, reason: "length mismatch" };
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "hmac mismatch" };
}

/**
 * Resolve a Slack user id (`U123…`) back to a HumanOwner ("Ben" | "Rene" | "Drew").
 *
 * Configuration: set `SLACK_USER_BEN`, `SLACK_USER_RENE`, `SLACK_USER_DREW`
 * in the environment to the Slack user id for each person. If not set,
 * falls back to the paperclip-era hardcoded ids so existing workspaces keep
 * working; Ben can override per workspace.
 */
export function slackUserIdToHumanOwner(
  userId: string,
): "Ben" | "Rene" | "Drew" | null {
  const table: Record<string, "Ben" | "Rene" | "Drew"> = {
    [process.env.SLACK_USER_BEN ?? "U08JY86Q508"]: "Ben",
    [process.env.SLACK_USER_RENE ?? "U0ALL27JM38"]: "Rene",
    [process.env.SLACK_USER_DREW ?? "U08J3S3GC3G"]: "Drew",
  };
  return table[userId] ?? null;
}
