/**
 * Classifier — assigns one of `EntryKind` to a captured operating-memory
 * entry.
 *
 * Doctrine map (operating-memory.md §"What Slack must capture"):
 *   - "Decisions"     → "decision"
 *   - "Corrections"   → "correction"  (drift-detection priority bucket)
 *   - "Follow-up tasks" → "followup"
 *   - "Transcripts" / call recaps (§17) → "transcript"
 *   - "System-generated summaries" (daily brief, weekly KPI) → "report"
 *
 * This classifier is intentionally heuristic + deterministic — no LLM in
 * the loop. The audit envelope cites the matched signals so a future drift
 * audit can review the labeling.
 *
 * Priority order (first match wins):
 *   1. correction — explicit "wrong / actually / correct figure"
 *      patterns. This is the drift-detection signal; we do not want a
 *      correction to be filed as a generic "decision" just because it
 *      includes "we'll lock the rate at $X" downstream.
 *   2. followup — "todo / need to / will follow up / next step"
 *   3. report   — "daily brief / weekly kpi / morning brief / EOD wrap"
 *      (system-summary tells)
 *   4. transcript — "recap / call notes / transcript / meeting notes" or
 *      a long body (>= 1200 chars) with multiple paragraphs
 *   5. decision — "we're locking / we'll go with / decision / locked"
 *   6. fallback → "transcript" (catch-all for §17 §"capture-or-evaporate")
 */

import type { EntryKind } from "./types";

interface Pattern {
  kind: EntryKind;
  /** Tag to attach when this pattern matches. */
  tag: string;
  re: RegExp;
}

const CORRECTION_PATTERNS: Pattern[] = [
  { kind: "correction", tag: "correction:wrong", re: /\b(?:that(?:'s| is|'s actually)?\s+wrong|incorrect|not\s+right|nope)\b/i },
  { kind: "correction", tag: "correction:actually", re: /\bactually[,\s]/i },
  { kind: "correction", tag: "correction:figure", re: /\b(?:the\s+)?(?:correct|actual|real)\s+(?:figure|number|amount|value)\s+(?:is|was)\b/i },
  { kind: "correction", tag: "correction:no-its", re: /\bno[,]?\s+it[''']s\b/i },
  { kind: "correction", tag: "correction:should-be", re: /\bshould\s+(?:be|read|say)\b/i },
  { kind: "correction", tag: "correction:fix", re: /\b(?:please\s+)?(?:fix|correct)\s+(?:this|that|the)\b/i },
];

const FOLLOWUP_PATTERNS: Pattern[] = [
  { kind: "followup", tag: "followup:todo", re: /\b(?:todo|to-do|to do)\b/i },
  { kind: "followup", tag: "followup:need-to", re: /\bneed\s+to\b/i },
  { kind: "followup", tag: "followup:will", re: /\b(?:i|we)\s+will\s+(?:follow\s*up|circle\s*back|chase|test|verify|confirm|reach\s+out)\b/i },
  { kind: "followup", tag: "followup:next-step", re: /\bnext\s+(?:step|action)\b/i },
  { kind: "followup", tag: "followup:action-item", re: /\baction\s+item\b/i },
];

const REPORT_PATTERNS: Pattern[] = [
  { kind: "report", tag: "report:daily-brief", re: /\b(?:daily|morning)\s+brief\b/i },
  { kind: "report", tag: "report:eod-wrap", re: /\b(?:eod|end\s+of\s+day)\s+(?:wrap|summary|brief)\b/i },
  { kind: "report", tag: "report:weekly-kpi", re: /\bweekly\s+kpi\b/i },
  { kind: "report", tag: "report:friday-summary", re: /\bfriday\s+(?:sales|finance)\s+summary\b/i },
  { kind: "report", tag: "report:month-end", re: /\bmonth[-\s]end\s+(?:report|summary|close)\b/i },
];

const TRANSCRIPT_PATTERNS: Pattern[] = [
  { kind: "transcript", tag: "transcript:recap", re: /\b(?:call\s+recap|recap\s+of|meeting\s+recap)\b/i },
  { kind: "transcript", tag: "transcript:notes", re: /\b(?:meeting|call)\s+notes\b/i },
  { kind: "transcript", tag: "transcript:keyword", re: /\b(?:transcript|verbatim)\b/i },
];

const DECISION_PATTERNS: Pattern[] = [
  { kind: "decision", tag: "decision:locking", re: /\bwe(?:'re|\s+are)\s+(?:locking|locked)\b/i },
  { kind: "decision", tag: "decision:go-with", re: /\bwe(?:'ll|\s+will)\s+go\s+with\b/i },
  { kind: "decision", tag: "decision:decided", re: /\b(?:decision|decided)[:\s]/i },
  { kind: "decision", tag: "decision:locked", re: /\b(?:locked|finalized)\s+(?:on|to|at)\b/i },
  { kind: "decision", tag: "decision:approve", re: /\b(?:approved|approval)\b/i },
];

const ALL: readonly Pattern[][] = [
  CORRECTION_PATTERNS,
  FOLLOWUP_PATTERNS,
  REPORT_PATTERNS,
  TRANSCRIPT_PATTERNS,
  DECISION_PATTERNS,
];

export interface Classification {
  kind: EntryKind;
  tags: string[];
  /** Bytes-of-evidence: which patterns fired, in firing order. For audit. */
  matchedPatterns: string[];
}

/**
 * Classify a captured body. Always returns a `Classification` — never
 * throws. Empty body falls through to "transcript" to avoid filing it
 * under a more-actionable kind on no signal.
 */
export function classifyEntry(body: string, kindHint?: EntryKind): Classification {
  if (!body || !body.trim()) {
    return { kind: kindHint ?? "transcript", tags: [], matchedPatterns: [] };
  }

  const tags = new Set<string>();
  const matched: string[] = [];
  let chosen: EntryKind | null = null;

  for (const group of ALL) {
    for (const pat of group) {
      // Reset state on each test (some patterns are stateful via `g` flag,
      // none here are, but defensive).
      const re = new RegExp(pat.re.source, pat.re.flags);
      if (re.test(body)) {
        tags.add(pat.tag);
        matched.push(pat.tag);
        if (chosen === null) chosen = pat.kind;
      }
    }
  }

  // Long-body fallback to "transcript" if nothing else matched and the
  // body looks like a recap (long + multi-paragraph).
  if (chosen === null) {
    const looksLikeRecap = body.length >= 1200 && /\n\s*\n/.test(body);
    chosen = looksLikeRecap ? "transcript" : "transcript";
  }

  // Honor an explicit kindHint when it's compatible — but a "correction"
  // signal in the body always wins, because corrections are the
  // drift-detection input and must not be silently downgraded.
  let finalKind: EntryKind = chosen;
  if (kindHint) {
    const sawCorrection = matched.some((m) => m.startsWith("correction:"));
    if (!sawCorrection) {
      finalKind = kindHint;
    }
  }

  return {
    kind: finalKind,
    tags: [...tags].sort(),
    matchedPatterns: matched,
  };
}

/** Exposed for tests. */
export const __INTERNAL = {
  CORRECTION_PATTERNS,
  FOLLOWUP_PATTERNS,
  REPORT_PATTERNS,
  TRANSCRIPT_PATTERNS,
  DECISION_PATTERNS,
};
