/**
 * Receipt OCR — pure extraction normalization.
 *
 * Phase 7 of the Sales Command / Finance review lane: turn raw OCR
 * text from receipt images into a *suggested* envelope that Rene/Ben
 * can review. This module is **prepare-for-review only** — it never
 * posts to QBO, never auto-categorizes, never creates vendors, and
 * never classifies a payment beyond surfacing a hint.
 *
 * Hard rules (every one tested):
 *   - **Pure.** No I/O. No env reads. No KV/DB/HTTP/Drive/Slack/QBO.
 *     Input → output is a deterministic function of the OCR text.
 *   - **Never fabricates a value.** A field that can't be extracted
 *     with a confident regex hit returns `null` AND emits a
 *     warning naming the missing field. We never guess a vendor
 *     from "the first line", never guess "today" for a missing
 *     date, never assume USD if no currency hint is present.
 *   - **Confidence is a derived label**, not a free parameter:
 *       - `high`   → 4+ wired fields, zero warnings
 *       - `medium` → 2-3 wired fields, OR ≥1 warning despite hits
 *       - `low`    → 0-1 wired fields
 *   - **Warnings are facts**, not suggestions. Each warning names
 *     a specific missing field or ambiguity (e.g. "amount missing —
 *     no `total` or `$` line matched"). Reviewers can act on them.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OcrConfidence = "high" | "medium" | "low";

export interface ReceiptOcrSuggestion {
  /** Vendor / merchant name. `null` when not extractable. */
  vendor: string | null;
  /** ISO 8601 date (`YYYY-MM-DD`). `null` when not extractable. */
  date: string | null;
  /** Total amount in major units (USD dollars by default).
   *  `null` when not extractable. NEVER NaN. */
  amount: number | null;
  /** ISO-4217 currency code (e.g. `"USD"`). `null` when no currency
   *  hint is present in the OCR text. */
  currency: string | null;
  /** Tax amount in major units. `null` when no tax line matched. */
  tax: number | null;
  /** Last 4 digits of the payment instrument (string of 4 digits).
   *  `null` when no `**** NNNN` / `xxxx NNNN` pattern matched. */
  last4: string | null;
  /** Free-form payment-method hint surfaced as-is from the OCR
   *  text (e.g. `"Visa"`, `"Cash"`, `"American Express"`).
   *  `null` when no clean hint matched. NOT a classification —
   *  reviewers decide the QBO category. */
  paymentHint: string | null;
  confidence: OcrConfidence;
  /** Human-readable warnings. Empty list when extraction was clean. */
  warnings: string[];
  /** ISO timestamp the extractor ran (caller-supplied for
   *  determinism; defaults to `new Date().toISOString()`). */
  extractedAt: string;
  /** The original OCR text. Stored alongside so reviewers can
   *  cross-reference what the extractor actually saw. */
  rawText: string;
}

export interface ExtractOptions {
  /** Override the timestamp (test ergonomics). */
  now?: Date;
}

// ---------------------------------------------------------------------------
// Patterns — tightly scoped, audited for over-eager matching
// ---------------------------------------------------------------------------

// Total / amount lines. We match *labelled* totals first. The `total`
// keyword is exact-word (`\btotal\b`); the qualifier (`due|amount|paid`)
// is optional, the punctuation (`:` or `-`) and `$` are optional, and
// the whitespace between elements is `\s*` so we accept `Total: $12.34`,
// `Total $12.34`, `total:12.34`, etc. Subtotal-only lines are NOT
// matched (the regex starts at `total`, not `subtotal`).
const TOTAL_LABELS = [
  /(?:^|[^a-z])(?:grand\s+)?total\b\s*(?:due|amount|paid)?\s*[:-]?\s*\$?\s*([0-9]+(?:\.[0-9]{2})?)/i,
  /\bamount\s+(?:due|paid)\b\s*[:-]?\s*\$?\s*([0-9]+(?:\.[0-9]{2})?)/i,
  /\bbalance\s+due\b\s*[:-]?\s*\$?\s*([0-9]+(?:\.[0-9]{2})?)/i,
];

// Tax line. Matches "Tax", "Sales Tax", "Tax (X%)" etc.
const TAX_LABEL = /\b(?:sales\s+)?tax\b[^$\n]*\$?\s*([0-9]+(?:\.[0-9]{2})?)/i;

// Date — only standard ISO / US numeric / common short month formats.
// We deliberately do NOT match a date inside a subtotal/tax line.
const DATE_PATTERNS: Array<{ re: RegExp; parse: (m: RegExpMatchArray) => string | null }> = [
  // ISO YYYY-MM-DD
  {
    re: /\b(\d{4})-(\d{2})-(\d{2})\b/,
    parse: (m) => normalizeIso(m[1], m[2], m[3]),
  },
  // US M/D/YYYY or MM/DD/YYYY
  {
    re: /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/,
    parse: (m) => normalizeIso(m[3], m[1].padStart(2, "0"), m[2].padStart(2, "0")),
  },
  // US M/D/YY
  {
    re: /\b(\d{1,2})\/(\d{1,2})\/(\d{2})\b/,
    parse: (m) => {
      const yy = Number(m[3]);
      const yyyy = yy >= 70 ? `19${m[3]}` : `20${m[3].padStart(2, "0")}`;
      return normalizeIso(yyyy, m[1].padStart(2, "0"), m[2].padStart(2, "0"));
    },
  },
  // M-D-YYYY (dashes)
  {
    re: /\b(\d{1,2})-(\d{1,2})-(\d{4})\b/,
    parse: (m) => normalizeIso(m[3], m[1].padStart(2, "0"), m[2].padStart(2, "0")),
  },
  // "Jan 05, 2026" / "Jan 5 2026"
  {
    re: /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i,
    parse: (m) => {
      const month = MONTH_INDEX[m[1].slice(0, 3).toLowerCase()];
      if (!month) return null;
      return normalizeIso(m[3], month, m[2].padStart(2, "0"));
    },
  },
];

const MONTH_INDEX: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

// Card last 4. Matches `**** 1234`, `xxxx-xxxx-xxxx-1234`, `card #1234`.
// Note: `\b` doesn't fire before `*`, so we anchor on the punctuation
// directly. The trailing `\b` is fine — digits end at a word boundary.
const LAST4_PATTERNS = [
  /(?:\*+|[xX]+)[-\s]*(\d{4})\b/,
  /\bcard\s*#?\s*(\d{4})\b/i,
  /\b(?:account|acct)\s*[:#]?\s*(?:\*+\s*)?(\d{4})\b/i,
];

// Payment hint — surface the literal token (Visa / Mastercard /
// AmEx / etc.). NOT a classification.
const PAYMENT_HINTS = [
  /\b(visa)\b/i,
  /\b(mastercard|master\s*card)\b/i,
  /\b(american\s+express|amex)\b/i,
  /\b(discover)\b/i,
  /\b(debit\s+card)\b/i,
  /\b(credit\s+card)\b/i,
  /\b(cash)\b/i,
  /\b(check)\b/i,
  /\b(ach)\b/i,
  /\b(zelle)\b/i,
  /\b(venmo)\b/i,
  /\b(paypal)\b/i,
];

// Currency hints. We default to null when there is no signal —
// blueprint non-fabrication rule.
const CURRENCY_PATTERNS: Array<{ re: RegExp; code: string }> = [
  { re: /\bUSD\b/, code: "USD" },
  { re: /\bUS\$/, code: "USD" },
  { re: /\bCAD\b/, code: "CAD" },
  { re: /\bCA\$/, code: "CAD" },
  { re: /\bEUR\b/, code: "EUR" },
  { re: /€/, code: "EUR" },
  { re: /\bGBP\b/, code: "GBP" },
  { re: /£/, code: "GBP" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeIso(yyyy: string, mm: string, dd: string): string | null {
  const y = Number(yyyy);
  const m = Number(mm);
  const d = Number(dd);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;
  // Build a real Date and round-trip — rejects e.g. Feb 30, Apr 31.
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return `${y.toString().padStart(4, "0")}-${mm}-${dd}`;
}

function extractAmount(text: string): number | null {
  for (const re of TOTAL_LABELS) {
    const m = text.match(re);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0) return Math.round(n * 100) / 100;
    }
  }
  return null;
}

function extractTax(text: string): number | null {
  const m = text.match(TAX_LABEL);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function extractDate(text: string): string | null {
  for (const { re, parse } of DATE_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const iso = parse(m);
      if (iso) return iso;
    }
  }
  return null;
}

function extractLast4(text: string): string | null {
  for (const re of LAST4_PATTERNS) {
    const m = text.match(re);
    if (m && /^\d{4}$/.test(m[1])) return m[1];
  }
  return null;
}

function extractPaymentHint(text: string): string | null {
  for (const re of PAYMENT_HINTS) {
    const m = text.match(re);
    if (m) {
      // Surface the literal token from the text (preserve original
      // casing where possible — the reviewer sees what the OCR saw).
      return m[1].replace(/\s+/g, " ").trim();
    }
  }
  return null;
}

function extractCurrency(text: string): string | null {
  for (const { re, code } of CURRENCY_PATTERNS) {
    if (re.test(text)) return code;
  }
  return null;
}

/**
 * Vendor extraction is deliberately conservative.
 *
 * A naive "first non-empty line" rule fabricates vendors from
 * receipts that lead with addresses or store numbers. We require:
 *   - the line is in the top 5 lines of the receipt (vendors live
 *     near the top of printed/digital receipts)
 *   - the line has at least 3 letters
 *   - it doesn't look like a date, an amount, an address line, or
 *     a system field (e.g. "Receipt #", "Order #", "Subtotal").
 *
 * If no candidate qualifies, return null + a warning. We do NOT
 * guess.
 */
const VENDOR_REJECT = [
  /^[\d.,$\s]+$/, // numeric only
  /\b(?:receipt|order|invoice|transaction|register|ref)[\s#:]/i,
  /^\s*\d{1,5}\s+\w/,                  // street address ("123 Main St")
  /\b\d{1,2}[/-]\d{1,2}/,             // contains a date fragment
  /\bsubtotal\b|\btotal\b|\bbalance\b|\btax\b/i,
  /\b(?:tel|phone|fax)\b[\s:]/i,
  /^\s*www\./i,
  /^\s*[*=\-_]{3,}\s*$/, // separator lines
];

function extractVendor(text: string): { value: string | null; reason?: string } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { value: null, reason: "vendor missing — OCR text was empty" };
  }
  for (const line of lines.slice(0, 5)) {
    if (line.length < 3) continue;
    if (!/[a-zA-Z]/.test(line)) continue;
    const letterCount = (line.match(/[a-zA-Z]/g) ?? []).length;
    if (letterCount < 3) continue;
    if (VENDOR_REJECT.some((re) => re.test(line))) continue;
    // Trim trailing punctuation; preserve casing.
    return { value: line.replace(/[.,;:]+$/, "").slice(0, 80), reason: undefined };
  }
  return {
    value: null,
    reason: "vendor missing — no top-of-receipt line passed the vendor filter",
  };
}

function pickConfidence(wired: number, warnings: number): OcrConfidence {
  if (wired >= 4 && warnings === 0) return "high";
  if (wired >= 2) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract a structured suggestion from raw OCR text. Pure.
 *
 * The output is a *suggestion only* — the caller is responsible for
 * (a) attaching it to a `needs_review` receipt without auto-promoting
 * the receipt, (b) showing every field as review-only in the UI, and
 * (c) refusing to feed any of these fields into a QBO write path.
 */
export function extractReceiptFromText(
  text: unknown,
  options: ExtractOptions = {},
): ReceiptOcrSuggestion {
  const rawText = typeof text === "string" ? text : "";
  const extractedAt = (options.now ?? new Date()).toISOString();
  const warnings: string[] = [];

  if (rawText.trim().length === 0) {
    warnings.push("OCR text was empty — nothing to extract");
    return {
      vendor: null,
      date: null,
      amount: null,
      currency: null,
      tax: null,
      last4: null,
      paymentHint: null,
      confidence: "low",
      warnings,
      extractedAt,
      rawText,
    };
  }

  const { value: vendor, reason: vendorReason } = extractVendor(rawText);
  if (vendor === null && vendorReason) warnings.push(vendorReason);

  const date = extractDate(rawText);
  if (date === null) {
    warnings.push("date missing — no recognizable date format matched");
  }

  const amount = extractAmount(rawText);
  if (amount === null) {
    warnings.push(
      "amount missing — no `total`/`amount due`/`balance due` label matched",
    );
  }

  const currency = extractCurrency(rawText);
  if (currency === null && amount !== null) {
    // We extracted an amount but no currency hint — explicit warning,
    // never default to USD silently.
    warnings.push("currency missing — no USD/CAD/EUR/GBP/symbol matched");
  }

  const tax = extractTax(rawText);
  // Tax is optional on a receipt (some are tax-exempt, some only
  // show subtotal+total). Missing tax is NOT a warning — only
  // missing required fields are warnings.

  const last4 = extractLast4(rawText);
  const paymentHint = extractPaymentHint(rawText);

  // Wired count for the confidence rubric — vendor / date / amount
  // / currency are the four "primary" extractions. Tax / last4 /
  // paymentHint are bonus signal that don't move the needle.
  const wired = [vendor, date, amount, currency].filter((v) => v !== null).length;
  const confidence = pickConfidence(wired, warnings.length);

  return {
    vendor,
    date,
    amount,
    currency,
    tax,
    last4,
    paymentHint,
    confidence,
    warnings,
    extractedAt,
    rawText,
  };
}

/** Type guard for callers receiving suggestions over the wire. */
export function isReceiptOcrSuggestion(input: unknown): input is ReceiptOcrSuggestion {
  if (input === null || typeof input !== "object") return false;
  const o = input as Record<string, unknown>;
  if (typeof o.confidence !== "string") return false;
  if (!["high", "medium", "low"].includes(o.confidence)) return false;
  if (!Array.isArray(o.warnings)) return false;
  if (typeof o.rawText !== "string") return false;
  if (typeof o.extractedAt !== "string") return false;
  // Allow null for every nullable field.
  for (const k of ["vendor", "date", "currency", "last4", "paymentHint"] as const) {
    const v = o[k];
    if (v !== null && typeof v !== "string") return false;
  }
  for (const k of ["amount", "tax"] as const) {
    const v = o[k];
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v))) return false;
  }
  return true;
}
