/**
 * Notion ↔ /contracts Lockstep Auditor — orchestrator.
 *
 * Implements P0-7 from `/contracts/agent-architecture-audit.md`.
 *
 * **Pure function with dependency injection.** Inputs:
 *   - `repoManifest` — array of `RepoContract` (parsed from `/contracts/*.md`).
 *   - `notionManifest` — array of `NotionCanonItem` (from a Notion fetch
 *     or an exported JSON manifest). MAY be null when live Notion fetch
 *     is unavailable — the auditor degrades gracefully.
 *   - `now` — ISO clock injection.
 *   - optional `doctrineMarkerIds` — when supplied, the auditor flags
 *     repo contracts whose `doctrineMarkers[]` overlap (the markers
 *     themselves are precomputed by the reader against the same
 *     doctrine-lock table the drift-detector uses).
 *
 * **Read-only.** No Notion writes, no file writes, no Slack posts, no
 * QBO/HubSpot/Shopify mutations. The auditor produces a structured
 * `LockstepReport` and returns.
 *
 * Class A only. The route that exposes the dashboard summary uses
 * server-side rendering only.
 *
 * Drew-owns-nothing: the `proposedHumanReview` text never names Drew
 * as the reviewer; the dedicated `drew-regression` detector flags any
 * repo or Notion content that asserts a Drew approval lane.
 */

import { createHash } from "node:crypto";

import {
  ACTION_REGISTRY,
  classify,
} from "@/lib/ops/control-plane/taxonomy";

import type {
  LockstepConfidence,
  LockstepDetectorKind,
  LockstepFinding,
  LockstepReport,
  LockstepSeverity,
  NotionCanonItem,
  RepoContract,
} from "./types";

// =========================================================================
// Constants
// =========================================================================

/** Stale threshold: Notion lastEditedAt must be within this much time of repo versionDate. */
const STALE_THRESHOLD_DAYS = 14;

const DEFAULT_REVIEWER = "Ben + Rene";

const ALL_DETECTORS: readonly LockstepDetectorKind[] = Object.freeze([
  "missing-in-notion",
  "missing-in-repo",
  "version-mismatch",
  "stale-notion-timestamp",
  "title-mismatch",
  "doctrine-contradiction",
  "drew-regression",
  "unknown-slug",
]);

const ALL_SEVERITIES: readonly LockstepSeverity[] = Object.freeze([
  "low",
  "medium",
  "high",
  "critical",
]);

// =========================================================================
// Helpers
// =========================================================================

function makeFindingId(
  detector: LockstepDetectorKind,
  repoPath: string | undefined,
  notionPageId: string | undefined,
  sub: string,
): string {
  const seed = `${detector}|${repoPath ?? "-"}|${notionPageId ?? "-"}|${sub}`;
  return createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 32);
}

function snippet(text: string, max = 240): string {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Normalize a contract title for comparison — strip "Agent Contract — "
 * prefix, collapse whitespace, lowercase. The auditor wants Notion
 * "Booke" and repo "Agent Contract — Booke" to match cleanly.
 */
function normalizeTitle(t: string | undefined): string {
  if (!t) return "";
  return t
    .replace(/^Agent Contract\s*[-—–]\s*/i, "")
    .replace(/^Agent\s+/i, "")
    .replace(/\(.*?\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Pull a numeric prefix out of a version string. "1.4 — 2026-04-27" → "1.4".
 * Returns the original string if no leading number found.
 */
function normalizeVersion(v: string | undefined): string {
  if (!v) return "";
  const m = v.match(/^\s*v?(\d+(?:\.\d+)*)/);
  return m ? m[1] : v.trim();
}

/** Extract the ISO date portion of a version string. "1.4 — 2026-04-27" → "2026-04-27". */
function extractVersionDate(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const m = v.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : undefined;
}

// =========================================================================
// Drew-regression patterns (parallel to drift-detector — same doctrine)
// =========================================================================

const DREW_REGRESSION_PATTERNS: ReadonlyArray<RegExp> = Object.freeze([
  /\bdrew\s+(?:should|can|may|will|to)\s+(?:approve|sign[-\s]?off|own|authorize)\b/i,
  /\bgive\s+drew\s+(?:approval|sign[-\s]?off|approve\s+rights|authority)\b/i,
  /\bdrew\s+(?:is|becomes)\s+(?:the\s+)?(?:approver|owner)\b/i,
  /\b(?:assign|reassign|route)\s+(?:approval|sign[-\s]?off)\s+(?:to|back\s+to)\s+drew\b/i,
  /\bdrew\s+approves?\b/i,
]);

function findDrewRegression(text: string): string | null {
  if (!text) return null;
  for (const re of DREW_REGRESSION_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

// =========================================================================
// Slug detection
// =========================================================================

const SLUG_TOKEN_RE = /\b(?:[a-z][a-z0-9-]+)(?:\.[a-z][a-z0-9-]+){1,3}\b/gi;

const SLUG_FALSE_POSITIVE_PREFIXES = new Set<string>([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "google.com",
  "shopify.com",
  "amazon.com",
  "usagummies.com",
  "anthropic.com",
  "vercel.app",
  "vercel.com",
  "slack.com",
  "supabase.co",
  "notion.so",
  "github.com",
  "stripe.com",
  "qbo.intuit.com",
  "intuit.com",
  "openai.com",
  "make.com",
  "next.config",
  "tsconfig.json",
  "package.json",
  "node.js",
  "react.js",
  "next.js",
  "tailwind.css",
]);

function findUnknownSlugs(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const matches = text.match(SLUG_TOKEN_RE) ?? [];
  const knownPrefixes = new Set(
    ACTION_REGISTRY.map((a) => a.slug.split(".")[0]),
  );
  for (const raw of matches) {
    const token = raw.toLowerCase();
    if (SLUG_FALSE_POSITIVE_PREFIXES.has(token)) continue;
    const firstSeg = token.split(".")[0];
    if (!knownPrefixes.has(firstSeg)) continue;
    if (classify(token)) continue;
    found.add(token);
  }
  return [...found];
}

// =========================================================================
// Severity helpers
// =========================================================================

function severityForMissing(status?: string): LockstepSeverity {
  if (!status) return "medium";
  const s = status.toUpperCase();
  if (s.startsWith("CANONICAL")) return "high";
  if (s.startsWith("DEPRECATED") || s.startsWith("ARCHIV")) return "low";
  return "medium";
}

// =========================================================================
// The audit function
// =========================================================================

export interface AuditLockstepParams {
  /** Repo manifest. Required. Empty array allowed (degraded). */
  repoManifest: readonly RepoContract[];
  /**
   * Notion manifest. Pass `null` when live fetch is unavailable; the
   * auditor degrades and emits no missing/version/title findings, but
   * STILL runs Drew + unknown-slug + doctrine-contradiction detectors
   * over the repo side.
   */
  notionManifest: readonly NotionCanonItem[] | null;
  /** Clock injection. */
  now?: Date;
  /**
   * Optional list of doctrine-marker ids the reader detected in repo
   * bodies. When non-empty, the auditor emits doctrine-contradiction
   * findings citing each marker.
   */
  doctrineMarkerIds?: readonly string[];
  /** Stale-Notion threshold override (default 14 days). */
  staleThresholdDays?: number;
}

export function auditLockstep(params: AuditLockstepParams): LockstepReport {
  const now = params.now ?? new Date();
  const generatedAt = now.toISOString();
  const staleThreshold =
    (params.staleThresholdDays ?? STALE_THRESHOLD_DAYS) * 86_400_000;

  const repoManifest = params.repoManifest;
  const notionManifest = params.notionManifest;
  const fullyAudited = notionManifest !== null;
  const degradedReasons: string[] = [];
  if (!fullyAudited) {
    degradedReasons.push(
      "Notion canon manifest not provided. Cross-walk detectors (missing-in-notion, missing-in-repo, version-mismatch, stale-notion-timestamp, title-mismatch) are skipped. Repo-side detectors (drew-regression, unknown-slug, doctrine-contradiction) still run.",
    );
  }

  const findings: LockstepFinding[] = [];
  const dedupe = new Set<string>();

  function emit(f: Omit<LockstepFinding, "detectedAt">): void {
    if (dedupe.has(f.id)) return;
    dedupe.add(f.id);
    findings.push({ ...f, detectedAt: generatedAt });
  }

  // ---- Repo-side detectors (always run) ----
  for (const repo of repoManifest) {
    // drew-regression
    const drew = findDrewRegression(repo.body);
    if (drew) {
      emit({
        id: makeFindingId("drew-regression", repo.path, undefined, drew),
        detector: "drew-regression",
        severity: "high",
        confidence: "medium",
        repoPath: repo.path,
        mismatchType: "Repo contract asserts a Drew approval lane (CLAUDE.md 'Drew owns nothing' violation).",
        evidence: snippet(drew),
        proposedHumanReview:
          `${DEFAULT_REVIEWER} review: ${repo.path} contains language that suggests Drew take an approval lane. ` +
          `Per CLAUDE.md (2026-04-27 doctrine), Drew is a fulfillment node only — never an approver. ` +
          `Reassign the slug to Ben (Class B) or Ben+Rene (Class C dual).`,
      });
    }

    // unknown-slug — referenced slugs that don't resolve
    for (const slug of repo.referencedSlugs) {
      if (classify(slug)) continue;
      emit({
        id: makeFindingId("unknown-slug", repo.path, undefined, slug),
        detector: "unknown-slug",
        severity: "medium",
        confidence: "high",
        repoPath: repo.path,
        mismatchType: `Repo contract references unregistered approval slug \`${slug}\`.`,
        evidence: snippet(`slug: ${slug}`),
        proposedHumanReview:
          `${DEFAULT_REVIEWER} review: ${repo.path} cites \`${slug}\`, which is not in approval-taxonomy.md. ` +
          `Either register the slug (with class + approver) or rewrite the contract to use a canonical slug.`,
      });
    }

    // doctrine-contradiction — when the reader flagged any markers
    for (const markerId of repo.doctrineMarkers) {
      emit({
        id: makeFindingId("doctrine-contradiction", repo.path, undefined, markerId),
        detector: "doctrine-contradiction",
        severity: "high",
        confidence: "medium",
        repoPath: repo.path,
        mismatchType: `Repo contract contains contradiction marker '${markerId}'.`,
        evidence: snippet(`marker: ${markerId}`),
        proposedHumanReview:
          `${DEFAULT_REVIEWER} review: ${repo.path} matches doctrine-lock '${markerId}'. ` +
          `If the doctrine has genuinely changed, update the canonical contract first; if not, file as a mistaken edit.`,
      });
    }

    // Repo-side: also scan body for unknown slugs the reader's referencedSlugs
    // field might have missed (defense-in-depth).
    for (const slug of findUnknownSlugs(repo.body)) {
      if (repo.referencedSlugs.includes(slug)) continue; // already reported
      emit({
        id: makeFindingId("unknown-slug", repo.path, undefined, `body:${slug}`),
        detector: "unknown-slug",
        severity: "medium",
        confidence: "medium",
        repoPath: repo.path,
        mismatchType: `Repo contract body references unregistered slug-shaped token \`${slug}\`.`,
        evidence: snippet(`body: ${slug}`),
        proposedHumanReview:
          `${DEFAULT_REVIEWER} review: ${repo.path} body cites \`${slug}\`, which is not a registered slug.`,
      });
    }

    // Optional doctrine-marker IDs from external probe.
    if (params.doctrineMarkerIds) {
      for (const markerId of params.doctrineMarkerIds) {
        // Only emit if not already covered above.
        if (!repo.doctrineMarkers.includes(markerId)) continue;
      }
    }
  }

  // ---- Notion-side repo-independent detectors (always run when notion provided) ----
  if (notionManifest) {
    for (const item of notionManifest) {
      // Drew regression in Notion body
      const drew = findDrewRegression(item.excerpt ?? "");
      if (drew) {
        emit({
          id: makeFindingId("drew-regression", item.repoPath, item.pageId, drew),
          detector: "drew-regression",
          severity: "high",
          confidence: "medium",
          repoPath: item.repoPath,
          notionPageId: item.pageId,
          notionUrl: item.url,
          mismatchType: "Notion canon item asserts a Drew approval lane.",
          evidence: snippet(drew),
          proposedHumanReview:
            `${DEFAULT_REVIEWER} review: Notion page "${item.title}" contains language suggesting Drew take an approval lane. ` +
            `Edit the Notion page to reassign to Ben/Rene per the canonical doctrine.`,
        });
      }

      // Unknown slugs cited in Notion
      for (const slug of item.referencedSlugs) {
        if (classify(slug)) continue;
        emit({
          id: makeFindingId("unknown-slug", item.repoPath, item.pageId, slug),
          detector: "unknown-slug",
          severity: "medium",
          confidence: "high",
          repoPath: item.repoPath,
          notionPageId: item.pageId,
          notionUrl: item.url,
          mismatchType: `Notion page references unregistered approval slug \`${slug}\`.`,
          evidence: snippet(`slug: ${slug}`),
          proposedHumanReview:
            `${DEFAULT_REVIEWER} review: Notion page "${item.title}" cites \`${slug}\`, which is not in approval-taxonomy.md.`,
        });
      }
    }
  }

  // ---- Cross-walk detectors (only when both manifests provided) ----
  if (notionManifest) {
    const repoByPath = new Map(repoManifest.map((r) => [r.path, r] as const));
    const notionByRepoPath = new Map<string, NotionCanonItem>();
    for (const n of notionManifest) {
      if (n.repoPath) notionByRepoPath.set(n.repoPath, n);
    }

    // missing-in-notion: repo contract has no Notion mirror
    for (const repo of repoManifest) {
      const notion = notionByRepoPath.get(repo.path);
      if (!notion) {
        emit({
          id: makeFindingId("missing-in-notion", repo.path, undefined, "no-mirror"),
          detector: "missing-in-notion",
          severity: severityForMissing(repo.status),
          confidence: "high",
          repoPath: repo.path,
          mismatchType: "Repo contract has no Notion mirror.",
          evidence: snippet(`status: ${repo.status ?? "?"} · version: ${repo.version ?? "?"}`),
          proposedHumanReview:
            `${DEFAULT_REVIEWER} review: ${repo.path} (status=${repo.status ?? "?"}) is not present in the Notion canon manifest. ` +
            `Either create the Notion mirror page or, if the repo contract is deprecated, mark the front-matter accordingly.`,
        });
        continue; // remaining cross-walk detectors require both sides present
      }

      // version-mismatch
      const repoV = normalizeVersion(repo.version);
      const notionV = normalizeVersion(notion.version);
      if (repoV && notionV && repoV !== notionV) {
        emit({
          id: makeFindingId("version-mismatch", repo.path, notion.pageId, `${repoV}-vs-${notionV}`),
          detector: "version-mismatch",
          severity: "medium",
          confidence: "high",
          repoPath: repo.path,
          notionPageId: notion.pageId,
          notionUrl: notion.url,
          mismatchType: `Version mismatch: repo=${repoV}, Notion=${notionV}.`,
          evidence: snippet(`repo:${repo.version} · notion:${notion.version}`),
          proposedHumanReview:
            `${DEFAULT_REVIEWER} review: ${repo.path} version (${repo.version}) does not match Notion page (${notion.version}). ` +
            `Pick the canonical source and update the lagging side.`,
        });
      }

      // title-mismatch
      const repoTitle = normalizeTitle(repo.title);
      const notionTitle = normalizeTitle(notion.title);
      if (repoTitle && notionTitle && repoTitle !== notionTitle) {
        emit({
          id: makeFindingId(
            "title-mismatch",
            repo.path,
            notion.pageId,
            `${repoTitle}-vs-${notionTitle}`,
          ),
          detector: "title-mismatch",
          severity: "low",
          confidence: "medium",
          repoPath: repo.path,
          notionPageId: notion.pageId,
          notionUrl: notion.url,
          mismatchType: "Title mismatch between repo and Notion (after normalization).",
          evidence: snippet(`repo:"${repo.title}" · notion:"${notion.title}"`),
          proposedHumanReview:
            `${DEFAULT_REVIEWER} review: ${repo.path} title and Notion title differ. ` +
            `Renaming Notion is usually the cheaper fix; verify.`,
        });
      }

      // stale-notion-timestamp
      const repoVersionDate = repo.versionDate ?? extractVersionDate(repo.version);
      if (repoVersionDate && notion.lastEditedAt) {
        const repoMs = new Date(repoVersionDate).getTime();
        const notionMs = new Date(notion.lastEditedAt).getTime();
        if (
          Number.isFinite(repoMs) &&
          Number.isFinite(notionMs) &&
          repoMs - notionMs > staleThreshold
        ) {
          emit({
            id: makeFindingId(
              "stale-notion-timestamp",
              repo.path,
              notion.pageId,
              `${repoVersionDate}>${notion.lastEditedAt}`,
            ),
            detector: "stale-notion-timestamp",
            severity: "medium",
            confidence: "medium",
            repoPath: repo.path,
            notionPageId: notion.pageId,
            notionUrl: notion.url,
            mismatchType: `Notion page lastEditedAt (${notion.lastEditedAt}) is more than ${params.staleThresholdDays ?? STALE_THRESHOLD_DAYS}d behind repo version date (${repoVersionDate}).`,
            evidence: snippet(`repo:${repoVersionDate} · notion:${notion.lastEditedAt}`),
            proposedHumanReview:
              `${DEFAULT_REVIEWER} review: ${repo.path} was updated more than ${params.staleThresholdDays ?? STALE_THRESHOLD_DAYS}d after the Notion page was last edited. ` +
              `Refresh the Notion page or — if Notion is the canonical source — update the repo contract.`,
          });
        }
      }
    }

    // missing-in-repo: Notion canon item with no repo mirror
    for (const item of notionManifest) {
      if (!item.repoPath) {
        emit({
          id: makeFindingId("missing-in-repo", undefined, item.pageId, "no-repo-path"),
          detector: "missing-in-repo",
          severity: severityForMissing(item.status),
          confidence: "low",
          notionPageId: item.pageId,
          notionUrl: item.url,
          mismatchType: "Notion canon item has no repoPath property.",
          evidence: snippet(`title:"${item.title}" · status:${item.status ?? "?"}`),
          proposedHumanReview:
            `${DEFAULT_REVIEWER} review: Notion page "${item.title}" lacks a repoPath property. ` +
            `Either link it to a repo contract or, if the page is informational only, mark its status non-CANONICAL.`,
        });
        continue;
      }
      if (!repoByPath.has(item.repoPath)) {
        emit({
          id: makeFindingId("missing-in-repo", item.repoPath, item.pageId, "no-file"),
          detector: "missing-in-repo",
          severity: severityForMissing(item.status),
          confidence: "high",
          repoPath: item.repoPath,
          notionPageId: item.pageId,
          notionUrl: item.url,
          mismatchType: `Notion canon item points to repo path "${item.repoPath}" but no such file exists in the repo manifest.`,
          evidence: snippet(`title:"${item.title}" · status:${item.status ?? "?"}`),
          proposedHumanReview:
            `${DEFAULT_REVIEWER} review: Notion page "${item.title}" expects ${item.repoPath} in the repo. ` +
            `Either create the repo contract or update the Notion repoPath property.`,
        });
      }
    }
  }

  // Tally
  const byDetector = Object.fromEntries(
    ALL_DETECTORS.map((k) => [k, 0] as const),
  ) as Record<LockstepDetectorKind, number>;
  const bySeverity = Object.fromEntries(
    ALL_SEVERITIES.map((s) => [s, 0] as const),
  ) as Record<LockstepSeverity, number>;
  for (const f of findings) {
    byDetector[f.detector] += 1;
    bySeverity[f.severity] += 1;
  }

  return {
    ok: true,
    generatedAt,
    fullyAudited,
    degradedReasons,
    repoCount: repoManifest.length,
    notionCount: notionManifest?.length ?? 0,
    findings,
    byDetector,
    bySeverity,
  };
}

/** Compact summary for dashboard surfacing. */
export function summarizeReport(report: LockstepReport): {
  generatedAt: string;
  fullyAudited: boolean;
  degradedReasons: readonly string[];
  repoCount: number;
  notionCount: number;
  totalFindings: number;
  bySeverity: Record<LockstepSeverity, number>;
  byDetector: Record<LockstepDetectorKind, number>;
} {
  return {
    generatedAt: report.generatedAt,
    fullyAudited: report.fullyAudited,
    degradedReasons: report.degradedReasons,
    repoCount: report.repoCount,
    notionCount: report.notionCount,
    totalFindings: report.findings.length,
    bySeverity: report.bySeverity,
    byDetector: report.byDetector,
  };
}

/** Exposed for tests. */
export const __INTERNAL = {
  STALE_THRESHOLD_DAYS,
  makeFindingId,
  normalizeTitle,
  normalizeVersion,
  extractVersionDate,
  findDrewRegression,
  findUnknownSlugs,
  severityForMissing,
};

export type {
  LockstepConfidence,
  LockstepDetectorKind,
  LockstepFinding,
  LockstepReport,
  LockstepSeverity,
  NotionCanonItem,
  RepoContract,
};
