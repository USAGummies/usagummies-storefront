/**
 * packingSlipHtml renderer tests.
 *
 * The template lives in src/lib/ops/html-to-pdf.ts and ships to
 * production via the /api/ops/fulfillment/packing-slip route. These
 * tests lock the canonical fields so a template tweak can't silently
 * drop critical info (tracking, totals, ship-to company, memo).
 */
import { describe, expect, it } from "vitest";

import {
  packingSlipHtml,
  type PackingSlipInput,
} from "../html-to-pdf";

function baseInput(
  overrides: Partial<PackingSlipInput> = {},
): PackingSlipInput {
  return {
    invoiceNumber: "1207",
    invoiceDate: "2026-04-20",
    terms: "Net 10",
    dueDate: "2026-04-30",
    shipFrom: {
      name: "USA Gummies",
      street1: "30027 SR 706 E",
      city: "Ashford",
      state: "WA",
      postalCode: "98304",
      phone: "(307) 209-4928",
    },
    shipTo: {
      name: "Bryce Glamp & Camp",
      street1: "555 W Yellow Creek Rd",
      city: "Cannonville",
      state: "UT",
      postalCode: "84718",
    },
    lineItems: [
      {
        qty: 36,
        description: "All American Gummy Bears — 7.5 oz Bag",
        sub: "1 master carton × 36 bags",
        unitPrice: 3.25,
      },
    ],
    ...overrides,
  };
}

describe("packingSlipHtml — essentials", () => {
  it("renders a well-formed HTML document", () => {
    const html = packingSlipHtml(baseInput());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.includes("<title>")).toBe(true);
    expect(html.includes("</body></html>")).toBe(true);
  });

  it("embeds invoice number + date", () => {
    const html = packingSlipHtml(baseInput());
    expect(html).toContain("#1207");
    expect(html).toContain("2026-04-20");
  });

  it("renders ship-to name + city + state + zip", () => {
    const html = packingSlipHtml(baseInput());
    expect(html).toContain("Bryce Glamp &amp; Camp");
    expect(html).toContain("Cannonville");
    expect(html).toContain("UT");
    expect(html).toContain("84718");
  });

  it("escapes ampersands + angle brackets in ship-to", () => {
    const html = packingSlipHtml(
      baseInput({
        shipTo: {
          name: "A&B <Test>",
          street1: "1 Main",
          city: "X",
          state: "CA",
          postalCode: "90210",
        },
      }),
    );
    expect(html).toContain("A&amp;B &lt;Test&gt;");
    // And NOT the raw string
    expect(html).not.toContain("A&B <Test>");
  });
});

describe("packingSlipHtml — line items + totals", () => {
  it("computes line total = qty × unitPrice", () => {
    const html = packingSlipHtml(baseInput());
    expect(html).toContain("$117.00");
  });

  it("renders freight line when present", () => {
    const html = packingSlipHtml(
      baseInput({
        freightLine: { label: "UPS Ground 2 cartons", amount: 24.5 },
      }),
    );
    expect(html).toContain("UPS Ground 2 cartons");
    expect(html).toContain("$24.50");
  });

  it("honors totalOverride when supplied", () => {
    const html = packingSlipHtml(baseInput({ totalOverride: 250.0 }));
    expect(html).toContain("$250.00");
  });

  it("applies delivered unitLabel override", () => {
    const html = packingSlipHtml(
      baseInput({
        lineItems: [
          {
            qty: 72,
            description: "All American Gummy Bears — 7.5 oz Bag",
            unitPrice: 2.1,
            unitLabel: "$2.10 delivered",
          },
        ],
      }),
    );
    expect(html).toContain("$2.10 delivered");
  });
});

describe("packingSlipHtml — tracking + memo", () => {
  it("renders tracking block when numbers provided", () => {
    const html = packingSlipHtml(
      baseInput({
        trackingNumbers: ["1Z19D7600300004211", "1Z19D7600301187228"],
      }),
    );
    expect(html).toContain("1Z19D7600300004211");
    expect(html).toContain("1Z19D7600301187228");
    expect(html).toMatch(/Carton 1 of 2/);
    expect(html).toMatch(/Carton 2 of 2/);
  });

  it("omits carton N of M when a single tracking is provided", () => {
    const html = packingSlipHtml(
      baseInput({ trackingNumbers: ["9405550106151029204546"] }),
    );
    expect(html).toContain("9405550106151029204546");
    expect(html).not.toMatch(/Carton 1 of 1/);
  });

  it("renders memo block when provided", () => {
    const html = packingSlipHtml(
      baseInput({
        memo: "Show Special — $3.25/bag with <strong>FREE shipping</strong>",
      }),
    );
    expect(html).toContain("Show Special");
    expect(html).toContain("FREE shipping"); // HTML preserved
  });
});
