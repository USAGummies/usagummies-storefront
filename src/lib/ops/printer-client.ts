/**
 * Printer Client — USA Gummies (local-only, macOS CUPS)
 *
 * BUILD #4 — printer routing by document type.
 *
 * Context: on 2026-04-20 we sent UPS 4×6 shipping labels to the
 * Brother laser instead of the Polono thermal, burning time and
 * paper. Ben had to re-print after manually spotting the mistake.
 * Root cause: there was no helper that encoded "label → thermal,
 * packing-slip → laser" as a hard rule. This file fixes that.
 *
 * Destinations:
 *   - Shipping labels (4×6 / 100×150 mm)  → `_PL70e_BT` (Polono PL70e-BT, thermal, USB/BT)
 *   - Packing slips + invoices (letter)    → `Brother_HL_L6200DW_series` (Brother laser)
 *
 * Printer names are env-overridable so a printer swap doesn't need a
 * deploy:
 *   THERMAL_PRINTER_NAME  (default `_PL70e_BT`)
 *   LASER_PRINTER_NAME    (default `Brother_HL_L6200DW_series`)
 *
 * Thermal mode note: the Polono defaults to Gap media tracking, which
 * prints a blank "spacer" label between jobs. The doctrine-verified
 * flag is `zeMediaTracking=Continuous`. Always pass it — losing this
 * flag silently wastes label stock.
 *
 * This module only works on the host where the CUPS printer is
 * connected (Ben's MacBook). On Vercel it's a no-op that returns
 * `{ ok: false, error: "cups unavailable" }`.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------
// Printer constants — env-overridable
// ---------------------------------------------------------------------------

export const THERMAL_PRINTER_NAME =
  process.env.THERMAL_PRINTER_NAME?.trim() || "_PL70e_BT";
export const LASER_PRINTER_NAME =
  process.env.LASER_PRINTER_NAME?.trim() || "Brother_HL_L6200DW_series";

// Thermal 4×6: 288×432 pts (4 in × 6 in at 72 dpi). Matches Polono die-cut.
const THERMAL_LABEL_OPTIONS = [
  "-o",
  "PageSize=w288h432",
  // Gap mode ejects a blank label between jobs. Continuous keeps the
  // next die-cut label in position. VERIFIED doctrine.
  "-o",
  "zeMediaTracking=Continuous",
  "-o",
  "page-top=0",
  "-o",
  "page-bottom=0",
  "-o",
  "page-left=0",
  "-o",
  "page-right=0",
  "-o",
  "fit-to-page",
];

// Laser letter packing slip: default letter, 0.25" margins, duplex off.
const LASER_LETTER_OPTIONS = ["-o", "media=Letter", "-o", "sides=one-sided"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DocumentType =
  /** 4×6 shipping label (UPS, USPS, FedEx, etc.). → thermal printer. */
  | "shipping_label"
  /** Letter-sized packing slip / invoice. → laser printer. */
  | "packing_slip";

export interface PrintResult {
  ok: boolean;
  printer: string;
  docType: DocumentType;
  copies: number;
  pdfPath: string;
  /** CUPS job id (`request id is PRINTER-JOB (n file(s))`) when parsed. */
  cupsJobId?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Print a PDF. Routes thermal vs laser by `docType`. Never swap
 * this logic at the call site — callers should just declare intent
 * (shipping_label vs packing_slip) and let the module pick hardware.
 *
 * Fails cleanly when:
 *   - The PDF file doesn't exist
 *   - `lp` is unavailable (non-macOS / no CUPS) — returns ok:false
 *   - The selected printer isn't connected (CUPS exits non-zero)
 */
export async function printDocument(params: {
  docType: DocumentType;
  pdfPath: string;
  copies?: number;
}): Promise<PrintResult> {
  const docType = params.docType;
  const copies = Math.max(1, Math.floor(params.copies ?? 1));
  const pdfPath = params.pdfPath;

  if (!pdfPath || !existsSync(pdfPath)) {
    return {
      ok: false,
      printer: "",
      docType,
      copies,
      pdfPath,
      error: `PDF not found: ${pdfPath || "(empty path)"}`,
    };
  }

  const printer =
    docType === "shipping_label" ? THERMAL_PRINTER_NAME : LASER_PRINTER_NAME;
  const opts =
    docType === "shipping_label" ? THERMAL_LABEL_OPTIONS : LASER_LETTER_OPTIONS;

  const args = ["-d", printer, ...opts, "-n", String(copies), pdfPath];

  try {
    const { stdout, stderr } = await execFileP("lp", args, {
      timeout: 30_000,
      // `lp` is found in /usr/bin on macOS. Don't rely on PATH inside Next.js.
      env: { ...process.env, PATH: `/usr/bin:/bin:${process.env.PATH ?? ""}` },
    });
    const jobIdMatch = stdout.match(/request id is ([\w-]+-\d+)/);
    return {
      ok: true,
      printer,
      docType,
      copies,
      pdfPath,
      cupsJobId: jobIdMatch?.[1],
      stdout: stdout.trim() || undefined,
      stderr: stderr.trim() || undefined,
    };
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : JSON.stringify(err);
    return {
      ok: false,
      printer,
      docType,
      copies,
      pdfPath,
      error: `lp failed: ${msg}`,
    };
  }
}

/** Convenience — shipping label (thermal 4×6). */
export function printShippingLabel(
  pdfPath: string,
  copies = 1,
): Promise<PrintResult> {
  return printDocument({ docType: "shipping_label", pdfPath, copies });
}

/** Convenience — packing slip (laser letter). */
export function printPackingSlip(
  pdfPath: string,
  copies = 1,
): Promise<PrintResult> {
  return printDocument({ docType: "packing_slip", pdfPath, copies });
}

/**
 * Pairs a shipping label + packing slip into one logical print job.
 * Sends each to its correct printer. Returns both results so callers
 * can surface per-document status (e.g. "label printed, packing
 * slip failed — laser offline").
 *
 * This is the canonical way to dispatch a full order packet.
 */
export async function printOrderPacket(params: {
  labelPdfPath: string;
  packingSlipPdfPath: string;
  labelCopies?: number;
  packingSlipCopies?: number;
}): Promise<{ label: PrintResult; packingSlip: PrintResult }> {
  const [label, packingSlip] = await Promise.all([
    printShippingLabel(params.labelPdfPath, params.labelCopies ?? 1),
    printPackingSlip(
      params.packingSlipPdfPath,
      params.packingSlipCopies ?? 1,
    ),
  ]);
  return { label, packingSlip };
}
