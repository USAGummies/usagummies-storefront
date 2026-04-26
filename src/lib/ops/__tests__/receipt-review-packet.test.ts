/**
 * Pure tests for `buildReceiptReviewPacket` — Phase 8.
 *
 * Locks the prepare-for-review contract:
 *   - Canonical fields preferred over OCR.
 *   - OCR used as fallback ONLY when canonical is empty.
 *   - Missing fields stay missing — NEVER fabricated.
 *   - Eligibility is honest: `ok: true` iff every required field
 *     has a value in `proposedFields` (vendor / date / amount /
 *     category).
 *   - Taxonomy slug is `null` today + reason names the gap.
 *   - Building does NOT mutate the input receipt or OCR suggestion.
 *   - Module imports nothing from QBO/HubSpot/Slack-send.
 */
import { describe, expect, it } from "vitest";

import { buildReceiptReviewPacket } from "../receipt-review-packet";
import type { ReceiptOcrSuggestion } from "../receipt-ocr";
import type { ReceiptRecord } from "../docs";

const FIXED_NOW = new Date("2026-04-25T12:00:00Z");

function mkReceipt(overrides: Partial<ReceiptRecord> = {}): ReceiptRecord {
  return {
    id: "receipt-1",
    source_url: "https://example.com/receipt.jpg",
    source_channel: "test",
    status: "needs_review",
    processed_at: "2026-04-20T00:00:00Z",
    ...overrides,
  };
}

function mkOcr(
  overrides: Partial<ReceiptOcrSuggestion> = {},
): ReceiptOcrSuggestion {
  return {
    vendor: null,
    date: null,
    amount: null,
    currency: null,
    tax: null,
    last4: null,
    paymentHint: null,
    confidence: "low",
    warnings: [],
    extractedAt: "2026-04-20T01:00:00Z",
    rawText: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Determinism + non-mutation
// ---------------------------------------------------------------------------

describe("determinism + non-mutation", () => {
  it("packetId is deterministic in receipt id (idempotent storage key)", () => {
    const r = mkReceipt({ id: "abc" });
    const a = buildReceiptReviewPacket(r, { now: FIXED_NOW });
    const b = buildReceiptReviewPacket(r, { now: FIXED_NOW });
    expect(a.packetId).toBe(b.packetId);
    expect(a.packetId).toBe("pkt-v1-abc");
  });

  it("does not mutate the input receipt", () => {
    const r = mkReceipt({ vendor: "Belmark Inc" });
    const before = JSON.stringify(r);
    buildReceiptReviewPacket(r, { now: FIXED_NOW });
    expect(JSON.stringify(r)).toBe(before);
  });

  it("does not mutate the input OCR suggestion", () => {
    const ocr = mkOcr({ vendor: "OCR Vendor", warnings: ["foo"] });
    const r = mkReceipt({ ocr_suggestion: ocr });
    const before = JSON.stringify(ocr);
    buildReceiptReviewPacket(r, { now: FIXED_NOW });
    expect(JSON.stringify(ocr)).toBe(before);
  });

  it("createdAt comes from options.now", () => {
    const p = buildReceiptReviewPacket(mkReceipt(), { now: FIXED_NOW });
    expect(p.createdAt).toBe(FIXED_NOW.toISOString());
  });

  it("receiptStatusAtBuild snapshots the receipt's status (visibility lock)", () => {
    const p1 = buildReceiptReviewPacket(
      mkReceipt({ status: "needs_review" }),
      { now: FIXED_NOW },
    );
    expect(p1.receiptStatusAtBuild).toBe("needs_review");
    const p2 = buildReceiptReviewPacket(
      mkReceipt({ status: "ready" }),
      { now: FIXED_NOW },
    );
    expect(p2.receiptStatusAtBuild).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// Canonical-preferred merge
// ---------------------------------------------------------------------------

describe("proposedFields merge — canonical preferred over OCR", () => {
  it("canonical wins when both canonical and OCR have a value", () => {
    const r = mkReceipt({
      vendor: "Human Vendor",
      date: "2026-04-20",
      amount: 50,
      category: "supplies",
      payment_method: "Bank ACH",
      ocr_suggestion: mkOcr({
        vendor: "OCR Vendor",
        date: "2026-04-15",
        amount: 999,
        currency: "USD",
        paymentHint: "Visa",
      }),
    });
    const p = buildReceiptReviewPacket(r, { now: FIXED_NOW });
    expect(p.proposedFields.vendor).toEqual({
      value: "Human Vendor",
      source: "canonical",
    });
    expect(p.proposedFields.date).toEqual({
      value: "2026-04-20",
      source: "canonical",
    });
    expect(p.proposedFields.amount).toEqual({ value: 50, source: "canonical" });
    expect(p.proposedFields.category).toEqual({
      value: "supplies",
      source: "canonical",
    });
    expect(p.proposedFields.payment_method).toEqual({
      value: "Bank ACH",
      source: "canonical",
    });
    // Currency has no canonical column on ReceiptRecord — falls back to OCR.
    expect(p.proposedFields.currency).toEqual({
      value: "USD",
      source: "ocr-suggested",
    });
  });

  it("OCR is used when canonical is empty/whitespace", () => {
    const r = mkReceipt({
      vendor: "  ", // whitespace-only counts as empty
      ocr_suggestion: mkOcr({
        vendor: "OCR Vendor",
        amount: 25,
      }),
    });
    const p = buildReceiptReviewPacket(r, { now: FIXED_NOW });
    expect(p.proposedFields.vendor).toEqual({
      value: "OCR Vendor",
      source: "ocr-suggested",
    });
    expect(p.proposedFields.amount).toEqual({
      value: 25,
      source: "ocr-suggested",
    });
  });

  it("fields stay missing when neither canonical nor OCR have a value", () => {
    const r = mkReceipt({});
    const p = buildReceiptReviewPacket(r, { now: FIXED_NOW });
    expect(p.proposedFields.vendor).toEqual({ value: null, source: "missing" });
    expect(p.proposedFields.date).toEqual({ value: null, source: "missing" });
    expect(p.proposedFields.amount).toEqual({ value: null, source: "missing" });
    expect(p.proposedFields.category).toEqual({ value: null, source: "missing" });
  });

  it("category never falls back to OCR (extractor never proposes category — locked)", () => {
    const r = mkReceipt({
      ocr_suggestion: mkOcr({ vendor: "OCR" }),
    });
    const p = buildReceiptReviewPacket(r, { now: FIXED_NOW });
    expect(p.proposedFields.category).toEqual({ value: null, source: "missing" });
  });

  it("NaN amount in canonical falls through to OCR (defensive)", () => {
    const r = mkReceipt({
      amount: Number.NaN,
      ocr_suggestion: mkOcr({ amount: 7.5 }),
    });
    const p = buildReceiptReviewPacket(r, { now: FIXED_NOW });
    expect(p.proposedFields.amount).toEqual({
      value: 7.5,
      source: "ocr-suggested",
    });
  });
});

// ---------------------------------------------------------------------------
// Eligibility rubric — honest accounting of missing fields
// ---------------------------------------------------------------------------

describe("eligibility rubric — never fabricates", () => {
  it("ok=true when vendor, date, amount, category all have values", () => {
    const r = mkReceipt({
      vendor: "V",
      date: "2026-04-20",
      amount: 10,
      category: "supplies",
    });
    const p = buildReceiptReviewPacket(r, { now: FIXED_NOW });
    expect(p.eligibility.ok).toBe(true);
    expect(p.eligibility.missing).toEqual([]);
  });

  it("ok=false with each missing required field listed verbatim", () => {
    const r = mkReceipt({}); // nothing set
    const p = buildReceiptReviewPacket(r, { now: FIXED_NOW });
    expect(p.eligibility.ok).toBe(false);
    expect(p.eligibility.missing).toEqual([
      "vendor",
      "date",
      "amount",
      "category",
    ]);
  });

  it("amount=0 is a valid value (not a missing field)", () => {
    const r = mkReceipt({
      vendor: "V",
      date: "2026-04-20",
      amount: 0,
      category: "supplies",
    });
    const p = buildReceiptReviewPacket(r, { now: FIXED_NOW });
    expect(p.eligibility.ok).toBe(true);
    expect(p.proposedFields.amount).toEqual({ value: 0, source: "canonical" });
  });

  it("OCR fallback fills required fields and flips ok to true", () => {
    const r = mkReceipt({
      category: "supplies", // canonical
      ocr_suggestion: mkOcr({
        vendor: "OCR Vendor",
        date: "2026-04-20",
        amount: 50,
      }),
    });
    const p = buildReceiptReviewPacket(r, { now: FIXED_NOW });
    expect(p.eligibility.ok).toBe(true);
  });

  it("OCR warnings are surfaced (read-only) under packet warnings", () => {
    const r = mkReceipt({
      ocr_suggestion: mkOcr({
        warnings: ["amount missing", "currency missing"],
      }),
    });
    const p = buildReceiptReviewPacket(r, { now: FIXED_NOW });
    expect(p.eligibility.warnings).toEqual([
      "OCR: amount missing",
      "OCR: currency missing",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Taxonomy gap — locked at the contract level
// ---------------------------------------------------------------------------

describe("taxonomy gap — packet is honest about missing slug", () => {
  it("taxonomy.slug is null by default (no slug exists today)", () => {
    const p = buildReceiptReviewPacket(mkReceipt(), { now: FIXED_NOW });
    expect(p.taxonomy.slug).toBeNull();
  });

  it("taxonomy.classExpected is 'B' (Rene single-approval)", () => {
    const p = buildReceiptReviewPacket(mkReceipt(), { now: FIXED_NOW });
    expect(p.taxonomy.classExpected).toBe("B");
  });

  it("taxonomy.reason names the missing slug + the fail-closed rule", () => {
    const p = buildReceiptReviewPacket(mkReceipt(), { now: FIXED_NOW });
    expect(p.taxonomy.reason).toMatch(/receipt\.review\.promote/);
    expect(p.taxonomy.reason).toMatch(/fail-closed/i);
  });

  it("taxonomyOverride lets a future test stage a registered slug", () => {
    const p = buildReceiptReviewPacket(mkReceipt(), {
      now: FIXED_NOW,
      taxonomyOverride: { slug: "receipt.review.promote", reason: "registered" },
    });
    expect(p.taxonomy.slug).toBe("receipt.review.promote");
    expect(p.taxonomy.reason).toBe("registered");
    // classExpected still defaults to 'B' (override merges).
    expect(p.taxonomy.classExpected).toBe("B");
  });
});

// ---------------------------------------------------------------------------
// Status invariant — packet never becomes 'pending' / 'approved' / 'open'
// ---------------------------------------------------------------------------

describe("packet status invariant", () => {
  it("status is always 'draft' (never opens an approval)", () => {
    const p = buildReceiptReviewPacket(mkReceipt(), { now: FIXED_NOW });
    expect(p.status).toBe("draft");
  });
});

// ---------------------------------------------------------------------------
// Read-only / no forbidden imports
// ---------------------------------------------------------------------------

describe("read-only / no forbidden imports (static-source)", () => {
  it("the module imports nothing from QBO, HubSpot, Slack send, control-plane approvals", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../receipt-review-packet.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/from\s+["'].*qbo/);
    expect(src).not.toMatch(/from\s+["'].*hubspot/);
    expect(src).not.toMatch(/from\s+["'].*slack-(send|client)/);
    // Critically: no import from the approvals store. The packet is
    // a queue item, not an opened approval.
    expect(src).not.toMatch(/from\s+["'].*control-plane\/approvals/);
    expect(src).not.toMatch(/from\s+["'].*control-plane\/stores/);
    // No KV either — packet builder is pure.
    expect(src).not.toMatch(/from\s+["'].*@vercel\/kv/);
    // No Date.now() — `options.now` is the deterministic clock.
    expect(src).not.toMatch(/Date\.now\(\)/);
  });
});
