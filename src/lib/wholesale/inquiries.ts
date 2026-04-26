/**
 * Wholesale inquiry archive.
 *
 * Phase 6 of the Sales Command Center. Persists every wholesale
 * submission from `/api/leads` (when intent === "wholesale") into a
 * queryable KV store so the Sales Command Center can show a real,
 * source-attested count instead of `not_wired`.
 *
 * Hard rules:
 *   - **Read-only public surfaces.** This module only writes from
 *     the public lead-capture endpoint, and only to KV. No HubSpot
 *     stage/lifecycle writes, no QBO writes, no Shopify writes.
 *     The existing `/api/leads` Notion mirror is preserved as-is.
 *   - **Fail-soft on write.** Persistence errors must NEVER block
 *     the public form submission. The lead-capture path treats
 *     this archive write the same as the Notion mirror — best
 *     effort, logged on failure.
 *   - **Honest on read.** A KV exception during read returns an
 *     `error` outcome — callers MUST surface that as `error` state,
 *     not as a fabricated zero. An empty-but-reachable archive
 *     returns `total: 0` legitimately (real, source-attested zero).
 *   - **Bounded growth.** The index is capped at `INDEX_CAP` (most
 *     recent N records); older IDs are evicted. Each record is
 *     stored under its own key with a TTL backstop.
 *   - **PII discipline.** Records carry the same fields the public
 *     form already collects + a server-side timestamp + a
 *     deterministic id. No further enrichment.
 */

import { kv } from "@vercel/kv";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// KV layout
// ---------------------------------------------------------------------------
//
// `wholesale:inquiries:index` — JSON array of record IDs (most-recent first
//                               in the index, capped at INDEX_CAP).
// `wholesale:inquiry:<id>`    — JSON-serialized WholesaleInquiryRecord.
//                               TTL = 365 days (defense-in-depth — index
//                               is the source of truth for ordering).
//
// We deliberately use string keys (no Redis lists / sorted sets) so the
// pattern matches the rest of the codebase (`src/lib/locations/drafts.ts`,
// `src/lib/ops/ap-packets.ts`) and works under @vercel/kv's REST flavor.

const KV_INDEX_KEY = "wholesale:inquiries:index";
const KV_RECORD_PREFIX = "wholesale:inquiry:";
const INDEX_CAP = 5000;
const RECORD_TTL_SECONDS = 365 * 24 * 3600;

function recordKey(id: string): string {
  return `${KV_RECORD_PREFIX}${id}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WholesaleInquiryRecord {
  /** Stable id minted server-side at append time. */
  id: string;
  /** ISO 8601 server-side timestamp. */
  submittedAt: string;
  /** Form fields the public capture endpoint already collects.
   *  Empty strings are normalized to undefined here so consumers
   *  never have to distinguish empty vs missing. */
  email?: string;
  phone?: string;
  source?: string;
  intent?: string;
  storeName?: string;
  buyerName?: string;
  location?: string;
  interest?: string;
}

export interface WholesaleInquirySummary {
  /** Total stored across the entire archive (capped by INDEX_CAP). */
  total: number;
  /** Most-recent submittedAt (ISO 8601), if any. */
  lastSubmittedAt?: string;
}

/** Read outcome — the consumer (sales-command reader) maps this to
 *  the SourceState contract. `error` callers must propagate as
 *  `error` state, NEVER as fabricated zero. */
export type WholesaleInquiryReadResult =
  | { ok: true; summary: WholesaleInquirySummary }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function readIndex(): Promise<string[]> {
  const raw = await kv.get<string[] | string>(KV_INDEX_KEY);
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function writeIndex(ids: string[]): Promise<void> {
  // Most-recent first; cap to keep KV size bounded.
  const capped = ids.slice(0, INDEX_CAP);
  await kv.set(KV_INDEX_KEY, capped);
}

function normalize(input: Record<string, unknown>): WholesaleInquiryRecord {
  const get = (k: string): string | undefined => {
    const v = input[k];
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  };
  return {
    id: typeof input.id === "string" && input.id ? input.id : randomUUID(),
    submittedAt:
      typeof input.submittedAt === "string" && input.submittedAt
        ? input.submittedAt
        : new Date().toISOString(),
    email: get("email"),
    phone: get("phone"),
    source: get("source"),
    intent: get("intent"),
    storeName: get("storeName"),
    buyerName: get("buyerName"),
    location: get("location"),
    interest: get("interest"),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Append a wholesale inquiry to the durable archive.
 *
 * **Fail-soft contract:** caller (e.g. /api/leads) must wrap with
 * `.catch(() => {})` — persistence errors must not break the public
 * form submission. We mirror the existing Notion-mirror pattern.
 *
 * Returns the persisted record on success so test code can assert
 * the normalized shape.
 */
export async function appendWholesaleInquiry(
  input: Partial<WholesaleInquiryRecord>,
): Promise<WholesaleInquiryRecord> {
  const record = normalize(input as Record<string, unknown>);
  // Defense-in-depth: refuse to persist a record with neither email
  // nor phone — same gate the public route already enforces.
  if (!record.email && !record.phone) {
    throw new Error(
      "appendWholesaleInquiry: rejected record with neither email nor phone (caller should not have passed this through).",
    );
  }
  await kv.set(recordKey(record.id), JSON.stringify(record), {
    ex: RECORD_TTL_SECONDS,
  });
  const existing = await readIndex();
  // Most-recent first; deduplicate defensively (id collisions are
  // astronomically unlikely with randomUUID but tests may pass
  // pre-minted IDs).
  const next = [record.id, ...existing.filter((x) => x !== record.id)];
  await writeIndex(next);
  return record;
}

/** Internal: fetch records for a list of ids, in order. Missing
 *  records (TTL expired, evicted, write failure) are skipped — the
 *  index is best-effort and may temporarily lag the records. */
async function getRecords(ids: string[]): Promise<WholesaleInquiryRecord[]> {
  const out: WholesaleInquiryRecord[] = [];
  for (const id of ids) {
    const raw = await kv.get<string | WholesaleInquiryRecord>(recordKey(id));
    if (!raw) continue;
    if (typeof raw === "string") {
      try {
        out.push(JSON.parse(raw) as WholesaleInquiryRecord);
      } catch {
        // unparseable record; skip
      }
    } else {
      out.push(raw);
    }
  }
  return out;
}

/**
 * List wholesale inquiries, most-recent first. Bounded by `limit`
 * (default 50; max 500). Used by the auth-gated internal list
 * endpoint at `/api/ops/wholesale/inquiries`.
 */
export async function listWholesaleInquiries(opts: {
  limit?: number;
} = {}): Promise<WholesaleInquiryRecord[]> {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 50));
  const ids = await readIndex();
  return getRecords(ids.slice(0, limit));
}

/**
 * Compact summary for the Sales Command Center. Returns the read
 * outcome wrapped — callers MUST distinguish `ok:false` from a real
 * zero count to honor the no-fabricated-zero rule.
 */
export async function getWholesaleInquirySummary(): Promise<WholesaleInquiryReadResult> {
  try {
    const ids = await readIndex();
    if (ids.length === 0) {
      return { ok: true, summary: { total: 0 } };
    }
    // Read the most-recent record only — that's enough to populate
    // `lastSubmittedAt`. Index order = most-recent first.
    const [first] = await getRecords([ids[0]]);
    return {
      ok: true,
      summary: {
        total: ids.length,
        lastSubmittedAt: first?.submittedAt,
      },
    };
  } catch (err) {
    return {
      ok: false,
      reason: `KV read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Test helpers (NOT exported from a barrel — for the unit suite only)
// ---------------------------------------------------------------------------

/** Internal export for tests. Production callers should use the
 *  named helpers above. */
export const __INTERNAL = {
  KV_INDEX_KEY,
  KV_RECORD_PREFIX,
  INDEX_CAP,
  RECORD_TTL_SECONDS,
  recordKey,
};
