/**
 * Email Agent Queue — read-only aggregator over Phase 37.1 + 37.2 KV state.
 *
 * Build 3 from `docs/SYSTEM_BUILD_CONTINUATION_BLUEPRINT.md`. The actual
 * triage runtime ships INSIDE Viktor as Phase 37.1 (Inbox Scanner) +
 * 37.2 (Classifier) per `/contracts/email-agents-system.md` §9.1 lane
 * lock. Those phases write `inbox:scan:<msgId>` KV records:
 *
 *   - `received`           — Phase 37.1 scanned, not yet classified
 *   - `received_noise`     — Phase 37.1 denylist-matched (no further work)
 *   - `classified`         — Phase 37.2 classified (regular)
 *   - `classified_whale`   — Phase 37.2 whale-domain HARD STOP fired
 *
 * This module is the operator-visible queue layer over those records:
 * an aggregator + KV scanner + summary roll-up so the `/ops/email-agents`
 * dashboard and the Slack `email queue` command can answer "what's in
 * the inbox queue?" without opening Gmail.
 *
 * Hard rules:
 *   - Read-only. NO Gmail send, NO HubSpot write, NO classifier mutation.
 *     The scan + classify work happens in `src/lib/sales/viktor/*`.
 *   - Fail-soft on KV errors — return `{ rows: [], degraded: [...] }`,
 *     never throw to the caller.
 *   - No secrets / no full email bodies stored or returned.
 *
 * Pure aggregator (`summarizeEmailAgentQueue`) is testable without KV.
 * The scanner (`scanEmailAgentQueue`) wraps `@vercel/kv` and is the
 * I/O boundary.
 */
import { kv } from "@vercel/kv";

import type { ScannedRecord } from "@/lib/sales/viktor/inbox-scanner";
import type {
  ClassifiedRecord,
  EmailCategoryV1,
} from "@/lib/sales/viktor/classifier";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Union of every status a queue row can land in (Phase 37.1 + 37.2). */
export type EmailAgentQueueStatus =
  | "received"
  | "received_noise"
  | "classified"
  | "classified_whale";

/**
 * Lean projection of the KV record for the queue UI. Drops the snippet
 * + label ids + raw "From" header so we don't leak data the operator
 * doesn't need.
 */
export interface EmailAgentQueueRow {
  messageId: string;
  threadId: string;
  fromEmail: string;
  /** "Name <addr@host>" header — kept because the UI renders the display name. */
  fromHeader: string;
  subject: string;
  /** Raw RFC 2822 Date header from Gmail. */
  date: string;
  status: EmailAgentQueueStatus;
  /** Phase 37.2 classification (only present when status=classified*). */
  category?: EmailCategoryV1;
  confidence?: number;
  classificationReason?: string;
  /** Why noise was flagged (only present when status=received_noise). */
  noiseReason?: string;
  /** ISO when scanner recorded this. */
  observedAt: string;
  /** ISO when classifier ran (only present when status=classified*). */
  classifiedAt?: string;
}

export interface EmailAgentQueueSummary {
  /** Total queue depth across every status. */
  total: number;
  /** Count by status. */
  byStatus: Record<EmailAgentQueueStatus, number>;
  /** Count by category (classified records only). */
  byCategory: Record<string, number>;
  /**
   * Number of records flagged whale-class (subset of classified). Surfaced
   * separately because whales gate the §2.5 approval class to C/D minimum.
   */
  whaleCount: number;
  /** Oldest received record by observedAt — null when queue is empty. */
  oldestReceived: EmailAgentQueueRow | null;
  /**
   * Top N rows for the UI / Slack card — the 5 most-recently-received
   * NON-noise records (so noise doesn't crowd out actionable items).
   */
  topRows: EmailAgentQueueRow[];
  /**
   * Backlog count: records still in `received` (i.e. scanner ran but
   * classifier hasn't). Surfaced because a growing backlog means the
   * classifier is degraded.
   */
  backlogReceived: number;
}

const TOP_N_DEFAULT = 5;
const KV_PREFIX = "inbox:scan:";
const SCAN_BATCH = 200;
const SCAN_MAX_KEYS = 2000; // hard cap so a runaway queue can't OOM the route

// ---------------------------------------------------------------------------
// Pure aggregator
// ---------------------------------------------------------------------------

const ZERO_BY_STATUS: () => Record<EmailAgentQueueStatus, number> = () => ({
  received: 0,
  received_noise: 0,
  classified: 0,
  classified_whale: 0,
});

/** Pure roll-up over the rows. Easy to test. */
export function summarizeEmailAgentQueue(
  rows: ReadonlyArray<EmailAgentQueueRow>,
  opts: { topN?: number } = {},
): EmailAgentQueueSummary {
  const byStatus = ZERO_BY_STATUS();
  const byCategory: Record<string, number> = {};
  let whaleCount = 0;
  let oldestReceived: EmailAgentQueueRow | null = null;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (r.category) {
      byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    }
    if (r.status === "classified_whale") whaleCount += 1;
    if (r.status === "received") {
      if (
        !oldestReceived ||
        Date.parse(r.observedAt) < Date.parse(oldestReceived.observedAt)
      ) {
        oldestReceived = r;
      }
    }
  }

  // Top rows: non-noise, sorted most-recently-observed first.
  const actionable = rows.filter((r) => r.status !== "received_noise");
  const sorted = [...actionable].sort(
    (a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt),
  );
  const topN = opts.topN ?? TOP_N_DEFAULT;

  return {
    total: rows.length,
    byStatus,
    byCategory,
    whaleCount,
    oldestReceived,
    topRows: sorted.slice(0, topN),
    backlogReceived: byStatus.received,
  };
}

// ---------------------------------------------------------------------------
// KV scanner (I/O boundary)
// ---------------------------------------------------------------------------

export interface ScanEmailAgentQueueOpts {
  /** Hard cap on rows returned (default 2000 — also the KV-scan ceiling). */
  limit?: number;
  /** Optional status filter (post-fetch — KV doesn't index by status). */
  statusFilter?: EmailAgentQueueStatus;
  /** Inject store for tests (must support get/scan). */
  store?: {
    get: <T>(key: string) => Promise<T | null>;
    scan: (
      cursor: string | number,
      opts: { match: string; count?: number },
    ) => Promise<[string | number, string[]]>;
  };
}

export interface ScanEmailAgentQueueResult {
  rows: EmailAgentQueueRow[];
  degraded: string[];
  /** True iff `SCAN_MAX_KEYS` cap fired (queue larger than scanner returned). */
  truncated: boolean;
}

/**
 * Bounded KV scan over `inbox:scan:*` keys. Returns the lean queue rows.
 * Fail-soft on KV errors — caller gets a `degraded` list and possibly empty
 * rows, never an exception.
 */
export async function scanEmailAgentQueue(
  opts: ScanEmailAgentQueueOpts = {},
): Promise<ScanEmailAgentQueueResult> {
  const limit = opts.limit ?? SCAN_MAX_KEYS;
  const store =
    opts.store ??
    ({
      get: async <T>(key: string) => (await kv.get<T>(key)) ?? null,
      scan: (cursor, sopts) =>
        kv.scan(cursor, sopts) as unknown as Promise<[string | number, string[]]>,
    } as const);

  const rows: EmailAgentQueueRow[] = [];
  const degraded: string[] = [];
  let truncated = false;

  let cursor: string | number = 0;
  let totalSeen = 0;
  let firstPass = true;
  try {
    while (firstPass || cursor !== 0) {
      firstPass = false;
      const [next, keys] = await store.scan(cursor, {
        match: `${KV_PREFIX}*`,
        count: SCAN_BATCH,
      });
      cursor = next;
      for (const key of keys) {
        if (totalSeen >= limit) {
          truncated = true;
          break;
        }
        totalSeen += 1;
        let raw: ScannedRecord | ClassifiedRecord | null = null;
        try {
          raw = (await store.get<ScannedRecord | ClassifiedRecord>(key)) ?? null;
        } catch (err) {
          degraded.push(
            `kv-get:${key}:${err instanceof Error ? err.message : String(err)}`,
          );
          continue;
        }
        if (!raw) continue;
        const row = projectRow(raw);
        if (opts.statusFilter && row.status !== opts.statusFilter) continue;
        rows.push(row);
      }
      if (truncated) break;
    }
  } catch (err) {
    degraded.push(
      `kv-scan:${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { rows, degraded, truncated };
}

/** Project the raw KV record down to the lean queue row. */
function projectRow(
  raw: ScannedRecord | ClassifiedRecord,
): EmailAgentQueueRow {
  const base: EmailAgentQueueRow = {
    messageId: raw.messageId,
    threadId: raw.threadId,
    fromEmail: raw.fromEmail,
    fromHeader: raw.fromHeader,
    subject: raw.subject,
    date: raw.date,
    status: raw.status as EmailAgentQueueStatus,
    observedAt: raw.observedAt,
    noiseReason: raw.noiseReason || undefined,
  };
  // Classifier extends ScannedRecord — narrow safely.
  const classified = raw as Partial<ClassifiedRecord>;
  if (typeof classified.category === "string") {
    base.category = classified.category;
    base.confidence = classified.confidence;
    base.classificationReason = classified.classificationReason;
    base.classifiedAt = classified.classifiedAt;
  }
  return base;
}
