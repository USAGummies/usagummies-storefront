/**
 * Drift Detector — types.
 *
 * Implements P0-1 from `/contracts/agent-architecture-audit.md`:
 * "Slack-Corrections Drift Detector". Reads captured operating-memory
 * entries (the persisted output of P0-3 transcript-saver) and compares
 * them against canonical doctrine + the approval-taxonomy registry to
 * surface drift conditions a human should review.
 *
 * Produces a STRUCTURED REPORT — never mutates anything. No file writes,
 * no Slack posts, no contract edits, no QBO/Shopify/HubSpot writes.
 *
 * Class A only. The route that exposes this report uses
 * `slack.post.audit` (Class A) for the read mirror. Findings themselves
 * are observations, not actions.
 *
 * Doctrine references:
 *   - /contracts/operating-memory.md §"Drift detection via Slack corrections"
 *   - /contracts/governance.md §1 #1 (single source of truth per domain)
 *   - /contracts/approval-taxonomy.md §Class D (red-line / prohibited)
 *   - /contracts/approval-taxonomy.md "fail-closed on unknown actions"
 *   - CLAUDE.md "Drew owns nothing" (2026-04-27 doctrine)
 */

/** Five detector kinds — one per drift condition in the build spec. */
export type DriftDetectorKind =
  | "drew-regression"
  | "class-d-request"
  | "unknown-slug"
  | "doctrine-contradiction"
  | "stale-reference";

export type DriftSeverity = "low" | "medium" | "high" | "critical";

export interface DriftFinding {
  /**
   * Stable id — sha256(detector + sourceFingerprint + subContext). Same
   * entry processed twice through the same detector produces the same
   * id, so consumers can dedupe across runs.
   */
  id: string;
  detector: DriftDetectorKind;
  severity: DriftSeverity;
  /** OperatingMemoryEntry.id (random uuid v4) of the originating entry. */
  sourceEntryId: string;
  /** OperatingMemoryEntry.fingerprint (sha256 hex) — the dedupe key on the entry side. */
  sourceFingerprint: string;
  /** Path of the canonical doc this finding contradicts or references. Optional. */
  conflictedDoc?: string;
  /** ≤ 240-char excerpt from the entry body. Already redacted (P0-3). */
  evidenceSnippet: string;
  /**
   * One-sentence prompt for the human reviewer ("Open #ops-audit, review
   * the citation, decide if doctrine update needed"). NEVER names Drew as
   * the reviewer — Drew owns nothing per CLAUDE.md doctrine.
   */
  proposedHumanReview: string;
  /** ISO 8601 — when this detector ran. */
  detectedAt: string;
}

export interface DriftReport {
  ok: true;
  generatedAt: string;
  /** Windowing — only entries with capturedAt in [from, to] are scanned. */
  windowFromISO: string;
  windowToISO: string;
  /** Total operating-memory entries scanned in this window. */
  scanned: number;
  /** Findings (already deduped by `finding.id`). */
  findings: DriftFinding[];
  /** Counts by detector kind, for dashboards. */
  byDetector: Record<DriftDetectorKind, number>;
  /** Counts by severity, for triage. */
  bySeverity: Record<DriftSeverity, number>;
}

/**
 * A canonical doctrine lock. The detector compares correction-shaped
 * entries against these patterns to flag contradictions. Adding a lock
 * is a doctrinal change that lands in `/contracts/*.md` first; the lock
 * here is the runtime mirror.
 */
export interface DoctrineLock {
  /** Short id used in finding evidence + audit. */
  id: string;
  /** Canonical contract file path that anchors this lock. */
  doc: string;
  /** Brief human-readable description shown to the reviewer. */
  rule: string;
  /**
   * Regex that matches the contradicting language in an entry body.
   * MUST be specific enough to avoid false positives — the cost of a
   * false positive here is "human reviewer wastes 30 seconds." Keep
   * patterns anchored on action verbs ("remove", "stop", "skip").
   */
  contradictionPattern: RegExp;
  /** Severity of a contradiction. */
  severity: DriftSeverity;
}

/**
 * Contract source bundle — the detector accepts canonical contract text
 * by file path so tests can inject fixtures and the route can read from
 * disk in production. Keep small: only the docs the detector
 * cross-references appear here.
 */
export interface ContractSource {
  /** Path relative to repo root, e.g. "contracts/approval-taxonomy.md". */
  path: string;
  /** Full file text (utf-8). */
  text: string;
}
