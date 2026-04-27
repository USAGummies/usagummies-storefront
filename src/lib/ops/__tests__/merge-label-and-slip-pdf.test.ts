/**
 * Phase 28m — `mergeLabelAndSlipPdf` 2-page PDF.
 *
 * Doctrinal rule (Ben 2026-04-27, "this needs to be fixed fucking
 * now"): when Ben prints the shipping label, it MUST be a 2-page
 * print — page 1 the label, page 2 the packing slip with correct
 * quantities and product name. **One click, both pages.** No
 * thread reply. No race condition. No silent drops.
 *
 * Locks the contract:
 *   - Output is a valid PDF that contains exactly
 *     `labelPages + slipPages` pages.
 *   - Page order: label first, then slip.
 *   - Multi-page label inputs (carrier shipper-receipt etc.) are
 *     preserved — copyPages copies ALL of them.
 *   - Empty/invalid inputs throw — no silent label-only output.
 *   - Output is a Buffer (callers expect Buffer for Slack upload).
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import {
  buildPackingSlipPdfBuffer,
  mergeLabelAndSlipPdf,
} from "../packing-slip-pdf";

async function makeBlankPdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([612, 792]);
  }
  return Buffer.from(await doc.save());
}

async function pageCount(buf: Buffer): Promise<number> {
  return (await PDFDocument.load(buf)).getPageCount();
}

describe("mergeLabelAndSlipPdf — 2-page contract", () => {
  it("single-page label + 1-page slip → 2-page merged PDF", async () => {
    const label = await makeBlankPdf(1);
    const slip = await makeBlankPdf(1);
    const merged = await mergeLabelAndSlipPdf(label, slip);
    expect(Buffer.isBuffer(merged)).toBe(true);
    expect(await pageCount(merged)).toBe(2);
  });

  it("multi-page label (carrier receipt) is preserved — all pages copied", async () => {
    const label = await makeBlankPdf(2); // e.g. label + shipper receipt
    const slip = await makeBlankPdf(1);
    const merged = await mergeLabelAndSlipPdf(label, slip);
    expect(await pageCount(merged)).toBe(3);
  });

  it("page order: label pages FIRST, then slip pages", async () => {
    // Build a label with one page sized 100×100 and a slip with one
    // page sized 200×200; verify order via page dimensions.
    const labelDoc = await PDFDocument.create();
    labelDoc.addPage([100, 100]);
    const label = Buffer.from(await labelDoc.save());

    const slipDoc = await PDFDocument.create();
    slipDoc.addPage([200, 200]);
    const slip = Buffer.from(await slipDoc.save());

    const merged = await mergeLabelAndSlipPdf(label, slip);
    const mergedDoc = await PDFDocument.load(merged);
    expect(mergedDoc.getPageCount()).toBe(2);
    const p0 = mergedDoc.getPage(0);
    const p1 = mergedDoc.getPage(1);
    expect(Math.round(p0.getWidth())).toBe(100); // label first
    expect(Math.round(p0.getHeight())).toBe(100);
    expect(Math.round(p1.getWidth())).toBe(200); // slip second
    expect(Math.round(p1.getHeight())).toBe(200);
  });

  it("works with a real packing slip from buildPackingSlipPdfBuffer", async () => {
    const label = await makeBlankPdf(1);
    const slip = await buildPackingSlipPdfBuffer({
      orderNumber: "111-1502722-7838646",
      source: "amazon",
      orderDate: "2026-04-27T11:00:00.000Z",
      shipDate: "2026-04-27T16:00:00.000Z",
      shipTo: {
        name: "Amy Catalano",
        street1: "2882 Oakwood Dr",
        street2: null,
        city: "Willoughby Hills",
        state: "OH",
        postalCode: "44094-9158",
        country: "US",
      },
      items: [
        {
          sku: "USG-FBM-1PK",
          name: "USA Gummies — All American Gummy Bears, 7.5 oz Bag",
          quantity: 1,
        },
      ],
      carrierService: "USPS First-Class",
      trackingNumber: "9400150206217663670669",
    });
    const merged = await mergeLabelAndSlipPdf(label, slip);
    expect(await pageCount(merged)).toBe(2);
  });

  it("throws on empty label input — never produces a label-less merged PDF", async () => {
    const slip = await makeBlankPdf(1);
    await expect(
      mergeLabelAndSlipPdf(Buffer.alloc(0), slip),
    ).rejects.toThrow(/labelPdf is empty/);
  });

  it("throws on empty slip input — never produces a slip-less merged PDF", async () => {
    const label = await makeBlankPdf(1);
    await expect(
      mergeLabelAndSlipPdf(label, Buffer.alloc(0)),
    ).rejects.toThrow(/slipPdf is empty/);
  });

  it("merged output is a valid PDF that round-trips through PDFDocument.load", async () => {
    const label = await makeBlankPdf(1);
    const slip = await makeBlankPdf(1);
    const merged = await mergeLabelAndSlipPdf(label, slip);
    // Round-trip — proves the bytes are valid PDF, not a malformed
    // concatenation. pdf-lib will throw on a bad PDF.
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(2);
  });

  it("accepts Uint8Array inputs as well as Buffer (defensive)", async () => {
    const labelU8 = new Uint8Array(await makeBlankPdf(1));
    const slipU8 = new Uint8Array(await makeBlankPdf(1));
    const merged = await mergeLabelAndSlipPdf(labelU8, slipU8);
    expect(await pageCount(merged)).toBe(2);
  });
});
