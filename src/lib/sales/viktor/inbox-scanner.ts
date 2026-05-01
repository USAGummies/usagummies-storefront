/**
 * Phase 37.1 — Inbox Scanner (Viktor capability).
 *
 * Per /contracts/email-agents-system.md §2.1: continuously poll Gmail INBOX
 * for new mail, skip noise senders via the canonical denylist, and write
 * one KV record per message at `inbox:scan:<msg_id>` with status
 * `received` or `received_noise`.
 *
 * This is a CAPABILITY inside the Viktor runtime, NOT a new top-level
 * agent. Promotion to runtime requires passing the §15 promotion gate.
 *
 * Doctrine constraints (locked v1.0 2026-04-30 PM):
 *   - Class A (autonomous read-only). NO email send, NO HubSpot write,
 *     NO classification beyond the denylist short-circuit.
 *   - Reuses `gmail-reader.listEmails()` + `email-intelligence/cursor`.
 *     Adds NO new Gmail primitive.
 *   - Sender denylist is canonicalized in §2.1 — substring-match on the
 *     domain portion of the From header.
 *   - KV records `inbox:scan:<msgId>` are JSON envelopes + status. Idempotent
 *     re-scans only write records for ids not already present.
 *   - Cursor advances by max(receivedAt) on success.
 *   - Hard cap on messages per run + per-run audit so a misconfigured
 *     window cannot blow the orchestrator's KV budget.
 *
 * The classifier (§2.2 / Phase 37.2) is the next phase — this module only
 * decides "noise vs candidate"; everything else is downstream.
 */
import { kv } from "@vercel/kv";

import { listEmails, type EmailEnvelope } from "@/lib/ops/gmail-reader";
import {
  gmailAfterFragment,
  readCursor,
  writeCursor,
} from "@/lib/ops/email-intelligence/cursor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScanStatus = "received" | "received_noise";

export interface ScannedRecord {
  /** Gmail message id — the canonical key in KV. */
  messageId: string;
  threadId: string;
  /** Bare sender email, lowercased — convenience for downstream lookups. */
  fromEmail: string;
  /** Original "Name <addr@host>" header value. */
  fromHeader: string;
  subject: string;
  /** Raw RFC 2822 Date header — preserved verbatim from Gmail. */
  date: string;
  /** Gmail snippet (≤ ~200 chars). */
  snippet: string;
  labelIds: string[];
  /** `received_noise` short-circuits classification + drafting downstream. */
  status: ScanStatus;
  /** Why noise was flagged (denylist domain match) — empty when status=received. */
  noiseReason: string;
  /** ISO timestamp of when this scanner persisted the record. */
  observedAt: string;
}

export interface InboxScanReport {
  /** ISO timestamps marking the scan window (cursor → now). */
  windowStart: string;
  windowEnd: string;
  /** Gmail "after:YYYY/MM/DD" fragment used for the listEmails query. */
  gmailAfterFragment: string;
  /** Total envelopes returned by Gmail before any filtering. */
  envelopesFetched: number;
  /** Records newly written this run (excludes re-scans of already-known ids). */
  recordsWritten: number;
  /** Counts by status across written records. */
  byStatus: { received: number; received_noise: number };
  /** Records suppressed because the same message id was already in KV. */
  alreadyKnown: number;
  /** Cap that fired (`maxEmails` exceeded). 0 = no cap fired. */
  capExceeded: number;
  /** True if Gmail/KV degraded — orchestrator decides whether to alarm. */
  degraded: boolean;
  /** Human-readable degradation notes (Gmail throw, KV throw, etc.). */
  degradedNotes: string[];
  /** Newly-written records — handed to the next stage (classifier). */
  newRecords: ScannedRecord[];
  /** Cursor state before/after — useful for diagnostics + drift audit. */
  cursorBefore: number;
  cursorAfter: number;
  /** True when the scan ran end-to-end and the cursor advanced. */
  cursorAdvanced: boolean;
}

export interface RunInboxScannerOpts {
  /** Cap on the number of envelopes processed per run (default 50). */
  maxEmails?: number;
  /** Override Gmail folder (default INBOX). */
  folder?: string;
  /** When true, do not advance the cursor or persist KV records. */
  dryRun?: boolean;
  /** Override `Date.now()` for tests. */
  nowEpochMs?: number;
  /** Inject Gmail list function for tests. */
  listEmailsFn?: (opts: {
    folder?: string;
    count?: number;
    query?: string;
  }) => Promise<EmailEnvelope[]>;
  /** Inject KV store for tests. Must implement get/set. */
  store?: {
    get: <T>(key: string) => Promise<T | null>;
    set: (key: string, value: unknown) => Promise<unknown>;
  };
  /** Inject cursor for tests. */
  cursor?: {
    read: () => Promise<number>;
    write: (epochSeconds: number) => Promise<void>;
  };
  /** Override the noise denylist for tests. */
  senderDenylist?: readonly string[];
}

// ---------------------------------------------------------------------------
// Sender denylist — canonicalized in §2.1
// ---------------------------------------------------------------------------

/**
 * Domains whose mail is automatically classified as `received_noise`.
 *
 * Substring-matched against the lowercased `@host` portion of the From
 * header. The intent is "no human at the other end is asking us a
 * question" — outreach platforms, marketing newsletters, deal aggregators,
 * portal-only domains.
 *
 * Adding to this list requires Class A `system.read` audit + a Weekly
 * Drift Audit confirmation that real human conversations from the domain
 * are not being suppressed. Removing requires the same.
 */
export const DEFAULT_SENDER_DENYLIST: readonly string[] = [
  "semrush.com",
  "linkedin.com",
  "helpareporter.com",
  "apollo.io",
  "helium10.com",
  "make.com",
  "integromat.com",
  "roku.com",
  "america250.org",
  "substack.com",
  "rushordertees.com",
  "ecommerceequation.com",
  "firecrawl.dev",
  "puzzle.io",
  "euna.com",
  "lendzi.com",
  "americanexpress.com",
  "rangeme.com",
  "alibaba.com",
] as const;

const KV_RECORD_PREFIX = "inbox:scan:";
const DEFAULT_MAX_EMAILS = 50;
const DEFAULT_LIST_BATCH = 50;
/** KV record TTL — long enough that downstream phases can find the record
 *  but not so long that a stuck pipeline accumulates state forever. */
const RECORD_TTL_SECONDS = 60 * 24 * 3600; // 60 days

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the bare email from "Name <addr@host>" or a raw "addr@host". */
export function parseFromAddress(raw: string): string {
  if (!raw) return "";
  const m = raw.match(/<([^>]+)>/);
  const candidate = (m ? m[1] : raw).trim().toLowerCase();
  // Defensive — strip stray quotes/whitespace.
  return candidate.replace(/^"|"$/g, "").trim();
}

/** Return the lowercased domain of an email address, or empty string. */
export function fromEmailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).toLowerCase();
}

/**
 * Decide whether an envelope is noise per the denylist. Returns the matched
 * denylist entry (for audit) or empty string when not noise.
 */
export function matchSenderDenylist(
  fromEmail: string,
  denylist: readonly string[] = DEFAULT_SENDER_DENYLIST,
): string {
  const domain = fromEmailDomain(fromEmail);
  if (!domain) return "";
  for (const entry of denylist) {
    const needle = entry.toLowerCase();
    // Match either exact domain or a subdomain (e.g. mail.linkedin.com → linkedin.com).
    if (domain === needle || domain.endsWith(`.${needle}`)) {
      return entry;
    }
  }
  return "";
}

/**
 * Parse the RFC 2822 Date header to epoch seconds. Returns 0 on parse
 * failure — the cursor advancer ignores 0-valued timestamps.
 */
export function parseRfc2822Date(date: string): number {
  if (!date) return 0;
  const t = Date.parse(date);
  return Number.isFinite(t) && t > 0 ? Math.floor(t / 1000) : 0;
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/**
 * Run one inbox-scan tick.
 *
 * Reads the Gmail cursor, fetches all messages newer than the cursor,
 * filters denylist senders into `received_noise`, persists one KV record
 * per never-seen message id, and advances the cursor on success.
 *
 * Returns a structured report. Throws ONLY if cursor read fails AND no
 * fallback is possible — every other failure is captured in `degraded`.
 */
export async function runInboxScanner(
  opts: RunInboxScannerOpts = {},
): Promise<InboxScanReport> {
  const maxEmails = opts.maxEmails ?? DEFAULT_MAX_EMAILS;
  const folder = opts.folder ?? "INBOX";
  const dryRun = opts.dryRun ?? false;
  const nowMs = opts.nowEpochMs ?? Date.now();
  const list = opts.listEmailsFn ?? listEmails;
  const denylist = opts.senderDenylist ?? DEFAULT_SENDER_DENYLIST;

  const cursorRead = opts.cursor?.read ?? readCursor;
  const cursorWrite = opts.cursor?.write ?? writeCursor;

  const store = opts.store ?? {
    get: async <T>(key: string) => (await kv.get<T>(key)) ?? null,
    set: async (key: string, value: unknown) =>
      kv.set(key, value, { ex: RECORD_TTL_SECONDS }),
  };

  const degradedNotes: string[] = [];

  // 1. Cursor read.
  const cursorBefore = await cursorRead();
  const fragment = gmailAfterFragment(cursorBefore);

  // 2. Gmail list — degrade-soft on failure (return empty envelope set).
  let envelopes: EmailEnvelope[] = [];
  try {
    envelopes = await list({
      folder,
      count: DEFAULT_LIST_BATCH,
      query: fragment,
    });
  } catch (err) {
    degradedNotes.push(
      `gmail-list: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 3. Cap.
  let capExceeded = 0;
  let working = envelopes;
  if (working.length > maxEmails) {
    capExceeded = working.length - maxEmails;
    working = working.slice(0, maxEmails);
  }

  // 4. Per-envelope: dedupe via KV existence check, then persist one record.
  const newRecords: ScannedRecord[] = [];
  let alreadyKnown = 0;
  let receivedCount = 0;
  let noiseCount = 0;
  let maxObservedSec = cursorBefore;

  for (const env of working) {
    const key = `${KV_RECORD_PREFIX}${env.id}`;

    // Existence check — degraded => assume not present, accept the duplicate.
    let existing: ScannedRecord | null = null;
    try {
      existing = await store.get<ScannedRecord>(key);
    } catch (err) {
      degradedNotes.push(
        `kv-get(${env.id}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (existing) {
      alreadyKnown += 1;
      // Still advance the cursor — older record's date counts toward window.
      const sec = parseRfc2822Date(existing.date);
      if (sec > maxObservedSec) maxObservedSec = sec;
      continue;
    }

    const fromEmail = parseFromAddress(env.from);
    const matched = matchSenderDenylist(fromEmail, denylist);
    const status: ScanStatus = matched ? "received_noise" : "received";

    const record: ScannedRecord = {
      messageId: env.id,
      threadId: env.threadId,
      fromEmail,
      fromHeader: env.from,
      subject: env.subject,
      date: env.date,
      snippet: env.snippet,
      labelIds: env.labelIds,
      status,
      noiseReason: matched ? `denylist:${matched}` : "",
      observedAt: new Date(nowMs).toISOString(),
    };

    if (!dryRun) {
      try {
        await store.set(key, record);
      } catch (err) {
        degradedNotes.push(
          `kv-set(${env.id}): ${err instanceof Error ? err.message : String(err)}`,
        );
        // Don't count as "written" if we couldn't persist.
        continue;
      }
    }

    newRecords.push(record);
    if (status === "received") receivedCount += 1;
    else noiseCount += 1;

    const sec = parseRfc2822Date(record.date);
    if (sec > maxObservedSec) maxObservedSec = sec;
  }

  // 5. Advance cursor only when (a) not dry-run and (b) we observed something.
  let cursorAfter = cursorBefore;
  let cursorAdvanced = false;
  if (!dryRun && maxObservedSec > cursorBefore) {
    try {
      await cursorWrite(maxObservedSec);
      cursorAfter = maxObservedSec;
      cursorAdvanced = true;
    } catch (err) {
      degradedNotes.push(
        `cursor-write: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    windowStart: new Date(cursorBefore * 1000).toISOString(),
    windowEnd: new Date(nowMs).toISOString(),
    gmailAfterFragment: fragment,
    envelopesFetched: envelopes.length,
    recordsWritten: newRecords.length,
    byStatus: { received: receivedCount, received_noise: noiseCount },
    alreadyKnown,
    capExceeded,
    degraded: degradedNotes.length > 0,
    degradedNotes,
    newRecords,
    cursorBefore,
    cursorAfter,
    cursorAdvanced,
  };
}

/**
 * Read a previously-scanned record by message id. Used by Phase 37.2
 * (classifier) and downstream stages.
 */
export async function readScannedRecord(
  messageId: string,
): Promise<ScannedRecord | null> {
  try {
    return (await kv.get<ScannedRecord>(`${KV_RECORD_PREFIX}${messageId}`)) ?? null;
  } catch {
    return null;
  }
}
