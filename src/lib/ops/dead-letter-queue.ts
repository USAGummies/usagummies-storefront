/**
 * Dead Letter Recovery Queue — captures failed agent work items and retries
 * them with exponential backoff.
 *
 * Failed agents are enqueued automatically by engine-runner.ts. The queue
 * is persisted in KV state and processed every 30 minutes by the ABRA13
 * internal agent.
 *
 * Backoff schedule: 5 min, 15 min, 45 min (max 3 retries).
 */

import { readState, writeState } from "@/lib/ops/state";
import { notify } from "@/lib/ops/notify";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeadLetterItem = {
  id: string;
  engineId: string;
  agentKey: string;
  agentName: string;
  failedAt: string;
  errorMessage: string;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: string | null;
  status: "pending" | "retrying" | "recovered" | "abandoned";
  metadata?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_KEY = "dead-letter-queue" as const;
const DEFAULT_MAX_RETRIES = 3;

/** Backoff intervals in milliseconds: 5 min, 15 min, 45 min */
const BACKOFF_MS = [5 * 60_000, 15 * 60_000, 45 * 60_000];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `dlq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function calculateNextRetry(retryCount: number): string | null {
  if (retryCount >= DEFAULT_MAX_RETRIES) return null;
  const delayMs = BACKOFF_MS[retryCount] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
  return new Date(Date.now() + delayMs).toISOString();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add a failed agent to the dead letter queue.
 * Auto-calculates next retry with exponential backoff.
 */
export async function enqueueFailedAgent(
  item: Omit<DeadLetterItem, "id" | "retryCount" | "status" | "nextRetryAt">,
): Promise<string> {
  const queue = await readState(STATE_KEY, [] as DeadLetterItem[]);

  const id = generateId();
  const newItem: DeadLetterItem = {
    ...item,
    id,
    retryCount: 0,
    maxRetries: item.maxRetries || DEFAULT_MAX_RETRIES,
    status: "pending",
    nextRetryAt: calculateNextRetry(0),
  };

  queue.push(newItem);

  // Cap queue at 500 items — drop oldest abandoned/recovered first
  if (queue.length > 500) {
    queue.sort((a, b) => {
      const priority = { abandoned: 0, recovered: 1, pending: 2, retrying: 3 };
      return (priority[a.status] ?? 2) - (priority[b.status] ?? 2);
    });
    queue.splice(0, queue.length - 500);
  }

  await writeState(STATE_KEY, queue);

  console.log(
    `[dead-letter] Enqueued ${item.agentName} (${item.engineId}/${item.agentKey}): ${item.errorMessage.slice(0, 120)}`,
  );

  return id;
}

/**
 * Get all items in the dead letter queue.
 */
export async function getDeadLetterQueue(): Promise<DeadLetterItem[]> {
  return readState(STATE_KEY, [] as DeadLetterItem[]);
}

/**
 * Get items that are due for retry (nextRetryAt <= now).
 */
export async function getPendingRetries(): Promise<DeadLetterItem[]> {
  const queue = await getDeadLetterQueue();
  const now = new Date().toISOString();

  return queue.filter(
    (item) =>
      item.status === "pending" &&
      item.nextRetryAt !== null &&
      item.nextRetryAt <= now,
  );
}

/**
 * Process all pending retries. Calls runAgent() for each item due,
 * updates status, and sends Slack notifications on recovery.
 */
export async function processRetries(): Promise<{
  retried: number;
  recovered: number;
  abandoned: number;
}> {
  const pending = await getPendingRetries();
  const stats = { retried: 0, recovered: 0, abandoned: 0 };

  if (pending.length === 0) return stats;

  // Lazy import to break circular dependency with engine-runner
  const { runAgent } = await import("@/lib/ops/engine-runner");

  const queue = await getDeadLetterQueue();
  const queueMap = new Map(queue.map((item) => [item.id, item]));

  for (const item of pending) {
    const current = queueMap.get(item.id);
    if (!current) continue;

    stats.retried++;
    current.status = "retrying";
    current.retryCount++;

    try {
      const result = await runAgent(current.engineId, current.agentKey);

      if (result.status === "success") {
        current.status = "recovered";
        current.nextRetryAt = null;
        stats.recovered++;

        // Notify on recovery
        await notify({
          channel: "alerts",
          text: `[DLQ] Recovered: ${current.agentName} (${current.engineId}/${current.agentKey}) after ${current.retryCount} retries`,
        }).catch(() => {});
      } else {
        // Still failing
        if (current.retryCount >= current.maxRetries) {
          current.status = "abandoned";
          current.nextRetryAt = null;
          stats.abandoned++;

          await notify({
            channel: "alerts",
            text: `[DLQ] Abandoned: ${current.agentName} (${current.engineId}/${current.agentKey}) — exhausted ${current.maxRetries} retries. Last error: ${result.summary.slice(0, 150)}`,
          }).catch(() => {});
        } else {
          current.status = "pending";
          current.nextRetryAt = calculateNextRetry(current.retryCount);
          current.errorMessage = result.summary.slice(0, 500);
        }
      }
    } catch (err) {
      // Retry runner itself failed
      if (current.retryCount >= current.maxRetries) {
        current.status = "abandoned";
        current.nextRetryAt = null;
        stats.abandoned++;
      } else {
        current.status = "pending";
        current.nextRetryAt = calculateNextRetry(current.retryCount);
        current.errorMessage =
          err instanceof Error ? err.message : String(err);
      }
    }
  }

  // Write updated queue
  const updatedQueue = Array.from(queueMap.values());
  await writeState(STATE_KEY, updatedQueue);

  if (stats.retried > 0) {
    console.log(
      `[dead-letter] Processed ${stats.retried} retries: ${stats.recovered} recovered, ${stats.abandoned} abandoned`,
    );
  }

  return stats;
}

/**
 * Mark a specific item as abandoned (manual override).
 */
export async function abandonItem(id: string): Promise<void> {
  const queue = await getDeadLetterQueue();
  const item = queue.find((i) => i.id === id);
  if (!item) return;

  item.status = "abandoned";
  item.nextRetryAt = null;
  await writeState(STATE_KEY, queue);
}

/**
 * Remove recovered items older than 7 days.
 * Returns the number of items cleared.
 */
export async function clearRecovered(): Promise<number> {
  const queue = await getDeadLetterQueue();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const before = queue.length;
  const filtered = queue.filter(
    (item) =>
      !(item.status === "recovered" && item.failedAt < sevenDaysAgo),
  );

  if (filtered.length < before) {
    await writeState(STATE_KEY, filtered);
  }

  return before - filtered.length;
}
