import { describe, expect, it } from "vitest";

import {
  boothQuoteToCandidates,
  parseStoredBoothQuote,
} from "../off-grid-quote-sources";

import type { BoothQuote } from "@/lib/sales-tour/booth-visit-types";

const quote: BoothQuote & { createdAt?: string } = {
  intent: {
    rawText: "/booth 3 pallets to Bryce Glamp UT, anchor",
    prospectName: "Bryce Glamp",
    state: "UT",
    city: null,
    scale: "pallet",
    count: 3,
    totalBags: 2700,
    freightAsk: "anchor",
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    notes: null,
    confidence: 0.9,
  },
  lines: [
    {
      bGridDesignator: null,
      pricingClass: "C-ANCH",
      pricePerBag: 3,
      freightStance: "landed",
      totalUsd: 8100,
      label: "3 pallets",
    },
  ],
  freight: {
    source: "regional-table-v0.1",
    drivePerPallet: 400,
    ltlPerPallet: 600,
    totalDrive: 1200,
    totalLtl: 1800,
    state: "UT",
    found: true,
    driveFreightPerBag: 0.44,
  },
  escalationClause: "Escalation clause",
  approval: "class-c",
  approvalReasons: ["off-grid"],
  dealCheckRequired: true,
  tourId: "may-2026",
  visitId: "visit-1",
  generatedAt: "2026-04-30T18:00:00.000Z",
  createdAt: "2026-04-30T18:00:00.000Z",
};

describe("off-grid quote source projection", () => {
  it("parses stored booth quote JSON", () => {
    expect(parseStoredBoothQuote(JSON.stringify(quote))?.visitId).toBe("visit-1");
  });

  it("accepts already parsed booth quote objects", () => {
    expect(parseStoredBoothQuote(quote)?.intent.prospectName).toBe("Bryce Glamp");
  });

  it("rejects malformed stored values", () => {
    expect(parseStoredBoothQuote("not-json")).toBeNull();
    expect(parseStoredBoothQuote({ visitId: "x", intent: {}, lines: "nope" })).toBeNull();
    expect(parseStoredBoothQuote({ ...quote, visitId: "" })).toBeNull();
  });

  it("projects priced booth quote lines into quote candidates", () => {
    const projected = boothQuoteToCandidates(quote, "2026-04-30T00:00:00.000Z");
    expect(projected.skippedReason).toBeNull();
    expect(projected.candidates).toEqual([
      {
        id: "visit-1:0",
        source: "booth_quote",
        customerName: "Bryce Glamp",
        pricePerBagUsd: 3,
        bagCount: 2700,
        createdAt: "2026-04-30T18:00:00.000Z",
        createdBy: "sales-tour-booth-quote",
      },
    ]);
  });

  it("uses the fallback timestamp and visit id when optional display fields are absent", () => {
    const projected = boothQuoteToCandidates(
      {
        ...quote,
        createdAt: undefined,
        intent: { ...quote.intent, prospectName: null },
      },
      "2026-05-01T00:00:00.000Z",
    );
    expect(projected.candidates[0]?.customerName).toBe("Booth visit visit-1");
    expect(projected.candidates[0]?.createdAt).toBe("2026-05-01T00:00:00.000Z");
  });

  it("refuses to fabricate candidates when bag count is missing", () => {
    const projected = boothQuoteToCandidates(
      { ...quote, intent: { ...quote.intent, totalBags: Number.NaN } },
      "2026-04-30T00:00:00.000Z",
    );
    expect(projected).toEqual({
      candidates: [],
      skippedReason: "missing_bag_count",
    });
  });

  it("skips non-priced lines without inventing zero-dollar candidates", () => {
    const projected = boothQuoteToCandidates(
      {
        ...quote,
        lines: [
          { ...quote.lines[0], pricePerBag: 0 },
          { ...quote.lines[0], pricePerBag: Number.POSITIVE_INFINITY },
        ],
      },
      "2026-04-30T00:00:00.000Z",
    );
    expect(projected).toEqual({
      candidates: [],
      skippedReason: "no_priced_lines",
    });
  });
});
