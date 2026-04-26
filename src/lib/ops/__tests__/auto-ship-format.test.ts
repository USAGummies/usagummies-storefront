/**
 * Phase 27 — tests for the v1.0 SHIPPING PROTOCOL formatters.
 *
 * Locks the exact layout Ben pinned in #shipping on 2026-04-10:
 *
 *   SHIPMENT: [Order ID]
 *   To: [Recipient Name] — [Company]
 *   Address: [Full address]
 *   From: [PA or WA Warehouse]
 *   Carrier: [USPS Priority / UPS Ground / etc.]
 *   Tracking: [number]
 *   Cost: $[amount]
 *   Tag: [Sample / Wholesale / FBA / Internal]
 *   Label: [attached PDF]
 *
 * Hard rules:
 *   - NEVER fabricates a recipient / address / tracking / cost.
 *     Missing → literal "(unknown)" / "(no tracking)" / etc. so the
 *     gap is operator-visible and not a silent empty cell.
 *   - Tag derivation is deterministic.
 *   - Order of lines is fixed.
 *   - Pure: same input → same output.
 */
import { describe, expect, it } from "vitest";

import {
  deriveAutoShipTag,
  formatPackingSlipComment,
  formatRecipient,
  formatShipFrom,
  formatShipToAddress,
  formatShipmentComment,
} from "@/lib/ops/auto-ship-format";

const baseShipTo = {
  name: "Debora Mills",
  company: null,
  street1: "123 Main St",
  street2: null,
  city: "Austin",
  state: "TX",
  postalCode: "78704",
  country: "US",
};

describe("deriveAutoShipTag", () => {
  it("amazon → FBA", () => {
    expect(deriveAutoShipTag({ source: "amazon", bags: 1 })).toBe("FBA");
    expect(deriveAutoShipTag({ source: "amazon", bags: 36 })).toBe("FBA");
  });

  it("shopify with bags ≥ 36 → Wholesale (master carton)", () => {
    expect(deriveAutoShipTag({ source: "shopify", bags: 36 })).toBe(
      "Wholesale",
    );
    expect(deriveAutoShipTag({ source: "shopify", bags: 144 })).toBe(
      "Wholesale",
    );
  });

  it("shopify with 6-35 bags → Wholesale (case quantity)", () => {
    expect(deriveAutoShipTag({ source: "shopify", bags: 6 })).toBe("Wholesale");
    expect(deriveAutoShipTag({ source: "shopify", bags: 12 })).toBe(
      "Wholesale",
    );
    expect(deriveAutoShipTag({ source: "shopify", bags: 35 })).toBe(
      "Wholesale",
    );
  });

  it("shopify with ≤ 5 bags → Sample (mailer-sized small DTC)", () => {
    expect(deriveAutoShipTag({ source: "shopify", bags: 1 })).toBe("Sample");
    expect(deriveAutoShipTag({ source: "shopify", bags: 5 })).toBe("Sample");
  });

  it("faire → Wholesale (always retailer)", () => {
    expect(deriveAutoShipTag({ source: "faire", bags: 1 })).toBe("Wholesale");
    expect(deriveAutoShipTag({ source: "faire", bags: 36 })).toBe("Wholesale");
  });

  it("manual / unknown → Internal (defensive default)", () => {
    expect(deriveAutoShipTag({ source: "manual", bags: 1 })).toBe("Internal");
    expect(deriveAutoShipTag({ source: "store:42", bags: 6 })).toBe("Internal");
    expect(deriveAutoShipTag({ source: "", bags: 1 })).toBe("Internal");
  });

  it("source matching is case-insensitive + substring-tolerant", () => {
    expect(deriveAutoShipTag({ source: "AMAZON", bags: 1 })).toBe("FBA");
    expect(deriveAutoShipTag({ source: "Shopify Plus", bags: 1 })).toBe(
      "Sample",
    );
  });
});

describe("formatRecipient", () => {
  it("name only when no company", () => {
    expect(formatRecipient(baseShipTo)).toBe("Debora Mills");
  });

  it("name — company when both present", () => {
    expect(
      formatRecipient({ ...baseShipTo, company: "Red Dog Saloon" }),
    ).toBe("Debora Mills — Red Dog Saloon");
  });

  it("missing name → (unknown)", () => {
    expect(formatRecipient({ ...baseShipTo, name: null })).toBe("(unknown)");
    expect(formatRecipient({ ...baseShipTo, name: "  " })).toBe("(unknown)");
  });

  it("trims whitespace from name + company", () => {
    expect(
      formatRecipient({
        ...baseShipTo,
        name: "  Eric Forst  ",
        company: "  Red Dog Saloon  ",
      }),
    ).toBe("Eric Forst — Red Dog Saloon");
  });
});

describe("formatShipToAddress", () => {
  it("street1 + city, state ZIP for typical input", () => {
    expect(formatShipToAddress(baseShipTo)).toBe(
      "123 Main St, Austin, TX 78704",
    );
  });

  it("includes street2 when present", () => {
    expect(
      formatShipToAddress({ ...baseShipTo, street2: "Apt 4B" }),
    ).toBe("123 Main St, Apt 4B, Austin, TX 78704");
  });

  it("missing city → (unknown city) — no fabrication", () => {
    expect(formatShipToAddress({ ...baseShipTo, city: null })).toBe(
      "123 Main St, (unknown city), TX 78704",
    );
  });

  it("missing state → ?? — operator can spot it", () => {
    expect(formatShipToAddress({ ...baseShipTo, state: null })).toBe(
      "123 Main St, Austin, ?? 78704",
    );
  });

  it("missing zip → (no zip)", () => {
    expect(formatShipToAddress({ ...baseShipTo, postalCode: null })).toBe(
      "123 Main St, Austin, TX (no zip)",
    );
  });

  it("missing street1 → city/state/ZIP only (still recognizable)", () => {
    expect(formatShipToAddress({ ...baseShipTo, street1: null })).toBe(
      "Austin, TX 78704",
    );
  });
});

describe("formatShipFrom", () => {
  it("returns WA Warehouse (Ashford) — fixed origin per CLAUDE.md fulfillment rules", () => {
    expect(formatShipFrom()).toBe("WA Warehouse (Ashford)");
  });
});

describe("formatShipmentComment — v1.0 SHIPPING PROTOCOL", () => {
  it("renders all 9 locked lines in the locked order", () => {
    const out = formatShipmentComment({
      orderNumber: "112-9310316-1993035",
      source: "amazon",
      bags: 1,
      shipTo: baseShipTo,
      carrier: {
        service: "USPS First Class",
        trackingNumber: "9400150106151198000588",
        costUsd: 6.11,
      },
    });
    const lines = out.split("\n");
    expect(lines[0]).toBe("SHIPMENT: 112-9310316-1993035");
    expect(lines[1]).toBe("To: Debora Mills");
    expect(lines[2]).toBe("Address: 123 Main St, Austin, TX 78704");
    expect(lines[3]).toBe("From: WA Warehouse (Ashford)");
    expect(lines[4]).toBe("Carrier: USPS First Class");
    expect(lines[5]).toBe("Tracking: 9400150106151198000588");
    expect(lines[6]).toBe("Cost: $6.11");
    expect(lines[7]).toBe("Tag: FBA");
    expect(lines[8]).toBe("Label: (attached PDF)");
  });

  it("amazon FBM single-bag → Tag: FBA", () => {
    const out = formatShipmentComment({
      orderNumber: "x",
      source: "amazon",
      bags: 1,
      shipTo: baseShipTo,
      carrier: {
        service: "USPS First Class",
        trackingNumber: "TRK1",
        costUsd: 6.11,
      },
    });
    expect(out).toContain("Tag: FBA");
  });

  it("shopify wholesale 144-bag → Tag: Wholesale", () => {
    const out = formatShipmentComment({
      orderNumber: "1016",
      source: "shopify",
      bags: 144,
      shipTo: { ...baseShipTo, name: "Eric Forst", company: "Red Dog Saloon" },
      carrier: {
        service: "USPS Priority Mail",
        trackingNumber: "TRK2",
        costUsd: 67.5,
      },
    });
    expect(out).toContain("Tag: Wholesale");
    expect(out).toContain("To: Eric Forst — Red Dog Saloon");
  });

  it("missing tracking → (no tracking) — never empty", () => {
    const out = formatShipmentComment({
      orderNumber: "x",
      source: "amazon",
      bags: 1,
      shipTo: baseShipTo,
      carrier: {
        service: "USPS First Class",
        trackingNumber: null,
        costUsd: 6.11,
      },
    });
    expect(out).toContain("Tracking: (no tracking)");
  });

  it("NaN cost → (unknown) — never $NaN", () => {
    const out = formatShipmentComment({
      orderNumber: "x",
      source: "amazon",
      bags: 1,
      shipTo: baseShipTo,
      carrier: {
        service: "USPS First Class",
        trackingNumber: "TRK1",
        costUsd: Number.NaN,
      },
    });
    expect(out).toContain("Cost: (unknown)");
    expect(out).not.toContain("$NaN");
  });

  it("Drive backup links append AFTER the locked v1.0 block when present", () => {
    const out = formatShipmentComment({
      orderNumber: "x",
      source: "amazon",
      bags: 1,
      shipTo: baseShipTo,
      carrier: {
        service: "USPS First Class",
        trackingNumber: "TRK1",
        costUsd: 6.11,
      },
      driveLinks: {
        label: "https://drive.example.com/label.pdf",
        packingSlip: "https://drive.example.com/slip.pdf",
      },
    });
    const lines = out.split("\n");
    // The 9-line locked block + blank separator + drive line.
    expect(lines.length).toBe(11);
    expect(lines[8]).toBe("Label: (attached PDF)");
    expect(lines[9]).toBe("");
    expect(lines[10]).toContain("Drive: label PDF");
    expect(lines[10]).toContain("Drive: packing slip");
  });

  it("no Drive links → just the 9-line locked block (no trailing newline)", () => {
    const out = formatShipmentComment({
      orderNumber: "x",
      source: "amazon",
      bags: 1,
      shipTo: baseShipTo,
      carrier: {
        service: "USPS First Class",
        trackingNumber: "TRK1",
        costUsd: 6.11,
      },
    });
    const lines = out.split("\n");
    expect(lines.length).toBe(9);
  });

  it("pure: same input → same output", () => {
    const args = {
      orderNumber: "x",
      source: "amazon",
      bags: 1,
      shipTo: baseShipTo,
      carrier: {
        service: "USPS First Class",
        trackingNumber: "TRK1",
        costUsd: 6.11,
      },
    };
    expect(formatShipmentComment(args)).toBe(formatShipmentComment(args));
  });

  it("renders Eric Forst / Red Dog Saloon AK end-to-end (full snapshot)", () => {
    const out = formatShipmentComment({
      orderNumber: "1016",
      source: "shopify",
      bags: 144,
      shipTo: {
        name: "Eric Forst",
        company: "Red Dog Saloon",
        street1: "1234 Whatever Ave",
        street2: null,
        city: "Anchorage",
        state: "AK",
        postalCode: "99501",
        country: "US",
      },
      carrier: {
        service: "USPS Priority Mail",
        trackingNumber: "9400150106151198001234",
        costUsd: 67.5,
      },
    });
    expect(out).toBe(
      [
        "SHIPMENT: 1016",
        "To: Eric Forst — Red Dog Saloon",
        "Address: 1234 Whatever Ave, Anchorage, AK 99501",
        "From: WA Warehouse (Ashford)",
        "Carrier: USPS Priority Mail",
        "Tracking: 9400150106151198001234",
        "Cost: $67.50",
        "Tag: Wholesale",
        "Label: (attached PDF)",
      ].join("\n"),
    );
  });
});

describe("formatPackingSlipComment", () => {
  it("renders 'Packing slip — <orderNumber>'", () => {
    expect(formatPackingSlipComment("1016")).toBe("Packing slip — 1016");
    expect(formatPackingSlipComment("114-3537957-6941066")).toBe(
      "Packing slip — 114-3537957-6941066",
    );
  });
});
