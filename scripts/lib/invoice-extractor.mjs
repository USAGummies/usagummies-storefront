#!/usr/bin/env node
/**
 * Invoice Extractor — Gmail Invoice/Receipt Parser
 *
 * Scans Gmail via himalaya CLI for invoice and receipt emails from known vendors.
 * Extracts: vendor, amount, invoice number, date, category.
 *
 * Usage:
 *   import { scanForInvoices, extractInvoiceData } from "./lib/invoice-extractor.mjs";
 *   const invoices = await scanForInvoices({ since: "2026-02-01", dryRun: false });
 */

import { checkEmail, log } from "./usa-gummies-shared.mjs";

// ── Known Invoice Sender Patterns ───────────────────────────────────────────

export const INVOICE_PATTERNS = [
  {
    name: "Lowe Graham Jones",
    senderPattern: /lowe.*graham|lowegj/i,
    subjectPattern: /invoice|statement|billing/i,
    invoiceNumPattern: /USAG[.\-]?\d+/i,
    category: "Legal",
    amountPattern: /(?:total|amount|balance)[:\s]*\$?([\d,]+\.?\d*)/i,
  },
  {
    name: "Co-Packer (Acct 65107)",
    senderPattern: /jenna.*werner|bill.*yoder|ira.*vanorder/i,
    subjectPattern: /invoice|order|production|account.*65107/i,
    invoiceNumPattern: /(?:inv|invoice|po)[#:\s-]*(\d+)/i,
    category: "Production",
    amountPattern: /(?:total|amount|balance|due)[:\s]*\$?([\d,]+\.?\d*)/i,
  },
  {
    name: "Packaging (Gagliardi/Kroetch)",
    senderPattern: /gagliardi|kroetch/i,
    subjectPattern: /invoice|order|quote|film/i,
    invoiceNumPattern: /(?:inv|invoice)[#:\s-]*(\w+)/i,
    category: "Packaging",
    amountPattern: /(?:total|amount|balance|due)[:\s]*\$?([\d,]+\.?\d*)/i,
  },
  {
    name: "CompanySage",
    senderPattern: /companysage/i,
    subjectPattern: /invoice|receipt|registration|compliance|fee/i,
    invoiceNumPattern: /(?:inv|receipt|order)[#:\s-]*(\w+)/i,
    category: "Compliance",
    amountPattern: /(?:total|amount|charge)[:\s]*\$?([\d,]+\.?\d*)/i,
  },
  {
    name: "Shopify",
    senderPattern: /shopify/i,
    subjectPattern: /invoice|statement|subscription|balance|billing/i,
    invoiceNumPattern: /(?:inv|invoice|receipt)[#:\s-]*(\w+)/i,
    category: "SaaS",
    amountPattern: /(?:total|amount|charge|balance)[:\s]*\$?([\d,]+\.?\d*)/i,
  },
  {
    name: "RushOrderTees",
    senderPattern: /rushordertees/i,
    subjectPattern: /invoice|order|receipt|confirmation/i,
    invoiceNumPattern: /(?:order|inv)[#:\s-]*(\w+)/i,
    category: "Marketing",
    amountPattern: /(?:total|amount|charge)[:\s]*\$?([\d,]+\.?\d*)/i,
  },
  {
    name: "Shipping (USPS/FedEx/UPS)",
    senderPattern: /usps|fedex|ups\.com|united\s*parcel/i,
    subjectPattern: /receipt|label|charge|invoice|shipping/i,
    invoiceNumPattern: /(?:tracking|label|receipt)[#:\s-]*(\w+)/i,
    category: "Shipping",
    amountPattern: /(?:total|amount|charge|cost)[:\s]*\$?([\d,]+\.?\d*)/i,
  },
  {
    name: "Found.com",
    senderPattern: /found\.com|found\s*banking/i,
    subjectPattern: /export|statement|transaction/i,
    invoiceNumPattern: null, // Found doesn't send invoices, just CSV exports
    category: "Banking",
    amountPattern: null, // N/A — Found emails are CSV exports, not invoices
    isCSVExport: true, // Flag for the transaction ingestor
  },
];

// ── Email Scanning ──────────────────────────────────────────────────────────

/**
 * Scan Gmail for invoice-like emails.
 * Uses himalaya CLI via checkEmail wrapper.
 *
 * @param {Object} options
 * @param {string} [options.since] - Only emails after this date (YYYY-MM-DD)
 * @param {number} [options.count] - Max emails to scan (default 50)
 * @param {Set} [options.processedIds] - Set of already-processed email IDs to skip
 * @param {boolean} [options.dryRun] - If true, just report findings without processing
 * @returns {{ invoices: Array, csvExports: Array, errors: string[] }}
 */
export function scanForInvoices({ since, count = 50, processedIds = new Set(), dryRun = false } = {}) {
  const query = since ? `after:${since}` : "";
  const result = checkEmail({ folder: "INBOX", count, query });

  if (!result.ok) {
    return {
      invoices: [],
      csvExports: [],
      errors: [`Email check failed: ${result.error || "unknown"}`],
    };
  }

  const emails = parseEmailList(result.output);
  const invoices = [];
  const csvExports = [];
  const errors = [];

  for (const email of emails) {
    // Skip already processed
    if (processedIds.has(email.id)) continue;

    for (const pattern of INVOICE_PATTERNS) {
      const senderMatch = pattern.senderPattern.test(email.from || "");
      const subjectMatch = pattern.subjectPattern.test(email.subject || "");

      if (senderMatch || subjectMatch) {
        if (pattern.isCSVExport) {
          csvExports.push({
            emailId: email.id,
            from: email.from,
            subject: email.subject,
            date: email.date,
            vendor: pattern.name,
          });
        } else {
          const extracted = extractInvoiceData(email, pattern);
          invoices.push({
            emailId: email.id,
            from: email.from,
            subject: email.subject,
            date: email.date,
            vendor: pattern.name,
            category: pattern.category,
            invoiceNumber: extracted.invoiceNumber,
            amount: extracted.amount,
            confidence: extracted.confidence,
            dryRun,
          });
        }
        break; // First pattern match wins
      }
    }
  }

  return { invoices, csvExports, errors };
}

/**
 * Extract invoice data from an email using pattern matching.
 */
export function extractInvoiceData(email, pattern) {
  const text = `${email.subject || ""} ${email.body || ""}`;
  let invoiceNumber = "";
  let amount = null;
  let confidence = "low";

  // Extract invoice number
  if (pattern.invoiceNumPattern) {
    const m = text.match(pattern.invoiceNumPattern);
    if (m) {
      invoiceNumber = m[1] || m[0];
      confidence = "medium";
    }
  }

  // Extract amount
  if (pattern.amountPattern) {
    const m = text.match(pattern.amountPattern);
    if (m) {
      const raw = String(m[1] || "").replace(/,/g, "");
      const parsed = parseFloat(raw);
      if (!isNaN(parsed) && parsed > 0) {
        amount = parsed;
        confidence = invoiceNumber ? "high" : "medium";
      }
    }
  }

  return { invoiceNumber, amount, confidence };
}

// ── Email List Parser ───────────────────────────────────────────────────────
// Parses himalaya list output into structured objects.

function parseEmailList(output) {
  if (!output) return [];
  const emails = [];

  // himalaya outputs emails in a structured format
  // Each email block starts with an ID line
  const blocks = String(output).split(/(?=^[0-9]+\t)/m);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Try to parse structured himalaya output
    // Format varies: "ID\tFLAGS\tSUBJECT\tFROM\tDATE"
    const lines = trimmed.split("\n");
    const firstLine = lines[0] || "";
    const parts = firstLine.split("\t");

    if (parts.length >= 3) {
      emails.push({
        id: parts[0]?.trim() || "",
        flags: parts[1]?.trim() || "",
        subject: parts[2]?.trim() || "",
        from: parts[3]?.trim() || "",
        date: parts[4]?.trim() || "",
        body: lines.slice(1).join("\n").trim(),
      });
    }
  }

  return emails;
}

/**
 * Determine due date from an invoice email.
 * Looks for "Net 30", "Due by", etc.
 * Returns ISO date string or null.
 */
export function extractDueDate(text, invoiceDate) {
  const content = String(text || "");

  // Look for explicit due date
  let m = content.match(/(?:due|pay\s*by|payment\s*due)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (m) {
    const parsed = Date.parse(m[1]);
    if (!isNaN(parsed)) {
      const d = new Date(parsed);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  }

  // Look for Net terms
  m = content.match(/net\s*(\d+)/i);
  if (m && invoiceDate) {
    const days = parseInt(m[1], 10);
    const base = new Date(`${invoiceDate}T12:00:00Z`);
    base.setUTCDate(base.getUTCDate() + days);
    return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
  }

  // Default: 30 days from invoice date
  if (invoiceDate) {
    const base = new Date(`${invoiceDate}T12:00:00Z`);
    base.setUTCDate(base.getUTCDate() + 30);
    return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
  }

  return null;
}
