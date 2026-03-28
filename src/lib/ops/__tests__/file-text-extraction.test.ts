import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: vi.fn((payload: { data: Uint8Array }) => {
    const marker = Buffer.from(payload.data).toString("utf8");
    if (marker.includes("SCANNED")) {
      return {
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({
            getTextContent: async () => ({ items: [] }),
          }),
        }),
      };
    }

    return {
      promise: Promise.resolve({
        numPages: 2,
        getPage: async (pageNumber: number) => ({
          getTextContent: async () => ({
            items: [{ str: pageNumber === 1 ? "Bank statement opening balance" : "Ending balance 22436.10" }],
          }),
        }),
      }),
    };
  }),
}));

describe("extractPdfTextFromBuffer", () => {
  it("extracts text from a text-based PDF via pdfjs", async () => {
    const { extractPdfTextFromBuffer } = await import("@/lib/ops/file-text-extraction");
    const result = await extractPdfTextFromBuffer(Buffer.from("TEXT_BASED_PDF"), {
      maxPages: 10,
      maxChars: 1000,
    });

    expect(result.scanned).toBe(false);
    expect(result.pageCount).toBe(2);
    expect(result.text).toContain("Bank statement opening balance");
    expect(result.text).toContain("Ending balance 22436.10");
  });

  it("returns the scanned placeholder when the PDF has no extractable text", async () => {
    const { extractPdfTextFromBuffer } = await import("@/lib/ops/file-text-extraction");
    const result = await extractPdfTextFromBuffer(Buffer.from("SCANNED"), {
      scannedPlaceholder: "[Scanned PDF — no extractable text. Needs OCR.]",
    });

    expect(result.scanned).toBe(true);
    expect(result.pageCount).toBe(1);
    expect(result.text).toBe("[Scanned PDF — no extractable text. Needs OCR.]");
  });
});
