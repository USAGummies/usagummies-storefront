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
  applyReviewPacketsFilters,
  buildReviewPacketsView,
  decodeReviewPacketCursor,
  encodeReviewPacketCursor,
  escapeCsvCell,
  filterPacketsBySpec,
  formatAmountCell,
  formatVendorCell,
  paginateReviewPackets,
  parseReviewPacketsFilterSpec,
  renderReviewPacketsCsv,
  reviewPacketsCsvFilename,
  reviewPacketsFilterSpecToQuery,
} from "../data";
import type { ReviewPacketsView } from "../data";
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

// ---------------------------------------------------------------------------
// Phase 14 — applyReviewPacketsFilters (operator filters)
// ---------------------------------------------------------------------------

describe("applyReviewPacketsFilters", () => {
  // Build a fixture view with one of each status + multiple vendors
  // + spread createdAt values so each filter case has both
  // matching and non-matching rows.
  function fixture() {
    return buildReviewPacketsView([
      {
        ...buildReceiptReviewPacket(
          mkReceipt({
            id: "r-belmark",
            vendor: "Belmark Inc",
            date: "2026-04-15",
            amount: 250,
            category: "supplies",
          }),
          { now: new Date("2026-04-15T00:00:00Z") },
        ),
        status: "draft",
      },
      {
        ...buildReceiptReviewPacket(
          mkReceipt({
            id: "r-albanese",
            vendor: "Albanese Confectionery",
            date: "2026-04-20",
            amount: 1200,
            category: "supplies",
          }),
          { now: new Date("2026-04-20T00:00:00Z") },
        ),
        status: "rene-approved",
      },
      {
        ...buildReceiptReviewPacket(
          mkReceipt({
            id: "r-uline",
            vendor: "Uline",
            date: "2026-04-22",
            amount: 50,
            category: "supplies",
          }),
          { now: new Date("2026-04-22T00:00:00Z") },
        ),
        status: "rejected",
      },
      {
        ...buildReceiptReviewPacket(
          mkReceipt({
            id: "r-belmark2",
            vendor: "Belmark Inc",
            date: "2026-04-23",
            amount: 100,
            category: "supplies",
          }),
          { now: new Date("2026-04-23T00:00:00Z") },
        ),
        status: "rene-approved",
      },
    ]);
  }

  it("no spec / all-defaults → returns the input view verbatim", () => {
    const v = fixture();
    const filtered = applyReviewPacketsFilters(v, {});
    expect(filtered.rows.length).toBe(v.rows.length);
    expect(filtered.counts).toEqual(v.counts);
  });

  it("status filter narrows rows + recomputes counts", () => {
    const v = fixture();
    const filtered = applyReviewPacketsFilters(v, { status: "rene-approved" });
    expect(filtered.rows.every((r) => r.status === "rene-approved")).toBe(true);
    expect(filtered.counts).toEqual({
      total: 2,
      draft: 0,
      reneApproved: 2,
      rejected: 0,
    });
  });

  it("status: 'all' → no filter applied (same as undefined)", () => {
    const v = fixture();
    const filteredAll = applyReviewPacketsFilters(v, { status: "all" });
    expect(filteredAll.counts).toEqual(v.counts);
  });

  it("vendor substring filter is case-insensitive", () => {
    const v = fixture();
    const filtered = applyReviewPacketsFilters(v, {
      vendorContains: "BELmark",
    });
    expect(filtered.rows.length).toBe(2);
    expect(
      filtered.rows.every((r) => r.vendor?.toLowerCase().includes("belmark")),
    ).toBe(true);
  });

  it("vendor substring filter tolerates the (ocr) suffix on OCR-suggested cells", () => {
    const v = buildReviewPacketsView([
      {
        ...buildReceiptReviewPacket(
          mkReceipt({
            id: "r-ocr",
            ocr_suggestion: mkOcr({ vendor: "Belmark Inc" }),
          }),
          { now: new Date("2026-04-25T00:00:00Z") },
        ),
        status: "draft",
      },
    ]);
    // The vendor source is ocr-suggested; the formatted cell reads
    // "Belmark Inc (ocr)". The operator's "belmark" should still match.
    const filtered = applyReviewPacketsFilters(v, {
      vendorContains: "belmark",
    });
    expect(filtered.rows.length).toBe(1);
  });

  it("vendor substring with whitespace-only / empty → no filter applied", () => {
    const v = fixture();
    expect(applyReviewPacketsFilters(v, { vendorContains: "" }).counts).toEqual(
      v.counts,
    );
    expect(
      applyReviewPacketsFilters(v, { vendorContains: "   " }).counts,
    ).toEqual(v.counts);
  });

  it("createdAfter filter excludes rows before the threshold", () => {
    const v = fixture();
    const filtered = applyReviewPacketsFilters(v, {
      createdAfter: "2026-04-21",
    });
    // Drops r-belmark (2026-04-15) + r-albanese (2026-04-20).
    expect(filtered.rows.length).toBe(2);
    expect(
      filtered.rows.every((r) => Date.parse(r.createdAt) >= Date.parse("2026-04-21")),
    ).toBe(true);
  });

  it("createdBefore filter excludes rows after the threshold", () => {
    const v = fixture();
    const filtered = applyReviewPacketsFilters(v, {
      createdBefore: "2026-04-21",
    });
    // Keeps r-belmark + r-albanese.
    expect(filtered.rows.length).toBe(2);
  });

  it("date range (after + before) narrows correctly", () => {
    const v = fixture();
    const filtered = applyReviewPacketsFilters(v, {
      createdAfter: "2026-04-19",
      createdBefore: "2026-04-22",
    });
    // Keeps r-albanese (04-20) + r-uline (04-22).
    expect(filtered.rows.length).toBe(2);
  });

  it("unparseable createdAfter / createdBefore → no filter applied (defensive)", () => {
    const v = fixture();
    const filtered = applyReviewPacketsFilters(v, {
      createdAfter: "not-a-date",
      createdBefore: "also-not-a-date",
    });
    expect(filtered.counts).toEqual(v.counts);
  });

  it("combined filters AND together (status + vendor + date)", () => {
    const v = fixture();
    const filtered = applyReviewPacketsFilters(v, {
      status: "rene-approved",
      vendorContains: "belmark",
      createdAfter: "2026-04-22",
    });
    // Only r-belmark2 (rene-approved, Belmark, 04-23) matches.
    expect(filtered.rows.length).toBe(1);
    expect(filtered.rows[0].receiptId).toBe("r-belmark2");
    expect(filtered.counts).toEqual({
      total: 1,
      draft: 0,
      reneApproved: 1,
      rejected: 0,
    });
  });

  it("filter that excludes everything → empty rows + zero counts (no fabrication)", () => {
    const v = fixture();
    const filtered = applyReviewPacketsFilters(v, {
      vendorContains: "no-such-vendor-anywhere",
    });
    expect(filtered.rows).toEqual([]);
    expect(filtered.counts).toEqual({
      total: 0,
      draft: 0,
      reneApproved: 0,
      rejected: 0,
    });
  });

  it("does NOT mutate the input view", () => {
    const v = fixture();
    const before = JSON.stringify(v);
    applyReviewPacketsFilters(v, {
      status: "draft",
      vendorContains: "belmark",
      createdAfter: "2026-04-22",
    });
    expect(JSON.stringify(v)).toBe(before);
  });

  it("pure: same input + same spec → same output", () => {
    const v = fixture();
    const spec = {
      status: "rene-approved" as const,
      vendorContains: "belmark",
    };
    const a = applyReviewPacketsFilters(v, spec);
    const b = applyReviewPacketsFilters(v, spec);
    expect(a).toEqual(b);
  });

  it("rows whose createdAt is unparseable get excluded under any date filter (no silent inclusion)", () => {
    const v: ReturnType<typeof buildReviewPacketsView> = {
      rows: [
        {
          packetId: "pkt-v1-bad",
          packetIdShort: "pkt-v1-bad",
          receiptId: "r-bad",
          status: "draft",
          color: "amber",
          vendor: "Whatever",
          vendorSource: "canonical",
          amountUsd: 1,
          amountSource: "canonical",
          eligibilityOk: false,
          eligibilityMissing: ["date"],
          createdAt: "not-a-date",
          approvalId: null,
          approvalStatus: null,
        },
      ],
      counts: {
        total: 1,
        draft: 1,
        reneApproved: 0,
        rejected: 0,
      },
    };
    const filtered = applyReviewPacketsFilters(v, {
      createdAfter: "2026-04-01",
    });
    expect(filtered.rows.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 15 — query-string parsing + serialization + lockstep filter
// ---------------------------------------------------------------------------

describe("parseReviewPacketsFilterSpec", () => {
  function q(pairs: Record<string, string>): URLSearchParams {
    return new URLSearchParams(pairs);
  }

  it("empty params → empty spec", () => {
    expect(parseReviewPacketsFilterSpec(q({}))).toEqual({});
  });

  it("known status values pass through", () => {
    expect(parseReviewPacketsFilterSpec(q({ status: "draft" }))).toEqual({
      status: "draft",
    });
    expect(parseReviewPacketsFilterSpec(q({ status: "rene-approved" }))).toEqual(
      { status: "rene-approved" },
    );
    expect(parseReviewPacketsFilterSpec(q({ status: "rejected" }))).toEqual({
      status: "rejected",
    });
    expect(parseReviewPacketsFilterSpec(q({ status: "all" }))).toEqual({
      status: "all",
    });
  });

  it("unknown status → omitted (defensive — collapses to no filter)", () => {
    const spec = parseReviewPacketsFilterSpec(q({ status: "fubar" }));
    expect(spec.status).toBeUndefined();
  });

  it("vendor / dates parse through verbatim", () => {
    const spec = parseReviewPacketsFilterSpec(
      q({
        vendor: "Belmark",
        createdAfter: "2026-04-01",
        createdBefore: "2026-04-30",
      }),
    );
    expect(spec).toEqual({
      vendorContains: "Belmark",
      createdAfter: "2026-04-01",
      createdBefore: "2026-04-30",
    });
  });

  it("empty / whitespace string params are omitted from the spec", () => {
    const spec = parseReviewPacketsFilterSpec(
      q({ vendor: "   ", createdAfter: "", createdBefore: " \t " }),
    );
    expect(spec.vendorContains).toBeUndefined();
    expect(spec.createdAfter).toBeUndefined();
    expect(spec.createdBefore).toBeUndefined();
  });

  it("ignores unknown / extra params (URL tracking compatibility)", () => {
    const spec = parseReviewPacketsFilterSpec(
      q({ utm_source: "slack", limit: "200", random: "x" }),
    );
    expect(spec).toEqual({});
  });
});

describe("reviewPacketsFilterSpecToQuery", () => {
  it("empty spec → empty params", () => {
    expect(reviewPacketsFilterSpecToQuery({}).toString()).toBe("");
  });

  it('status: "all" omits the param (route default)', () => {
    expect(
      reviewPacketsFilterSpecToQuery({ status: "all" }).toString(),
    ).toBe("");
  });

  it("status non-default → set", () => {
    expect(
      reviewPacketsFilterSpecToQuery({ status: "rene-approved" }).toString(),
    ).toContain("status=rene-approved");
  });

  it("trims string fields before serializing", () => {
    const params = reviewPacketsFilterSpecToQuery({
      vendorContains: "  Belmark  ",
      createdAfter: " 2026-04-01 ",
    });
    expect(params.get("vendor")).toBe("Belmark");
    expect(params.get("createdAfter")).toBe("2026-04-01");
  });

  it("empty / whitespace string fields are omitted", () => {
    const params = reviewPacketsFilterSpecToQuery({
      vendorContains: "   ",
      createdAfter: "",
    });
    expect(params.get("vendor")).toBeNull();
    expect(params.get("createdAfter")).toBeNull();
  });

  it("round-trip: parse(serialize(spec)) === spec for typical inputs", () => {
    const original: import("../data").ReviewPacketsFilterSpec = {
      status: "draft",
      vendorContains: "Belmark",
      createdAfter: "2026-04-01",
      createdBefore: "2026-04-30",
    };
    const params = reviewPacketsFilterSpecToQuery(original);
    expect(parseReviewPacketsFilterSpec(params)).toEqual(original);
  });
});

describe("filterPacketsBySpec — lockstep with applyReviewPacketsFilters", () => {
  function fixture() {
    return [
      buildReceiptReviewPacket(
        mkReceipt({
          id: "r-belmark",
          vendor: "Belmark Inc",
          date: "2026-04-15",
          amount: 250,
          category: "supplies",
        }),
        { now: new Date("2026-04-15T00:00:00Z") },
      ),
      buildReceiptReviewPacket(
        mkReceipt({
          id: "r-uline",
          vendor: "Uline",
          date: "2026-04-22",
          amount: 50,
          category: "supplies",
        }),
        { now: new Date("2026-04-22T00:00:00Z") },
      ),
    ];
  }

  it("returns the SAME packetIds that applyReviewPacketsFilters keeps", () => {
    const packets = fixture();
    const view = buildReviewPacketsView(packets);
    const spec = { vendorContains: "belmark" };
    const clientFiltered = applyReviewPacketsFilters(view, spec);
    const serverFiltered = filterPacketsBySpec(packets, spec);
    expect(serverFiltered.map((p) => p.packetId).sort()).toEqual(
      clientFiltered.rows.map((r) => r.packetId).sort(),
    );
  });

  it("preserves input order (route returns raw packets — client re-derives view)", () => {
    const packets = fixture();
    const filtered = filterPacketsBySpec(packets, {});
    expect(filtered.map((p) => p.packetId)).toEqual(
      packets.map((p) => p.packetId),
    );
  });

  it("does not mutate the input packets array", () => {
    const packets = fixture();
    const before = JSON.stringify(packets);
    filterPacketsBySpec(packets, { status: "draft" });
    expect(JSON.stringify(packets)).toBe(before);
  });

  it("excluding all → empty array (no fabrication)", () => {
    expect(
      filterPacketsBySpec(fixture(), {
        vendorContains: "no-such-vendor-anywhere",
      }),
    ).toEqual([]);
  });

  it("pure: same input + same spec → same output", () => {
    const packets = fixture();
    const spec = {
      status: "draft" as const,
      vendorContains: "belmark",
    };
    const a = filterPacketsBySpec(packets, spec);
    const b = filterPacketsBySpec(packets, spec);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Phase 16 — approval-status enrichment + filter
// ---------------------------------------------------------------------------

describe("buildReviewPacketsView — approval enrichment (Phase 16)", () => {
  it("returns approvalId/Status as null when no map is passed", () => {
    const v = buildReviewPacketsView([
      buildReceiptReviewPacket(mkReceipt({ id: "r-x" }), { now: FIXED_NOW }),
    ]);
    expect(v.rows[0].approvalId).toBeNull();
    expect(v.rows[0].approvalStatus).toBeNull();
  });

  it("returns approvalId/Status as null when map omits the packet", () => {
    const packet = buildReceiptReviewPacket(mkReceipt({ id: "r-x" }), {
      now: FIXED_NOW,
    });
    const v = buildReviewPacketsView(
      [packet],
      new Map([["pkt-v1-OTHER", { id: "appr-other", status: "pending" }]]),
    );
    expect(v.rows[0].approvalId).toBeNull();
    expect(v.rows[0].approvalStatus).toBeNull();
  });

  it("attaches approvalId/Status when the map has a matching entry", () => {
    const packet = buildReceiptReviewPacket(mkReceipt({ id: "r-x" }), {
      now: FIXED_NOW,
    });
    const v = buildReviewPacketsView(
      [packet],
      new Map([
        [packet.packetId, { id: "appr-123", status: "pending" }],
      ]),
    );
    expect(v.rows[0].approvalId).toBe("appr-123");
    expect(v.rows[0].approvalStatus).toBe("pending");
  });
});

describe("applyReviewPacketsFilters — approvalStatus (Phase 16)", () => {
  function fixtureWithApprovals() {
    const packets = [
      buildReceiptReviewPacket(mkReceipt({ id: "r-pending" }), {
        now: FIXED_NOW,
      }),
      buildReceiptReviewPacket(mkReceipt({ id: "r-approved" }), {
        now: FIXED_NOW,
      }),
      buildReceiptReviewPacket(mkReceipt({ id: "r-no-appr" }), {
        now: FIXED_NOW,
      }),
    ];
    const map = new Map<string, { id: string; status: string }>();
    map.set(packets[0].packetId, { id: "a-pending", status: "pending" });
    map.set(packets[1].packetId, { id: "a-approved", status: "approved" });
    // packets[2] intentionally omitted → no-approval row
    return buildReviewPacketsView(packets, map);
  }

  it('"any" / undefined → all rows pass (no filter)', () => {
    const v = fixtureWithApprovals();
    expect(applyReviewPacketsFilters(v, {}).rows).toHaveLength(3);
    expect(
      applyReviewPacketsFilters(v, { approvalStatus: "any" }).rows,
    ).toHaveLength(3);
  });

  it('"no-approval" → only rows with null approvalStatus', () => {
    const v = fixtureWithApprovals();
    const filtered = applyReviewPacketsFilters(v, {
      approvalStatus: "no-approval",
    });
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0].receiptId).toBe("r-no-appr");
  });

  it('"pending" → only rows whose approvalStatus is exactly "pending"', () => {
    const v = fixtureWithApprovals();
    const filtered = applyReviewPacketsFilters(v, {
      approvalStatus: "pending",
    });
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0].receiptId).toBe("r-pending");
  });

  it('"approved" → only rows whose approvalStatus is exactly "approved"', () => {
    const v = fixtureWithApprovals();
    const filtered = applyReviewPacketsFilters(v, {
      approvalStatus: "approved",
    });
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0].receiptId).toBe("r-approved");
  });

  it("approvalStatus filter combines AND with status / vendor / date filters", () => {
    const v = fixtureWithApprovals();
    const filtered = applyReviewPacketsFilters(v, {
      status: "draft",
      approvalStatus: "pending",
    });
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0].receiptId).toBe("r-pending");
  });

  it("counts re-aggregate after the approvalStatus filter", () => {
    const v = fixtureWithApprovals();
    const filtered = applyReviewPacketsFilters(v, {
      approvalStatus: "pending",
    });
    expect(filtered.counts).toEqual({
      total: 1,
      draft: 1,
      reneApproved: 0,
      rejected: 0,
    });
  });

  it("approvalStatus filter on a view built without a map → only no-approval matches", () => {
    const v = buildReviewPacketsView([
      buildReceiptReviewPacket(mkReceipt({ id: "r-x" }), { now: FIXED_NOW }),
    ]);
    expect(
      applyReviewPacketsFilters(v, { approvalStatus: "pending" }).rows,
    ).toHaveLength(0);
    expect(
      applyReviewPacketsFilters(v, { approvalStatus: "no-approval" }).rows,
    ).toHaveLength(1);
  });
});

describe("parseReviewPacketsFilterSpec — approvalStatus param (Phase 16)", () => {
  function q(pairs: Record<string, string>): URLSearchParams {
    return new URLSearchParams(pairs);
  }

  it("known approval-status values pass through", () => {
    for (const v of [
      "any",
      "no-approval",
      "pending",
      "approved",
      "rejected",
      "expired",
      "stood-down",
    ]) {
      expect(
        parseReviewPacketsFilterSpec(q({ approvalStatus: v })).approvalStatus,
      ).toBe(v);
    }
  });

  it("unknown approvalStatus → omitted (defensive)", () => {
    const spec = parseReviewPacketsFilterSpec(
      q({ approvalStatus: "fubar" }),
    );
    expect(spec.approvalStatus).toBeUndefined();
  });

  it("empty / whitespace approvalStatus → omitted", () => {
    expect(
      parseReviewPacketsFilterSpec(q({ approvalStatus: "" })).approvalStatus,
    ).toBeUndefined();
    expect(
      parseReviewPacketsFilterSpec(q({ approvalStatus: "   " })).approvalStatus,
    ).toBeUndefined();
  });
});

describe("reviewPacketsFilterSpecToQuery — approvalStatus serialization", () => {
  it('approvalStatus: "any" omits the param (default at server)', () => {
    expect(
      reviewPacketsFilterSpecToQuery({ approvalStatus: "any" })
        .toString(),
    ).toBe("");
  });

  it("non-default approvalStatus is set", () => {
    expect(
      reviewPacketsFilterSpecToQuery({ approvalStatus: "pending" })
        .toString(),
    ).toContain("approvalStatus=pending");
  });

  it('approvalStatus: "no-approval" round-trips', () => {
    const spec: import("../data").ReviewPacketsFilterSpec = {
      approvalStatus: "no-approval",
    };
    const params = reviewPacketsFilterSpecToQuery(spec);
    expect(parseReviewPacketsFilterSpec(params)).toEqual(spec);
  });
});

describe("filterPacketsBySpec — approval-status filter parity (Phase 16)", () => {
  it("with map, server filter packetId set matches client helper output", () => {
    const packets = [
      buildReceiptReviewPacket(mkReceipt({ id: "r-pending" }), {
        now: FIXED_NOW,
      }),
      buildReceiptReviewPacket(mkReceipt({ id: "r-approved" }), {
        now: FIXED_NOW,
      }),
    ];
    const map = new Map<string, { id: string; status: string }>([
      [packets[0].packetId, { id: "a1", status: "pending" }],
      [packets[1].packetId, { id: "a2", status: "approved" }],
    ]);
    const spec = { approvalStatus: "pending" as const };
    const view = buildReviewPacketsView(packets, map);
    const clientFiltered = applyReviewPacketsFilters(view, spec);
    const serverFiltered = filterPacketsBySpec(packets, spec, map);
    expect(serverFiltered.map((p) => p.packetId).sort()).toEqual(
      clientFiltered.rows.map((r) => r.packetId).sort(),
    );
  });

  it("without map, approval-status filter (other than 'any'/'no-approval') excludes everything", () => {
    const packets = [
      buildReceiptReviewPacket(mkReceipt({ id: "r-x" }), { now: FIXED_NOW }),
    ];
    expect(
      filterPacketsBySpec(packets, { approvalStatus: "pending" }),
    ).toEqual([]);
    expect(
      filterPacketsBySpec(packets, { approvalStatus: "no-approval" })
        .length,
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 17 — cursor encode/decode + paginateReviewPackets
// ---------------------------------------------------------------------------

describe("encodeReviewPacketCursor / decodeReviewPacketCursor", () => {
  it("round-trips a {ts, packetId} cursor", () => {
    const cursor = { ts: 1735000000000, packetId: "pkt-v1-belmark" };
    const encoded = encodeReviewPacketCursor(cursor);
    expect(decodeReviewPacketCursor(encoded)).toEqual(cursor);
  });

  it("encoded cursor is opaque (base64url, no plaintext)", () => {
    const cursor = { ts: 1, packetId: "pkt-v1-x" };
    const encoded = encodeReviewPacketCursor(cursor);
    // base64url charset only: A-Z a-z 0-9 - _
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    // No raw "pkt-v1-x" leaking through.
    expect(encoded).not.toContain("pkt-v1");
  });

  it("decode returns null for null / undefined / empty / whitespace", () => {
    expect(decodeReviewPacketCursor(null)).toBeNull();
    expect(decodeReviewPacketCursor(undefined)).toBeNull();
    expect(decodeReviewPacketCursor("")).toBeNull();
    expect(decodeReviewPacketCursor("   ")).toBeNull();
  });

  it("decode returns null for malformed base64", () => {
    expect(decodeReviewPacketCursor("!!!not-base64!!!")).toBeNull();
  });

  it("decode returns null for valid base64 but non-JSON payload", () => {
    const garbage = Buffer.from("not json", "utf8").toString("base64url");
    expect(decodeReviewPacketCursor(garbage)).toBeNull();
  });

  it("decode returns null for JSON payload missing ts or packetId", () => {
    const noTs = Buffer.from(
      JSON.stringify({ packetId: "x" }),
      "utf8",
    ).toString("base64url");
    expect(decodeReviewPacketCursor(noTs)).toBeNull();
    const noPid = Buffer.from(
      JSON.stringify({ ts: 1 }),
      "utf8",
    ).toString("base64url");
    expect(decodeReviewPacketCursor(noPid)).toBeNull();
  });

  it("decode returns null for JSON payload with wrong types", () => {
    const wrong = Buffer.from(
      JSON.stringify({ ts: "not-a-number", packetId: "x" }),
      "utf8",
    ).toString("base64url");
    expect(decodeReviewPacketCursor(wrong)).toBeNull();
  });

  it("decode rejects empty packetId (defensive — prevents pagination loop)", () => {
    const empty = Buffer.from(
      JSON.stringify({ ts: 1, packetId: "" }),
      "utf8",
    ).toString("base64url");
    expect(decodeReviewPacketCursor(empty)).toBeNull();
  });
});

describe("paginateReviewPackets", () => {
  function packetAt(id: string, iso: string) {
    return buildReceiptReviewPacket(mkReceipt({ id }), { now: new Date(iso) });
  }

  function fixture(): ReturnType<typeof packetAt>[] {
    // Note: createdAt is NOT in canonical sort order — function
    // must re-sort internally.
    return [
      packetAt("r-old-a", "2026-04-15T00:00:00Z"),
      packetAt("r-new-a", "2026-04-25T00:00:00Z"),
      packetAt("r-tied-b", "2026-04-20T00:00:00Z"),
      packetAt("r-mid-a", "2026-04-18T00:00:00Z"),
      packetAt("r-tied-a", "2026-04-20T00:00:00Z"),
    ];
  }

  it("first page returns most-recent packets first; nextCursor non-null when more remain", () => {
    const r = paginateReviewPackets(fixture(), { limit: 2 });
    expect(r.page).toHaveLength(2);
    // packetId is "pkt-v1-r-..." — the new-a packet has the most
    // recent createdAt.
    expect(r.page[0].receiptId).toBe("r-new-a");
    expect(r.nextCursor).not.toBeNull();
  });

  it("traversing all pages with the returned cursors visits every packet exactly once, in canonical order", () => {
    const packets = fixture();
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let safety = 0; safety < 20; safety++) {
      const r: ReturnType<typeof paginateReviewPackets> = paginateReviewPackets(
        packets,
        { limit: 2, cursor },
      );
      for (const p of r.page) seen.push(p.receiptId);
      if (!r.nextCursor) break;
      cursor = r.nextCursor;
    }
    expect(seen).toEqual([
      "r-new-a",   // 04-25
      "r-tied-a",  // 04-20 (tie-broken asc by packetId pkt-v1-r-tied-a)
      "r-tied-b",  // 04-20 (pkt-v1-r-tied-b)
      "r-mid-a",   // 04-18
      "r-old-a",   // 04-15
    ]);
    expect(seen.length).toBe(packets.length);
    // No duplicates.
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("nextCursor is null when fewer than limit items remain", () => {
    const r = paginateReviewPackets(fixture(), { limit: 100 });
    expect(r.page.length).toBe(5);
    expect(r.nextCursor).toBeNull();
  });

  it("limit clamped to [1, 500]", () => {
    expect(paginateReviewPackets(fixture(), { limit: 0 }).page.length).toBe(1);
    expect(paginateReviewPackets(fixture(), { limit: -5 }).page.length).toBe(1);
    expect(paginateReviewPackets(fixture(), { limit: 999_999 }).page.length).toBe(
      5,
    );
  });

  it("malformed cursor falls back to first page (defensive — never throws)", () => {
    const r = paginateReviewPackets(fixture(), {
      cursor: "not-a-real-cursor",
      limit: 2,
    });
    expect(r.page).toHaveLength(2);
    expect(r.page[0].receiptId).toBe("r-new-a");
  });

  it("empty input → empty page + null cursor", () => {
    const r = paginateReviewPackets([], { limit: 100 });
    expect(r.page).toEqual([]);
    expect(r.nextCursor).toBeNull();
  });

  it("does not mutate the input array", () => {
    const packets = fixture();
    const before = JSON.stringify(packets);
    paginateReviewPackets(packets, { limit: 2 });
    expect(JSON.stringify(packets)).toBe(before);
  });

  it("ties on createdAt break by packetId asc (stable order across pages)", () => {
    // Three packets with identical createdAt, different ids.
    const tied = [
      packetAt("r-c", "2026-04-20T00:00:00Z"),
      packetAt("r-a", "2026-04-20T00:00:00Z"),
      packetAt("r-b", "2026-04-20T00:00:00Z"),
    ];
    const all: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i++) {
      const r: ReturnType<typeof paginateReviewPackets> = paginateReviewPackets(
        tied,
        { limit: 1, cursor },
      );
      if (r.page.length === 0) break;
      all.push(r.page[0].receiptId);
      if (!r.nextCursor) break;
      cursor = r.nextCursor;
    }
    expect(all).toEqual(["r-a", "r-b", "r-c"]);
  });

  it("pagination is idempotent under filter+paginate composition", () => {
    // The route's flow: filter the full set, then paginate. Verify
    // that `paginateReviewPackets(filterPacketsBySpec(packets, spec))`
    // gives a deterministic page that matches a single-pass filter.
    const packets = fixture();
    const spec = { vendorContains: "no-such" }; // matches nothing
    const filtered = filterPacketsBySpec(packets, spec);
    const r = paginateReviewPackets(filtered, { limit: 10 });
    expect(r.page).toEqual([]);
    expect(r.nextCursor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 18 — CSV export (pure)
// ---------------------------------------------------------------------------

describe("escapeCsvCell", () => {
  it("returns empty string for null / undefined / empty input", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
    expect(escapeCsvCell("")).toBe("");
  });

  it("passes through plain values without quoting", () => {
    expect(escapeCsvCell("hello")).toBe("hello");
    expect(escapeCsvCell("Belmark Inc")).toBe("Belmark Inc");
    expect(escapeCsvCell("12.34")).toBe("12.34");
  });

  it("quotes cells containing commas", () => {
    expect(escapeCsvCell("Belmark, Inc")).toBe('"Belmark, Inc"');
  });

  it("quotes cells containing newlines or carriage returns", () => {
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("doubles internal quotes per RFC-4180", () => {
    expect(escapeCsvCell('She said "hi"')).toBe('"She said ""hi"""');
  });

  it("quotes leading/trailing whitespace cells (Excel-safe)", () => {
    expect(escapeCsvCell(" leading")).toBe('" leading"');
    expect(escapeCsvCell("trailing ")).toBe('"trailing "');
  });
});

describe("renderReviewPacketsCsv", () => {
  function rowFrom(
    overrides: Partial<import("../data").ReviewPacketRow> = {},
  ): import("../data").ReviewPacketRow {
    return {
      packetId: "pkt-v1-r-x",
      packetIdShort: "pkt-v1-r-x",
      receiptId: "r-x",
      status: "draft",
      color: "amber",
      vendor: null,
      vendorSource: "missing",
      amountUsd: null,
      amountSource: "missing",
      eligibilityOk: false,
      eligibilityMissing: ["vendor", "date", "amount", "category"],
      createdAt: "2026-04-25T12:00:00.000Z",
      approvalId: null,
      approvalStatus: null,
      ...overrides,
    };
  }

  it("empty input → header-only CSV (1 line + trailing CRLF)", () => {
    const csv = renderReviewPacketsCsv([]);
    const lines = csv.split("\r\n");
    // Header + empty trailing line from the final CRLF.
    expect(lines.length).toBe(2);
    expect(lines[1]).toBe("");
    expect(lines[0]).toContain("status");
    expect(lines[0]).toContain("packetId");
    expect(lines[0]).toContain("createdAt");
  });

  it("locked column order — finance tooling depends on it", () => {
    const csv = renderReviewPacketsCsv([]);
    const header = csv.split("\r\n")[0];
    expect(header).toBe(
      "status,packetId,receiptId,vendor,vendorSource,amountUsd,amountSource,currency,eligibilityOk,eligibilityMissing,approvalId,approvalStatus,createdAt",
    );
  });

  it("typical row formats correctly", () => {
    const csv = renderReviewPacketsCsv([
      rowFrom({
        packetId: "pkt-v1-r-belmark",
        packetIdShort: "pkt-v1-r-belm…",
        receiptId: "r-belmark",
        status: "rene-approved",
        color: "green",
        vendor: "Belmark Inc",
        vendorSource: "canonical",
        amountUsd: 250,
        amountSource: "canonical",
        eligibilityOk: true,
        eligibilityMissing: [],
        approvalId: "appr-abc",
        approvalStatus: "approved",
        createdAt: "2026-04-20T00:00:00.000Z",
      }),
    ]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe(
      [
        "rene-approved",
        "pkt-v1-r-belmark",
        "r-belmark",
        "Belmark Inc",
        "canonical",
        "250.00",
        "canonical",
        "",
        "true",
        "",
        "appr-abc",
        "approved",
        "2026-04-20T00:00:00.000Z",
      ].join(","),
    );
  });

  it("null vendor / amount / approval render as empty cells (NEVER 'null' / NEVER '0')", () => {
    const csv = renderReviewPacketsCsv([rowFrom()]);
    const cells = csv.split("\r\n")[1].split(",");
    // vendor (idx 3), amountUsd (idx 5), approvalId (idx 10),
    // approvalStatus (idx 11) all empty.
    expect(cells[3]).toBe("");
    expect(cells[5]).toBe("");
    expect(cells[10]).toBe("");
    expect(cells[11]).toBe("");
  });

  it("OCR-suggested vendor renders with `(ocr)` suffix verbatim", () => {
    const csv = renderReviewPacketsCsv([
      rowFrom({ vendor: "OCR Vendor", vendorSource: "ocr-suggested" }),
    ]);
    const cells = csv.split("\r\n")[1].split(",");
    expect(cells[3]).toBe("OCR Vendor (ocr)");
  });

  it("vendor containing a comma is quoted; internal quote doubled", () => {
    const csv = renderReviewPacketsCsv([
      rowFrom({ vendor: 'Belmark, "The Company"', vendorSource: "canonical" }),
    ]);
    expect(csv).toContain('"Belmark, ""The Company"""');
  });

  it("eligibilityMissing joined with `|` (NOT `,` — survives column boundary)", () => {
    const csv = renderReviewPacketsCsv([
      rowFrom({
        eligibilityMissing: ["vendor", "date", "amount"],
        eligibilityOk: false,
      }),
    ]);
    expect(csv).toContain("vendor|date|amount");
    // Verify it parses as a single CSV cell, not three.
    const lines = csv.split("\r\n");
    const cells = lines[1].split(",");
    expect(cells[9]).toBe("vendor|date|amount");
  });

  it("eligibilityOk: true renders 'true', false renders 'false'", () => {
    const csvT = renderReviewPacketsCsv([rowFrom({ eligibilityOk: true })]);
    const csvF = renderReviewPacketsCsv([rowFrom({ eligibilityOk: false })]);
    expect(csvT.split("\r\n")[1].split(",")[8]).toBe("true");
    expect(csvF.split("\r\n")[1].split(",")[8]).toBe("false");
  });

  it("amountUsd is formatted to 2 decimals; NaN/Infinity render as empty", () => {
    const ok = renderReviewPacketsCsv([
      rowFrom({ amountUsd: 1234.5, amountSource: "canonical" }),
    ]);
    expect(ok.split("\r\n")[1].split(",")[5]).toBe("1234.50");
    const nan = renderReviewPacketsCsv([
      rowFrom({ amountUsd: Number.NaN, amountSource: "canonical" }),
    ]);
    expect(nan.split("\r\n")[1].split(",")[5]).toBe("");
    const inf = renderReviewPacketsCsv([
      rowFrom({
        amountUsd: Number.POSITIVE_INFINITY,
        amountSource: "canonical",
      }),
    ]);
    expect(inf.split("\r\n")[1].split(",")[5]).toBe("");
  });

  it("multiple rows render in input order, separated by CRLF", () => {
    const csv = renderReviewPacketsCsv([
      rowFrom({ packetId: "pkt-v1-a", receiptId: "r-a" }),
      rowFrom({ packetId: "pkt-v1-b", receiptId: "r-b" }),
    ]);
    const lines = csv.split("\r\n");
    expect(lines.length).toBe(4); // header + 2 rows + trailing empty
    expect(lines[1]).toContain("pkt-v1-a");
    expect(lines[2]).toContain("pkt-v1-b");
  });

  it("ends with CRLF terminator (RFC-4180)", () => {
    const csv = renderReviewPacketsCsv([rowFrom()]);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("pure: same input → same output (deterministic)", () => {
    const rows = [rowFrom({ vendor: "X" }), rowFrom({ vendor: "Y" })];
    expect(renderReviewPacketsCsv(rows)).toBe(renderReviewPacketsCsv(rows));
  });

  it("does not mutate the input rows array", () => {
    const rows = [rowFrom({ vendor: "X" })];
    const before = JSON.stringify(rows);
    renderReviewPacketsCsv(rows);
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe("reviewPacketsCsvFilename", () => {
  it("formats as usa-gummies-review-packets-YYYY-MM-DD.csv", () => {
    const fn = reviewPacketsCsvFilename(new Date("2026-04-25T12:34:56Z"));
    expect(fn).toBe("usa-gummies-review-packets-2026-04-25.csv");
  });

  it("zero-pads single-digit months and days", () => {
    const fn = reviewPacketsCsvFilename(new Date("2026-01-05T00:00:00Z"));
    expect(fn).toBe("usa-gummies-review-packets-2026-01-05.csv");
  });
});

// ---------------------------------------------------------------------------
// Phase 23 — id-substring search (packetId / receiptId / approvalId)
// ---------------------------------------------------------------------------
//
// Operator pastes any id from a Slack thread, audit log, or CSV row
// and the table narrows. Locked rules:
//   - Substring (NOT exact match) — pasting a partial id still works.
//   - Case-insensitive on all three fields (packetId / receiptId /
//     approvalId).
//   - Empty / whitespace collapses to "no filter" (defensive — a
//     stray keystroke shouldn't hide rows).
//   - Approval-id match requires the approval map plumbed through
//     `buildReviewPacketsView` (otherwise approvalId is always null
//     on every row, so only packetId / receiptId can match).
//   - Filter composes with status / vendor / date / approvalStatus
//     filters (AND semantics across all six dimensions).
//   - URL roundtrip: parse(serialize({ idContains: "x" })) preserves it.
//   - Server (`filterPacketsBySpec`) and client (`applyReviewPacketsFilters`)
//     return the same packetIds for the same input + spec (lockstep).

describe("Phase 23 — applyReviewPacketsFilters idContains", () => {
  function fixture(): ReviewPacketsView {
    return {
      rows: [
        {
          packetId: "pkt-v1-receipt-belmark-001",
          receiptId: "receipt-belmark-001",
          packetIdShort: "pkt-belmark",
          status: "draft",
          color: "amber",
          vendor: "Belmark Inc",
          vendorSource: "canonical",
          amountUsd: 250,
          amountSource: "canonical",
          eligibilityOk: true,
          eligibilityMissing: [],
          createdAt: "2026-04-15T00:00:00Z",
          approvalId: "appr-uuid-belmark-aaa",
          approvalStatus: "pending",
        },
        {
          packetId: "pkt-v1-receipt-uline-002",
          receiptId: "receipt-uline-002",
          packetIdShort: "pkt-uline",
          status: "draft",
          color: "amber",
          vendor: "Uline",
          vendorSource: "canonical",
          amountUsd: 50,
          amountSource: "canonical",
          eligibilityOk: true,
          eligibilityMissing: [],
          createdAt: "2026-04-22T00:00:00Z",
          approvalId: null,
          approvalStatus: null,
        },
      ],
      counts: { total: 2, draft: 2, reneApproved: 0, rejected: 0 },
    };
  }

  it("matches by packetId substring", () => {
    const v = fixture();
    const f = applyReviewPacketsFilters(v, { idContains: "belmark" });
    expect(f.rows.map((r) => r.packetId)).toEqual([
      "pkt-v1-receipt-belmark-001",
    ]);
    expect(f.counts.total).toBe(1);
  });

  it("matches by receiptId substring (when packetId doesn't contain the needle)", () => {
    const v = fixture();
    const f = applyReviewPacketsFilters(v, { idContains: "receipt-uline" });
    expect(f.rows.map((r) => r.receiptId)).toEqual(["receipt-uline-002"]);
  });

  it("matches by approvalId substring (when only approvalId contains the needle)", () => {
    const v = fixture();
    const f = applyReviewPacketsFilters(v, { idContains: "uuid-belmark-aaa" });
    expect(f.rows.map((r) => r.packetId)).toEqual([
      "pkt-v1-receipt-belmark-001",
    ]);
  });

  it("approvalId null on a row → that row CAN'T match an approval-id-only needle", () => {
    const v = fixture();
    // "appr-uuid" matches the belmark row's approvalId but the uline
    // row has approvalId: null — so only belmark passes.
    const f = applyReviewPacketsFilters(v, { idContains: "appr-uuid" });
    expect(f.rows.map((r) => r.packetId)).toEqual([
      "pkt-v1-receipt-belmark-001",
    ]);
  });

  it("case-insensitive on all three id fields", () => {
    const v = fixture();
    const lower = applyReviewPacketsFilters(v, { idContains: "BELMARK" });
    const upper = applyReviewPacketsFilters(v, { idContains: "belmark" });
    expect(lower.rows.map((r) => r.packetId)).toEqual(
      upper.rows.map((r) => r.packetId),
    );
    expect(lower.rows).toHaveLength(1);
  });

  it("empty / whitespace idContains → no filter (defensive)", () => {
    const v = fixture();
    expect(applyReviewPacketsFilters(v, { idContains: "" }).counts).toEqual(
      v.counts,
    );
    expect(applyReviewPacketsFilters(v, { idContains: "   " }).counts).toEqual(
      v.counts,
    );
  });

  it("no match across any of the three fields → empty rows (no fabrication)", () => {
    const v = fixture();
    const f = applyReviewPacketsFilters(v, {
      idContains: "no-such-id-anywhere",
    });
    expect(f.rows).toEqual([]);
    expect(f.counts.total).toBe(0);
  });

  it("composes with status filter (AND semantics)", () => {
    const v = fixture();
    const f = applyReviewPacketsFilters(v, {
      idContains: "belmark",
      status: "rene-approved", // Belmark row is "draft"
    });
    expect(f.rows).toEqual([]);
  });

  it("composes with vendor filter (AND semantics)", () => {
    const v = fixture();
    const f = applyReviewPacketsFilters(v, {
      idContains: "pkt-v1",
      vendorContains: "uline",
    });
    expect(f.rows.map((r) => r.packetId)).toEqual([
      "pkt-v1-receipt-uline-002",
    ]);
  });

  it("composes with approvalStatus filter (AND semantics)", () => {
    const v = fixture();
    const f = applyReviewPacketsFilters(v, {
      idContains: "pkt-v1",
      approvalStatus: "pending",
    });
    expect(f.rows.map((r) => r.packetId)).toEqual([
      "pkt-v1-receipt-belmark-001",
    ]);
  });
});

describe("Phase 23 — parseReviewPacketsFilterSpec id query param", () => {
  function q(pairs: Record<string, string>): URLSearchParams {
    return new URLSearchParams(pairs);
  }

  it("id query param parses to idContains", () => {
    expect(parseReviewPacketsFilterSpec(q({ id: "pkt-v1-foo" }))).toEqual({
      idContains: "pkt-v1-foo",
    });
  });

  it("empty / whitespace id → omitted from spec", () => {
    expect(parseReviewPacketsFilterSpec(q({ id: "" })).idContains).toBeUndefined();
    expect(parseReviewPacketsFilterSpec(q({ id: "   " })).idContains).toBeUndefined();
  });

  it("preserves verbatim — no trimming on parse (helper preserves input shape)", () => {
    // The helper trims at apply time, not at parse time, so the
    // original string survives the parse step (matches vendor's
    // existing parse semantics).
    const spec = parseReviewPacketsFilterSpec(q({ id: "  pkt-v1-foo  " }));
    expect(spec.idContains).toBe("  pkt-v1-foo  ");
  });
});

describe("Phase 23 — reviewPacketsFilterSpecToQuery id roundtrip", () => {
  it("trims before serializing", () => {
    const params = reviewPacketsFilterSpecToQuery({
      idContains: "  pkt-v1-foo  ",
    });
    expect(params.get("id")).toBe("pkt-v1-foo");
  });

  it("empty / whitespace idContains is omitted", () => {
    expect(
      reviewPacketsFilterSpecToQuery({ idContains: "" }).get("id"),
    ).toBeNull();
    expect(
      reviewPacketsFilterSpecToQuery({ idContains: "   " }).get("id"),
    ).toBeNull();
  });

  it("round-trip: parse(serialize({ idContains })) === { idContains }", () => {
    const original: import("../data").ReviewPacketsFilterSpec = {
      idContains: "pkt-v1-foo",
    };
    const params = reviewPacketsFilterSpecToQuery(original);
    expect(parseReviewPacketsFilterSpec(params)).toEqual(original);
  });

  it("round-trip with all six dimensions composed together", () => {
    const original: import("../data").ReviewPacketsFilterSpec = {
      status: "draft",
      vendorContains: "Belmark",
      createdAfter: "2026-04-01",
      createdBefore: "2026-04-30",
      approvalStatus: "pending",
      idContains: "pkt-v1-foo",
    };
    const params = reviewPacketsFilterSpecToQuery(original);
    expect(parseReviewPacketsFilterSpec(params)).toEqual(original);
  });
});

describe("Phase 23 — filterPacketsBySpec idContains lockstep", () => {
  it("server filter produces the same packetIds as the client helper for an id needle", () => {
    const packets = [
      buildReceiptReviewPacket(
        mkReceipt({
          id: "receipt-belmark-zzz",
          vendor: "Belmark Inc",
          date: "2026-04-15",
          amount: 250,
          category: "supplies",
        }),
        { now: new Date("2026-04-15T00:00:00Z") },
      ),
      buildReceiptReviewPacket(
        mkReceipt({
          id: "receipt-uline-yyy",
          vendor: "Uline",
          date: "2026-04-22",
          amount: 50,
          category: "supplies",
        }),
        { now: new Date("2026-04-22T00:00:00Z") },
      ),
    ];

    const spec = { idContains: "belmark" };
    const view = buildReviewPacketsView(packets);
    const clientFiltered = applyReviewPacketsFilters(view, spec);
    const serverFiltered = filterPacketsBySpec(packets, spec);

    expect(serverFiltered.map((p) => p.packetId).sort()).toEqual(
      clientFiltered.rows.map((r) => r.packetId).sort(),
    );
    expect(serverFiltered).toHaveLength(1);
    expect(serverFiltered[0].receiptId).toBe("receipt-belmark-zzz");
  });

  it("approvalId match works server-side when approvalsByPacketId is plumbed through", () => {
    const packet = buildReceiptReviewPacket(
      mkReceipt({
        id: "receipt-x",
        vendor: "Belmark Inc",
        date: "2026-04-15",
        amount: 250,
        category: "supplies",
      }),
      { now: new Date("2026-04-15T00:00:00Z") },
    );
    const approvalsMap = new Map([
      [packet.packetId, { id: "appr-zzzz-9999", status: "pending" }],
    ]);

    const filtered = filterPacketsBySpec(
      [packet],
      { idContains: "zzzz" },
      approvalsMap,
    );
    expect(filtered).toHaveLength(1);
  });

  it("approvalId match returns 0 packetIds when the lookup map is missing (defensive)", () => {
    const packet = buildReceiptReviewPacket(
      mkReceipt({
        id: "receipt-x",
        vendor: "Belmark Inc",
        date: "2026-04-15",
        amount: 250,
        category: "supplies",
      }),
      { now: new Date("2026-04-15T00:00:00Z") },
    );
    // No approvals map → server has no approvalId on row → "zzzz"
    // matches NO row (packet/receipt ids don't contain "zzzz").
    const filtered = filterPacketsBySpec([packet], { idContains: "zzzz" });
    expect(filtered).toHaveLength(0);
  });
});
