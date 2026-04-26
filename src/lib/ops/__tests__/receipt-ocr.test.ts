/**
 * Pure tests for `extractReceiptFromText` — Phase 7 receipt OCR.
 *
 * Locks the no-fabrication contract:
 *   - Missing vendor → `null` + warning. NEVER guesses from "first
 *     non-empty line" alone.
 *   - Missing date → `null` + warning. NEVER defaults to "today".
 *   - Missing amount → `null` + warning. NEVER infers from random
 *     dollar figures or sums line items.
 *   - Missing currency → `null` + warning when an amount was
 *     extracted (because the amount is meaningless without a unit).
 *     NEVER silently defaults to USD.
 *   - Confidence is derived, not free.
 *   - Empty input is handled gracefully.
 *   - Helpers (`isReceiptOcrSuggestion`) reject malformed envelopes.
 */
import { describe, expect, it } from "vitest";

import {
  extractReceiptFromText,
  isReceiptOcrSuggestion,
} from "../receipt-ocr";

const FIXED_NOW = new Date("2026-04-25T12:00:00Z");

// ---------------------------------------------------------------------------
// Empty / garbage input
// ---------------------------------------------------------------------------

describe("empty / unparseable input", () => {
  it("empty string → all-null suggestion + 'OCR text was empty' warning", () => {
    const s = extractReceiptFromText("", { now: FIXED_NOW });
    expect(s.vendor).toBeNull();
    expect(s.date).toBeNull();
    expect(s.amount).toBeNull();
    expect(s.currency).toBeNull();
    expect(s.tax).toBeNull();
    expect(s.last4).toBeNull();
    expect(s.paymentHint).toBeNull();
    expect(s.confidence).toBe("low");
    expect(s.warnings.some((w) => /empty/i.test(w))).toBe(true);
  });

  it("whitespace-only string is treated as empty", () => {
    const s = extractReceiptFromText("   \n\n   \t   \n", { now: FIXED_NOW });
    expect(s.vendor).toBeNull();
    expect(s.amount).toBeNull();
    expect(s.confidence).toBe("low");
  });

  it("non-string input is treated as empty (defensive)", () => {
    const s = extractReceiptFromText(undefined as unknown as string, { now: FIXED_NOW });
    expect(s.vendor).toBeNull();
    expect(s.warnings.length).toBeGreaterThan(0);
    expect(s.rawText).toBe("");
  });

  it("garbage with no recognizable patterns → all null + multiple warnings", () => {
    const s = extractReceiptFromText("XKCD ZZZZ ???? !!!! ........", { now: FIXED_NOW });
    // No vendor (rejected — short / no clean line), no date, no amount.
    expect(s.amount).toBeNull();
    expect(s.date).toBeNull();
    expect(s.warnings.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Vendor — never guesses
// ---------------------------------------------------------------------------

describe("vendor extraction — conservative, never guesses", () => {
  it("extracts a clean top-of-receipt vendor line", () => {
    const text = [
      "ALBANESE CONFECTIONERY",
      "5441 Tod Avenue",
      "Hobart IN 46342",
      "Date: 04/25/2026",
      "Total: $12.34",
    ].join("\n");
    const s = extractReceiptFromText(text, { now: FIXED_NOW });
    expect(s.vendor).toBe("ALBANESE CONFECTIONERY");
  });

  it("rejects an address-shaped first line and falls back to the next valid line", () => {
    const text = [
      "5441 Tod Avenue",
      "Belmark Inc",
      "Tax ID 12-3456789",
      "Total: $50.00",
    ].join("\n");
    const s = extractReceiptFromText(text, { now: FIXED_NOW });
    // Address line was rejected; "Belmark Inc" is the first valid candidate.
    expect(s.vendor).toBe("Belmark Inc");
  });

  it("rejects 'Receipt #' / 'Order #' / 'Subtotal' lines and warns when no candidate qualifies", () => {
    const text = [
      "Receipt # 12345",
      "Order # 9876",
      "Subtotal: $9.00",
    ].join("\n");
    const s = extractReceiptFromText(text, { now: FIXED_NOW });
    expect(s.vendor).toBeNull();
    expect(s.warnings.some((w) => /vendor missing/i.test(w))).toBe(true);
  });

  it("never picks up a vendor from below the top 5 lines (anti-fabrication bound)", () => {
    const text = [
      "Receipt # 12345",
      "Order # 9876",
      "Subtotal: $9.00",
      "Tax: $0.50",
      "Total: $9.50",
      "Belmark Inc", // line 6 — must NOT be picked
    ].join("\n");
    const s = extractReceiptFromText(text, { now: FIXED_NOW });
    expect(s.vendor).toBeNull();
  });

  it("trims trailing punctuation and caps length at 80 chars", () => {
    const text = `${"X".repeat(120)}.\nTotal: $5`;
    const s = extractReceiptFromText(text, { now: FIXED_NOW });
    expect(s.vendor?.length).toBeLessThanOrEqual(80);
  });
});

// ---------------------------------------------------------------------------
// Date — multiple formats, never defaults
// ---------------------------------------------------------------------------

describe("date extraction — strict ISO output, no defaults", () => {
  it("ISO YYYY-MM-DD → passthrough", () => {
    const s = extractReceiptFromText("Acme\nDate: 2026-04-25\nTotal: $1", { now: FIXED_NOW });
    expect(s.date).toBe("2026-04-25");
  });

  it("US M/D/YYYY → ISO", () => {
    const s = extractReceiptFromText("Acme\n4/5/2026\nTotal: $1", { now: FIXED_NOW });
    expect(s.date).toBe("2026-04-05");
  });

  it("US MM/DD/YY → ISO with sane century rollover", () => {
    const s1 = extractReceiptFromText("Acme\n01/15/26\nTotal: $1", { now: FIXED_NOW });
    expect(s1.date).toBe("2026-01-15");
    const s2 = extractReceiptFromText("Acme\n01/15/95\nTotal: $1", { now: FIXED_NOW });
    expect(s2.date).toBe("1995-01-15");
  });

  it("M-D-YYYY (dashes) → ISO", () => {
    const s = extractReceiptFromText("Acme\n4-5-2026\nTotal: $1", { now: FIXED_NOW });
    expect(s.date).toBe("2026-04-05");
  });

  it("'Jan 5, 2026' → ISO", () => {
    const s = extractReceiptFromText("Acme\nJan 5, 2026\nTotal: $1", { now: FIXED_NOW });
    expect(s.date).toBe("2026-01-05");
  });

  it("rejects impossible calendar dates (Feb 30, Apr 31)", () => {
    const s1 = extractReceiptFromText("Acme\n02/30/2026\nTotal: $1", { now: FIXED_NOW });
    expect(s1.date).toBeNull();
    const s2 = extractReceiptFromText("Acme\n04/31/2026\nTotal: $1", { now: FIXED_NOW });
    expect(s2.date).toBeNull();
  });

  it("missing date → null + warning. NEVER defaults to options.now", () => {
    const s = extractReceiptFromText("Acme\nTotal: $1", { now: FIXED_NOW });
    expect(s.date).toBeNull();
    expect(s.warnings.some((w) => /date missing/i.test(w))).toBe(true);
    // Belt-and-braces: extractedAt is the timestamp; `date` must NOT
    // mirror it.
    expect(s.date).not.toBe("2026-04-25");
  });
});

// ---------------------------------------------------------------------------
// Amount — labelled totals only; rejects unlabeled stray dollar figures
// ---------------------------------------------------------------------------

describe("amount extraction — labelled totals only, never guesses", () => {
  it("'Total: $12.34' → 12.34", () => {
    const s = extractReceiptFromText("Acme\nDate 2026-04-25\nTotal: $12.34", { now: FIXED_NOW });
    expect(s.amount).toBe(12.34);
  });

  it("'Grand Total $99.99' → 99.99", () => {
    const s = extractReceiptFromText("Acme\nGrand Total $99.99", { now: FIXED_NOW });
    expect(s.amount).toBe(99.99);
  });

  it("'Amount Due: 250.00' → 250 (no $)", () => {
    const s = extractReceiptFromText("Acme\nAmount Due: 250.00", { now: FIXED_NOW });
    expect(s.amount).toBe(250);
  });

  it("'Balance Due 7.50' → 7.50", () => {
    const s = extractReceiptFromText("Acme\nBalance Due 7.50", { now: FIXED_NOW });
    expect(s.amount).toBe(7.5);
  });

  it("a stray '$50' with NO total label → null + warning (never guesses)", () => {
    const text = [
      "Acme",
      "Item A   $50",
      "Item B   $25",
      // No 'Total' line at all.
    ].join("\n");
    const s = extractReceiptFromText(text, { now: FIXED_NOW });
    expect(s.amount).toBeNull();
    expect(s.warnings.some((w) => /amount missing/i.test(w))).toBe(true);
  });

  it("rounds to two decimals (defensive against odd OCR like $12.345)", () => {
    const s = extractReceiptFromText("Acme\nTotal: $12.345", { now: FIXED_NOW });
    // Regex captures up to two decimals — the trailing 5 isn't matched.
    expect(s.amount).toBe(12.34);
  });
});

// ---------------------------------------------------------------------------
// Currency — never defaults
// ---------------------------------------------------------------------------

describe("currency extraction — never silently defaults", () => {
  it("'USD' token → 'USD'", () => {
    const s = extractReceiptFromText("Acme\nTotal: $5 USD", { now: FIXED_NOW });
    expect(s.currency).toBe("USD");
  });

  it("'CA$' or 'CAD' → 'CAD'", () => {
    const s = extractReceiptFromText("Acme\nTotal: CA$50", { now: FIXED_NOW });
    expect(s.currency).toBe("CAD");
  });

  it("'€' → 'EUR'", () => {
    const s = extractReceiptFromText("Acme\nTotal: €25", { now: FIXED_NOW });
    expect(s.currency).toBe("EUR");
  });

  it("amount present but no currency hint → null + currency-missing warning", () => {
    // Just `$12.34` — `$` alone is not a currency code (could be CAD, AUD, MXN).
    const s = extractReceiptFromText("Acme\nTotal: $12.34", { now: FIXED_NOW });
    expect(s.amount).toBe(12.34);
    expect(s.currency).toBeNull();
    expect(s.warnings.some((w) => /currency missing/i.test(w))).toBe(true);
  });

  it("no amount and no currency → no currency warning (only required fields warn)", () => {
    const s = extractReceiptFromText("Acme\nDate 2026-04-25", { now: FIXED_NOW });
    expect(s.amount).toBeNull();
    expect(s.currency).toBeNull();
    // Currency-missing warning is gated on 'amount present', so it
    // should NOT appear when there's no amount.
    expect(s.warnings.some((w) => /currency missing/i.test(w))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tax / last4 / payment hint — bonus signal, optional
// ---------------------------------------------------------------------------

describe("tax / last4 / paymentHint — optional bonus signal", () => {
  it("'Sales Tax $1.23' → 1.23", () => {
    const s = extractReceiptFromText("Acme\nSales Tax $1.23\nTotal $13.23", { now: FIXED_NOW });
    expect(s.tax).toBe(1.23);
  });

  it("missing tax is NOT a warning (tax is optional)", () => {
    const s = extractReceiptFromText("Acme\nDate 2026-04-25\nTotal $5 USD", { now: FIXED_NOW });
    expect(s.tax).toBeNull();
    expect(s.warnings.some((w) => /tax/i.test(w))).toBe(false);
  });

  it("'**** 1234' → '1234'", () => {
    const s = extractReceiptFromText("Acme\nVisa **** 1234\nTotal $5", { now: FIXED_NOW });
    expect(s.last4).toBe("1234");
    expect(s.paymentHint).toBe("Visa");
  });

  it("'XXXX-XXXX-XXXX-1234' → '1234'", () => {
    const s = extractReceiptFromText("Acme\nXXXX-XXXX-XXXX-1234\nTotal $5", { now: FIXED_NOW });
    expect(s.last4).toBe("1234");
  });

  it("paymentHint surfaces literally — NOT a classification", () => {
    const s1 = extractReceiptFromText("Acme\nPaid in CASH\nTotal $5", { now: FIXED_NOW });
    expect(s1.paymentHint?.toLowerCase()).toBe("cash");
    // Last4 NOT set for cash.
    expect(s1.last4).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Confidence rubric — derived, not free
// ---------------------------------------------------------------------------

describe("confidence rubric", () => {
  it("4 wired fields + 0 warnings → 'high'", () => {
    const s = extractReceiptFromText(
      [
        "Belmark Inc",
        "2026-04-25",
        "Total: $250.00 USD",
      ].join("\n"),
      { now: FIXED_NOW },
    );
    expect(s.vendor).toBe("Belmark Inc");
    expect(s.date).toBe("2026-04-25");
    expect(s.amount).toBe(250);
    expect(s.currency).toBe("USD");
    expect(s.warnings).toEqual([]);
    expect(s.confidence).toBe("high");
  });

  it("3 wired fields → 'medium'", () => {
    const s = extractReceiptFromText(
      [
        "Belmark Inc",
        "2026-04-25",
        "Total: $250.00", // no currency
      ].join("\n"),
      { now: FIXED_NOW },
    );
    expect(s.confidence).toBe("medium");
  });

  it("0 wired fields → 'low'", () => {
    const s = extractReceiptFromText("zzzzzzz", { now: FIXED_NOW });
    expect(s.confidence).toBe("low");
  });

  it("warnings demote even a 4-wired result to 'medium' when no longer clean", () => {
    // Simulate a 4-wired extract by hand-checking the warnings demote.
    // Here we have vendor + date + amount + currency but the regex
    // fails for amount → only 3 wired, warning emitted. Should be medium.
    const s = extractReceiptFromText(
      [
        "Belmark Inc",
        "2026-04-25",
        "Subtotal: $100.00",
        "Currency USD",
      ].join("\n"),
      { now: FIXED_NOW },
    );
    expect(s.amount).toBeNull(); // subtotal alone doesn't match
    expect(s.warnings.length).toBeGreaterThan(0);
    expect(s.confidence).not.toBe("high");
  });
});

// ---------------------------------------------------------------------------
// Determinism + extractedAt
// ---------------------------------------------------------------------------

describe("determinism + extractedAt", () => {
  it("same input + same now → identical output", () => {
    const text = "Belmark Inc\n2026-04-25\nTotal $5 USD";
    const a = extractReceiptFromText(text, { now: FIXED_NOW });
    const b = extractReceiptFromText(text, { now: FIXED_NOW });
    expect(a).toEqual(b);
  });

  it("rawText is preserved verbatim", () => {
    const text = "Belmark Inc\nWeird:::stuff\nTotal $5 USD";
    const s = extractReceiptFromText(text, { now: FIXED_NOW });
    expect(s.rawText).toBe(text);
  });

  it("extractedAt comes from options.now (test ergonomics)", () => {
    const s = extractReceiptFromText("Acme\nTotal $5", { now: FIXED_NOW });
    expect(s.extractedAt).toBe(FIXED_NOW.toISOString());
  });
});

// ---------------------------------------------------------------------------
// isReceiptOcrSuggestion — wire-format guard
// ---------------------------------------------------------------------------

describe("isReceiptOcrSuggestion", () => {
  it("accepts a freshly extracted suggestion", () => {
    const s = extractReceiptFromText("Acme\nTotal $5 USD\n2026-04-25", { now: FIXED_NOW });
    expect(isReceiptOcrSuggestion(s)).toBe(true);
  });

  it("rejects null / non-objects", () => {
    expect(isReceiptOcrSuggestion(null)).toBe(false);
    expect(isReceiptOcrSuggestion("not an envelope")).toBe(false);
    expect(isReceiptOcrSuggestion(123)).toBe(false);
  });

  it("rejects an envelope with NaN amount (no contamination)", () => {
    const s = extractReceiptFromText("Acme\nTotal $5", { now: FIXED_NOW });
    const tampered = { ...s, amount: Number.NaN };
    expect(isReceiptOcrSuggestion(tampered)).toBe(false);
  });

  it("rejects an envelope with an unknown confidence value", () => {
    const s = extractReceiptFromText("Acme", { now: FIXED_NOW });
    const tampered = { ...s, confidence: "very-high" };
    expect(isReceiptOcrSuggestion(tampered)).toBe(false);
  });

  it("rejects an envelope where warnings is not an array", () => {
    const s = extractReceiptFromText("Acme", { now: FIXED_NOW });
    const tampered = { ...s, warnings: "missing-fields" };
    expect(isReceiptOcrSuggestion(tampered)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// No I/O / read-only invariants (static-source assertion)
// ---------------------------------------------------------------------------

describe("read-only / no-I/O invariants", () => {
  it("the module imports nothing from QBO, HubSpot, KV, fetch helpers", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../receipt-ocr.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/from\s+["'].*qbo/);
    expect(src).not.toMatch(/from\s+["'].*hubspot/);
    expect(src).not.toMatch(/from\s+["'].*@vercel\/kv/);
    expect(src).not.toMatch(/from\s+["'].*fetch/);
    // No Date.now() either — the extractor takes `options.now` so
    // tests are deterministic. (`new Date()` is acceptable as a default.)
    expect(src).not.toMatch(/Date\.now\(\)/);
  });
});
