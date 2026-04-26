/**
 * Pure tests for the Phase 13 aggregate review-packets dashboard
 * helpers (`buildReviewPacketsView`, `formatAmountCell`,
 * `formatVendorCell`).
 *
 * Locked rules:
 *   - Sort: draft-first, then most-recent-first by createdAt.
 *   - Status → color: draft=amber, rene-approved=green, rejected=red.
 *   - Vendor / amount fallback: canonical → ocr-suggested → "—".
 *     NEVER fabricated.
 *   - Counts derived verbatim from the rows.
 *   - Format helpers never paraphrase (they append "(ocr)" when
 *     the source is ocr-suggested so the operator knows).
 *   - Pure: same input → same output.
 */
import { describe, expect, it } from "vitest";

import {
  buildReviewPacketsView,
  formatAmountCell,
  formatVendorCell,
} from "../data";
import { buildReceiptReviewPacket } from "@/lib/ops/receipt-review-packet";
import type { ReceiptReviewPacket } from "@/lib/ops/receipt-review-packet";
import type { ReceiptRecord } from "@/lib/ops/docs";
import type { ReceiptOcrSuggestion } from "@/lib/ops/receipt-ocr";

const FIXED_NOW = new Date("2026-04-25T12:00:00Z");

function mkReceipt(overrides: Partial<ReceiptRecord> = {}): ReceiptRecord {
  return {
    id: `r-${Math.random().toString(36).slice(2, 8)}`,
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

function mkPacket(
  overrides: Partial<ReceiptRecord> = {},
  options: {
    status?: ReceiptReviewPacket["status"];
    createdAt?: string;
    ocr?: ReceiptOcrSuggestion;
  } = {},
): ReceiptReviewPacket {
  const receipt = mkReceipt({
    ...overrides,
    ocr_suggestion: options.ocr,
  });
  const base = buildReceiptReviewPacket(receipt, {
    now: options.createdAt ? new Date(options.createdAt) : FIXED_NOW,
  });
  return {
    ...base,
    status: options.status ?? base.status,
  };
}

// ---------------------------------------------------------------------------
// buildReviewPacketsView — sort + counts + projection
// ---------------------------------------------------------------------------

describe("buildReviewPacketsView — sort", () => {
  it("orders draft-first, then most-recent-first within tier", () => {
    const packets = [
      mkPacket(
        { vendor: "Old Approved", date: "2026-04-10", amount: 100, category: "supplies" },
        { status: "rene-approved", createdAt: "2026-04-10T00:00:00Z" },
      ),
      mkPacket(
        { vendor: "Old Draft", date: "2026-04-15", amount: 50, category: "supplies" },
        { status: "draft", createdAt: "2026-04-15T00:00:00Z" },
      ),
      mkPacket(
        { vendor: "New Draft" },
        { status: "draft", createdAt: "2026-04-20T00:00:00Z" },
      ),
      mkPacket(
        { vendor: "Old Reject", date: "2026-04-12", amount: 75, category: "supplies" },
        { status: "rejected", createdAt: "2026-04-12T00:00:00Z" },
      ),
      mkPacket(
        { vendor: "Recent Approved", date: "2026-04-22", amount: 200, category: "supplies" },
        { status: "rene-approved", createdAt: "2026-04-22T00:00:00Z" },
      ),
    ];
    const view = buildReviewPacketsView(packets);
    expect(view.rows.map((r) => r.vendor)).toEqual([
      "New Draft",        // draft / 2026-04-20
      "Old Draft",        // draft / 2026-04-15
      "Recent Approved",  // rene-approved / 2026-04-22 (most recent of terminal)
      "Old Approved",     // rene-approved / 2026-04-10
      "Old Reject",       // rejected / 2026-04-12
    ]);
  });

  it("counts are derived verbatim from the rows (no inflation)", () => {
    const packets = [
      mkPacket({ vendor: "A" }, { status: "draft" }),
      mkPacket({ vendor: "B" }, { status: "draft" }),
      mkPacket({ vendor: "C", date: "2026-04-20", amount: 5, category: "supplies" }, { status: "rene-approved" }),
      mkPacket({ vendor: "D", date: "2026-04-20", amount: 5, category: "supplies" }, { status: "rejected" }),
    ];
    const view = buildReviewPacketsView(packets);
    expect(view.counts).toEqual({
      total: 4,
      draft: 2,
      reneApproved: 1,
      rejected: 1,
    });
  });

  it("empty input → empty rows + zero counts (no fabrication)", () => {
    const view = buildReviewPacketsView([]);
    expect(view.rows).toEqual([]);
    expect(view.counts).toEqual({
      total: 0,
      draft: 0,
      reneApproved: 0,
      rejected: 0,
    });
  });
});

describe("buildReviewPacketsView — status → color", () => {
  it("draft → amber", () => {
    const v = buildReviewPacketsView([mkPacket({}, { status: "draft" })]);
    expect(v.rows[0].color).toBe("amber");
  });
  it("rene-approved → green", () => {
    const v = buildReviewPacketsView([
      mkPacket({}, { status: "rene-approved" }),
    ]);
    expect(v.rows[0].color).toBe("green");
  });
  it("rejected → red", () => {
    const v = buildReviewPacketsView([mkPacket({}, { status: "rejected" })]);
    expect(v.rows[0].color).toBe("red");
  });
});

describe("buildReviewPacketsView — vendor / amount fallback", () => {
  it("canonical wins over OCR for vendor", () => {
    const v = buildReviewPacketsView([
      mkPacket(
        { vendor: "Human Vendor" },
        { ocr: mkOcr({ vendor: "OCR Vendor", amount: 50 }) },
      ),
    ]);
    expect(v.rows[0].vendor).toBe("Human Vendor");
    expect(v.rows[0].vendorSource).toBe("canonical");
  });

  it("OCR is the fallback when canonical empty", () => {
    const v = buildReviewPacketsView([
      mkPacket({}, { ocr: mkOcr({ vendor: "OCR Only", amount: 75 }) }),
    ]);
    expect(v.rows[0].vendor).toBe("OCR Only");
    expect(v.rows[0].vendorSource).toBe("ocr-suggested");
  });

  it("missing on both → null + 'missing' source (NEVER fabricated)", () => {
    const v = buildReviewPacketsView([mkPacket()]);
    expect(v.rows[0].vendor).toBeNull();
    expect(v.rows[0].vendorSource).toBe("missing");
  });

  it("amount: canonical wins; OCR fallback; missing stays null", () => {
    const v = buildReviewPacketsView([
      mkPacket(
        { vendor: "X", date: "2026-04-20", amount: 99, category: "supplies" },
        { ocr: mkOcr({ amount: 999 }) },
      ),
      mkPacket({}, { ocr: mkOcr({ amount: 25 }) }),
      mkPacket(),
    ]);
    expect(v.rows[0].amountUsd).toBe(99);
    expect(v.rows[0].amountSource).toBe("canonical");
    expect(v.rows[1].amountUsd).toBe(25);
    expect(v.rows[1].amountSource).toBe("ocr-suggested");
    expect(v.rows[2].amountUsd).toBeNull();
    expect(v.rows[2].amountSource).toBe("missing");
  });

  it("eligibility flags surfaced verbatim", () => {
    const v = buildReviewPacketsView([
      mkPacket({}), // no canonical, no OCR → ineligible
      mkPacket({
        vendor: "X",
        date: "2026-04-20",
        amount: 5,
        category: "supplies",
      }),
    ]);
    expect(v.rows[0].eligibilityOk).toBe(false);
    expect(v.rows[0].eligibilityMissing).toEqual([
      "vendor",
      "date",
      "amount",
      "category",
    ]);
    // The eligible packet is in `draft` first by sort, but vendor is "X".
    const eligible = v.rows.find((r) => r.vendor === "X")!;
    expect(eligible.eligibilityOk).toBe(true);
    expect(eligible.eligibilityMissing).toEqual([]);
  });
});

describe("buildReviewPacketsView — packetIdShort", () => {
  it("short packet ids pass through unchanged", () => {
    const v = buildReviewPacketsView([mkPacket({ id: "ab" })]);
    // packet id = "pkt-v1-ab" (9 chars) → no truncation.
    expect(v.rows[0].packetIdShort).toBe(v.rows[0].packetId);
    expect(v.rows[0].packetIdShort.endsWith("…")).toBe(false);
  });

  it("long packet ids truncate to 14 chars + ellipsis", () => {
    const v = buildReviewPacketsView([
      mkPacket({ id: "verylongreceiptidextendingfar" }),
    ]);
    // packet id = "pkt-v1-verylongreceiptidextendingfar"
    expect(v.rows[0].packetIdShort.length).toBeLessThanOrEqual(15);
    expect(v.rows[0].packetIdShort.endsWith("…")).toBe(true);
  });
});

describe("buildReviewPacketsView — determinism", () => {
  it("same input → same output (pure)", () => {
    const packets = [
      mkPacket({ vendor: "A" }, { status: "draft", createdAt: "2026-04-20T00:00:00Z" }),
      mkPacket({ vendor: "B", date: "2026-04-20", amount: 5, category: "x" }, { status: "rene-approved", createdAt: "2026-04-21T00:00:00Z" }),
    ];
    const a = buildReviewPacketsView(packets);
    const b = buildReviewPacketsView(packets);
    expect(a).toEqual(b);
  });

  it("does not mutate the input", () => {
    const packets = [
      mkPacket({ vendor: "B" }, { status: "rejected", createdAt: "2026-04-21T00:00:00Z" }),
      mkPacket({ vendor: "A" }, { status: "draft", createdAt: "2026-04-20T00:00:00Z" }),
    ];
    const before = JSON.stringify(packets);
    buildReviewPacketsView(packets);
    expect(JSON.stringify(packets)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// formatAmountCell / formatVendorCell — pure projections
// ---------------------------------------------------------------------------

describe("formatAmountCell", () => {
  it("null → '—' (NEVER synthesized)", () => {
    expect(formatAmountCell(null, "missing")).toBe("—");
    expect(formatAmountCell(null, "canonical")).toBe("—");
    expect(formatAmountCell(null, "ocr-suggested")).toBe("—");
  });

  it("canonical → '$N.NN' (no source tag)", () => {
    expect(formatAmountCell(12.34, "canonical")).toBe("$12.34");
    expect(formatAmountCell(0, "canonical")).toBe("$0.00");
  });

  it("ocr-suggested → '$N.NN (ocr)' (visible source attribution)", () => {
    expect(formatAmountCell(12.34, "ocr-suggested")).toBe("$12.34 (ocr)");
  });

  it("NaN / Infinity → '—' (defensive)", () => {
    expect(formatAmountCell(Number.NaN, "canonical")).toBe("—");
    expect(formatAmountCell(Number.POSITIVE_INFINITY, "canonical")).toBe("—");
  });
});

describe("formatVendorCell", () => {
  it("null / empty / whitespace → '—'", () => {
    expect(formatVendorCell(null, "missing")).toBe("—");
    expect(formatVendorCell("", "canonical")).toBe("—");
    expect(formatVendorCell("   ", "canonical")).toBe("—");
  });

  it("canonical → vendor verbatim", () => {
    expect(formatVendorCell("Belmark Inc", "canonical")).toBe("Belmark Inc");
  });

  it("ocr-suggested → vendor + '(ocr)' suffix", () => {
    expect(formatVendorCell("OCR Vendor", "ocr-suggested")).toBe(
      "OCR Vendor (ocr)",
    );
  });
});
