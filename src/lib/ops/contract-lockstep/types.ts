/**
 * Notion ↔ /contracts Lockstep Auditor — types.
 *
 * Implements P0-7 from `/contracts/agent-architecture-audit.md` and the
 * §8 documentation-canonicalization rule from `/contracts/governance.md`:
 *
 *   "Agent contracts live in Notion (human-readable) and in this repo
 *    under `/contracts/` (machine-readable). They are kept in lockstep
 *    by the weekly drift audit."
 *
 * **Read-only by design.** The auditor produces a structured report.
 * It NEVER writes to Notion (the "auto-supersede" capability described
 * in the original §10 spec is explicitly out of scope per the user's
 * 2026-04-29 directive — the auditor surfaces drift; humans resolve it).
 *
 * Class A only. The function does no I/O of its own; the caller
 * supplies both manifests as inputs (pure DI). This makes the auditor
 * trivially testable AND immune to "live Notion fetch is unavailable"
 * regressions — the worst-case is `notionManifest = null`, which
 * yields a degraded-mode report explicit about the uncertainty.
 */

/**
 * Repo-side contract metadata. Built by `parseRepoManifest()` from the
 * markdown front-matter of every `/contracts/agents/*.md` file (plus
 * `viktor.md`). The reader is a separate module; tests pass synthetic
 * manifests directly.
 */
export interface RepoContract {
  /** Path relative to repo root, e.g. "contracts/agents/booke.md". */
  path: string;
  /** First H1 heading, e.g. "Agent Contract — Booke". */
  title: string;
  /**
   * Status string from front-matter, e.g. "CANONICAL (day-one, in-the-loop)"
   * or "DEPRECATED" or undefined. Drives some of the detectors — a repo
   * contract whose Notion mirror is missing is HIGH severity if status
   * is CANONICAL, MEDIUM if DEPRECATED.
   */
  status?: string;
  /**
   * Version semver/string from front-matter (e.g. "1.4 — 2026-04-27").
   * The auditor parses out the numeric portion + the date for
   * comparison. Leave undefined when not present.
   */
  version?: string;
  /** ISO 8601 date extracted from the version string when present. */
  versionDate?: string;
  /** Human owner if specified in front-matter. NEVER "Drew" per doctrine. */
  humanOwner?: string;
  /**
   * Approval slugs the contract references in body text, e.g.
   * `gmail.send`, `qbo.invoice.draft`. The reader scrapes these so
   * the auditor can flag unknown slugs even if the contract has no
   * explicit `Slugs:` front-matter field.
   */
  referencedSlugs: readonly string[];
  /**
   * Optional doctrine-contradiction marker scan result. Set by the
   * reader; an empty array means clean. Each entry is the matched
   * lock id (e.g. "drew-owns-nothing").
   */
  doctrineMarkers: readonly string[];
  /**
   * Raw body text (limited, for evidence snippets). The reader trims
   * to ~50KB to keep the manifest small. Empty string allowed.
   */
  body: string;
}

/**
 * Notion-side canon item metadata. Supplied by an external loader
 * (Notion API, exported manifest JSON, etc.). The auditor is agnostic
 * to the source.
 */
export interface NotionCanonItem {
  /** Notion page id (UUID-like). */
  pageId: string;
  /** Notion canonical URL. */
  url?: string;
  /** Page title. */
  title: string;
  /**
   * The repo path this Notion page mirrors, e.g. "contracts/agents/booke.md".
   * REQUIRED for cross-walk. Pages with no repo mirror are flagged
   * `missing-in-repo` if they have CANONICAL status.
   */
  repoPath?: string;
  /**
   * Status (Notion property): "CANONICAL" / "DRAFT" / "SUPERSEDED" /
   * "ARCHIVED". Drives severity of the missing-in-repo detector.
   */
  status?: string;
  /** Version string (Notion property) — should match `RepoContract.version`. */
  version?: string;
  /** ISO 8601 last-edited timestamp from Notion. */
  lastEditedAt?: string;
  /** Excerpt of body text for evidence snippet. */
  excerpt?: string;
  /** Slug references scraped from the page body. */
  referencedSlugs: readonly string[];
}

export type LockstepDetectorKind =
  | "missing-in-notion"
  | "missing-in-repo"
  | "version-mismatch"
  | "stale-notion-timestamp"
  | "title-mismatch"
  | "doctrine-contradiction"
  | "drew-regression"
  | "unknown-slug";

export type LockstepSeverity = "low" | "medium" | "high" | "critical";

export type LockstepConfidence = "low" | "medium" | "high";

export interface LockstepFinding {
  /**
   * Stable id — sha256(detector + repoPath + notionPageId + sub) — for
   * dedupe across runs. Same inputs → same id.
   */
  id: string;
  detector: LockstepDetectorKind;
  severity: LockstepSeverity;
  /** Confidence — explicit about uncertainty. */
  confidence: LockstepConfidence;
  /** Repo path involved in the mismatch (when available). */
  repoPath?: string;
  /** Notion page id involved in the mismatch (when available). */
  notionPageId?: string;
  /** Notion URL when available. */
  notionUrl?: string;
  /** Short human-readable mismatch type. */
  mismatchType: string;
  /** Evidence snippet (≤ 240 chars). Already redacted by the reader. */
  evidence: string;
  /**
   * One-sentence prompt for the human reviewer ("Open Notion page
   * X, verify the version against the repo's Y"). NEVER routes to
   * Drew — Drew owns nothing per CLAUDE.md doctrine.
   */
  proposedHumanReview: string;
  detectedAt: string;
}

export interface LockstepReport {
  ok: true;
  generatedAt: string;
  /**
   * True iff the auditor ran with both manifests provided. False if
   * either side was null — the report is then degraded-mode and
   * carries `degradedReasons[]`.
   */
  fullyAudited: boolean;
  /** Reasons the auditor ran in degraded mode. */
  degradedReasons: readonly string[];
  /** Total repo contracts scanned. */
  repoCount: number;
  /** Total Notion canon items scanned. */
  notionCount: number;
  /** All findings (deduped by `finding.id`). */
  findings: readonly LockstepFinding[];
  /** Counts by detector. */
  byDetector: Record<LockstepDetectorKind, number>;
  /** Counts by severity. */
  bySeverity: Record<LockstepSeverity, number>;
}

/**
 * What the lockstep summary looks like when surfaced on the
 * `/ops/agents/packs` dashboard. Compact — no findings array, just
 * counts + degraded-mode flag.
 */
export interface LockstepSummary {
  ok: true;
  generatedAt: string;
  fullyAudited: boolean;
  degradedReasons: readonly string[];
  repoCount: number;
  notionCount: number;
  totalFindings: number;
  bySeverity: Record<LockstepSeverity, number>;
  byDetector: Record<LockstepDetectorKind, number>;
}

export interface LockstepSummaryError {
  ok: false;
  error: string;
}
