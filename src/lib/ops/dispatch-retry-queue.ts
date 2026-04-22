/**
 * Dispatch Retry Queue — catch-all for S-08 dispatch failures.
 *
 * When a webhook/route successfully classifies an OrderIntent but
 * the downstream Slack post (to #ops-approvals) fails due to a
 * transient outage, we don't want the dispatch to silently vanish.
 * Instead we enqueue it to a bounded KV list; a retry cron walks
 * the queue every 30 min and reposts.
 *
 * Also used by buy-label for labels that raced past createlabel
 * but couldn't write back to the fulfillment stage map — retry
 * can drain those idempotently.
 *
 * Pure helpers — callers own the KV shape.
 */

import { kv } from "@vercel/kv";

import type {
  DispatchClassification,
  OrderIntent,
  ShipmentProposal,
} from "./sample-order-dispatch";

export const KV_DISPATCH_RETRY_QUEUE = "fulfillment:dispatch-retry-queue";
const MAX_QUEUE_SIZE = 200;
const MAX_ATTEMPTS = 5;

export interface DispatchRetryEntry {
  enqueuedAt: string;
  reason: string;
  intent: OrderIntent;
  classification: DispatchClassification;
  proposal: ShipmentProposal;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  status: "pending" | "posted" | "exhausted";
  postedTs?: string;
  postedTo?: string;
}

export async function readRetryQueue(): Promise<DispatchRetryEntry[]> {
  const queue =
    ((await kv.get<DispatchRetryEntry[]>(KV_DISPATCH_RETRY_QUEUE)) ??
      []) as DispatchRetryEntry[];
  return queue;
}

async function writeRetryQueue(
  entries: DispatchRetryEntry[],
): Promise<void> {
  // Newest-first, cap at MAX_QUEUE_SIZE.
  await kv.set(KV_DISPATCH_RETRY_QUEUE, entries.slice(0, MAX_QUEUE_SIZE));
}

export async function enqueueRetry(params: {
  reason: string;
  intent: OrderIntent;
  classification: DispatchClassification;
  proposal: ShipmentProposal;
}): Promise<DispatchRetryEntry> {
  const entry: DispatchRetryEntry = {
    enqueuedAt: new Date().toISOString(),
    reason: params.reason,
    intent: params.intent,
    classification: params.classification,
    proposal: params.proposal,
    attempts: 0,
    status: "pending",
  };
  const queue = await readRetryQueue();
  // Dedupe by sourceId+channel — if the same intent is already queued,
  // bump its reason/timestamp rather than inserting a duplicate.
  const dupIdx = queue.findIndex(
    (e) =>
      e.intent.channel === entry.intent.channel &&
      e.intent.sourceId === entry.intent.sourceId &&
      e.status === "pending",
  );
  if (dupIdx >= 0) {
    const existing = queue[dupIdx];
    existing.reason = params.reason;
    existing.enqueuedAt = entry.enqueuedAt;
    queue[dupIdx] = existing;
    await writeRetryQueue(queue);
    return existing;
  }
  queue.unshift(entry);
  await writeRetryQueue(queue);
  return entry;
}

export interface RetryResult {
  entry: DispatchRetryEntry;
  attempted: boolean;
  posted: boolean;
  error?: string;
}

/**
 * Walk the queue, retry each pending entry via the supplied post
 * function. Updates entries in place: `attempts++`, marks `posted`
 * when successful, marks `exhausted` when attempts ≥ MAX_ATTEMPTS.
 */
export async function drainRetryQueue(
  postFn: (
    entry: DispatchRetryEntry,
  ) => Promise<{ ok: boolean; ts?: string; channel?: string; error?: string }>,
): Promise<RetryResult[]> {
  const queue = await readRetryQueue();
  const results: RetryResult[] = [];
  const now = new Date().toISOString();
  for (const entry of queue) {
    if (entry.status !== "pending") {
      results.push({ entry, attempted: false, posted: false });
      continue;
    }
    if (entry.attempts >= MAX_ATTEMPTS) {
      entry.status = "exhausted";
      results.push({ entry, attempted: false, posted: false });
      continue;
    }
    entry.attempts += 1;
    entry.lastAttemptAt = now;
    try {
      const r = await postFn(entry);
      if (r.ok) {
        entry.status = "posted";
        entry.postedTs = r.ts;
        entry.postedTo = r.channel;
        entry.lastError = undefined;
        results.push({ entry, attempted: true, posted: true });
      } else {
        entry.lastError = r.error ?? "post failed without error";
        if (entry.attempts >= MAX_ATTEMPTS) {
          entry.status = "exhausted";
        }
        results.push({ entry, attempted: true, posted: false, error: entry.lastError });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      entry.lastError = msg;
      if (entry.attempts >= MAX_ATTEMPTS) {
        entry.status = "exhausted";
      }
      results.push({ entry, attempted: true, posted: false, error: msg });
    }
  }
  await writeRetryQueue(queue);
  return results;
}

export async function pendingRetryCount(): Promise<number> {
  const queue = await readRetryQueue();
  return queue.filter((e) => e.status === "pending").length;
}

export async function exhaustedRetryCount(): Promise<number> {
  const queue = await readRetryQueue();
  return queue.filter((e) => e.status === "exhausted").length;
}
