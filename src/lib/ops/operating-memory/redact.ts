/**
 * Secret redaction for operating-memory captures.
 *
 * Doctrine: /contracts/governance.md §1 #7
 *   "Secrets never live in Notion, Slack, or plaintext repo files.
 *    Managed stores only."
 *
 * The transcript saver writes to Open Brain (and via audit to #ops-audit
 * mirror). Both are searchable surfaces. If a transcript pastes an API
 * key, ACH detail, or an SSN, the redactor scrubs the value before any
 * persistence call returns.
 *
 * Approach: regex against well-known secret shapes. Whitelist over
 * blacklist would be safer but unworkable for free-text recaps; this is
 * a defense-in-depth layer (governance §1 #7 names the SECRET POLICY as
 * the primary protection — managed stores). The redactor's job is to
 * catch the obvious paste-mistake.
 *
 * The redactor returns BOTH the scrubbed text and a list of the kinds
 * matched, so the persisted record can carry `redactedKinds: [...]` in
 * its envelope. This makes "we scrubbed something" observable for drift
 * audit without leaking what.
 */

export type RedactionKind =
  | "api_key"
  | "aws_key"
  | "private_key"
  | "jwt"
  | "slack_token"
  | "github_token"
  | "stripe_key"
  | "openai_key"
  | "supabase_key"
  | "bearer_token"
  | "password_assignment"
  | "ssn"
  | "credit_card"
  | "ach_routing";

interface RedactionPattern {
  kind: RedactionKind;
  /** Regex matching the secret-shaped substring. Must be GLOBAL. */
  re: RegExp;
}

/**
 * Patterns ordered by specificity — more-specific patterns first so a
 * Stripe key isn't double-counted as a generic api_key.
 *
 * NOTE: every regex MUST have the `g` flag. The redactor uses
 * `String.prototype.replaceAll(re, ...)`, which requires a global regex
 * when the first argument is a RegExp.
 */
const PATTERNS: readonly RedactionPattern[] = Object.freeze([
  // AWS access keys — distinctive AKIA / ASIA prefix + 16 chars total
  { kind: "aws_key", re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  // Stripe — sk_live_*, sk_test_*, pk_live_*, pk_test_*
  { kind: "stripe_key", re: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  // OpenAI — sk-... keys (legacy + project)
  { kind: "openai_key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  // GitHub — ghp_*, gho_*, ghu_*, ghs_*, ghr_*
  { kind: "github_token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  // Slack — xox[abprs]-... tokens
  { kind: "slack_token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  // Supabase — sbp_* (admin) or sb_secret_* (service)
  { kind: "supabase_key", re: /\bsb[pa]?_(?:secret_)?[A-Za-z0-9]{20,}\b/g },
  // JWT — three base64 segments separated by dots, leading "eyJ"
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
  // PEM private key block — multiline, but we anchor on the BEGIN line
  {
    kind: "private_key",
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  // Bearer tokens after "Bearer " (common in pasted curl examples)
  { kind: "bearer_token", re: /\bBearer\s+[A-Za-z0-9_-]{20,}\b/g },
  // password=... / "password": "..." — capture the value
  // Allows an optional closing quote on the key ("password": "...") and
  // matches the value whether or not it's quoted. The value pattern
  // `[^\s,}]{6,}` deliberately excludes only whitespace + structural
  // delimiters so embedded special chars (!@#$%) are scrubbed too.
  {
    kind: "password_assignment",
    re: /(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token)["']?\s*[:=]\s*["']?[^\s,}]{6,}/gi,
  },
  // SSN (US) — XXX-XX-XXXX or 9 consecutive digits with dashes/spaces
  { kind: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  // Credit card — 13 to 19 digits with optional dashes/spaces, common shapes
  // Conservative: match Visa/Mastercard/Amex/Discover-shaped runs.
  {
    kind: "credit_card",
    re: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011)[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  },
  // ACH routing/account — labeled or 9-digit-routing+long-account pairs.
  // "routing 123456789 account 9876543210" or "routing: 123456789".
  // The labels are case-insensitive; values are 8-17 digits.
  {
    kind: "ach_routing",
    re: /\b(?:routing|aba|account|acct)\s*(?:#|number|no\.?)?\s*[:=]?\s*\d{8,17}\b/gi,
  },
  // Generic high-entropy api-key-shaped strings (last resort, conservative)
  { kind: "api_key", re: /\b[A-Za-z0-9_-]{40,}\b/g },
]);

const REDACTED_TOKEN = "[REDACTED]";

export interface RedactionResult {
  text: string;
  kinds: RedactionKind[];
}

/**
 * Scrub secret-shaped substrings from `text`. Returns both the scrubbed
 * text and the (deduped) list of pattern kinds that fired.
 *
 * The replacement token is the literal string `[REDACTED]`. We do not
 * include any of the original characters in the replacement — even
 * partial preservation ("first 4 chars") leaks under aggregation.
 */
export function redactSecrets(text: string): RedactionResult {
  if (!text) return { text: "", kinds: [] };

  let out = text;
  const kindsHit = new Set<RedactionKind>();

  for (const { kind, re } of PATTERNS) {
    // Reset lastIndex so successive calls behave consistently — global
    // regex objects retain state between exec/replace calls.
    re.lastIndex = 0;
    if (re.test(out)) {
      kindsHit.add(kind);
      re.lastIndex = 0;
      out = out.replaceAll(re, REDACTED_TOKEN);
    }
  }

  return {
    text: out,
    // Stable order for snapshot tests.
    kinds: [...kindsHit].sort(),
  };
}

/**
 * Cheap predicate — true iff `text` contains a secret-shaped substring
 * the redactor would scrub. Used by validators that want to fail-closed
 * BEFORE persistence rather than relying on post-hoc redaction.
 */
export function containsSecretShape(text: string): boolean {
  if (!text) return false;
  for (const { re } of PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text)) {
      return true;
    }
  }
  return false;
}

/** Exposed for tests. */
export const __INTERNAL = { PATTERNS, REDACTED_TOKEN };
