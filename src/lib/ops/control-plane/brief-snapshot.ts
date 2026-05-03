/**
 * Brief snapshot KV helpers — for the "vs yesterday" diff line.
 *
 * Closes audit finding CB#16 — every morning brief is a snapshot of
 * absolute values; without yesterday's reference, a constant
 * `2 stale buyers` line says nothing about whether things got better
 * or worse. This module captures today's key metrics into KV so
 * tomorrow's brief can compute the delta.
 *
 * Stored under `brief:snapshot:<YYYY-MM-DD>` with a 14-day TTL — long
 * enough to absorb a Vercel KV outage gap, short enough that we don't
 * accumulate noise. Only the metrics we render diff lines for —
 * never the full brief blocks.
 *
 * Fail-soft: KV miss/error returns null on read; KV failure on write
 * is silently swallowed (the diff is a nice-to-have, not load-bearing).
 */
import { kv } from "@vercel/kv";

const KEY_PREFIX = "brief:snapshot:";
const TTL_SECONDS = 14 * 24 * 3600;

export interface BriefSnapshot {
  date: string; // YYYY-MM-DD
  cashUsd: number | null;
  pendingApprovals: number;
  staleBuyers: number | null;
  sampleQueueAwaitingShip: number | null;
  sampleQueueShippedAwaitingResponse: number | null;
  capturedAt: string;
}

function key(date: string): string {
  return `${KEY_PREFIX}${date}`;
}

export async function saveBriefSnapshot(
  snapshot: BriefSnapshot,
): Promise<void> {
  try {
    await kv.set(key(snapshot.date), JSON.stringify(snapshot), {
      ex: TTL_SECONDS,
    });
  } catch {
    /* fail-soft */
  }
}

export async function loadBriefSnapshot(
  date: string,
): Promise<BriefSnapshot | null> {
  try {
    const raw = await kv.get(key(date));
    if (!raw) return null;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw) as BriefSnapshot;
      } catch {
        return null;
      }
    }
    if (typeof raw === "object") return raw as BriefSnapshot;
    return null;
  } catch {
    return null;
  }
}
