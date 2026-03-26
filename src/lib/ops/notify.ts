/**
 * Cloud-compatible notification system — Slack webhooks + optional Twilio SMS.
 *
 * Replaces iMessage (osascript) for Vercel-hosted agents.
 * Three Slack channels for different urgency levels, plus SMS for critical alerts.
 *
 * Channels:
 *   #ops-alerts    — System health, errors, self-heal events
 *   #ops-pipeline  — New prospects, interested replies, orders
 *   #ops-daily     — Daily digest (replaces iMessage daily report)
 *
 * Usage:
 *   import { notify, notifyAlert, notifyPipeline, notifyDaily } from "@/lib/ops/notify";
 *   await notifyAlert("🔴 Engine B2B failed: connection timeout");
 *   await notifyPipeline("🟢 New interested reply from Whole Foods");
 *   await notifyDaily(dailySummaryText);
 */

import { isCloud, readState, writeState } from "./state";
import { classifyNotification } from "@/lib/ops/operator/four-d-filter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotifyChannel = "alerts" | "pipeline" | "daily";

export type NotifyOpts = {
  channel: NotifyChannel;
  text: string;
  /** Optional Slack Block Kit payload */
  blocks?: unknown[];
  /** Notification metadata used by Four D filtering / gating */
  type?: string;
  target?: string;
  changed?: boolean;
  priority?: "critical" | "high" | "medium" | "low";
  /** Send SMS via Twilio as well (for critical alerts) */
  sms?: boolean;
  /** Phone numbers to SMS (defaults to Ben's numbers) */
  smsRecipients?: string[];
};

type NotificationGateState = {
  recent: Record<string, number[]>;
  deferred: Array<{
    channel: NotifyChannel;
    text: string;
    created_at: string;
    type: string;
  }>;
};

// ---------------------------------------------------------------------------
// Slack Bot Token + Channel ID (preferred — posts to specific channels)
// ---------------------------------------------------------------------------

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

// All channels route to #abra-control (C0ALS6W7VB4) — the only Slack channel that exists.
// When dedicated channels are created, update the env vars to split traffic.
const ABRA_CONTROL_CHANNEL = "C0ALS6W7VB4";
const SLACK_CHANNEL_ID_MAP: Record<NotifyChannel, string | undefined> = {
  alerts: process.env.SLACK_CHANNEL_ALERTS || ABRA_CONTROL_CHANNEL,
  pipeline: process.env.SLACK_CHANNEL_PIPELINE || ABRA_CONTROL_CHANNEL,
  daily: process.env.SLACK_CHANNEL_DAILY || ABRA_CONTROL_CHANNEL,
};

async function sendSlackBot(
  channelId: string,
  text: string,
  blocks?: unknown[],
): Promise<boolean> {
  if (!SLACK_BOT_TOKEN) return false;

  try {
    const payload: Record<string, unknown> = { channel: channelId, text };
    if (Array.isArray(blocks) && blocks.length > 0) {
      payload.blocks = blocks;
    }
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!data.ok) {
      console.error(`[notify] Slack Bot API error: ${data.error}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[notify] Slack Bot send failed:`, err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Slack Webhooks (fallback when no bot token or channel ID configured)
// ---------------------------------------------------------------------------

const SLACK_FALLBACK_WEBHOOK = process.env.SLACK_SUPPORT_WEBHOOK_URL;
const NOTIFICATION_GATE_KEY = "operator:notification_gate" as never;

const SLACK_WEBHOOK_MAP: Record<NotifyChannel, string | undefined> = {
  alerts: process.env.SLACK_WEBHOOK_ALERTS || SLACK_FALLBACK_WEBHOOK,
  pipeline: process.env.SLACK_WEBHOOK_PIPELINE || SLACK_FALLBACK_WEBHOOK,
  daily: process.env.SLACK_WEBHOOK_DAILY || SLACK_FALLBACK_WEBHOOK,
};

async function sendSlackWebhook(
  channel: NotifyChannel,
  text: string,
  blocks?: unknown[],
): Promise<boolean> {
  const webhookUrl = SLACK_WEBHOOK_MAP[channel];
  if (!webhookUrl) {
    console.warn(`[notify] No Slack webhook configured for channel: ${channel}`);
    return false;
  }

  // Prefix with channel tag when using fallback webhook so messages are distinguishable
  const isFallback = webhookUrl === SLACK_FALLBACK_WEBHOOK && SLACK_FALLBACK_WEBHOOK;
  const prefixedText = isFallback ? `[${channel.toUpperCase()}] ${text}` : text;

  try {
    const payload: Record<string, unknown> = { text: prefixedText };
    if (Array.isArray(blocks) && blocks.length > 0) {
      payload.blocks = blocks;
    }
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch (err) {
    console.error(`[notify] Slack webhook send failed (${channel}):`, err);
    return false;
  }
}

async function sendSlack(
  channel: NotifyChannel,
  text: string,
  blocks?: unknown[],
): Promise<boolean> {
  // Prefer Bot Token + channel ID (posts to the exact channel)
  const channelId = SLACK_CHANNEL_ID_MAP[channel];
  if (SLACK_BOT_TOKEN && channelId) {
    return sendSlackBot(channelId, text, blocks);
  }
  // Fall back to webhooks
  return sendSlackWebhook(channel, text, blocks);
}

async function passNotificationGate(
  opts: NotifyOpts,
): Promise<{ allow: boolean; deferred: boolean }> {
  const hasRoutingMetadata =
    typeof opts.type === "string" ||
    typeof opts.target === "string" ||
    typeof opts.priority === "string" ||
    typeof opts.changed === "boolean";
  if (!hasRoutingMetadata) {
    return { allow: true, deferred: false };
  }

  const priority = opts.priority || "medium";
  const type = opts.type || "generic";
  const target = opts.target || "team";
  const changed = opts.changed !== false;
  const decision = classifyNotification({
    type,
    content: opts.text,
    priority,
    target,
    changed,
  });

  if (decision === "delete") {
    return { allow: false, deferred: false };
  }

  const state = await readState<NotificationGateState>(NOTIFICATION_GATE_KEY, {
    recent: {},
    deferred: [],
  });
  const now = Date.now();
  const recent = Array.isArray(state.recent[opts.channel])
    ? state.recent[opts.channel].filter((ts) => now - ts < 60 * 60 * 1000)
    : [];
  state.recent[opts.channel] = recent;

  if (priority !== "critical" && recent.length >= 3) {
    state.deferred.push({
      channel: opts.channel,
      text: opts.text,
      created_at: new Date(now).toISOString(),
      type,
    });
    state.deferred = state.deferred.slice(-100);
    await writeState(NOTIFICATION_GATE_KEY, state);
    return { allow: false, deferred: true };
  }

  if (decision === "defer" && priority !== "critical") {
    state.deferred.push({
      channel: opts.channel,
      text: opts.text,
      created_at: new Date(now).toISOString(),
      type,
    });
    state.deferred = state.deferred.slice(-100);
    await writeState(NOTIFICATION_GATE_KEY, state);
    return { allow: false, deferred: true };
  }

  recent.push(now);
  state.recent[opts.channel] = recent.slice(-10);
  await writeState(NOTIFICATION_GATE_KEY, state);
  return { allow: true, deferred: false };
}

// ---------------------------------------------------------------------------
// Twilio SMS (optional — for critical alerts only)
// ---------------------------------------------------------------------------

const DEFAULT_SMS_RECIPIENTS = ["4358967765", "6102356973"];

async function sendSMS(text: string, recipients?: string[]): Promise<boolean> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.warn("[notify] Twilio not configured — skipping SMS");
    return false;
  }

  const phones = recipients ?? DEFAULT_SMS_RECIPIENTS;
  let allOk = true;

  for (const phone of phones) {
    const toNumber = phone.startsWith("+") ? phone : `+1${phone}`;
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const body = new URLSearchParams({
        To: toNumber,
        From: fromNumber,
        Body: text.slice(0, 1600), // SMS limit
      });

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        console.error(`[notify] Twilio SMS failed for ${toNumber}: ${res.status}`);
        allOk = false;
      }
    } catch (err) {
      console.error(`[notify] Twilio SMS error for ${toNumber}:`, err);
      allOk = false;
    }
  }

  return allOk;
}

// ---------------------------------------------------------------------------
// iMessage fallback (local only — same osascript approach)
// ---------------------------------------------------------------------------

async function sendIMessageLocal(text: string): Promise<boolean> {
  if (isCloud()) return false;

  try {
    const { execSync } = await import("node:child_process");
    const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const phones = DEFAULT_SMS_RECIPIENTS;

    for (const phone of phones) {
      const script = `
        tell application "Messages"
          set targetService to 1st account whose service type = iMessage
          set targetBuddy to participant "${phone}" of targetService
          send "${escaped}" to targetBuddy
        end tell
      `;
      execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    }
    return true;
  } catch (err) {
    console.error("[notify] iMessage fallback failed:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a notification. Tries Slack first, falls back to iMessage on laptop.
 * Optionally sends SMS for critical alerts.
 */
export async function notify(opts: NotifyOpts): Promise<{ slack: boolean; sms?: boolean; imessage?: boolean }> {
  const { channel, text, blocks, sms, smsRecipients } = opts;
  const result: { slack: boolean; sms?: boolean; imessage?: boolean } = { slack: false };
  const gate = await passNotificationGate(opts);
  if (!gate.allow) {
    return result;
  }

  // Try Slack first
  result.slack = await sendSlack(channel, text, blocks);

  // If Slack failed and we're on laptop, try iMessage
  if (!result.slack && !isCloud()) {
    result.imessage = await sendIMessageLocal(text);
  }

  // SMS for critical alerts
  if (sms) {
    result.sms = await sendSMS(text, smsRecipients);
  }

  return result;
}

/** Convenience: send to #ops-alerts */
export async function notifyAlert(text: string, sms = false) {
  return notify({ channel: "alerts", text, sms });
}

/** Convenience: send to #ops-pipeline */
export async function notifyPipeline(text: string) {
  return notify({ channel: "pipeline", text });
}

/** Convenience: send to #ops-daily */
export async function notifyDaily(text: string) {
  return notify({ channel: "daily", text });
}

/**
 * Send a notification to Ben specifically.
 * Cloud: Slack #ops-alerts + optional SMS.
 * Local: iMessage (preserves original behavior).
 */
export async function textBen(message: string): Promise<boolean> {
  if (isCloud()) {
    const result = await notifyAlert(message, /* sms */ true);
    return result.slack || result.sms || false;
  }
  return sendIMessageLocal(message);
}
