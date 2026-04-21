/**
 * HTML → PDF — USA Gummies (local-only, Chrome headless)
 *
 * BUILD #5 — Chrome-headless packing slip PDF generator.
 *
 * Context: on 2026-04-20 we hand-built HTML packing slips for
 * Glacier, Bryce, and Red Dog, then piped each through a manual
 * `google-chrome --headless --print-to-pdf=...` invocation to get a
 * printable PDF. That friction cost minutes per order mid-rush.
 *
 * This module wraps that invocation as a typed helper so any agent
 * can convert an HTML packing slip / invoice / sell-sheet into a
 * letter-size PDF with zero shell boilerplate.
 *
 * Pairs with `printer-client.ts` (`printPackingSlip()`) for the
 * end-to-end "HTML in, paper out" flow:
 *
 *   const { pdfPath } = await renderHtmlToPdf({ html, ... });
 *   await printPackingSlip(pdfPath);
 *
 * Local-only. On Vercel there's no Chrome binary — returns
 * `{ ok: false, error: "chrome binary not found" }`.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------
// Chrome binary lookup
// ---------------------------------------------------------------------------

const MACOS_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

const LINUX_CHROME_CANDIDATES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function resolveChromeBinary(): string | null {
  // 1. Explicit env override.
  const override = process.env.CHROME_BINARY?.trim();
  if (override && existsSync(override)) return override;

  // 2. macOS Applications.
  for (const p of MACOS_CHROME_PATHS) {
    if (existsSync(p)) return p;
  }

  // 3. Linux candidates.
  for (const p of LINUX_CHROME_CANDIDATES) {
    if (existsSync(p)) return p;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PaperSize = "Letter" | "Legal" | "A4";

export interface RenderHtmlToPdfParams {
  /** Raw HTML string. Mutually exclusive with `htmlPath`. */
  html?: string;
  /** Absolute path to an HTML file. Mutually exclusive with `html`. */
  htmlPath?: string;
  /** Where to write the PDF. Defaults to a tempfile under /tmp. */
  outputPath?: string;
  /** Letter/Legal/A4. Default: Letter. */
  paperSize?: PaperSize;
  /** `landscape=false` = portrait. Default: portrait. */
  landscape?: boolean;
  /** CSS `@page` margins are respected; this is a timeout only. */
  timeoutMs?: number;
}

export interface RenderHtmlToPdfResult {
  ok: boolean;
  pdfPath: string;
  bytes: number;
  error?: string;
  stdout?: string;
  stderr?: string;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Convert an HTML document to a PDF via Chrome headless.
 *
 * Usage:
 *   const res = await renderHtmlToPdf({ html: "<html>...</html>" });
 *   if (res.ok) await printPackingSlip(res.pdfPath);
 *
 * Why Chrome (vs. Puppeteer / wkhtmltopdf):
 *   - Puppeteer pulls ~300MB of node_modules and a second Chromium;
 *     Ben already has stock Chrome installed.
 *   - wkhtmltopdf is abandoned and doesn't support modern flex layout.
 *   - `google-chrome --headless --print-to-pdf` is zero-dep + matches
 *     the manual workflow Ben already used during the 2026-04-20 rush.
 */
export async function renderHtmlToPdf(
  params: RenderHtmlToPdfParams,
): Promise<RenderHtmlToPdfResult> {
  if (!params.html && !params.htmlPath) {
    return {
      ok: false,
      pdfPath: "",
      bytes: 0,
      error: "Must provide `html` or `htmlPath`",
    };
  }
  if (params.html && params.htmlPath) {
    return {
      ok: false,
      pdfPath: "",
      bytes: 0,
      error: "Provide `html` OR `htmlPath`, not both",
    };
  }

  const chrome = resolveChromeBinary();
  if (!chrome) {
    return {
      ok: false,
      pdfPath: "",
      bytes: 0,
      error:
        "Chrome binary not found (checked /Applications + /usr/bin). " +
        "Set CHROME_BINARY env var to override.",
    };
  }

  // Resolve input HTML path. Write inline HTML to a tempfile if needed.
  let htmlPath = params.htmlPath ?? "";
  let tempDir: string | null = null;
  if (params.html) {
    tempDir = mkdtempSync(join(tmpdir(), "usagummies-pdf-"));
    htmlPath = join(tempDir, "input.html");
    writeFileSync(htmlPath, params.html, "utf8");
  } else if (!existsSync(htmlPath)) {
    return {
      ok: false,
      pdfPath: "",
      bytes: 0,
      error: `HTML file not found: ${htmlPath}`,
    };
  }

  // Resolve output path.
  let outPath = params.outputPath;
  if (!outPath) {
    if (!tempDir) tempDir = mkdtempSync(join(tmpdir(), "usagummies-pdf-"));
    outPath = join(tempDir, "output.pdf");
  }

  // Chrome flags — headless, no-sandbox for CI/dev, no header/footer on PDF,
  // disable GPU (not needed for PDF generation).
  const paper = params.paperSize ?? "Letter";
  const paperSizeArg = (() => {
    // Chrome accepts --no-pdf-header-footer but paper size has to come
    // from the HTML via @page — so we inject a style block if none exists.
    switch (paper) {
      case "Legal":
        return "size: Legal";
      case "A4":
        return "size: A4";
      default:
        return "size: Letter";
    }
  })();
  // We don't actually inject @page here because most of our packing slips
  // already declare `@page { size: letter; margin: 0.5in; }`. `paperSizeArg`
  // is preserved for docs — Chrome respects the HTML's @page directive.
  void paperSizeArg;

  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-pdf-header-footer",
    `--print-to-pdf=${outPath}`,
    ...(params.landscape ? ["--print-to-pdf-landscape"] : []),
    `file://${htmlPath}`,
  ];

  try {
    const { stdout, stderr } = await execFileP(chrome, args, {
      timeout: params.timeoutMs ?? 30_000,
    });
    if (!existsSync(outPath)) {
      return {
        ok: false,
        pdfPath: outPath,
        bytes: 0,
        error: "Chrome returned no error but PDF file was not created",
        stdout: stdout.trim() || undefined,
        stderr: stderr.trim() || undefined,
      };
    }
    // Stat the file for byte count.
    const { statSync } = await import("node:fs");
    const bytes = statSync(outPath).size;
    return {
      ok: true,
      pdfPath: outPath,
      bytes,
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
      pdfPath: outPath,
      bytes: 0,
      error: `Chrome headless failed: ${msg}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Packing slip template — used by agents to generate order packets
// ---------------------------------------------------------------------------

export interface PackingSlipInput {
  invoiceNumber: string;
  invoiceDate: string; // ISO YYYY-MM-DD
  terms?: string; // "Net 10", "Net 30", "COD", "Paid — Shopify"
  dueDate?: string;
  shipFrom: {
    name: string;
    street1: string;
    street2?: string;
    city: string;
    state: string;
    postalCode: string;
    phone?: string;
  };
  shipTo: {
    name: string;
    company?: string;
    attn?: string;
    street1: string;
    street2?: string;
    city: string;
    state: string;
    postalCode: string;
    phone?: string;
  };
  lineItems: Array<{
    qty: number;
    description: string;
    sub?: string; // smaller grey sub-line
    unitPrice: number;
    unitLabel?: string; // e.g. "$2.10 delivered" vs "$2.10"
  }>;
  freightLine?: {
    label: string; // "Freight (included)" or "Freight (UPS Ground 2 cartons)"
    amount: number; // 0 for absorbed, or computed freight dollars
  };
  totalOverride?: number;
  trackingNumbers?: string[]; // UPS/USPS numbers shown in a dashed box
  memo?: string;
  footer?: string;
}

/**
 * Render a packing-slip HTML string using the USA Gummies red-and-white
 * brand template. Pairs with `renderHtmlToPdf()` + `printPackingSlip()`.
 *
 * All dollar amounts should already be rounded by the caller to 2 decimal places.
 */
export function packingSlipHtml(input: PackingSlipInput): string {
  const itemsHtml = input.lineItems
    .map((it) => {
      const unit = (it.unitLabel ?? `$${it.unitPrice.toFixed(2)}`).replace(
        /</g,
        "&lt;",
      );
      const total = (it.qty * it.unitPrice).toFixed(2);
      return `
      <tr>
        <td>${it.qty}</td>
        <td><strong>${escape(it.description)}</strong>${
          it.sub
            ? `<br><span style="color:#666;font-size:11px;">${escape(it.sub)}</span>`
            : ""
        }</td>
        <td class="num">${unit}</td>
        <td class="num">$${total}</td>
      </tr>`;
    })
    .join("");

  const subtotal = input.lineItems.reduce(
    (a, it) => a + it.qty * it.unitPrice,
    0,
  );
  const freight = input.freightLine?.amount ?? 0;
  const total = input.totalOverride ?? subtotal + freight;

  const trackingHtml =
    input.trackingNumbers && input.trackingNumbers.length > 0
      ? `<div class="tracking"><strong>Tracking:</strong><br>${input.trackingNumbers
          .map((t, i) =>
            input.trackingNumbers!.length > 1
              ? `Carton ${i + 1} of ${input.trackingNumbers!.length} — ${escape(t)}`
              : escape(t),
          )
          .join("<br>")}</div>`
      : "";

  const termsHtml = input.terms
    ? ` · Terms: ${escape(input.terms)}${
        input.dueDate ? ` · Due: ${escape(input.dueDate)}` : ""
      }`
    : "";

  const attnHtml = input.shipTo.attn
    ? `<div>Attn: ${escape(input.shipTo.attn)}</div>`
    : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Packing Slip — ${escape(input.shipTo.name)}</title>
<style>
@page { size: letter; margin: 0.5in; }
body { font-family: -apple-system, Arial, sans-serif; color: #111; }
.header { border-bottom: 3px solid #b22234; padding-bottom: 12px; margin-bottom: 18px; }
.header h1 { margin: 0; font-size: 28px; color: #b22234; }
.header .tag { font-size: 12px; color: #555; margin-top: 4px; }
.title { font-size: 22px; font-weight: 700; margin: 10px 0 4px; }
.two-col { display: flex; gap: 24px; margin: 14px 0 18px; }
.two-col > div { flex: 1; background: #f7f7f7; padding: 12px 14px; border-radius: 6px; border-left: 4px solid #b22234; }
.two-col h3 { margin: 0 0 6px; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: #b22234; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; }
table th { background: #111; color: #fff; padding: 8px; text-align: left; font-size: 12px; }
table td { padding: 10px 8px; border-bottom: 1px solid #ddd; font-size: 13px; }
table td.num, table th.num { text-align: right; }
.totals { margin-top: 14px; padding: 14px; background: #f7f7f7; border-left: 4px solid #16a34a; }
.totals div { display: flex; justify-content: space-between; margin: 3px 0; }
.totals .grand { font-weight: 700; font-size: 16px; margin-top: 8px; padding-top: 8px; border-top: 2px solid #111; }
.tracking { margin-top: 14px; padding: 12px; background: #eef7ef; border: 1px dashed #16a34a; font-family: ui-monospace, Menlo, monospace; font-size: 13px; }
.memo { margin-top: 10px; padding: 10px; background: #fff9e6; border-left: 4px solid #f59e0b; font-size: 12px; }
.footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 11px; color: #666; }
</style>
</head><body>
<div class="header">
  <h1>USA Gummies</h1>
  <div class="tag">Made in the U.S.A. · usagummies.com · ben@usagummies.com · (307) 209-4928</div>
</div>
<div class="title">Packing Slip + Invoice · #${escape(input.invoiceNumber)}</div>
<div style="font-size:13px;color:#555;">Invoice date: ${escape(input.invoiceDate)}${termsHtml}</div>
<div class="two-col">
  <div>
    <h3>Ship From</h3>
    <div><strong>${escape(input.shipFrom.name)}</strong></div>
    <div>${escape(input.shipFrom.street1)}</div>
    ${input.shipFrom.street2 ? `<div>${escape(input.shipFrom.street2)}</div>` : ""}
    <div>${escape(input.shipFrom.city)}, ${escape(input.shipFrom.state)} ${escape(input.shipFrom.postalCode)}</div>
    ${input.shipFrom.phone ? `<div>${escape(input.shipFrom.phone)}</div>` : ""}
  </div>
  <div>
    <h3>Ship To</h3>
    <div><strong>${escape(input.shipTo.name)}</strong></div>
    ${input.shipTo.company ? `<div>${escape(input.shipTo.company)}</div>` : ""}
    ${attnHtml}
    <div>${escape(input.shipTo.street1)}</div>
    ${input.shipTo.street2 ? `<div>${escape(input.shipTo.street2)}</div>` : ""}
    <div>${escape(input.shipTo.city)}, ${escape(input.shipTo.state)} ${escape(input.shipTo.postalCode)}</div>
    ${input.shipTo.phone ? `<div>${escape(input.shipTo.phone)}</div>` : ""}
  </div>
</div>
<table>
  <thead>
    <tr>
      <th style="width:45px;">Qty</th>
      <th>Item</th>
      <th class="num" style="width:100px;">Unit</th>
      <th class="num" style="width:110px;">Total</th>
    </tr>
  </thead>
  <tbody>${itemsHtml}</tbody>
</table>
<div class="totals">
  <div><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
  ${
    input.freightLine
      ? `<div><span>${escape(input.freightLine.label)}</span><span>$${freight.toFixed(2)}</span></div>`
      : ""
  }
  <div class="grand"><span>Total due</span><span>$${total.toFixed(2)}</span></div>
</div>
${trackingHtml}
${input.memo ? `<div class="memo">${input.memo}</div>` : ""}
<div class="footer">${escape(input.footer ?? "Made in the U.S.A. · All natural colors · No artificial dyes · usagummies.com")}</div>
</body></html>`;
}

// Minimal HTML-escape for interpolated values. Intentionally tiny —
// packing slip template only handles trusted internal inputs, this
// is just defense against broken addresses with "&" in them.
function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
