/**
 * Branded packing-slip PDF generator.
 *
 * Replaces the empty page-2 that ShipStation returns from createlabel
 * (which has no order #, no items, no qty — just the ship-to). The
 * auto-ship pipeline calls this with the ShipStation order summary
 * (which DOES carry items + ship-to) so every packing slip threaded
 * under a label in `#shipping` shows real order data.
 *
 * Why pure pdf-lib (no headless Chrome): runs in Vercel serverless
 * where Chrome isn't available. `html-to-pdf.ts` exists for Ben's
 * laptop workflow; this file is the serverless equivalent.
 *
 * Layout — Letter portrait, single-page:
 *   ┌────────────────────────── PACKING SLIP ──────────────────────────┐
 *   │  USA Gummies                              Order #  <orderNumber> │
 *   │  30027 SR 706 E                           Order Date  <date>     │
 *   │  Ashford, WA 98304                        Ship Date <date>       │
 *   │  ben@usagummies.com                       Channel  <source>      │
 *   │                                                                  │
 *   │  Ship To:                                                        │
 *   │  <name>                                                          │
 *   │  <street1> [/ street2]                                           │
 *   │  <city>, <state> <postalCode>                                    │
 *   │  <country>                                                       │
 *   │                                                                  │
 *   │  ┌─SKU─────────┬─Description─────────────────┬─Qty─┐             │
 *   │  │ <sku>        │ <name>                       │ <q>  │             │
 *   │  │ ...          │ ...                          │ ...  │             │
 *   │  └─────────────┴─────────────────────────────┴─────┘             │
 *   │                                                                  │
 *   │  Carrier: <service>                                              │
 *   │  Tracking: <tracking>                                            │
 *   │                                                                  │
 *   │  Thank you for your order! — usagummies.com                      │
 *   └──────────────────────────────────────────────────────────────────┘
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Default ship-from values. Mirrors `/api/ops/fulfillment/packing-slip`'s
 * DEFAULT_SHIP_FROM, with env-var overrides for the same vars
 * `SHIPSTATION_FROM_*` so a single config change moves both surfaces.
 */
const DEFAULT_FROM = {
  name: process.env.SHIPSTATION_FROM_COMPANY?.trim() || "USA Gummies",
  street1: process.env.SHIPSTATION_FROM_STREET1?.trim() || "30027 SR 706 E",
  city: process.env.SHIPSTATION_FROM_CITY?.trim() || "Ashford",
  state: process.env.SHIPSTATION_FROM_STATE?.trim() || "WA",
  postalCode: process.env.SHIPSTATION_FROM_POSTALCODE?.trim() || "98304",
  email: process.env.SHIPSTATION_FROM_EMAIL?.trim() || "ben@usagummies.com",
};

export interface PackingSlipPdfInput {
  /** Channel order number (Amazon "111-…", Shopify "1016", etc.). */
  orderNumber: string;
  /** Free-form source label, e.g. "Amazon FBM", "Shopify", "Manual". */
  source: string;
  /** ISO date or empty — when the order was placed. Shown as `Order Date`. */
  orderDate?: string | null;
  /** ISO date — when the label was bought / shipment dispatched. */
  shipDate?: string | null;
  /** Recipient. */
  shipTo: {
    name?: string | null;
    company?: string | null;
    street1?: string | null;
    street2?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    country?: string | null;
    phone?: string | null;
  };
  /** Line items. NEVER empty — caller is responsible for synthesizing
   *  a single "Unknown item" entry if upstream has no items. We refuse
   *  to render an item-less slip (that's the bug we're fixing). */
  items: Array<{
    sku?: string | null;
    name?: string | null;
    quantity: number;
  }>;
  /** Carrier service label, e.g. "USPS Ground Advantage". */
  carrierService?: string | null;
  /** Tracking number. */
  trackingNumber?: string | null;
}

/**
 * Render a single-page packing slip and return its bytes as a Node
 * Buffer. Caller is expected to attach the result to Slack / Drive.
 *
 * Throws on truly unrecoverable input (missing orderNumber, empty
 * items array). Returns a never-empty Buffer on success.
 */
export async function buildPackingSlipPdfBuffer(
  input: PackingSlipPdfInput,
): Promise<Buffer> {
  if (!input.orderNumber?.trim()) {
    throw new Error("buildPackingSlipPdfBuffer: orderNumber required");
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error(
      "buildPackingSlipPdfBuffer: items required (non-empty array)",
    );
  }

  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // Letter portrait
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const helvOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  const M = 48; // page margin
  const W = 612 - 2 * M;
  let y = 792 - M;

  // ---- Title ---------------------------------------------------------
  drawCentered(page, "PACKING SLIP", helvBold, 22, y, 612);
  y -= 36;

  // ---- Header: from (left) + order info (right) ----------------------
  const colLeftX = M;
  const colRightX = M + W / 2 + 8;
  const headerStartY = y;

  // Left: from
  let lyL = headerStartY;
  lyL = drawLine(page, DEFAULT_FROM.name, colLeftX, lyL, helvBold, 12);
  lyL = drawLine(page, DEFAULT_FROM.street1, colLeftX, lyL, helv, 11);
  lyL = drawLine(
    page,
    `${DEFAULT_FROM.city}, ${DEFAULT_FROM.state} ${DEFAULT_FROM.postalCode}`,
    colLeftX,
    lyL,
    helv,
    11,
  );
  lyL = drawLine(page, DEFAULT_FROM.email, colLeftX, lyL, helv, 10, {
    color: rgb(0.45, 0.45, 0.45),
  });

  // Right: order info
  let lyR = headerStartY;
  lyR = drawKV(page, "Order #", input.orderNumber, colRightX, lyR, helv, helvBold, 11);
  if (input.orderDate) {
    lyR = drawKV(page, "Order Date", formatDate(input.orderDate), colRightX, lyR, helv, helvBold, 11);
  }
  if (input.shipDate) {
    lyR = drawKV(page, "Ship Date", formatDate(input.shipDate), colRightX, lyR, helv, helvBold, 11);
  }
  lyR = drawKV(page, "Channel", input.source || "—", colRightX, lyR, helv, helvBold, 11);

  y = Math.min(lyL, lyR) - 16;

  // ---- Ship To -------------------------------------------------------
  y = drawLine(page, "Ship To:", M, y, helvBold, 12);
  y = drawLine(page, input.shipTo.name ?? "", M, y, helv, 11);
  if (input.shipTo.company) y = drawLine(page, input.shipTo.company, M, y, helv, 11);
  if (input.shipTo.street1) y = drawLine(page, input.shipTo.street1, M, y, helv, 11);
  if (input.shipTo.street2) y = drawLine(page, input.shipTo.street2, M, y, helv, 11);
  const cityLine = [
    input.shipTo.city,
    input.shipTo.state ? `${input.shipTo.state} ${input.shipTo.postalCode ?? ""}`.trim() : input.shipTo.postalCode,
  ]
    .filter(Boolean)
    .join(", ");
  if (cityLine) y = drawLine(page, cityLine, M, y, helv, 11);
  if (input.shipTo.country && input.shipTo.country.toUpperCase() !== "US") {
    y = drawLine(page, input.shipTo.country, M, y, helv, 11);
  }
  y -= 16;

  // ---- Items table ---------------------------------------------------
  const tableX = M;
  const tableW = W;
  const colSku = 110;
  const colQty = 50;
  const colDesc = tableW - colSku - colQty;

  // Header row
  page.drawRectangle({
    x: tableX,
    y: y - 22,
    width: tableW,
    height: 22,
    color: rgb(0.94, 0.94, 0.94),
  });
  page.drawText("SKU", { x: tableX + 8, y: y - 16, size: 11, font: helvBold });
  page.drawText("Description", {
    x: tableX + colSku + 8,
    y: y - 16,
    size: 11,
    font: helvBold,
  });
  page.drawText("Qty", {
    x: tableX + colSku + colDesc + 16,
    y: y - 16,
    size: 11,
    font: helvBold,
  });
  y -= 22;

  // Item rows
  for (const item of input.items) {
    const rowH = 22;
    page.drawRectangle({
      x: tableX,
      y: y - rowH,
      width: tableW,
      height: rowH,
      borderColor: rgb(0.6, 0.6, 0.6),
      borderWidth: 0.5,
    });
    const sku = item.sku?.trim() || "—";
    const desc = item.name?.trim() || "—";
    const qty = String(item.quantity);
    page.drawText(truncate(sku, 18), {
      x: tableX + 8,
      y: y - 15,
      size: 10,
      font: helv,
    });
    page.drawText(truncate(desc, 64), {
      x: tableX + colSku + 8,
      y: y - 15,
      size: 10,
      font: helv,
    });
    page.drawText(qty, {
      x: tableX + colSku + colDesc + 22,
      y: y - 15,
      size: 11,
      font: helvBold,
    });
    y -= rowH;
  }
  y -= 18;

  // ---- Carrier + tracking -------------------------------------------
  if (input.carrierService) {
    y = drawKV(page, "Carrier", input.carrierService, M, y, helv, helvBold, 11);
  }
  if (input.trackingNumber) {
    y = drawKV(page, "Tracking #", input.trackingNumber, M, y, helv, helvBold, 11);
  }
  y -= 24;

  // ---- Footer --------------------------------------------------------
  drawLine(page, "Thank you for your order!", M, y, helvOblique, 10, {
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= 14;
  drawLine(
    page,
    `Questions? ${DEFAULT_FROM.email} — usagummies.com`,
    M,
    y,
    helv,
    10,
    {
      color: rgb(0.45, 0.45, 0.45),
    },
  );

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function drawLine(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  opts?: { color?: ReturnType<typeof rgb> },
): number {
  page.drawText(sanitize(text), {
    x,
    y: y - size,
    size,
    font,
    color: opts?.color ?? rgb(0, 0, 0),
  });
  return y - size - 4;
}

function drawKV(
  page: PDFPage,
  key: string,
  value: string,
  x: number,
  y: number,
  font: PDFFont,
  bold: PDFFont,
  size: number,
): number {
  page.drawText(`${key}:`, { x, y: y - size, size, font: bold });
  // Indent value after the key
  const keyWidth = bold.widthOfTextAtSize(`${key}:`, size) + 6;
  page.drawText(sanitize(value), {
    x: x + keyWidth,
    y: y - size,
    size,
    font,
  });
  return y - size - 6;
}

function drawCentered(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  y: number,
  pageWidth: number,
): void {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: (pageWidth - w) / 2,
    y: y - size,
    size,
    font,
  });
}

/**
 * pdf-lib's StandardFonts can't render anything outside WinAnsi
 * (no em-dash, smart quotes, accented chars). The auto-ship path
 * surfaces real customer data, so strip non-WinAnsi to keep the
 * generator total-fail-soft.
 */
function sanitize(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .replace(/[‐-―]/g, "-") // hyphens / em-dashes
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-\xFF]/g, "?");
}

function truncate(s: string, n: number): string {
  const clean = sanitize(s);
  return clean.length <= n ? clean : `${clean.slice(0, n - 1)}…`.replace(/…/, "...");
}

function formatDate(iso: string): string {
  // Accept "YYYY-MM-DD" or full ISO timestamp; emit "M/D/YYYY".
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Merge label + packing slip into one 2-page PDF
// ---------------------------------------------------------------------------

/**
 * Concatenate the label PDF + packing-slip PDF into a single
 * **2-page** PDF (page 1 = label, page 2 = packing slip).
 *
 * **Doctrinal rule (Ben 2026-04-27, "this needs to be fixed
 * fucking now"):** when Ben prints the shipping label, it MUST be
 * a 2-page print — page 1 the label, page 2 the packing slip with
 * correct quantities and the product name. **One click, both
 * pages.** No thread reply. No race condition. No silent drops.
 *
 * Why this matters:
 *   - Eliminates the Slack thread-reply propagation race entirely
 *     (the previous failure mode).
 *   - Eliminates the "label without slip" possibility — the slip
 *     is physically in the same PDF as the label.
 *   - Single Drive write, single Slack post, single source of
 *     truth.
 *
 * Implementation notes:
 *   - Uses `pdf-lib`'s `PDFDocument.copyPages` — works in Vercel
 *     serverless (no headless Chrome).
 *   - The label may itself be multi-page (some carriers include a
 *     shipper receipt page). We copy ALL pages of the label so
 *     nothing is lost. The packing slip is always 1 page (built by
 *     `buildPackingSlipPdfBuffer`).
 *   - If either input is empty/invalid, throws — the caller MUST
 *     handle this and decide whether to fall back or fail the buy.
 *     We never produce a "label-only" PDF and call it "merged" —
 *     that would be a silent regression of the doctrinal rule.
 *
 * Pure async — no I/O, no clock side-effects.
 */
export async function mergeLabelAndSlipPdf(
  labelPdf: Buffer | Uint8Array,
  slipPdf: Buffer | Uint8Array,
): Promise<Buffer> {
  if (!labelPdf || labelPdf.length === 0) {
    throw new Error("mergeLabelAndSlipPdf: labelPdf is empty");
  }
  if (!slipPdf || slipPdf.length === 0) {
    throw new Error("mergeLabelAndSlipPdf: slipPdf is empty");
  }

  const merged = await PDFDocument.create();
  const labelDoc = await PDFDocument.load(labelPdf);
  const slipDoc = await PDFDocument.load(slipPdf);

  if (labelDoc.getPageCount() === 0) {
    throw new Error("mergeLabelAndSlipPdf: label PDF has zero pages");
  }
  if (slipDoc.getPageCount() === 0) {
    throw new Error("mergeLabelAndSlipPdf: slip PDF has zero pages");
  }

  // Copy ALL label pages (some carriers include a shipper receipt
  // as a second page; preserve that — the operator may still need
  // it).
  const labelPages = await merged.copyPages(
    labelDoc,
    labelDoc.getPageIndices(),
  );
  for (const p of labelPages) merged.addPage(p);

  // Copy the packing slip (always 1 page, built by
  // `buildPackingSlipPdfBuffer`).
  const slipPages = await merged.copyPages(slipDoc, slipDoc.getPageIndices());
  for (const p of slipPages) merged.addPage(p);

  const bytes = await merged.save();
  return Buffer.from(bytes);
}

