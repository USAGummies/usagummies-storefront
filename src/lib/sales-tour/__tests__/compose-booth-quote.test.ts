import { describe, expect, it } from "vitest";

import type { BoothVisitIntent } from "@/lib/sales-tour/booth-visit-types";
import {
  buildVisitId,
  composeBoothQuote,
  DEFAULT_TOUR_ID,
} from "@/lib/sales-tour/compose-booth-quote";
import { formatBoothQuoteReply } from "@/lib/sales-tour/format-booth-reply";

const FIXED_NOW = new Date("2026-05-11T15:30:00.000Z");

function intent(overrides: Partial<BoothVisitIntent> = {}): BoothVisitIntent {
  return {
    rawText: "/booth 36 to Bryce Glamp UT, landed, contact Sarah 555-1212",
    prospectName: "Bryce Glamp and Camp",
    state: "UT",
    city: null,
    scale: "master-carton",
    count: 1,
    totalBags: 36,
    freightAsk: "landed",
    contactName: "Sarah",
    contactPhone: "555-1212",
    contactEmail: null,
    notes: null,
    confidence: 0.9,
    ...overrides,
  };
}

describe("buildVisitId — stable + idempotent", () => {
  it("produces a slug-timestamp id", () => {
    const id = buildVisitId("Bryce Glamp & Camp", FIXED_NOW);
    expect(id).toMatch(/^bryce-glamp-camp-2026-05-11-15-30$/);
  });

  it("falls back to 'unknown' for empty prospect name", () => {
    expect(buildVisitId(null, FIXED_NOW)).toMatch(/^unknown-/);
    expect(buildVisitId("", FIXED_NOW)).toMatch(/^unknown-/);
  });

  it("idempotent within the same minute", () => {
    const a = buildVisitId("ABC", new Date("2026-05-11T15:30:01Z"));
    const b = buildVisitId("ABC", new Date("2026-05-11T15:30:59Z"));
    expect(a).toBe(b);
  });

  it("changes across minutes", () => {
    const a = buildVisitId("ABC", new Date("2026-05-11T15:30:00Z"));
    const b = buildVisitId("ABC", new Date("2026-05-11T15:31:00Z"));
    expect(a).not.toBe(b);
  });
});

describe("composeBoothQuote — end-to-end", () => {
  it("composes a clean B2 landed quote with corridor freight", () => {
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    expect(q.tourId).toBe(DEFAULT_TOUR_ID);
    expect(q.lines).toHaveLength(1);
    expect(q.lines[0].bGridDesignator).toBe("B2");
    expect(q.lines[0].pricePerBag).toBe(3.49);
    expect(q.approval).toBe("none");
    expect(q.dealCheckRequired).toBe(false);
    expect(q.escalationClause).toContain("Pricing held");
    // Sub-pallet → no corridor freight.
    expect(q.freight.found).toBe(false);
    expect(q.freight.source).toBe("no-freight-needed");
  });

  it("3-pallet anchor: corridor freight is found + escalation is anchor variant", () => {
    const q = composeBoothQuote(
      intent({ scale: "pallet", count: 3, totalBags: 2700, freightAsk: "anchor" }),
      { now: FIXED_NOW },
    );
    expect(q.freight.found).toBe(true);
    expect(q.freight.source).toBe("regional-table-v0.1");
    expect(q.freight.totalDrive).toBe(375); // 125 * 3 (UT 3-pallet drive)
    expect(q.approval).toBe("class-c");
    expect(q.dealCheckRequired).toBe(true);
    expect(q.escalationClause).toContain("3 pallets / 90 days");
  });

  it("Sample drop has zero-price line + no deal-check + sample escalation", () => {
    const q = composeBoothQuote(
      intent({ scale: "sample", count: 1, totalBags: 1, freightAsk: "unsure" }),
      { now: FIXED_NOW },
    );
    expect(q.lines[0].pricePerBag).toBe(0);
    expect(q.approval).toBe("none");
    expect(q.dealCheckRequired).toBe(false);
    expect(q.escalationClause).toContain("Sample drop");
  });

  it("Unsure freight ask on master-carton: 2 lines + Class A", () => {
    const q = composeBoothQuote(
      intent({ scale: "master-carton", count: 1, totalBags: 36, freightAsk: "unsure" }),
      { now: FIXED_NOW },
    );
    expect(q.lines).toHaveLength(2);
    expect(q.approval).toBe("none");
  });
});

describe("formatBoothQuoteReply — Slack-ready text", () => {
  it("formats a B2 landed quote with all required sections", () => {
    const q = composeBoothQuote(intent(), { now: FIXED_NOW });
    const text = formatBoothQuoteReply(q);
    expect(text).toContain("Bryce Glamp and Camp");
    expect(text).toContain("UT");
    expect(text).toContain("$3.49");
    expect(text).toContain("Lead time:");
    expect(text).toContain("Escalation:");
    expect(text).toContain("Class A");
    expect(text).toContain("NCS-001 vendor form: https://www.usagummies.com/upload/ncs");
    expect(text).toContain("Visit ID:");
    expect(text).toContain("Tour: may-2026");
    expect(text).toContain("Contact: Sarah · 555-1212");
  });

  it("formats a C-ANCH 3-pallet quote with Class C deal-check warning", () => {
    const q = composeBoothQuote(
      intent({
        prospectName: "Indian Pueblo Stores",
        state: "NM",
        scale: "pallet",
        count: 3,
        totalBags: 2700,
        freightAsk: "anchor",
      }),
      { now: FIXED_NOW },
    );
    const text = formatBoothQuoteReply(q);
    expect(text).toContain("C-ANCH");
    expect(text).toContain("Class C");
    expect(text).toContain("$3.00");
    expect(text).toContain("Indian Pueblo Stores");
    expect(text).toContain("NM");
  });

  it("formats a sample drop with FREE label", () => {
    const q = composeBoothQuote(
      intent({ scale: "sample", count: 1, totalBags: 1, freightAsk: "unsure" }),
      { now: FIXED_NOW },
    );
    const text = formatBoothQuoteReply(q);
    expect(text).toContain("FREE");
  });

  it("includes notes when present", () => {
    const q = composeBoothQuote(intent({ notes: "needs delivery before 5pm" }), { now: FIXED_NOW });
    const text = formatBoothQuoteReply(q);
    expect(text).toContain("Notes: needs delivery before 5pm");
  });

  it("handles missing prospect name gracefully", () => {
    const q = composeBoothQuote(intent({ prospectName: null, state: null }), { now: FIXED_NOW });
    const text = formatBoothQuoteReply(q);
    expect(text).toContain("(prospect name not captured)");
    expect(text).toContain("(state not captured)");
  });
});
