/**
 * Brief diff renderer — pure function. Computes "vs yesterday"
 * delta strings for the morning brief.
 *
 * Hard rules:
 *   • Returns null when yesterday is missing or every diff is zero
 *     (no change → no line, the brief stays clean on quiet days).
 *   • Each cell renders ONLY when both today's and yesterday's value
 *     are non-null. A null on either side suppresses that bullet —
 *     no fabrication, no ambiguous "vs N/A" lines.
 *   • Cash deltas show only when the magnitude is >= $5 (filters out
 *     micro-fluctuations from float-rounding cash positions).
 *   • Count deltas (approvals, stale buyers, samples) show even at +/-1
 *     because every count change is a real signal in this system.
 */
import type { BriefSnapshot } from "./brief-snapshot";

export interface BriefDiffInput {
  today: Pick<BriefSnapshot, "cashUsd" | "pendingApprovals" | "staleBuyers" | "sampleQueueAwaitingShip" | "sampleQueueShippedAwaitingResponse">;
  yesterday: BriefSnapshot;
}

const CASH_DIFF_FLOOR_USD = 5;

function fmtCash(diff: number): string {
  const abs = Math.abs(diff).toFixed(2);
  return diff >= 0 ? `+$${abs}` : `-$${abs}`;
}

function fmtCount(diff: number): string {
  return diff >= 0 ? `+${diff}` : `${diff}`;
}

function pluralize(n: number, singular: string, plural?: string): string {
  return Math.abs(n) === 1 ? singular : plural ?? `${singular}s`;
}

/**
 * Compute the diff line. Returns the markdown string, or null when
 * there's nothing meaningful to show.
 */
export function renderBriefDiffLine(input: BriefDiffInput): string | null {
  const { today, yesterday } = input;
  const bullets: string[] = [];

  // Cash delta — only when both sides non-null AND magnitude >= floor.
  if (today.cashUsd !== null && yesterday.cashUsd !== null) {
    const diff =
      Math.round((today.cashUsd - yesterday.cashUsd) * 100) / 100;
    if (Math.abs(diff) >= CASH_DIFF_FLOOR_USD) {
      bullets.push(`${fmtCash(diff)} cash`);
    }
  }

  // Pending approvals — both sides are number (never null).
  const apprDiff = today.pendingApprovals - yesterday.pendingApprovals;
  if (apprDiff !== 0) {
    bullets.push(
      `${fmtCount(apprDiff)} ${pluralize(apprDiff, "approval")}`,
    );
  }

  // Stale buyers — null when staleBuyers slice was unavailable.
  if (today.staleBuyers !== null && yesterday.staleBuyers !== null) {
    const d = today.staleBuyers - yesterday.staleBuyers;
    if (d !== 0) {
      bullets.push(`${fmtCount(d)} stale ${pluralize(d, "buyer")}`);
    }
  }

  // Sample queue — awaiting ship.
  if (
    today.sampleQueueAwaitingShip !== null &&
    yesterday.sampleQueueAwaitingShip !== null
  ) {
    const d =
      today.sampleQueueAwaitingShip - yesterday.sampleQueueAwaitingShip;
    if (d !== 0) {
      bullets.push(
        `${fmtCount(d)} sample${Math.abs(d) === 1 ? "" : "s"} awaiting ship`,
      );
    }
  }

  // Sample queue — shipped awaiting buyer response.
  if (
    today.sampleQueueShippedAwaitingResponse !== null &&
    yesterday.sampleQueueShippedAwaitingResponse !== null
  ) {
    const d =
      today.sampleQueueShippedAwaitingResponse -
      yesterday.sampleQueueShippedAwaitingResponse;
    if (d !== 0) {
      bullets.push(
        `${fmtCount(d)} sample${Math.abs(d) === 1 ? "" : "s"} awaiting reply`,
      );
    }
  }

  if (bullets.length === 0) return null;

  return `_vs ${yesterday.date}:_ ${bullets.join(" · ")}`;
}
