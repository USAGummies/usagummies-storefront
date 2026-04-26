/**
 * Phase 3.2 — Faire Direct follow-up eligibility helpers (READ-ONLY).
 *
 * What this module is
 * -------------------
 * Pure functions that turn a list of `FaireInviteRecord`s into a
 * grouped follow-up queue: which sent invites have been sitting long
 * enough to deserve a nudge, and which haven't.
 *
 * What this module is NOT
 * -----------------------
 *   - It does NOT send a follow-up email. Phase 3.2 is observational —
 *     the closer that auto-sends follow-ups (Class B
 *     `faire-direct.follow-up`) is a future build.
 *   - It does NOT mutate any record. No KV write, no fetch, no
 *     network call. The only inputs are `FaireInviteRecord`s and
 *     `now`. The only outputs are immutable grouping + reasons.
 *   - It does NOT change HubSpot lifecycle stages, custom properties,
 *     or deals. The retailer's CRM record is read-only from this path.
 *
 * Hard rules locked by tests:
 *   - A `sent` record with `sentAt` older than 7 days and no
 *     `followUpQueuedAt` → `overdue`.
 *   - A `sent` record with `sentAt` older than 3 days (but newer than
 *     7) and no `followUpQueuedAt` → `due_soon`.
 *   - A `sent` record younger than 3 days → `not_due` with
 *     `code: "fresh"`.
 *   - A `sent` record where `followUpQueuedAt` is set → `not_due` with
 *     `code: "follow_up_queued"`.
 *   - A `sent` record with no `sentAt` (data-integrity edge case) →
 *     `not_due` with `code: "missing_sent_at"`.
 *   - Any non-sent record (`needs_review`, `approved`, `rejected`) →
 *     `not_due` with `code: "wrong_status"`.
 */
import type { FaireInviteRecord } from "./invites";

const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_SOON_DAYS = 3;
const OVERDUE_DAYS = 7;

export type FollowUpBucket = "overdue" | "due_soon" | "not_due";

export type FollowUpReasonCode =
  | "overdue"
  | "due_soon"
  | "fresh" // sent < 3 days ago
  | "follow_up_queued" // a follow-up has already been queued/sent
  | "missing_sent_at" // status="sent" but no sentAt timestamp
  | "wrong_status"; // not in the "sent" bucket

export interface FollowUpReason {
  code: FollowUpReasonCode;
  detail: string;
}

export interface FollowUpClassification {
  record: FaireInviteRecord;
  bucket: FollowUpBucket;
  reason: FollowUpReason;
  /**
   * Whole-number days since `sentAt`. Null when sentAt is missing or
   * unparseable, or when the record was never sent.
   */
  daysSinceSent: number | null;
}

export interface FollowUpReport {
  /** Total records considered. */
  total: number;
  overdue: FollowUpClassification[];
  due_soon: FollowUpClassification[];
  not_due: FollowUpClassification[];
}

/**
 * Suggested copy the operator can paste into a manual follow-up. The
 * string is intentionally generic — it does NOT promise pricing,
 * shipping timelines, or product effects. Operator edits before
 * sending if needed.
 */
export function suggestNextActionCopy(
  record: FaireInviteRecord,
  daysSinceSent: number,
): string {
  const buyer =
    record.buyerName?.trim() && record.buyerName.trim().length > 0
      ? record.buyerName.trim()
      : record.retailerName.trim();
  const noun = daysSinceSent >= OVERDUE_DAYS ? "overdue" : "ready";
  return [
    `Manual follow-up ${noun} for ${record.retailerName}.`,
    `Suggested message to ${buyer} (${record.email}): a short check-in reply on the original Faire Direct invite thread, asking whether they had a chance to look at the brand portal link and whether they'd like a quick call to walk through pricing.`,
    `Do NOT promise terms, lead times, or product effects in the follow-up.`,
  ].join("\n");
}

/**
 * Classify a single record. Pure. `now` defaults to the current time;
 * tests pass it explicitly so they're deterministic.
 */
export function classifyForFollowUp(
  record: FaireInviteRecord,
  now: Date = new Date(),
): FollowUpClassification {
  if (record.status !== "sent") {
    return {
      record,
      bucket: "not_due",
      reason: {
        code: "wrong_status",
        detail: `Status is "${record.status}". Only "sent" invites can need follow-up.`,
      },
      daysSinceSent: null,
    };
  }
  if (!record.sentAt) {
    return {
      record,
      bucket: "not_due",
      reason: {
        code: "missing_sent_at",
        detail:
          "Record is marked sent but has no sentAt timestamp. This is a data-integrity gap — check the send closer's last run for this invite.",
      },
      daysSinceSent: null,
    };
  }
  const sentMs = Date.parse(record.sentAt);
  if (!Number.isFinite(sentMs)) {
    return {
      record,
      bucket: "not_due",
      reason: {
        code: "missing_sent_at",
        detail: `sentAt is unparseable: "${record.sentAt}".`,
      },
      daysSinceSent: null,
    };
  }
  if (record.followUpQueuedAt) {
    return {
      record,
      bucket: "not_due",
      reason: {
        code: "follow_up_queued",
        detail: `A follow-up was already queued at ${record.followUpQueuedAt}. The follow-up queue does not re-surface invites that have been actioned.`,
      },
      daysSinceSent: Math.floor((now.getTime() - sentMs) / DAY_MS),
    };
  }
  const days = Math.floor((now.getTime() - sentMs) / DAY_MS);
  if (days >= OVERDUE_DAYS) {
    return {
      record,
      bucket: "overdue",
      reason: {
        code: "overdue",
        detail: `Sent ${days} days ago — past the ${OVERDUE_DAYS}-day overdue threshold. Operator should send a manual nudge or close the loop.`,
      },
      daysSinceSent: days,
    };
  }
  if (days >= DUE_SOON_DAYS) {
    return {
      record,
      bucket: "due_soon",
      reason: {
        code: "due_soon",
        detail: `Sent ${days} days ago — past the ${DUE_SOON_DAYS}-day due-soon threshold. A follow-up reply on the original Gmail thread is a good next move.`,
      },
      daysSinceSent: days,
    };
  }
  return {
    record,
    bucket: "not_due",
    reason: {
      code: "fresh",
      detail: `Sent ${days} day${days === 1 ? "" : "s"} ago — still inside the ${DUE_SOON_DAYS}-day fresh window.`,
    },
    daysSinceSent: days,
  };
}

/**
 * Group an entire queue into the three follow-up buckets. Pure.
 *
 * Caller (route + UI) gets a stable shape:
 *   { total, overdue: [...], due_soon: [...], not_due: [...] }
 *
 * Within each bucket, records are sorted oldest-first (most stale at
 * the top) so the operator's eye lands on the most-overdue row first.
 */
export function reportFollowUps(
  records: readonly FaireInviteRecord[] | null | undefined,
  now: Date = new Date(),
): FollowUpReport {
  if (!Array.isArray(records)) {
    return { total: 0, overdue: [], due_soon: [], not_due: [] };
  }
  const overdue: FollowUpClassification[] = [];
  const due_soon: FollowUpClassification[] = [];
  const not_due: FollowUpClassification[] = [];
  for (const r of records) {
    const c = classifyForFollowUp(r, now);
    if (c.bucket === "overdue") overdue.push(c);
    else if (c.bucket === "due_soon") due_soon.push(c);
    else not_due.push(c);
  }
  // Most-stale first inside the actionable buckets.
  const byDaysDesc = (
    a: FollowUpClassification,
    b: FollowUpClassification,
  ) => (b.daysSinceSent ?? 0) - (a.daysSinceSent ?? 0);
  overdue.sort(byDaysDesc);
  due_soon.sort(byDaysDesc);
  return {
    total: records.length,
    overdue,
    due_soon,
    not_due,
  };
}

/**
 * Filter helper for callers who only want the records that need
 * action (overdue + due_soon). Pure.
 */
export function selectFollowUpsNeedingAction(
  records: readonly FaireInviteRecord[] | null | undefined,
  now: Date = new Date(),
): FaireInviteRecord[] {
  const r = reportFollowUps(records, now);
  return [...r.overdue, ...r.due_soon].map((c) => c.record);
}

/**
 * Test seam — exposes the constants so tests can document the
 * thresholds without re-deriving them from magic numbers.
 */
export const __FOLLOW_UP_CONSTANTS = {
  DUE_SOON_DAYS,
  OVERDUE_DAYS,
};
