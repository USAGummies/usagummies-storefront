/**
 * Slack Web API client — minimal. Used by the 3.0 control-plane surfaces.
 *
 * Scope: chat.postMessage + chat.update + chat.postEphemeral + chat.getPermalink.
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

// ---- conversations.history (read-side) ---------------------------------

export interface SlackHistoryMessage {
  /** Slack user id of the poster (absent for system messages / bot posts with `bot_id` only). */
  user?: string;
  /** Message text (may contain mrkdwn). */
  text: string;
  /** Epoch-seconds-with-fractional-suffix timestamp and permalink anchor. */
  ts: string;
  /** Present if the message is inside a thread; parent ts. */
  thread_ts?: string;
  /** Subtype e.g. "bot_message"; omitted for regular user messages. */
  subtype?: string;
}

export interface SlackHistoryResult {
  ok: boolean;
  messages?: SlackHistoryMessage[];
  /** True iff the channel has older messages past the current page. */
  has_more?: boolean;
  /** Cursor token for the next page (pass back as `cursor` param). */
  next_cursor?: string;
  error?: string;
  degraded?: boolean;
}

/**
 * Read recent messages from a channel. Used by Viktor W-5 (Rene response
 * capture) to scan #finance for decision-queue responses matching the
 * decision-id regex per /contracts/agents/viktor-rene-capture.md.
 *
 * Auth: SLACK_BOT_TOKEN with `channels:history` scope (public channels)
 * and/or `groups:history` (private channels). If the token is missing,
 * returns `{ ok: false, degraded: true }` — per §6 degraded-mode rule.
 */
export async function conversationsHistory(params: {
  /** Channel id (e.g. "C0ATF50QQ1M" for #finance). */
  channel: string;
  /** Lower-bound Slack ts ("start of window") — inclusive. Optional. */
  oldest?: string;
  /** Upper-bound Slack ts ("end of window") — inclusive. Optional. */
  latest?: string;
  /** Max messages per page (Slack cap 999; default 100). */
  limit?: number;
  /** Pagination cursor from a prior call's `next_cursor`. */
  cursor?: string;
}): Promise<SlackHistoryResult> {
  const bot = token();
  if (!bot) {
    return { ok: false, degraded: true, error: "SLACK_BOT_TOKEN not configured (degraded mode)" };
  }
  try {
    const qs = new URLSearchParams({ channel: params.channel });
    if (params.oldest) qs.set("oldest", params.oldest);
    if (params.latest) qs.set("latest", params.latest);
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.cursor) qs.set("cursor", params.cursor);
    const res = await fetch(`https://slack.com/api/conversations.history?${qs.toString()}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bot}`,
      },
    });
    const json = (await res.json()) as SlackHistoryResult & { response_metadata?: { next_cursor?: string } };
    if (!json.ok) {
      return { ok: false, error: json.error ?? `HTTP ${res.status}` };
    }
    return {
      ok: true,
      messages: json.messages ?? [],
      has_more: json.has_more,
      next_cursor: json.response_metadata?.next_cursor,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown slack error",
    };
  }
}

/**
 * Resolve a `#channel-name` (or already-`Cxxxx` id) to a channel id and
 * call `conversations.join` on it. Used to auto-recover from
 * `not_in_channel` errors — bots can join any public channel without an
 * invite. Private channels still require manual `/invite`.
 *
 * Returns `{ ok: true }` when the bot is now a member (whether it just
 * joined or was already in the channel). Returns `{ ok: false }` for
 * unrecoverable cases (bot lacks `channels:join` scope, channel is
 * private and bot was never invited, channel doesn't exist).
 */
export async function joinChannel(channel: string): Promise<SlackResult> {
  const bot = token();
  if (!bot) {
    return { ok: false, degraded: true, error: "SLACK_BOT_TOKEN not configured (degraded mode)" };
  }
  // `conversations.join` accepts a channel id, not a #name string.
  // If the caller passed a name (or a `#name` string), resolve it first
  // via conversations.list. Slack's API rejects `#name` directly here.
  let channelId = channel.startsWith("#")
    ? channel.slice(1)
    : channel;
  if (!channelId.match(/^C[A-Z0-9]+$/)) {
    const resolved = await resolveChannelIdByName(channelId);
    if (!resolved.ok || !resolved.id) {
      return {
        ok: false,
        error: `joinChannel: could not resolve channel name "${channel}"${resolved.error ? ` (${resolved.error})` : ""}`,
      };
    }
    channelId = resolved.id;
  }
  try {
    const res = await fetch("https://slack.com/api/conversations.join", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bot}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel: channelId }),
    });
    const json = (await res.json()) as SlackResult;
    if (!json.ok) {
      return { ok: false, error: json.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, channel: channelId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown slack error",
    };
  }
}

async function resolveChannelIdByName(name: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const bot = token();
  if (!bot) return { ok: false, error: "no token" };
  // Page through public + private channels. We expect <500 channels, so
  // a single page (limit=200) plus 1-2 follow-ups handles the workspace.
  let cursor = "";
  for (let page = 0; page < 5; page++) {
    const qs = new URLSearchParams({
      types: "public_channel,private_channel",
      limit: "200",
      exclude_archived: "true",
    });
    if (cursor) qs.set("cursor", cursor);
    try {
      const res = await fetch(
        `https://slack.com/api/conversations.list?${qs.toString()}`,
        { headers: { Authorization: `Bearer ${bot}` } },
      );
      const json = (await res.json()) as {
        ok: boolean;
        channels?: Array<{ id: string; name: string }>;
        response_metadata?: { next_cursor?: string };
        error?: string;
      };
      if (!json.ok) return { ok: false, error: json.error ?? "conversations.list failed" };
      const match = (json.channels ?? []).find((c) => c.name === name);
      if (match) return { ok: true, id: match.id };
      cursor = json.response_metadata?.next_cursor ?? "";
      if (!cursor) break;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "list error" };
    }
  }
  return { ok: false, error: "channel not found" };
}

export async function postMessage(params: PostMessageParams): Promise<SlackResult> {
  const result = await call("chat.postMessage", {
    channel: params.channel,
    text: params.text,
    blocks: params.blocks,
    thread_ts: params.threadTs,
  });
  // Auto-recover on `not_in_channel`: join the channel and retry once.
  // Killed the second class of #ops-alerts file-upload-failure noise
  // (the first class — `missing_scope` — is deduped to 1×/day in
  // /api/ops/shipping/auto-ship/route.ts per Cut D).
  if (
    !result.ok &&
    !result.degraded &&
    result.error === "not_in_channel"
  ) {
    const join = await joinChannel(params.channel);
    if (join.ok) {
      return call("chat.postMessage", {
        channel: params.channel,
        text: params.text,
        blocks: params.blocks,
        thread_ts: params.threadTs,
      });
    }
    return {
      ok: false,
      error: `not_in_channel + auto-join failed: ${join.error ?? "unknown"}`,
    };
  }
  return result;
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

// ---- chat.getPermalink (read-side, Phase 12) ---------------------------
//
// Read-only — never posts, never updates, never deletes. Used by the
// promote-review route to deep-link the green pill on /ops/finance/review
// to the approval's #ops-approvals thread. Returns `null` when the bot
// token is missing (degraded), when the channel/ts pair is empty, or
// when Slack itself rejects the lookup.

interface GetPermalinkParams {
  /** Slack channel id (e.g. `C0123…`). The control-plane stores
   *  `slackThread.channel` on `ApprovalRequest`. */
  channel: string;
  /** Slack message ts. */
  message_ts: string;
}

/**
 * Resolve a Slack message permalink. Defensive — returns `null` on
 * any failure; never throws. Caller decides how to surface the gap
 * (the pill renderer falls back to the plain approval id).
 */
export async function getPermalink(
  params: GetPermalinkParams,
): Promise<string | null> {
  const bot = token();
  if (!bot) return null;
  const ch = params.channel?.trim();
  const ts = params.message_ts?.trim();
  if (!ch || !ts) return null;
  try {
    const url =
      `https://slack.com/api/chat.getPermalink` +
      `?channel=${encodeURIComponent(ch)}` +
      `&message_ts=${encodeURIComponent(ts)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${bot}` },
    });
    const json = (await res.json()) as {
      ok: boolean;
      permalink?: string;
      error?: string;
    };
    if (!json.ok) return null;
    return typeof json.permalink === "string" && json.permalink.length > 0
      ? json.permalink
      : null;
  } catch {
    return null;
  }
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
