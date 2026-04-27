/**
 * Inbox triage backlog — Phase 30.3 closed-loop selector.
 *
 * The email-intelligence pipeline (`src/lib/ops/email-intelligence/*`)
 * already classifies, dedupes, drafts replies, and posts approval
 * cards. What was missing: a visibility surface that answers
 * "how many emails were triaged but never decided?"
 *
 * This module is the selector. Pure — no I/O. Takes the existing
 * `ScannedEmail[]` shape produced by the pipeline + a clock, and
 * computes:
 *
 *   - per-category + per-stage counts
 *   - per-message backlog state (handled / awaiting-decision /
 *     stale)
 *   - top-K stale items (no decision in N hours, prioritized by
 *     urgency)
 *   - daily-brief summary line ("X emails awaiting decision, oldest
 *     Y hours ago") with quiet collapse to "" when nothing's open
 *
 * Backlog state model:
 *
 *   - **handled**          — has both an approval AND that approval
 *                            is in a terminal state (out of scope
 *                            for this module — the caller passes
 *                            through `terminalApproval=true`).
 *                            We don't trust `hasApproval` alone
 *                            because pending approvals are still
 *                            "awaiting decision."
 *   - **awaiting-decision** — has approval pending OR draft saved
 *                            but no approval yet.
 *   - **junk**             — classified `junk_fyi`; not on the
 *                            radar regardless of state.
 *   - **fyi-only**         — Class A drafts that don't need
 *                            approval (e.g., `customer_support`
 *                            informational replies). The caller
 *                            tells us via `requiresApproval`.
 *
 * Inspired by the same pattern as `composeAgingBriefCallouts`:
 * surface stale items so they don't drift; honestly mark when
 * nothing is stale.
 */
import type { ScannedEmail } from "./email-intelligence/report";
import type { EmailCategory } from "./email-intelligence/classifier";

/**
 * Backlog-urgency tiers. Independent of the email-intelligence
 * Classification (which doesn't carry urgency); the caller supplies
 * urgency from the inbox-triage route output, or defaults via
 * category-based heuristic in `defaultUrgencyForCategory`.
 */
export type BacklogUrgency = "critical" | "high" | "medium" | "low";

export type BacklogState =
  | "handled"
  | "awaiting-decision"
  | "junk"
  | "fyi-only";

export interface BacklogClassifierInput {
  /** Whether the email's category requires an approval card before send. */
  requiresApproval: (category: EmailCategory) => boolean;
  /** Whether the approval (if any) is terminal (approved/rejected/expired). */
  isApprovalTerminal: (approvalId: string | null | undefined) => boolean;
  /**
   * Map a scanned email to its backlog urgency. The pipeline's
   * Classification doesn't carry urgency; the caller injects it
   * (inbox-triage route output, daily-brief urgency reader, or
   * `defaultUrgencyForCategory`).
   */
  urgencyFor: (s: ScannedEmail) => BacklogUrgency;
}

/**
 * Conservative default-urgency heuristic by email category. Pure.
 * Used by callers that don't have a per-message urgency signal yet.
 */
export function defaultUrgencyForCategory(
  category: EmailCategory,
): BacklogUrgency {
  switch (category) {
    case "shipping_issue":
    case "ap_finance":
      return "high";
    case "b2b_sales":
    case "sample_request":
    case "vendor_supply":
      return "medium";
    case "customer_support":
    case "marketing_pr":
    case "receipt_document":
      return "low";
    case "junk_fyi":
      return "low";
    default:
      return "medium";
  }
}

export interface BacklogRow {
  emailId: string;
  /** ISO timestamp of the original email (NOT the triage). */
  receivedAt: string;
  category: EmailCategory;
  urgency: BacklogUrgency;
  state: BacklogState;
  hasDraft: boolean;
  hasApproval: boolean;
  approvalId: string | null;
  /** Subject line, trimmed to 120 chars. */
  subject: string;
  /** Sender display string. */
  from: string;
  /** Hours between receivedAt and the clock; null when unparseable. */
  ageHours: number | null;
}

/** Default approval-required predicate matching the canonical pipeline rules. */
export function defaultRequiresApproval(category: EmailCategory): boolean {
  // Drafts in these categories MUST go through Class B approval per the
  // existing approval-taxonomy.md `gmail.send` slug.
  return (
    category === "b2b_sales" ||
    category === "ap_finance" ||
    category === "vendor_supply" ||
    category === "sample_request" ||
    category === "shipping_issue" ||
    category === "marketing_pr"
  );
}

/**
 * Hours between an ISO timestamp and the clock. Pure. Returns null
 * for missing/unparseable input.
 */
export function ageHoursSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const ms = now.getTime() - t;
  if (ms < 0) return 0;
  return Math.round(ms / 36e5);
}

/**
 * Compute backlog state for one scanned email. Pure.
 *
 *   - junk_fyi → "junk"
 *   - has approval AND approval is terminal → "handled"
 *   - has approval (pending) → "awaiting-decision"
 *   - has draft + requiresApproval → "awaiting-decision"
 *   - has draft + !requiresApproval → "fyi-only"
 *   - no draft, no approval, !requiresApproval → "fyi-only"
 *   - else → "awaiting-decision"
 */
export function computeBacklogState(
  s: ScannedEmail,
  cfg: BacklogClassifierInput,
): BacklogState {
  if (s.classification.category === "junk_fyi") return "junk";

  const requiresApproval = cfg.requiresApproval(s.classification.category);

  if (s.hasApproval && cfg.isApprovalTerminal(s.approvalId ?? null)) {
    return "handled";
  }
  if (s.hasApproval) {
    return "awaiting-decision";
  }
  if (s.hasDraft) {
    return requiresApproval ? "awaiting-decision" : "fyi-only";
  }
  if (!requiresApproval) {
    return "fyi-only";
  }
  return "awaiting-decision";
}

/** Project a scanned email into a backlog row. Pure. */
export function projectBacklogRow(
  s: ScannedEmail,
  cfg: BacklogClassifierInput,
  now: Date,
): BacklogRow {
  return {
    emailId: s.envelope.id,
    receivedAt: s.envelope.date ?? "",
    category: s.classification.category,
    urgency: cfg.urgencyFor(s),
    state: computeBacklogState(s, cfg),
    hasDraft: s.hasDraft,
    hasApproval: s.hasApproval,
    approvalId: s.approvalId ?? null,
    subject: (s.envelope.subject ?? "").slice(0, 120),
    from: s.envelope.from ?? "",
    ageHours: ageHoursSince(s.envelope.date ?? null, now),
  };
}

/** Convenience: project an entire batch in one call. Pure. */
export function projectBacklogRows(
  emails: readonly ScannedEmail[],
  cfg: BacklogClassifierInput,
  now: Date,
): BacklogRow[] {
  return emails.map((s) => projectBacklogRow(s, cfg, now));
}

export interface BacklogSummary {
  total: number;
  /** Counts of `state="awaiting-decision"` rows. */
  awaitingDecision: number;
  handled: number;
  fyiOnly: number;
  junk: number;
  /** Awaiting-decision rows whose age exceeds STALE_HOURS_BY_URGENCY. */
  stale: number;
  /** Oldest awaiting-decision age, in hours; null when none. */
  oldestAwaitingHours: number | null;
  byCategory: Record<EmailCategory, number>;
  byUrgency: Record<BacklogUrgency, number>;
}

/**
 * Per-urgency staleness threshold.
 *   - critical → 1h is already stale
 *   - high     → 4h
 *   - medium   → 12h
 *   - low      → 24h
 *
 * These match the operating-tempo guidance Ben uses for his own
 * inbox triage cadence (morning + early afternoon scan).
 */
export const STALE_HOURS_BY_URGENCY: Record<BacklogUrgency, number> = {
  critical: 1,
  high: 4,
  medium: 12,
  low: 24,
};

function isStale(row: BacklogRow): boolean {
  if (row.state !== "awaiting-decision") return false;
  if (row.ageHours === null) return false;
  return row.ageHours >= STALE_HOURS_BY_URGENCY[row.urgency];
}

/** Pure summarizer over backlog rows. */
export function summarizeBacklog(rows: readonly BacklogRow[]): BacklogSummary {
  const byCategory: Record<EmailCategory, number> = {
    customer_support: 0,
    b2b_sales: 0,
    ap_finance: 0,
    vendor_supply: 0,
    sample_request: 0,
    shipping_issue: 0,
    receipt_document: 0,
    marketing_pr: 0,
    junk_fyi: 0,
  };
  const byUrgency: Record<BacklogUrgency, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  let awaitingDecision = 0,
    handled = 0,
    fyiOnly = 0,
    junk = 0,
    stale = 0;
  let oldestAwaitingHours: number | null = null;

  for (const r of rows) {
    byCategory[r.category] += 1;
    byUrgency[r.urgency] += 1;

    switch (r.state) {
      case "awaiting-decision":
        awaitingDecision += 1;
        if (r.ageHours !== null) {
          if (oldestAwaitingHours === null || r.ageHours > oldestAwaitingHours) {
            oldestAwaitingHours = r.ageHours;
          }
        }
        break;
      case "handled":
        handled += 1;
        break;
      case "fyi-only":
        fyiOnly += 1;
        break;
      case "junk":
        junk += 1;
        break;
    }

    if (isStale(r)) stale += 1;
  }

  return {
    total: rows.length,
    awaitingDecision,
    handled,
    fyiOnly,
    junk,
    stale,
    oldestAwaitingHours,
    byCategory,
    byUrgency,
  };
}

const URGENCY_RANK: Record<BacklogUrgency, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Top-K stale awaiting-decision rows, urgency-first then oldest-first.
 * Pure.
 */
export function pickStaleAwaiting(
  rows: readonly BacklogRow[],
  opts: { limit?: number } = {},
): BacklogRow[] {
  const limit = Math.max(1, Math.floor(opts.limit ?? 5));
  return rows
    .filter((r) => isStale(r))
    .slice() // copy before sort
    .sort((a, b) => {
      const ur = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
      if (ur !== 0) return ur;
      const ah = a.ageHours ?? -Infinity;
      const bh = b.ageHours ?? -Infinity;
      return bh - ah; // oldest first within urgency tier
    })
    .slice(0, limit);
}

/**
 * One-line daily-brief summary. Quiet collapse: zero awaiting →
 * empty string. Renders the awaiting count + the oldest-age callout
 * when applicable.
 */
export function renderBacklogBriefLine(summary: BacklogSummary): string {
  if (summary.awaitingDecision === 0) return "";
  const oldest =
    summary.oldestAwaitingHours !== null && summary.oldestAwaitingHours > 0
      ? `, oldest ${summary.oldestAwaitingHours}h ago`
      : "";
  const staleTail = summary.stale > 0 ? ` — ${summary.stale} stale` : "";
  return `:envelope: *Inbox triage:* ${summary.awaitingDecision} awaiting decision${oldest}${staleTail}.`;
}
