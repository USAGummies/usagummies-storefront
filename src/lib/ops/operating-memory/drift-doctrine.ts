/**
 * Drift Detector — canonical doctrine locks.
 *
 * Each lock pairs a canonical contract path with a regex matching the
 * language of a CORRECTION that would contradict that doctrine. When a
 * correction-shaped operating-memory entry matches the regex, the
 * detector emits a `doctrine-contradiction` finding citing the contract
 * path so a human can review.
 *
 * Adding / changing locks is a doctrine change. The pattern here is the
 * runtime mirror — the source of truth is the markdown contract.
 *
 * Pattern philosophy:
 *   - Anchor on action verbs that REVERSE the doctrine ("remove",
 *     "stop", "drop", "skip", "bypass", "let agent do X without
 *     approval").
 *   - Fail-closed = false positive (human reviews and dismisses).
 *   - Fail-open = false negative (drift goes undetected). We accept
 *     more false positives in return for fewer false negatives.
 */

import type { DoctrineLock } from "./drift-types";

export const DOCTRINE_LOCKS: readonly DoctrineLock[] = Object.freeze([
  // ---------------------------------------------------------------------
  // CLAUDE.md / approval-taxonomy.md / session-handoff.md
  // "Drew owns nothing" — Phase 29 doctrine lock 2026-04-27.
  // ---------------------------------------------------------------------
  {
    id: "drew-owns-nothing",
    doc: "CLAUDE.md",
    rule:
      "Drew is not an approver. Drew remains a fulfillment node for samples + East Coast destinations only. " +
      "Reassign approver lanes to Ben (Class B) or Ben+Rene (Class C dual).",
    // Catches: "Drew approves X", "Drew should approve", "Drew signs off",
    // "Drew is the approver", "give Drew approval authority".
    // Note: this is intentionally distinct from drew-regression detector
    // (which scans corrections specifically). This lock fires on ANY
    // entry kind that asserts Drew has approval authority.
    contradictionPattern:
      /\bdrew\s+(?:is|will\s+be|should\s+be|to\s+be|becomes)\s+(?:the\s+)?(?:approver|owner|sign[-\s]?off|authority)\b|\bdrew\s+(?:approves|signs\s*off|owns|approves\s+the)\b|\bgive\s+drew\s+(?:approval|approve|sign[-\s]?off)\b|\bdrew\s+(?:can|may|should)\s+(?:approve|sign[-\s]?off|own)\b/i,
    severity: "high",
  },

  // ---------------------------------------------------------------------
  // operating-memory.md §"BCC-Rene rule on new-customer first emails"
  // (LOCKED 2026-04-28).
  // ---------------------------------------------------------------------
  {
    id: "bcc-rene-on-new-customer",
    doc: "contracts/operating-memory.md",
    rule:
      "Every new-wholesale-customer first email carries BCC: rene@usagummies.com until the customer is " +
      "fully onboarded. Wired in src/lib/wholesale/onboarding-dispatch-prod.ts.",
    contradictionPattern:
      /\b(?:remove|drop|skip|stop|disable|kill)\s+(?:the\s+)?bcc\s+(?:to\s+|on\s+|of\s+)?rene\b|\bdon[''']?t\s+bcc\s+rene\b|\bstop\s+bcc[-\s]?ing\s+rene\b|\bbcc\s+rene\s+is\s+(?:wrong|optional|not\s+needed)\b/i,
    severity: "high",
  },

  // ---------------------------------------------------------------------
  // governance.md §1 #5: "Every agent has exactly one job. No generalists."
  // ---------------------------------------------------------------------
  {
    id: "single-job-per-agent",
    doc: "contracts/governance.md",
    rule:
      "Every agent has exactly one job. No generalists. Bounded scope, specific tools, specific measurable output.",
    contradictionPattern:
      /\b(?:make|let|build)\s+(?:viktor|booke|finance|ops|the\s+agent)\s+(?:also|too)\s+(?:do|handle|run)\b|\bgive\s+(?:viktor|booke|finance|ops)\s+(?:another|a\s+second)\s+job\b/i,
    severity: "medium",
  },

  // ---------------------------------------------------------------------
  // operating-memory.md §"Hard rules" #5: "No silent action."
  // ---------------------------------------------------------------------
  {
    id: "no-silent-action",
    doc: "contracts/operating-memory.md",
    rule:
      "Every autonomous write produces an audit envelope AND a Slack notification. " +
      "No silent action.",
    contradictionPattern:
      /\b(?:skip|disable|don[''']?t\s+(?:write|emit|post)|bypass)\s+(?:the\s+)?audit\s+(?:envelope|log|trail)\b|\bpost\s+without\s+audit\b|\bsuppress\s+(?:the\s+)?(?:audit|#ops-audit)\s+(?:mirror|notification|post)\b/i,
    severity: "high",
  },

  // ---------------------------------------------------------------------
  // approval-taxonomy.md §Class D `qbo.chart-of-accounts.modify`.
  // CoA modification is RED-LINE prohibited; Rene policy.
  // ---------------------------------------------------------------------
  {
    id: "no-agent-coa-modify",
    doc: "contracts/approval-taxonomy.md",
    rule:
      "Modifying the QBO Chart of Accounts is Class D / red-line. CoA is Rene policy; agents never touch. " +
      "Rene edits manually in the QBO UI.",
    contradictionPattern:
      /\b(?:agent|automation|cron|workflow)\s+(?:can|should|will|may)\s+(?:modify|edit|create|add|rename|delete|touch)\s+(?:the\s+)?(?:coa|chart\s+of\s+accounts|qbo\s+account)\b|\blet\s+(?:the\s+)?agent\s+(?:touch|edit|modify|change|update)\s+(?:the\s+)?(?:coa|chart\s+of\s+accounts)\b/i,
    severity: "critical",
  },

  // ---------------------------------------------------------------------
  // CLAUDE.md "Rene investor transfers" red line — Class D.
  // ---------------------------------------------------------------------
  {
    id: "rene-investor-transfer-is-loan",
    doc: "CLAUDE.md",
    rule:
      "Any transfer from Rene G. Gonzalez or the Rene G. Gonzalez Trust is an INVESTOR LOAN (liability), " +
      "NEVER income. Recategorization is Class D / prohibited.",
    contradictionPattern:
      /\brene[''']?s?\s+(?:transfer|deposit|wire)\s+(?:is|should\s+be|categorize\s+as)\s+(?:income|revenue|sales)\b|\b(?:re-?)?categorize\s+rene[''']?s?\s+(?:transfer|deposit|wire)\s+(?:to|as)\s+(?:income|revenue|sales)\b/i,
    severity: "critical",
  },

  // ---------------------------------------------------------------------
  // wholesale-pricing.md §invoice-description rule — Rene 2026-04-28.
  // QBO line text must NOT include "B-tier" prefix; clean prose only.
  // ---------------------------------------------------------------------
  {
    id: "no-btier-prefix-in-invoice-text",
    doc: "contracts/wholesale-pricing.md",
    rule:
      "QBO invoice line text must use clean prose (no 'B2 —' / 'B3 —' tier prefix). Internal B1-B5 tier IDs " +
      "stay in code + audit envelopes only. Rene lock 2026-04-28.",
    contradictionPattern:
      /\b(?:add|put|include|prepend|use)\s+(?:the\s+)?b[1-5][-\s—]\s*(?:prefix|designator)\s+(?:in|on)\s+(?:the\s+)?(?:invoice|qbo)\s+(?:line|description|text)\b|\binvoice\s+line\s+(?:should|must)\s+(?:start\s+with|include)\s+b[1-5]\b/i,
    severity: "medium",
  },

  // ---------------------------------------------------------------------
  // CLAUDE.md "Orders → Ben (Ashford WA), samples → Drew."
  // ---------------------------------------------------------------------
  {
    id: "orders-from-ben-ashford",
    doc: "CLAUDE.md",
    rule:
      "Orders ship from Ben in Ashford, WA. Drew handles samples + East Coast only. Do NOT route customer " +
      "order fulfillment to Drew.",
    contradictionPattern:
      /\b(?:route|send|ship)\s+(?:wholesale|customer|retail)\s+orders?\s+(?:to|via|through|from)\s+drew\b|\bdrew\s+(?:should|will|can)\s+(?:ship|fulfill|pack)\s+(?:wholesale|customer|retail)\s+orders?\b/i,
    severity: "high",
  },
]);
