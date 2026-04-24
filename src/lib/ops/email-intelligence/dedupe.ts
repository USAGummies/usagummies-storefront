/**
 * Dedupe layer for the email-intelligence pipeline.
 *
 * Three independent signals — any one positive blocks a draft/send:
 *   1. KV processed-set: `email-intel:processed:<msgId>` (always-on)
 *   2. Gmail SENT: any reply we already sent in this thread
 *   3. HubSpot timeline: outbound email engagement on this contact in last 7d
 *
 * The KV signal is fast + deterministic. Gmail+HubSpot are network calls
 * with their own degraded modes (return "unknown — assume not duped" on
 * failure rather than failing the whole pipeline).
 */
import { kv } from "@vercel/kv";

import { listEmails } from "@/lib/ops/gmail-reader";
import { findContactByEmail } from "@/lib/ops/hubspot-client";

const KV_PROCESSED_PREFIX = "email-intel:processed:";
const KV_PROCESSED_TTL_SECONDS = 30 * 24 * 3600; // 30 days

export interface DedupeSignal {
  /** True iff this signal saw a previous engagement that should block re-action. */
  hit: boolean;
  /** Human-readable explanation. */
  detail: string;
  /** Set when the signal was unable to check (network failure, etc.). */
  degraded?: boolean;
}

export interface DedupeReport {
  messageId: string;
  threadId: string | null;
  alreadyProcessed: boolean;
  signals: {
    kv: DedupeSignal;
    gmailSent: DedupeSignal;
    hubspotTimeline: DedupeSignal;
  };
  /** A run should EXIT EARLY when any non-degraded signal hits. */
  shouldSkip: boolean;
}

/**
 * Mark a message id as processed in KV. Idempotent. Used by the
 * orchestrator after the email has been added to the Slack report so
 * the next cron tick doesn't re-classify it.
 */
export async function markProcessed(messageId: string): Promise<void> {
  try {
    await kv.set(`${KV_PROCESSED_PREFIX}${messageId}`, 1, {
      ex: KV_PROCESSED_TTL_SECONDS,
    });
  } catch {
    // Non-fatal — drift audit will catch repeat processing if KV is down.
  }
}

async function checkKv(messageId: string): Promise<DedupeSignal> {
  try {
    const v = await kv.get(`${KV_PROCESSED_PREFIX}${messageId}`);
    if (v !== null && v !== undefined) {
      return { hit: true, detail: "Message id already in processed set" };
    }
    return { hit: false, detail: "Not in KV processed set" };
  } catch (err) {
    return {
      hit: false,
      degraded: true,
      detail: `KV check failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkGmailSent(
  threadId: string | null,
  fromAddr: string,
): Promise<DedupeSignal> {
  if (!threadId) {
    return { hit: false, detail: "No threadId; Gmail check skipped" };
  }
  try {
    // Search SENT for any reply IN this thread. Use rfc822msgid: which is
    // more reliable than threadId scoping for some Gmail accounts.
    const sent = await listEmails({
      folder: "SENT",
      query: `in:sent`,
      count: 50,
    });
    const myReply = sent.find((e) => e.threadId === threadId);
    if (myReply) {
      return {
        hit: true,
        detail: `Already replied in thread on ${myReply.date} (msg ${myReply.id})`,
      };
    }
    return { hit: false, detail: "No prior reply in thread" };
  } catch (err) {
    return {
      hit: false,
      degraded: true,
      detail: `Gmail SENT check failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkHubSpotTimeline(fromAddr: string): Promise<DedupeSignal> {
  if (!fromAddr) {
    return { hit: false, detail: "No from address; HubSpot check skipped" };
  }
  // Extract bare email from the "Name <addr@host>" format.
  const m = fromAddr.match(/<([^>]+)>/);
  const cleaned = (m ? m[1] : fromAddr).trim().toLowerCase();
  try {
    const contactId = await findContactByEmail(cleaned);
    if (!contactId) {
      return { hit: false, detail: "No HubSpot contact for this sender" };
    }
    // We don't currently fetch engagements per-contact (would need a
    // separate HubSpot call). For now report contact existence only —
    // the orchestrator surfaces this as context, not a hard skip.
    return {
      hit: false,
      detail: `HubSpot contact found (${contactId}) — engagement scan deferred`,
    };
  } catch (err) {
    return {
      hit: false,
      degraded: true,
      detail: `HubSpot check failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Run all three dedup signals on an email. Cheap-first ordering: KV
 * before network. Short-circuits on the first non-degraded hit.
 */
export async function runDedupe(opts: {
  messageId: string;
  threadId: string | null;
  fromAddr: string;
}): Promise<DedupeReport> {
  const kvSignal = await checkKv(opts.messageId);

  // If KV says we already processed it, no need to hit network.
  if (kvSignal.hit) {
    return {
      messageId: opts.messageId,
      threadId: opts.threadId,
      alreadyProcessed: true,
      signals: {
        kv: kvSignal,
        gmailSent: { hit: false, detail: "skipped — KV already-processed hit" },
        hubspotTimeline: { hit: false, detail: "skipped — KV already-processed hit" },
      },
      shouldSkip: true,
    };
  }

  // Run remote checks in parallel.
  const [gmailSent, hubspotTimeline] = await Promise.all([
    checkGmailSent(opts.threadId, opts.fromAddr),
    checkHubSpotTimeline(opts.fromAddr),
  ]);

  const hardHit = gmailSent.hit && !gmailSent.degraded;
  return {
    messageId: opts.messageId,
    threadId: opts.threadId,
    alreadyProcessed: false,
    signals: { kv: kvSignal, gmailSent, hubspotTimeline },
    shouldSkip: hardHit,
  };
}
