#!/usr/bin/env node
/**
 * Found.com CSV Transaction Parser
 *
 * Parses CSV exports from Found.com banking.
 * Found exports arrive via email (subject: "Your Found export is ready")
 * with a CSV attachment containing: Date, Description, Amount, Category
 *
 * Usage:
 *   import { parseFoundCSV, parseFoundCSVFromFile } from "./lib/found-csv-parser.mjs";
 *   const transactions = parseFoundCSV(csvString);
 *   const transactions = parseFoundCSVFromFile("/path/to/export.csv");
 */

import fs from "node:fs";

// ── Known Found.com CSV Column Patterns ─────────────────────────────────────
// Found exports may vary column names. We normalize to a consistent schema.

const COLUMN_ALIASES = {
  date: ["date", "transaction date", "trans date", "posted date", "posting date"],
  description: ["description", "memo", "narrative", "details", "transaction description", "merchant"],
  amount: ["amount", "transaction amount", "trans amount", "value"],
  category: ["category", "type", "transaction type", "trans type"],
  status: ["status", "transaction status"],
  reference: ["reference", "ref", "reference number", "confirmation", "id"],
};

function normalizeHeader(header) {
  return String(header || "").trim().toLowerCase().replace(/[^a-z0-9 ]/g, "");
}

function mapColumns(headers) {
  const mapping = {};
  const normalized = headers.map(normalizeHeader);
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = normalized.findIndex((h) => aliases.includes(h));
    if (idx !== -1) mapping[canonical] = idx;
  }
  return mapping;
}

// ── CSV Parsing ─────────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parse a Found.com CSV string into normalized transaction objects.
 *
 * @param {string} csvString — Raw CSV content
 * @returns {{ transactions: Array, errors: string[], stats: Object }}
 */
export function parseFoundCSV(csvString) {
  const lines = String(csvString || "")
    .split(/\r?\n/)
    .filter((l) => l.trim());

  if (lines.length < 2) {
    return { transactions: [], errors: ["CSV has no data rows"], stats: { total: 0, parsed: 0, skipped: 0 } };
  }

  const headers = parseCSVLine(lines[0]);
  const mapping = mapColumns(headers);
  const errors = [];
  const transactions = [];

  if (mapping.date === undefined) {
    errors.push(`Could not find date column. Headers: ${headers.join(", ")}`);
    return { transactions: [], errors, stats: { total: lines.length - 1, parsed: 0, skipped: lines.length - 1 } };
  }
  if (mapping.amount === undefined) {
    errors.push(`Could not find amount column. Headers: ${headers.join(", ")}`);
    return { transactions: [], errors, stats: { total: lines.length - 1, parsed: 0, skipped: lines.length - 1 } };
  }

  for (let i = 1; i < lines.length; i++) {
    try {
      const fields = parseCSVLine(lines[i]);
      if (fields.length < 2) continue;

      const rawDate = fields[mapping.date] || "";
      const rawAmount = fields[mapping.amount] || "";
      const rawDesc = mapping.description !== undefined ? fields[mapping.description] || "" : "";
      const rawCategory = mapping.category !== undefined ? fields[mapping.category] || "" : "";
      const rawStatus = mapping.status !== undefined ? fields[mapping.status] || "" : "";
      const rawRef = mapping.reference !== undefined ? fields[mapping.reference] || "" : "";

      // Parse amount — strip currency symbols, handle parentheses for negatives
      let amount = rawAmount.replace(/[$,\s]/g, "");
      if (amount.startsWith("(") && amount.endsWith(")")) {
        amount = "-" + amount.slice(1, -1);
      }
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount)) {
        errors.push(`Row ${i + 1}: invalid amount "${rawAmount}"`);
        continue;
      }

      // Parse date — handle MM/DD/YYYY, YYYY-MM-DD, M/D/YY, etc.
      const parsedDate = normalizeDate(rawDate);
      if (!parsedDate) {
        errors.push(`Row ${i + 1}: invalid date "${rawDate}"`);
        continue;
      }

      // Determine transaction type from amount sign
      const type = numAmount >= 0 ? "Deposit" : "Withdrawal";

      transactions.push({
        date: parsedDate,
        description: rawDesc,
        amount: numAmount,
        absAmount: Math.abs(numAmount),
        type,
        category: rawCategory || "",
        status: rawStatus || "Posted",
        reference: rawRef || "",
        rawLine: i + 1,
        // Dedup key: date + amount + first 30 chars of description
        dedupKey: `${parsedDate}|${numAmount}|${rawDesc.slice(0, 30).toLowerCase()}`,
      });
    } catch (err) {
      errors.push(`Row ${i + 1}: parse error — ${err.message}`);
    }
  }

  return {
    transactions,
    errors,
    stats: {
      total: lines.length - 1,
      parsed: transactions.length,
      skipped: lines.length - 1 - transactions.length,
      totalDeposits: transactions.filter((t) => t.type === "Deposit").reduce((s, t) => s + t.amount, 0),
      totalWithdrawals: transactions.filter((t) => t.type === "Withdrawal").reduce((s, t) => s + t.absAmount, 0),
      dateRange: transactions.length
        ? { from: transactions[0].date, to: transactions[transactions.length - 1].date }
        : null,
    },
  };
}

/**
 * Parse a Found.com CSV file.
 */
export function parseFoundCSVFromFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { transactions: [], errors: [`File not found: ${filePath}`], stats: { total: 0, parsed: 0, skipped: 0 } };
  }
  const content = fs.readFileSync(filePath, "utf8");
  return parseFoundCSV(content);
}

// ── Date Normalization ──────────────────────────────────────────────────────

function normalizeDate(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;

  // Try YYYY-MM-DD first (ISO)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // MM/DD/YYYY
  let m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;

  // MM/DD/YY
  m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) {
    const year = Number(m[3]) + 2000;
    return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }

  // MM-DD-YYYY
  m = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;

  // Try Date.parse as last resort
  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) {
    const d = new Date(parsed);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
  }

  return null;
}

// ── Vendor Pattern Matching ─────────────────────────────────────────────────
// Pre-seeded vendor patterns from BUILD-OUTLINES.md

export const VENDOR_PATTERNS = [
  { pattern: /lowe graham jones/i, vendor: "Lowe Graham Jones", category: "Legal" },
  { pattern: /jenna werner|bill yoder|ira vanorder|account.*65107/i, vendor: "Co-Packer (Acct 65107)", category: "Production" },
  { pattern: /joe gagliardi|greg kroetch/i, vendor: "Packaging (Gagliardi/Kroetch)", category: "Packaging" },
  { pattern: /companysage/i, vendor: "CompanySage", category: "Compliance" },
  { pattern: /shopify/i, vendor: "Shopify", category: "Revenue-Shopify" },
  { pattern: /amazon|amzn/i, vendor: "Amazon", category: "Revenue-Amazon" },
  { pattern: /faire/i, vendor: "Faire", category: "Revenue-Faire" },
  { pattern: /rushordertees/i, vendor: "RushOrderTees", category: "Marketing" },
  { pattern: /usps|united states postal/i, vendor: "USPS", category: "Shipping" },
  { pattern: /fedex|federal express/i, vendor: "FedEx", category: "Shipping" },
  { pattern: /ups(?:\s|$)/i, vendor: "UPS", category: "Shipping" },
  { pattern: /stripe/i, vendor: "Stripe", category: "SaaS" },
  { pattern: /google|gcp/i, vendor: "Google", category: "SaaS" },
  { pattern: /vercel/i, vendor: "Vercel", category: "SaaS" },
  { pattern: /notion/i, vendor: "Notion", category: "SaaS" },
  { pattern: /irs|internal revenue|treasury/i, vendor: "IRS", category: "Tax" },
  { pattern: /state tax|franchise tax/i, vendor: "State Tax", category: "Tax" },
];

/**
 * Auto-categorize a transaction based on its description.
 * Returns { vendor, category } or null if no match.
 */
export function categorizeTransaction(description) {
  const desc = String(description || "").trim();
  for (const { pattern, vendor, category } of VENDOR_PATTERNS) {
    if (pattern.test(desc)) return { vendor, category };
  }
  return null;
}

/**
 * Detect if a deposit looks like a channel payout.
 * Returns channel name or null.
 */
export function detectPayoutSource(description, amount) {
  const desc = String(description || "").toLowerCase();
  if (desc.includes("shopify") && amount > 0) return "Shopify";
  if ((desc.includes("amazon") || desc.includes("amzn")) && amount > 0) return "Amazon";
  if (desc.includes("faire") && amount > 0) return "Faire";
  return null;
}
