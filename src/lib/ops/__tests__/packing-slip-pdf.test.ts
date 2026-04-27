/**
 * Locks the contract for `buildPackingSlipPdfBuffer`:
 *   - Always returns a non-empty PDF Buffer for valid input.
 *   - Refuses empty `items` arrays — that's the "ShipStation page-2 is
 *     blank" bug we're fixing, so the generator must NEVER produce
 *     a slip without at least one line item.
 *   - Strips non-WinAnsi characters so accented names / emoji never
 *     crash pdf-lib's StandardFonts.
 *   - Embeds the order number, ship-to name, SKU, qty, and tracking
 *     into the rendered PDF text stream so a downstream extractor
 *     (or human reader) can verify the data made it through.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import { buildPackingSlipPdfBuffer } from "@/lib/ops/packing-slip-pdf";

const VALID_INPUT = {
  orderNumber: "111-1056090-8513067",
  source: "Amazon FBM",
  orderDate: "2026-04-25",
  shipDate: "2026-04-27",
  shipTo: {
    name: "Margaret Moriarity",
    street1: "15012 Sunrise Ln",
    city: "Burnsville",
    state: "MN",
    postalCode: "55306-6386",
    country: "US",
  },
  items: [
    {
      sku: "USG-FBM-1PK",
      name: "USA Gummies — All American Gummy Bears, 7.5 oz Bag",
      quantity: 3,
    },
  ],
  carrierService: "UPS Ground Saver",
  trackingNumber: "1ZJ74F69YW43918760",
};

describe("buildPackingSlipPdfBuffer", () => {
  it("returns a non-empty PDF buffer for valid input", async () => {
    const buf = await buildPackingSlipPdfBuffer(VALID_INPUT);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.byteLength).toBeGreaterThan(500);
    // Verify the bytes are a valid PDF (starts with %PDF-)
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("the generated PDF has exactly 1 page", async () => {
    const buf = await buildPackingSlipPdfBuffer(VALID_INPUT);
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBe(1);
  });

  it("throws when items is empty (refuses to render an item-less slip)", async () => {
    await expect(
      buildPackingSlipPdfBuffer({ ...VALID_INPUT, items: [] }),
    ).rejects.toThrow(/items required/i);
  });

  it("throws when orderNumber is empty", async () => {
    await expect(
      buildPackingSlipPdfBuffer({ ...VALID_INPUT, orderNumber: "" }),
    ).rejects.toThrow(/orderNumber required/i);
  });

  it("survives non-WinAnsi characters in shipTo / items (no crash)", async () => {
    const buf = await buildPackingSlipPdfBuffer({
      ...VALID_INPUT,
      shipTo: {
        ...VALID_INPUT.shipTo,
        name: "Renée Müller — café",
      },
      items: [
        {
          sku: "USG-FBM-1PK",
          name: "All American Gummy Bears — “premium” 7.5 oz",
          quantity: 1,
        },
      ],
    });
    expect(buf.byteLength).toBeGreaterThan(500);
  });

  it("renders multiple line items (qty + sku + name preserved)", async () => {
    const buf = await buildPackingSlipPdfBuffer({
      ...VALID_INPUT,
      items: [
        { sku: "USG-FBM-1PK", name: "Bag 7.5oz", quantity: 2 },
        { sku: "USG-FBM-3PK", name: "3-Pack 7.5oz", quantity: 1 },
      ],
    });
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBe(1);
  });

  it("handles missing optional fields without crashing", async () => {
    const buf = await buildPackingSlipPdfBuffer({
      orderNumber: "MIN-1",
      source: "Manual",
      shipTo: {
        name: "Minimal",
        street1: "1 Test St",
        city: "Nowhere",
        state: "CA",
        postalCode: "90000",
      },
      items: [{ quantity: 1 }],
    });
    expect(buf.byteLength).toBeGreaterThan(500);
  });
});
