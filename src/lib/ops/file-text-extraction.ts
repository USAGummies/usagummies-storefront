import { Buffer } from "node:buffer";

export type PdfExtractionOptions = {
  maxPages?: number;
  maxChars?: number;
  scannedPlaceholder?: string;
};

export type PdfExtractionResult = {
  text: string;
  pageCount: number;
  scanned: boolean;
};

const DEFAULT_SCANNED_PLACEHOLDER = "[Scanned PDF — no extractable text. Needs OCR.]";

export async function extractPdfTextFromBuffer(
  input: Buffer | Uint8Array,
  options: PdfExtractionOptions = {},
): Promise<PdfExtractionResult> {
  const { maxPages = 50, maxChars = 50_000, scannedPlaceholder = DEFAULT_SCANNED_PLACEHOLDER } = options;
  const data = input instanceof Buffer ? input : Buffer.from(input);
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: Record<string, unknown>) => (item as { str?: string }).str || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (pageText) pages.push(pageText);
  }

  const text = pages.join("\n\n").slice(0, maxChars).trim();
  if (!text || text.length < 20) {
    return {
      text: scannedPlaceholder,
      pageCount: doc.numPages,
      scanned: true,
    };
  }

  return {
    text,
    pageCount: doc.numPages,
    scanned: false,
  };
}
