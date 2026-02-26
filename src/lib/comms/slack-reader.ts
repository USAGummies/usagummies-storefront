/**
 * Slack Channel Reader — USA Gummies
 *
 * Reads message history from Slack channels using the Web API.
 * Requires a Slack App bot token with channels:history and channels:read scopes.
 *
 * Reads from ops-relevant channels: #ops-alerts, #ops-pipeline, #ops-daily
 *
 * Env var: SLACK_BOT_TOKEN
 */

import { readState, writeState } from "@/lib/ops/state";
import type { CacheEnvelope } from "@/lib/amazon/types";
import type { CommMessage } from "./types";

const SLACK_BOT_TOKEN = () => process.env.SLACK_BOT_TOKEN || "";
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export function isSlackConfigured(): boolean {
  return !!SLACK_BOT_TOKEN();
}

// ---------------------------------------------------------------------------
// Slack API helpers
// ---------------------------------------------------------------------------

type SlackMessage = {
  type: string;
  user?: string;
  text: string;
  ts: string;
  thread_ts?: string;
};

type SlackChannel = {
  id: string;
  name: string;
  is_member: boolean;
};

async function slackGet<T>(endpoint: string, params?: Record<string, string>): Promise<T | null> {
  const token = SLACK_BOT_TOKEN();
  if (!token) return null;

  const url = new URL(`https://slack.com/api/${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (!data.ok) {
      console.error(`[slack] API error for ${endpoint}:`, data.error);
      return null;
    }
    return data as T;
  } catch (err) {
    console.error(`[slack] Fetch failed for ${endpoint}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Channel listing
// ---------------------------------------------------------------------------

async function findOpsChannels(): Promise<SlackChannel[]> {
  const data = await slackGet<{
    channels: SlackChannel[];
  }>("conversations.list", {
    types: "public_channel,private_channel",
    limit: "200",
  });

  if (!data?.channels) return [];

  // Filter to ops-relevant channels
  const opsPatterns = ["ops-", "alerts", "pipeline", "daily", "general"];
  return data.channels.filter(
    (ch) =>
      ch.is_member &&
      opsPatterns.some((p) => ch.name.toLowerCase().includes(p)),
  );
}

// ---------------------------------------------------------------------------
// Message history
// ---------------------------------------------------------------------------

async function getChannelHistory(
  channelId: string,
  limit = 20,
): Promise<SlackMessage[]> {
  const data = await slackGet<{
    messages: SlackMessage[];
  }>("conversations.history", {
    channel: channelId,
    limit: String(limit),
  });

  return data?.messages || [];
}

// ---------------------------------------------------------------------------
// User name lookup (cached)
// ---------------------------------------------------------------------------

const _userCache = new Map<string, string>();

async function resolveUserName(userId: string): Promise<string> {
  if (_userCache.has(userId)) return _userCache.get(userId)!;

  const data = await slackGet<{
    user: { real_name?: string; name?: string };
  }>("users.info", { user: userId });

  const name = data?.user?.real_name || data?.user?.name || userId;
  _userCache.set(userId, name);
  return name;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchSlackMessages(limit = 30): Promise<CommMessage[]> {
  if (!isSlackConfigured()) return [];

  // Check cache
  const cached = await readState<CacheEnvelope<CommMessage[]> | null>(
    "slack-history-cache",
    null,
  );
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.data;
  }

  const channels = await findOpsChannels();
  if (channels.length === 0) return [];

  const allMessages: CommMessage[] = [];

  for (const channel of channels.slice(0, 5)) {
    const messages = await getChannelHistory(channel.id, 10);

    for (const msg of messages) {
      if (msg.type !== "message" || !msg.text) continue;

      const userName = msg.user ? await resolveUserName(msg.user) : "Bot";
      const ts = parseFloat(msg.ts);
      const date = new Date(ts * 1000).toISOString();

      allMessages.push({
        id: `slack-${channel.id}-${msg.ts}`,
        source: "slack",
        from: `${userName} (#${channel.name})`,
        subject: `#${channel.name}`,
        snippet: msg.text.slice(0, 200),
        date,
        read: true, // Slack messages are "read" by default in this context
        threadId: msg.thread_ts ? `slack-thread-${msg.thread_ts}` : undefined,
        priority: categorizeSlackPriority(msg.text, channel.name),
        category: categorizeSlackMessage(channel.name, msg.text),
      });
    }
  }

  // Sort by date descending, limit
  const sorted = allMessages
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);

  // Cache
  await writeState("slack-history-cache", { data: sorted, cachedAt: Date.now() });

  return sorted;
}

// ---------------------------------------------------------------------------
// Categorization helpers
// ---------------------------------------------------------------------------

function categorizeSlackPriority(text: string, channel: string): CommMessage["priority"] {
  const lower = text.toLowerCase();
  if (channel.includes("alert") || lower.includes("🔴") || lower.includes("critical")) {
    return "high";
  }
  if (lower.includes("⚠️") || lower.includes("warning")) return "high";
  return "normal";
}

function categorizeSlackMessage(channel: string, text: string): CommMessage["category"] {
  if (channel.includes("pipeline") || channel.includes("sales")) return "sales";
  if (channel.includes("alert")) return "operations";
  if (channel.includes("finance")) return "finance";
  const lower = text.toLowerCase();
  if (lower.includes("order") || lower.includes("customer")) return "support";
  return "operations";
}
