/**
 * W-7 Rene Response Capture — pattern matcher (pure, no I/O).
 *
 * Extracted from route.ts so the regex + parser can be unit-tested and
 * imported independently. Next.js Route files may only export Route
 * handler symbols (GET / POST / etc.), so exporting helpers from the
 * route itself breaks the App Router type check.
 *
 * SOP: /contracts/agents/viktor-rene-capture.md §Match pattern.
 */

/**
 * Match pattern per viktor-rene-capture.md §Match pattern.
 *
 * Matches the *start* of a message line with optional blockquote/code/
 * bold prefix characters, then a decision id, then optional separator,
 * then the answer payload.
 *
 * Examples that match:
 *   "R.04: 0.95 / 0.70 / escalate"
 *   "J.02: Net 30 A-tier, Net 15 B-tier, prepaid Default"
 *   "CF-01: direct to BofA, checked last payout"
 *   "D.215: 30 / 60 / 90"
 *   "APPROVED: AIS-001 v2"
 *   "REDLINE: ARR-003: change +7 to +10 past-due"
 *   "> R.04 — 0.95 / 0.70 / escalate"  (blockquote prefix OK)
 */
export const W7_ID_PATTERN =
  /^\s*(?:[>`*_-]+\s*)?\*?_?`?((?:[RBJ]\.\d+)|(?:CF-\d+)|(?:D\.\d+)|APPROVED|REDLINE)`?_?\*?\s*[:\-—]\s*(.+)$/im;

export interface W7Match {
  /** Normalized decision id (R.04, J.02, CF-01, D.215, APPROVED, REDLINE). */
  id: string;
  /** The answer payload (trimmed). Never empty. */
  answer: string;
}

/**
 * Apply the W-7 regex to a single message's text. Returns all matches
 * (one message can contain multiple decisions if Rene batches them on
 * separate lines). Returns [] if none.
 */
export function matchW7Message(text: string): W7Match[] {
  const out: W7Match[] = [];
  if (!text) return out;
  // Slack messages are single-string with embedded \n line breaks.
  // We test each line independently so multi-decision messages capture
  // every line, not just the first.
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(W7_ID_PATTERN);
    if (!m) continue;
    const id = m[1].toUpperCase();
    const answer = (m[2] ?? "").trim();
    if (!answer) continue; // refuse empty payload
    out.push({ id, answer });
  }
  return out;
}
