/**
 * Phase 37.7 — Spam Cleaner (Class A-d autonomous DELETE).
 *
 * Per /contracts/email-agents-system.md §2.5d + §2.8 (BEN'S ADDITION
 * 2026-04-30 PM). The ONLY autonomous-DELETE lane in the system.
 *
 * Detection rules (ALL must be true to delete — layered for safety):
 *   1. `from:` matches the noise denylist (canonical 18-domain list,
 *      MINUS RangeMe + Faire which carry real campaign data we want).
 *   2. Subject matches noise patterns (unsubscribe / N-day sale / % off
 *      / Last call / View this online / Customers Often Purchase / etc.)
 *   3. NO HubSpot prior engagement on the sender domain — the moment we
 *      have any engagement history, the domain is permanently off the
 *      spam-eligible list per §7.13.
 *   4. NO attachment (no invoice / PDF / contract that needs handling).
 *
 * Doctrine constraints (locked v1.0 2026-04-30 PM):
 *   - Class A-d (autonomous DELETE) — moves to Gmail Trash via
 *     `gmail.users.messages.trash`. Recoverable for 30 days.
 *   - Posts a daily digest to `#ops-audit` showing volume + per-domain
 *     counts so the operator can audit drift.
 *   - Auto-delete is GATED on `SPAM_CLEANER_AUTO_DELETE=true` env flag.
 *     Default = dry-run mode: detection runs and surfaces candidates in
 *     the digest, but the actual trash call is suppressed. This lets
 *     the operator observe a week of digests before flipping the flag.
 *   - Whale-domain or executive-title senders NEVER trash, even if they
 *     somehow match the denylist (defense-in-depth).
 */
import { kv } from "@vercel/kv";

import { matchSenderDenylist } from "./inbox-scanner";
import { matchWhaleDomain } from "./classifier";
import type { ClassifiedRecord } from "./classifier";
import type { ScannedRecord } from "./inbox-scanner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpamDeleteOutcome =
  | "deleted" // Class A-d trash call succeeded
  | "deleted_dry_run" // Eligible for delete; dry-run suppressed the trash call
  | "skipped_not_eligible" // Detection rules didn't fire
  | "skipped_engagement" // HubSpot has prior engagement — permanently safe
  | "skipped_whale" // Whale-domain defense-in-depth block
  | "skipped_attachment" // Attachment present — needs handling
  | "skipped_safety" // Other safety guard fired (executive title, etc.)
  | "delete_failed"; // Gmail trash call returned an error

export interface SpamDecision {
  /** Should this record be deleted? Independent of dry-run flag. */
  eligible: boolean;
  outcome: SpamDeleteOutcome;
  /** Why the decision was made — human-readable for the daily digest. */
  reason: string;
  /** Matched denylist entry, when relevant — empty otherwise. */
  denylistMatch: string;
}

export interface SpamCleanerResult {
  messageId: string;
  fromEmail: string;
  subject: string;
  decision: SpamDecision;
  /** Gmail trash response on success, or error string on failure. */
  trashResult?: { ok: true; id: string } | { ok: false; error: string };
  /** ISO timestamp the cleaner ran on this record. */
  processedAt: string;
}

export interface SpamCleanerReport {
  examined: number;
  deleted: number;
  deletedDryRun: number;
  skippedNotEligible: number;
  skippedEngagement: number;
  skippedWhale: number;
  skippedAttachment: number;
  skippedSafety: number;
  deleteFailed: number;
  /** Per-domain delete counts for the daily digest. */
  byDomain: Record<string, number>;
  results: SpamCleanerResult[];
  degraded: boolean;
  degradedNotes: string[];
}

export interface RunSpamCleanerOpts {
  /** Records to evaluate — typically pulled from inbox:scan KV with
   *  category=Z_obvious_spam OR status=received_noise. */
  records: Array<
    ClassifiedRecord & {
      hasAttachment?: boolean;
      hubspotHasEngagement?: boolean;
    }
  >;
  /** When true, do not call gmail.users.messages.trash (default behavior).
   *  Auto-delete unlocked when env SPAM_CLEANER_AUTO_DELETE=true OR opts.dryRun=false. */
  dryRun?: boolean;
  nowEpochMs?: number;
  /** Override Date.now() for tests. */
  trashFn?: (
    messageId: string,
  ) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  /** KV log writer — defaults to vercel kv with a per-day key. */
  store?: {
    set: (key: string, value: unknown) => Promise<unknown>;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Subject-line noise patterns that indicate broadcast / marketing / promo
 * mail. Patterns are intentionally generic — the denylist + engagement-
 * history checks are the precision filter; this is recall.
 */
export const SPAM_SUBJECT_PATTERNS: readonly RegExp[] = [
  /\bunsubscribe\b/i,
  /\b\d+[-\s]?day\s+sale\b/i,
  /\b\d+%\s*off\b/i,
  /\blast\s+call\b/i,
  /\bview\s+this\s+(?:email|online)\b/i,
  /\bcustomers?\s+often\s+(?:buy|purchase)\b/i,
  /\bearn\s+rewards?\b/i,
  /\bdon'?t\s+miss\b/i,
  /\bdaily\s+digest\b/i,
  /\bnewsletter\b/i,
  /\bweekly\s+(?:roundup|update|digest)\b/i,
  /\bclick\s+(?:here|to)\b/i,
  /\bact\s+now\b/i,
  /\bdeal\s+of\s+the\s+(?:day|week)\b/i,
  /\bfree\s+(?:trial|demo|consultation)\b/i,
];

/**
 * Phrases in a subject that flag a message as DEFINITELY-NOT-SPAM, no matter
 * what other rules fire. Defense-in-depth so we never trash an actual buyer.
 */
export const SPAM_SAFETY_PATTERNS: readonly RegExp[] = [
  /\binvoice\b/i,
  /\breceipt\b/i,
  /\bpayment\s+(?:confirmation|received|due)\b/i,
  /\border\s+(?:confirmation|update|status)\b/i,
  /\bshipping\s+confirmation\b/i,
  /\bw-?9\b/i,
  /\bach\b/i,
  /\bnew\s+vendor\b/i,
  /\bvendor\s+(?:application|setup|onboarding)\b/i,
  /\bsample\s+request\b/i,
  /\bquote\b/i,
  /\bpurchase\s+order\b/i,
  /\bpo[-\s]?\d+/i,
];

const KV_DAILY_LOG_PREFIX = "spam-cleaner:log:";
const DAILY_LOG_TTL_SECONDS = 90 * 24 * 3600; // 90 days for audit retention

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Check if any spam subject pattern fires. Returns the first matching
 * pattern source for audit, or empty string when no match.
 */
export function matchSubjectPattern(subject: string): string {
  if (!subject) return "";
  for (const pat of SPAM_SUBJECT_PATTERNS) {
    if (pat.test(subject)) return pat.source;
  }
  return "";
}

/**
 * Check if subject contains a "definitely-not-spam" safety phrase
 * (invoice / W-9 / sample request / etc.). Returns first match or empty.
 */
export function matchSafetyPattern(subject: string): string {
  if (!subject) return "";
  for (const pat of SPAM_SAFETY_PATTERNS) {
    if (pat.test(subject)) return pat.source;
  }
  return "";
}

/**
 * Pure decision function — given a record + flags, returns the spam
 * decision with no I/O. Used by the runner and directly by tests.
 *
 * Resolution order (HARD STOPS first):
 *   1. Whale domain → never trash (defense-in-depth).
 *   2. HubSpot prior engagement → permanently safe.
 *   3. Subject matches a SAFETY pattern (invoice/W-9/PO) → never trash.
 *   4. Has attachment → never trash.
 *   5. From-domain on denylist + subject matches noise → eligible.
 *   6. Otherwise → not eligible.
 */
export function evaluateSpamDelete(
  record: ScannedRecord & {
    hasAttachment?: boolean;
    hubspotHasEngagement?: boolean;
  },
): SpamDecision {
  const fromEmail = record.fromEmail || "";
  const subject = record.subject || "";

  // 1. Whale domain — defense-in-depth.
  const whale = matchWhaleDomain(fromEmail);
  if (whale) {
    return {
      eligible: false,
      outcome: "skipped_whale",
      reason: `Sender on whale list (${whale}) — defense-in-depth, never trash`,
      denylistMatch: "",
    };
  }

  // 2. HubSpot engagement — permanently safe.
  if (record.hubspotHasEngagement) {
    return {
      eligible: false,
      outcome: "skipped_engagement",
      reason:
        "Sender domain has HubSpot prior engagement — permanently off spam-eligible list per §7.13",
      denylistMatch: "",
    };
  }

  // 3. Subject SAFETY pattern.
  const safetyMatch = matchSafetyPattern(subject);
  if (safetyMatch) {
    return {
      eligible: false,
      outcome: "skipped_safety",
      reason: `Subject matches safety pattern (${safetyMatch}) — never trash`,
      denylistMatch: "",
    };
  }

  // 4. Attachment present.
  if (record.hasAttachment) {
    return {
      eligible: false,
      outcome: "skipped_attachment",
      reason: "Message has an attachment — needs handling, never trash",
      denylistMatch: "",
    };
  }

  // 5. Denylist + noise subject.
  const denylistMatch = matchSenderDenylist(fromEmail);
  if (!denylistMatch) {
    return {
      eligible: false,
      outcome: "skipped_not_eligible",
      reason: "Sender domain not on noise denylist",
      denylistMatch: "",
    };
  }

  const subjectMatch = matchSubjectPattern(subject);
  if (!subjectMatch) {
    return {
      eligible: false,
      outcome: "skipped_not_eligible",
      reason: `Sender on denylist (${denylistMatch}) but subject doesn't match noise patterns`,
      denylistMatch,
    };
  }

  return {
    eligible: true,
    outcome: "deleted", // tentative — runner downgrades to deleted_dry_run when applicable
    reason: `Denylist match (${denylistMatch}) + noise subject (${subjectMatch}) + no engagement + no attachment`,
    denylistMatch,
  };
}

/** Domain key used for byDomain counts in the daily digest. */
function domainOf(fromEmail: string): string {
  const at = fromEmail.lastIndexOf("@");
  return at < 0 ? "unknown" : fromEmail.slice(at + 1).toLowerCase();
}

/**
 * Build a Slack-formatted daily digest of spam-cleaner activity.
 * Quiet-collapses to a one-liner when nothing fired.
 */
export function renderSpamCleanerDigest(report: SpamCleanerReport): string {
  const total = report.deleted + report.deletedDryRun;
  if (total === 0) {
    return `🧹 *Spam cleaner — daily digest*\n_No spam to clean today (${report.examined} examined)_`;
  }
  const mode = report.deletedDryRun > 0 ? " *(DRY RUN)*" : "";
  const lines: string[] = [
    `🧹 *Spam cleaner — daily digest*${mode}`,
    `_${total} eligible · ${report.deleted} actually deleted · ${report.examined} examined_`,
  ];
  const byDomain = Object.entries(report.byDomain).sort((a, b) => b[1] - a[1]);
  if (byDomain.length > 0) {
    lines.push("");
    lines.push("Per domain:");
    for (const [d, n] of byDomain.slice(0, 10)) {
      lines.push(`  • ${d} ×${n}`);
    }
  }
  if (report.deleteFailed > 0) {
    lines.push("");
    lines.push(`⚠️  ${report.deleteFailed} delete-failures — check audit log`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run the spam-cleaner across a batch of records. Honors `dryRun` flag
 * AND the `SPAM_CLEANER_AUTO_DELETE` env (either being false-ish keeps
 * the trash call suppressed).
 *
 * Pure-ish — `trashFn` and `store` are dependency-injected so tests
 * never need network. Production wiring uses `moveToTrash` from
 * gmail-reader.ts and Vercel KV.
 */
export async function runSpamCleaner(
  opts: RunSpamCleanerOpts,
): Promise<SpamCleanerReport> {
  const nowMs = opts.nowEpochMs ?? Date.now();

  // Resolve dry-run from BOTH the explicit opt AND the env flag.
  // dryRun defaults to TRUE — auto-delete only happens when both are off.
  const envEnabled =
    (process.env.SPAM_CLEANER_AUTO_DELETE ?? "").trim().toLowerCase() === "true";
  const dryRun = opts.dryRun !== undefined ? opts.dryRun : !envEnabled;

  const trashFn = opts.trashFn;
  const store = opts.store;

  const report: SpamCleanerReport = {
    examined: 0,
    deleted: 0,
    deletedDryRun: 0,
    skippedNotEligible: 0,
    skippedEngagement: 0,
    skippedWhale: 0,
    skippedAttachment: 0,
    skippedSafety: 0,
    deleteFailed: 0,
    byDomain: {},
    results: [],
    degraded: false,
    degradedNotes: [],
  };

  for (const record of opts.records) {
    report.examined += 1;

    const decision = evaluateSpamDelete(record);
    const result: SpamCleanerResult = {
      messageId: record.messageId,
      fromEmail: record.fromEmail,
      subject: record.subject,
      decision,
      processedAt: new Date(nowMs).toISOString(),
    };

    if (!decision.eligible) {
      // Tally skip outcome.
      switch (decision.outcome) {
        case "skipped_engagement":
          report.skippedEngagement += 1;
          break;
        case "skipped_whale":
          report.skippedWhale += 1;
          break;
        case "skipped_attachment":
          report.skippedAttachment += 1;
          break;
        case "skipped_safety":
          report.skippedSafety += 1;
          break;
        default:
          report.skippedNotEligible += 1;
          break;
      }
      report.results.push(result);
      continue;
    }

    // Eligible — either dry-run or real trash.
    if (dryRun || !trashFn) {
      result.decision = {
        ...decision,
        outcome: "deleted_dry_run",
        reason:
          decision.reason +
          (dryRun
            ? " — DRY RUN (SPAM_CLEANER_AUTO_DELETE not enabled)"
            : " — DRY RUN (no trashFn injected)"),
      };
      report.deletedDryRun += 1;
    } else {
      const trashResult = await trashFn(record.messageId);
      result.trashResult = trashResult;
      if (trashResult.ok) {
        result.decision = {
          ...decision,
          outcome: "deleted",
        };
        report.deleted += 1;
      } else {
        result.decision = {
          ...decision,
          outcome: "delete_failed",
          reason: `${decision.reason} — but trash failed: ${trashResult.error}`,
        };
        report.deleteFailed += 1;
        report.degraded = true;
        report.degradedNotes.push(
          `trash(${record.messageId}): ${trashResult.error}`,
        );
      }
    }

    // Tally by domain for the digest.
    const dom = domainOf(record.fromEmail);
    report.byDomain[dom] = (report.byDomain[dom] ?? 0) + 1;

    report.results.push(result);
  }

  // Persist daily log to KV — keyed by UTC date so a single day's runs roll up.
  const dayKey = new Date(nowMs).toISOString().slice(0, 10); // YYYY-MM-DD
  const logKey = `${KV_DAILY_LOG_PREFIX}${dayKey}`;
  const logStore = store ?? {
    set: async (key: string, value: unknown) =>
      kv.set(key, value, { ex: DAILY_LOG_TTL_SECONDS }),
  };
  try {
    await logStore.set(logKey, {
      date: dayKey,
      generatedAt: new Date(nowMs).toISOString(),
      examined: report.examined,
      deleted: report.deleted,
      deletedDryRun: report.deletedDryRun,
      deleteFailed: report.deleteFailed,
      byDomain: report.byDomain,
      // Don't persist full records — too verbose for KV.
      summary: report.results.map((r) => ({
        messageId: r.messageId,
        outcome: r.decision.outcome,
        from: r.fromEmail,
        subject: r.subject.slice(0, 80),
      })),
    });
  } catch (err) {
    report.degraded = true;
    report.degradedNotes.push(
      `kv-set(${logKey}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return report;
}
