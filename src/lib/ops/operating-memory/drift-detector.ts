/**
 * Slack-Corrections Drift Detector — orchestrator.
 *
 * Implements P0-1 from `/contracts/agent-architecture-audit.md`:
 *
 *   "On every Claude Code session start (and on cron Wkdy 07:30 PT),
 *    reads recent corrections... extracts the correction tuple... and
 *    surfaces a 1-paragraph 'drift report' to the next session's boot
 *    ritual."
 *
 * This detector READS the operating-memory store (the persisted output
 * of P0-3 transcript-saver) and the canonical contract texts, and
 * emits a structured `DriftReport`. It NEVER writes:
 *   - no operating-memory mutations,
 *   - no contract file mutations,
 *   - no Slack posts,
 *   - no QBO/Shopify/HubSpot writes,
 *   - no permission/secret changes.
 *
 * Class A only. The detector itself does not interact with the audit
 * store directly — the read-only API route may emit a `slack.post.audit`
 * Class A summary if desired, but the library is purely observational.
 *
 * Drew-owns-nothing: the `proposedHumanReview` text NEVER routes review
 * to Drew (the proposal helpers default to "Ben + Rene"). A separate
 * `drew-regression` detector explicitly catches captures that try to
 * reverse the doctrine.
 */

import { createHash } from "node:crypto";

import {
  ACTION_REGISTRY,
  classify,
} from "@/lib/ops/control-plane/taxonomy";

import { DOCTRINE_LOCKS } from "./drift-doctrine";
import {
  operatingMemoryStore,
  type OperatingMemoryStore,
} from "./store";
import type {
  ContractSource,
  DriftDetectorKind,
  DriftFinding,
  DriftReport,
  DriftSeverity,
} from "./drift-types";
import type { OperatingMemoryEntry } from "./types";

// ===========================================================================
// Constants + helpers
// ===========================================================================

/** Default lookback for the cron view: 14 days. */
const DEFAULT_WINDOW_DAYS = 14;

/** Hard cap on entries scanned per run — protects against unbounded reads. */
const MAX_SCAN = 2000;

/** Hard cap on findings per report — protects against pathological inputs. */
const MAX_FINDINGS = 500;

/** Reviewer string. Drew is never named. */
const DEFAULT_REVIEWER = "Ben + Rene";
const FINANCE_REVIEWER = "Rene (CC Ben)";

const ALL_DETECTORS: readonly DriftDetectorKind[] = Object.freeze([
  "drew-regression",
  "class-d-request",
  "unknown-slug",
  "doctrine-contradiction",
  "stale-reference",
]);

const ALL_SEVERITIES: readonly DriftSeverity[] = Object.freeze([
  "low",
  "medium",
  "high",
  "critical",
]);

function makeFindingId(
  detector: DriftDetectorKind,
  fingerprint: string,
  subContext: string,
): string {
  return createHash("sha256")
    .update(`${detector}|${fingerprint}|${subContext}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}

function snippet(body: string, around?: { match: string }): string {
  const text = body.replace(/\s+/g, " ").trim();
  if (!around || !around.match) return text.slice(0, 240);
  const idx = text.toLowerCase().indexOf(around.match.toLowerCase());
  if (idx < 0) return text.slice(0, 240);
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + around.match.length + 120);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

// ===========================================================================
// Detector #1 — Drew approver regression
// ===========================================================================

/**
 * Catches captures that suggest Drew should approve / sign off / own
 * something. This is doctrinally PROHIBITED per CLAUDE.md "Drew owns
 * nothing" 2026-04-27.
 *
 * Distinct from `drew-owns-nothing` doctrine lock (which fires on any
 * entry kind) — this detector specifically targets correction-shaped
 * entries where someone is REQUESTING a Drew approval lane.
 */
const DREW_REGRESSION_PATTERNS: ReadonlyArray<RegExp> = Object.freeze([
  /\bdrew\s+(?:should|can|may|will|to)\s+(?:approve|sign[-\s]?off|own|authorize)\b/i,
  /\bgive\s+drew\s+(?:approval|sign[-\s]?off|approve\s+rights|authority)\b/i,
  /\bdrew\s+(?:is|becomes)\s+(?:the\s+)?(?:approver|owner)\b/i,
  /\b(?:assign|reassign|route)\s+(?:approval|sign[-\s]?off)\s+(?:to|back\s+to)\s+drew\b/i,
  /\bdrew\s+approves?\b/i,
]);

function detectDrewRegression(entry: OperatingMemoryEntry): DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const re of DREW_REGRESSION_PATTERNS) {
    const m = entry.body.match(re);
    if (m) {
      findings.push({
        id: makeFindingId("drew-regression", entry.fingerprint, m[0]),
        detector: "drew-regression",
        severity: "high",
        sourceEntryId: entry.id,
        sourceFingerprint: entry.fingerprint,
        conflictedDoc: "CLAUDE.md",
        evidenceSnippet: snippet(entry.body, { match: m[0] }),
        proposedHumanReview:
          `${DEFAULT_REVIEWER} review: this entry suggests Drew take an approval lane, ` +
          `which contradicts CLAUDE.md "Drew owns nothing" (2026-04-27). ` +
          `Confirm with Ben whether the doctrine has changed before any code update.`,
        detectedAt: new Date().toISOString(),
      });
      break; // one finding per entry per detector
    }
  }
  return findings;
}

// ===========================================================================
// Detector #2 — Class D red-line action requests
// ===========================================================================

/**
 * Class D actions are NEVER autonomous (per /contracts/approval-taxonomy.md
 * §Class D). If a captured entry requests one of these actions in
 * imperative form, that's drift the human must review.
 *
 * We match on either the registered slug verbatim OR a paraphrase of
 * the action description. Slug matches are HIGH severity; paraphrase
 * matches are MEDIUM (lower confidence).
 */
function classDSlugSet(): Set<string> {
  return new Set(ACTION_REGISTRY.filter((a) => a.class === "D").map((a) => a.slug));
}

const CLASS_D_PARAPHRASE_PATTERNS: ReadonlyArray<{ description: string; re: RegExp }> = Object.freeze([
  {
    description: "delete production data",
    re: /\b(?:delete|drop|truncate|wipe|purge)\s+(?:production|prod|live)\s+(?:data|table|schema|records?|rows?)\b/i,
  },
  {
    description: "modify QBO chart of accounts",
    re: /\b(?:agent|automation|cron|workflow)?\s*(?:modify|edit|create|add|rename|delete)\s+(?:the\s+)?(?:qbo\s+)?(?:coa|chart\s+of\s+accounts)\b/i,
  },
  {
    description: "modify permissions / sharing",
    re: /\b(?:modify|change|grant)\s+(?:permissions?|access|sharing|admin\s+rights?)\b/i,
  },
  {
    description: "share or emit a secret",
    re: /\b(?:share|paste|emit|post|leak)\s+(?:the\s+)?(?:api\s+key|secret|access\s+token|credentials?)\s+(?:in|to|into)\s+(?:slack|notion|email|chat)\b/i,
  },
  {
    description: "sign a contract autonomously",
    re: /\b(?:agent|automation)\s+(?:should|can|will)\s+(?:sign|countersign|execute)\s+(?:the\s+)?(?:contract|msa|nda|terms)\b/i,
  },
  {
    description: "force-push or destructive system change",
    re: /\bforce[-\s]push\s+(?:to\s+)?main\b|\brevoke\s+(?:the\s+)?prod\s+(?:api\s+)?key\b|\bdrop\s+(?:the\s+)?supabase\s+schema\b/i,
  },
  {
    description: "publish ad creative without claims review",
    re: /\b(?:publish|launch|push)\s+(?:the\s+)?ad\s+(?:creative|copy)\s+(?:without|skip(?:ping)?)\s+(?:claims?\s+review|approval)\b/i,
  },
  {
    description: "export customer data to external (non-canonical) system",
    re: /\bexport\s+(?:the\s+)?customer\s+(?:data|list|emails?)\s+to\s+(?:an?\s+)?(?:external|third[-\s]?party|outside)\b/i,
  },
  {
    description: "post a journal entry autonomously",
    re: /\b(?:agent|automation|cron)\s+(?:posts?|writes?|creates?)\s+(?:a\s+)?(?:qbo\s+)?(?:journal\s+entry|je)\b/i,
  },
  {
    description: "reopen a closed accounting period",
    re: /\breopen\s+(?:a\s+|the\s+)?(?:closed\s+)?(?:qbo\s+)?(?:accounting\s+)?period\b/i,
  },
  {
    description: "recategorize a Rene investor transfer to income",
    re: /\brecategorize\s+rene[''']?s?\s+(?:transfer|deposit|wire)\s+(?:to|as)\s+(?:income|revenue|sales)\b/i,
  },
]);

function detectClassDRequest(entry: OperatingMemoryEntry): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const seen = new Set<string>();

  // Slug-shaped matches (highest confidence).
  const classD = classDSlugSet();
  for (const slug of classD) {
    const re = new RegExp(`\\b${slug.replace(/\./g, "\\.")}\\b`, "i");
    if (re.test(entry.body)) {
      const id = makeFindingId("class-d-request", entry.fingerprint, `slug:${slug}`);
      if (!seen.has(id)) {
        findings.push({
          id,
          detector: "class-d-request",
          severity: "critical",
          sourceEntryId: entry.id,
          sourceFingerprint: entry.fingerprint,
          conflictedDoc: "contracts/approval-taxonomy.md",
          evidenceSnippet: snippet(entry.body, { match: slug }),
          proposedHumanReview:
            `${DEFAULT_REVIEWER} review: this entry references Class D slug \`${slug}\` ` +
            `(red-line / prohibited per approval-taxonomy.md §Class D). ` +
            `Confirm the request is being routed to a manual human path, never an agent.`,
          detectedAt: new Date().toISOString(),
        });
        seen.add(id);
      }
    }
  }

  // Paraphrase matches (lower confidence — may be discussing risk
  // hypothetically; reviewer dismisses if so).
  for (const { description, re } of CLASS_D_PARAPHRASE_PATTERNS) {
    const m = entry.body.match(re);
    if (m) {
      const id = makeFindingId("class-d-request", entry.fingerprint, `para:${description}`);
      if (!seen.has(id)) {
        findings.push({
          id,
          detector: "class-d-request",
          severity: "high",
          sourceEntryId: entry.id,
          sourceFingerprint: entry.fingerprint,
          conflictedDoc: "contracts/approval-taxonomy.md",
          evidenceSnippet: snippet(entry.body, { match: m[0] }),
          proposedHumanReview:
            `${FINANCE_REVIEWER} review: this entry describes a Class D action ("${description}"). ` +
            `Class D is never autonomous — confirm a human path or escalate.`,
          detectedAt: new Date().toISOString(),
        });
        seen.add(id);
      }
    }
  }

  return findings;
}

// ===========================================================================
// Detector #3 — Unknown approval slugs
// ===========================================================================

/**
 * Approval-taxonomy.md Rule #1: "Fail-closed on unknown actions. If an
 * action slug is not in this registry, agents MUST NOT execute it."
 *
 * We scan for slug-shaped tokens (`<word>.<word>` with optional dot
 * suffixes — e.g. `qbo.invoice.send`, `gmail.send`) and flag any that
 * aren't registered. False positives possible (someone says "gmail.com"
 * — handled with a small whitelist of known non-slug shapes).
 */
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
  // Common file path / module shapes (NOT action slugs)
  "node.js",
  "react.js",
  "next.js",
  "tailwind.css",
]);

function looksLikeRegisteredSlug(token: string): boolean {
  return classify(token) !== undefined;
}

function detectUnknownSlug(entry: OperatingMemoryEntry): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const seen = new Set<string>();
  const matches = entry.body.match(SLUG_TOKEN_RE) ?? [];

  for (const raw of matches) {
    const token = raw.toLowerCase();
    if (SLUG_FALSE_POSITIVE_PREFIXES.has(token)) continue;
    // Skip URL-like (host.tld with no third dot) tokens that don't look
    // like slugs — heuristic: registered slugs always start with a known
    // system word from the registry. If the prefix is the first segment
    // of any registered slug, treat as a candidate; else skip.
    const firstSeg = token.split(".")[0];
    const knownPrefixes = new Set(
      ACTION_REGISTRY.map((a) => a.slug.split(".")[0]),
    );
    if (!knownPrefixes.has(firstSeg)) continue;
    if (looksLikeRegisteredSlug(token)) continue;

    const id = makeFindingId("unknown-slug", entry.fingerprint, token);
    if (seen.has(id)) continue;
    seen.add(id);
    findings.push({
      id,
      detector: "unknown-slug",
      severity: "medium",
      sourceEntryId: entry.id,
      sourceFingerprint: entry.fingerprint,
      conflictedDoc: "contracts/approval-taxonomy.md",
      evidenceSnippet: snippet(entry.body, { match: raw }),
      proposedHumanReview:
        `${DEFAULT_REVIEWER} review: token \`${token}\` looks like an action slug but is not in ` +
        `approval-taxonomy.md. Either register it (with class + approver) or rewrite the entry to use ` +
        `the canonical slug. Fail-closed rule: agents must not execute unknown slugs.`,
      detectedAt: new Date().toISOString(),
    });
  }

  return findings;
}

// ===========================================================================
// Detector #4 — Doctrine contradiction (canonical-lock matches)
// ===========================================================================

function detectDoctrineContradiction(entry: OperatingMemoryEntry): DriftFinding[] {
  const findings: DriftFinding[] = [];

  for (const lock of DOCTRINE_LOCKS) {
    const m = entry.body.match(lock.contradictionPattern);
    if (m) {
      findings.push({
        id: makeFindingId("doctrine-contradiction", entry.fingerprint, lock.id),
        detector: "doctrine-contradiction",
        severity: lock.severity,
        sourceEntryId: entry.id,
        sourceFingerprint: entry.fingerprint,
        conflictedDoc: lock.doc,
        evidenceSnippet: snippet(entry.body, { match: m[0] }),
        proposedHumanReview:
          `${DEFAULT_REVIEWER} review: this entry contradicts canonical lock "${lock.id}" — ${lock.rule} ` +
          `If the doctrine has genuinely changed, update ${lock.doc} first; if not, file the entry as a ` +
          `mistaken correction and mirror to #ops-audit.`,
        detectedAt: new Date().toISOString(),
      });
    }
  }

  return findings;
}

// ===========================================================================
// Detector #5 — Stale contract reference
// ===========================================================================

/**
 * Catches captured entries that cite a contract path which no longer
 * exists in the contract bundle. Common when a doctrine doc was
 * renamed, archived, or the entry was captured before the rename.
 *
 * Uses a regex matched against the pool of available contract paths.
 * Tokens that look like contract paths but aren't in the bundle yield
 * a low-severity finding (likely human review will dismiss but worth
 * surfacing).
 */
const CONTRACT_PATH_RE =
  /\b(?:contracts\/[a-z0-9._/-]+\.md|CLAUDE\.md|ops\/[A-Z0-9._/-]+\.md)\b/gi;

function detectStaleReference(
  entry: OperatingMemoryEntry,
  contracts: readonly ContractSource[],
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const seen = new Set<string>();
  const known = new Set(contracts.map((c) => c.path));
  const matches = entry.body.match(CONTRACT_PATH_RE) ?? [];

  for (const raw of matches) {
    const path = raw;
    // Normalize: strip trailing punctuation that often follows a path
    // in prose ("contracts/foo.md.").
    const normalized = path.replace(/[.,;:)\]]+$/, "");
    if (known.has(normalized)) continue;
    const id = makeFindingId("stale-reference", entry.fingerprint, normalized);
    if (seen.has(id)) continue;
    seen.add(id);
    findings.push({
      id,
      detector: "stale-reference",
      severity: "low",
      sourceEntryId: entry.id,
      sourceFingerprint: entry.fingerprint,
      conflictedDoc: normalized,
      evidenceSnippet: snippet(entry.body, { match: path }),
      proposedHumanReview:
        `${DEFAULT_REVIEWER} review: this entry cites \`${normalized}\` which is not in the current contract ` +
        `bundle. Either the doc was renamed/archived, or the entry references a path that never existed. ` +
        `Verify and update the entry's classification or restore/rename the doc.`,
      detectedAt: new Date().toISOString(),
    });
  }

  return findings;
}

// ===========================================================================
// Public API
// ===========================================================================

export interface DetectDriftParams {
  /** Operating-memory entries to scan. */
  entries: readonly OperatingMemoryEntry[];
  /** Canonical contract bundle (path + text). */
  contracts: readonly ContractSource[];
  /** Optional override for "now" — used in deterministic tests. */
  now?: Date;
  /** Window bounds for reporting purposes (entries should already be filtered). */
  windowFromISO?: string;
  windowToISO?: string;
}

/**
 * Pure detector — accepts entries + contracts, returns a structured
 * report. No I/O, no mutation. This is the test surface.
 *
 * Same input → same output (modulo the `now` clock injection used for
 * `detectedAt` timestamps). Findings are deduped by `finding.id`, so
 * running the detector twice over the same inputs yields the same set
 * of findings (same ids, same content).
 */
export function detectDrift(params: DetectDriftParams): DriftReport {
  const now = params.now ?? new Date();
  const generatedAt = now.toISOString();
  const findings: DriftFinding[] = [];
  const dedupe = new Set<string>();

  function addFindings(produced: DriftFinding[]): void {
    for (const f of produced) {
      if (findings.length >= MAX_FINDINGS) return;
      if (dedupe.has(f.id)) continue;
      dedupe.add(f.id);
      // Override detectedAt with the injected clock for determinism.
      findings.push({ ...f, detectedAt: generatedAt });
    }
  }

  for (const entry of params.entries) {
    // Drew regression — applies primarily to corrections, but also any
    // entry that asserts a Drew approval lane.
    addFindings(detectDrewRegression(entry));
    // Class D — applies to all kinds; fail-closed is the doctrine.
    addFindings(detectClassDRequest(entry));
    // Unknown slug — applies to all kinds.
    addFindings(detectUnknownSlug(entry));
    // Doctrine contradiction — applies to all kinds; the lock patterns
    // discriminate by language.
    addFindings(detectDoctrineContradiction(entry));
    // Stale reference — applies to all kinds.
    addFindings(detectStaleReference(entry, params.contracts));
  }

  // Tally by detector + severity.
  const byDetector = Object.fromEntries(
    ALL_DETECTORS.map((k) => [k, 0] as const),
  ) as Record<DriftDetectorKind, number>;
  const bySeverity = Object.fromEntries(
    ALL_SEVERITIES.map((s) => [s, 0] as const),
  ) as Record<DriftSeverity, number>;

  for (const f of findings) {
    byDetector[f.detector] += 1;
    bySeverity[f.severity] += 1;
  }

  return {
    ok: true,
    generatedAt,
    windowFromISO: params.windowFromISO ?? generatedAt,
    windowToISO: params.windowToISO ?? generatedAt,
    scanned: params.entries.length,
    findings,
    byDetector,
    bySeverity,
  };
}

export interface RunDriftDetectionDeps {
  /** Operating-memory store to read from. Defaults to the factory. */
  store?: OperatingMemoryStore;
  /**
   * Contract loader. Returns the canonical contract bundle. Pure inputs
   * → pure detector results. Tests inject fixtures here; the route
   * supplies a function that reads from disk.
   */
  loadContracts: () => Promise<readonly ContractSource[]>;
  /** Look-back window in days. Defaults to 14. */
  windowDays?: number;
  /** Hard cap on entries scanned. Defaults to MAX_SCAN. */
  maxScan?: number;
  /** Clock injection. */
  now?: () => Date;
}

/**
 * Library-level orchestrator. Pulls recent entries from the
 * operating-memory store, loads contracts via the injected loader,
 * runs `detectDrift()`, returns the report.
 *
 * Side-effect-free except for the read from the store + the (read-only)
 * contract load. Routes layer auth on top.
 */
export async function runDriftDetection(deps: RunDriftDetectionDeps): Promise<DriftReport> {
  const now = (deps.now ?? (() => new Date()))();
  const windowDays = deps.windowDays ?? DEFAULT_WINDOW_DAYS;
  const maxScan = Math.min(deps.maxScan ?? MAX_SCAN, MAX_SCAN);
  const fromMs = now.getTime() - windowDays * 86_400_000;
  const fromISO = new Date(fromMs).toISOString();
  const toISO = now.toISOString();

  const store = deps.store ?? operatingMemoryStore();
  const recent = await store.recent(maxScan);
  const inWindow = recent.filter(
    (e) => e.capturedAt >= fromISO && e.capturedAt <= toISO,
  );

  const contracts = await deps.loadContracts();

  return detectDrift({
    entries: inWindow,
    contracts,
    now,
    windowFromISO: fromISO,
    windowToISO: toISO,
  });
}

/** Exposed for tests. */
export const __INTERNAL = {
  DEFAULT_WINDOW_DAYS,
  MAX_SCAN,
  MAX_FINDINGS,
  makeFindingId,
  detectDrewRegression,
  detectClassDRequest,
  detectUnknownSlug,
  detectDoctrineContradiction,
  detectStaleReference,
};
