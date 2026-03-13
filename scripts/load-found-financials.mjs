#!/usr/bin/env node
/**
 * load-found-financials.mjs — Load Found banking CSVs into Notion Cash Transactions DB
 * and write P&L summaries to local state.
 *
 * Usage: node scripts/load-found-financials.mjs
 *
 * Reads:
 *   - /tmp/usag-statements/USAG Banking statements found/usa_gummies_activity_report_1773255711.csv (Mar-Dec 2025)
 *   - /tmp/usag-statements/USAG Banking statements found/usa_gummies_activity_report_1773255707.csv (Jan-Mar 2026)
 *
 * Writes:
 *   - Notion pages in Cash Transactions DB (6325d16870024b83876b9e591b3d2d9c)
 *   - .state/found-pnl-summary.json (P&L summaries from Found)
 *
 * Idempotent: checks for existing entries by date+description before creating.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const NOTION_API_KEY = loadEnvVar("NOTION_API_KEY");
const NOTION_VERSION = "2022-06-28";
const CASH_TX_DB_ID = "6325d16870024b83876b9e591b3d2d9c";

const CSV_DIR = "/tmp/usag-statements/USAG Banking statements found";
const CSV_FILES = [
  "usa_gummies_activity_report_1773255711.csv", // Mar-Dec 2025
  "usa_gummies_activity_report_1773255707.csv", // Jan-Mar 2026
];

const STATE_DIR = path.join(PROJECT_ROOT, ".state");
const PNL_STATE_FILE = path.join(STATE_DIR, "found-pnl-summary.json");

// ---------------------------------------------------------------------------
// Env loader (reads .env.local like other scripts)
// ---------------------------------------------------------------------------

function loadEnvVar(key) {
  // Check process.env first
  if (process.env[key]) return process.env[key];

  // Read from .env.local
  const envPath = path.join(PROJECT_ROOT, ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error(`[ERROR] .env.local not found and ${key} not in environment`);
    process.exit(1);
  }

  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eqIdx = trimmed.indexOf("=");
    const k = trimmed.slice(0, eqIdx).trim();
    if (k === key) {
      let v = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return v;
    }
  }

  console.error(`[ERROR] ${key} not found in .env.local or environment`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Notion helpers (mirrors src/lib/notion/client.ts patterns)
// ---------------------------------------------------------------------------

function toNotionId(raw) {
  const clean = raw.replace(/-/g, "");
  if (clean.length !== 32) return raw;
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
}

function notionHeaders() {
  return {
    Authorization: `Bearer ${NOTION_API_KEY}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

async function notionFetch(urlPath, init = {}) {
  const res = await fetch(`https://api.notion.com/v1${urlPath}`, {
    ...init,
    headers: { ...notionHeaders(), ...(init.headers || {}) },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`Notion ${init.method || "GET"} ${urlPath} failed (${res.status}): ${typeof json === "string" ? json : JSON.stringify(json)}`);
  }
  return json;
}

// Property builders (same as NotionProp in src/lib/notion/client.ts)
const NotionProp = {
  title: (text) => ({ title: [{ text: { content: text } }] }),
  richText: (text) => ({ rich_text: [{ text: { content: text.slice(0, 2000) } }] }),
  number: (n) => ({ number: n }),
  date: (iso) => ({ date: { start: iso } }),
  select: (name) => ({ select: { name } }),
  checkbox: (val) => ({ checkbox: val }),
};

// ---------------------------------------------------------------------------
// DB schema discovery
// ---------------------------------------------------------------------------

async function discoverDbSchema() {
  console.log("[schema] Fetching Cash Transactions DB schema...");
  const db = await notionFetch(`/databases/${toNotionId(CASH_TX_DB_ID)}`);
  const props = db.properties || {};
  console.log("[schema] Properties found:");
  const schema = {};
  for (const [name, prop] of Object.entries(props)) {
    schema[name] = prop.type;
    console.log(`  - ${name}: ${prop.type}`);
  }
  return schema;
}

// ---------------------------------------------------------------------------
// Query existing transactions for dedup
// ---------------------------------------------------------------------------

async function queryExistingKeys(startDate, endDate) {
  console.log(`[dedup] Querying existing transactions ${startDate} to ${endDate}...`);
  const keys = new Set();
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const body = {
      page_size: 100,
      filter: {
        and: [
          { property: "Date", date: { on_or_after: startDate } },
          { property: "Date", date: { on_or_before: endDate } },
        ],
      },
    };
    if (startCursor) body.start_cursor = startCursor;

    const result = await notionFetch(`/databases/${toNotionId(CASH_TX_DB_ID)}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    for (const page of result.results || []) {
      const props = page.properties || {};
      // Extract date
      const dateProp = props["Date"];
      const date = dateProp?.date?.start || "";
      // Extract description
      const descProp = props["Description"];
      let desc = "";
      if (descProp?.rich_text && Array.isArray(descProp.rich_text)) {
        desc = descProp.rich_text.map((t) => t.plain_text || "").join("");
      }
      // Extract amount for more precise dedup
      const amountProp = props["Amount"];
      const amount = amountProp?.number ?? "";
      if (date) {
        keys.add(`${date}|${desc}|${amount}`);
      }
    }

    hasMore = result.has_more || false;
    startCursor = result.next_cursor || undefined;
  }

  console.log(`[dedup] Found ${keys.size} existing transaction keys`);
  return keys;
}

// ---------------------------------------------------------------------------
// CSV parsing (Found activity report format)
// ---------------------------------------------------------------------------

function parseFoundActivityCSV(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  // Header: Date,Description,Amount,Category,Receipt,Asset,Card,Note,Tags,Pocket,Revenue Stream,1099 Payee,Split
  const transactions = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV — handle quoted fields
    const fields = parseCSVLine(line);
    if (fields.length < 4) continue;

    const dateRaw = fields[0].trim();       // MM/DD/YYYY
    const description = fields[1].trim();
    const amountRaw = fields[2].trim().replace(/[^0-9.\-]/g, "");
    const foundCategory = fields[3].trim(); // Found's category (e.g., "Postage and shipping")
    const revenueStream = fields.length > 10 ? fields[10].trim() : "";

    const amount = parseFloat(amountRaw);
    if (isNaN(amount)) continue;

    // Convert MM/DD/YYYY -> YYYY-MM-DD
    const dateParts = dateRaw.split("/");
    if (dateParts.length !== 3) continue;
    const [month, day, year] = dateParts;
    const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

    // Map to our category/channel system
    const { category, channel } = categorize(description, amount, foundCategory, revenueStream);

    transactions.push({
      date,
      description,
      amount,
      category,
      channel,
      foundCategory,
      source: "Found CSV Import",
    });
  }

  return transactions.sort((a, b) => a.date.localeCompare(b.date));
}

function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function categorize(description, amount, foundCategory, revenueStream) {
  const desc = description.toLowerCase();
  const cat = foundCategory.toLowerCase();

  // Income detection
  if (desc.includes("shopify")) {
    return { category: amount > 0 ? "Income" : "Refund", channel: "Shopify" };
  }
  if (desc.includes("amazon")) {
    return { category: amount > 0 ? "Income" : "Refund", channel: "Amazon" };
  }
  if (desc.includes("faire")) {
    return { category: amount > 0 ? "Income" : "Expense", channel: "Wholesale" };
  }

  // Transfer detection
  if (cat === "personal" || cat === "personal funding") {
    return { category: "Transfer", channel: "Found Transfer" };
  }
  if (desc.includes("transfer") || desc.includes("bank account")) {
    return { category: "Transfer", channel: "Found Transfer" };
  }
  if (desc.includes("found plus")) {
    return { category: "Transfer", channel: "Found Transfer" };
  }

  // Expense categories based on Found's categorization
  if (amount < 0) {
    // Map revenue stream to channel
    if (revenueStream && revenueStream.toLowerCase().includes("usa gummies")) {
      return { category: "Expense", channel: "Operating" };
    }
    return { category: "Expense", channel: "Other" };
  }

  // Default income
  if (amount > 0) {
    return { category: "Income", channel: "Other" };
  }

  return { category: "Transfer", channel: "Other" };
}

// ---------------------------------------------------------------------------
// Create Notion page for a transaction
// ---------------------------------------------------------------------------

async function createTransactionPage(tx, schema) {
  const properties = {};

  // Title property — find the title property name from schema
  const titlePropName = Object.entries(schema).find(([, type]) => type === "title")?.[0] || "Name";
  properties[titlePropName] = NotionProp.title(`${tx.date} ${tx.description}`.slice(0, 120));

  // Standard properties (only set if they exist in schema)
  if (schema["Date"]) properties["Date"] = NotionProp.date(tx.date);
  if (schema["Description"]) properties["Description"] = NotionProp.richText(tx.description);
  if (schema["Amount"]) properties["Amount"] = NotionProp.number(tx.amount);
  if (schema["Category"]) properties["Category"] = NotionProp.select(tx.category);
  if (schema["Channel"]) properties["Channel"] = NotionProp.select(tx.channel);
  if (schema["Source"]) properties["Source"] = NotionProp.select(tx.source);

  // Found-specific: store the original category if there's a property for it
  if (schema["Found Category"]) {
    properties["Found Category"] = NotionProp.select(tx.foundCategory);
  }

  const result = await notionFetch("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: toNotionId(CASH_TX_DB_ID) },
      properties,
    }),
  });

  return result?.id || null;
}

// ---------------------------------------------------------------------------
// P&L Summary data (from Found P&L PDFs)
// ---------------------------------------------------------------------------

const PNL_SUMMARIES = {
  "2025": {
    year: 2025,
    period: "2025-01-01 to 2025-12-31",
    source: "Found P&L Export",
    generatedAt: new Date().toISOString(),
    income: 1484.80,
    cogs: 7779.71,
    grossProfit: -6294.91,
    totalExpenses: 23888.23,
    netProfit: -30183.14,
    expenses: {
      software: 2734.34,
      cellPhone: 1885.16,
      shipping: 1339.05,
      legal: 1616.42,
      contractors: 10406.24,
      otherServices: 39.99,
      vehicle: 414.42,
      lodging: 230.78,
      parking: 12.95,
      insurance: 1291.64,
      advertising: 3917.24,
    },
  },
  "2026-ytd": {
    year: 2026,
    period: "2026-01-01 to 2026-03-11",
    source: "Found P&L Export",
    generatedAt: new Date().toISOString(),
    income: 2931.36,
    cogs: 0.0,
    grossProfit: 2931.36,
    totalExpenses: 3100.09,
    netProfit: -168.73,
    expenses: {
      software: 1426.32,
      shipping: 173.64,
      advertising: 666.31,
      bankFees: 15.0,
      contractors: 520.0,
      legal: 122.23,
      otherTravel: 41.0,
      vehicle: 85.88,
      meals: 48.52,
    },
  },
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Found Financials Loader ===");
  console.log(`Notion DB: ${CASH_TX_DB_ID}`);
  console.log(`CSV directory: ${CSV_DIR}`);
  console.log();

  // 1. Discover DB schema
  const schema = await discoverDbSchema();
  console.log();

  // 2. Parse all CSV files
  let allTransactions = [];
  for (const csvFile of CSV_FILES) {
    const filePath = path.join(CSV_DIR, csvFile);
    if (!fs.existsSync(filePath)) {
      console.error(`[ERROR] CSV not found: ${filePath}`);
      process.exit(1);
    }
    console.log(`[csv] Parsing ${csvFile}...`);
    const txns = parseFoundActivityCSV(filePath);
    console.log(`[csv]   ${txns.length} transactions parsed`);
    allTransactions.push(...txns);
  }

  // Sort all by date
  allTransactions.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`[csv] Total transactions: ${allTransactions.length}`);
  console.log();

  // 3. Dedup against existing Notion records
  const startDate = allTransactions[0]?.date;
  const endDate = allTransactions[allTransactions.length - 1]?.date;
  if (!startDate || !endDate) {
    console.error("[ERROR] No transactions to process");
    process.exit(1);
  }

  const existingKeys = await queryExistingKeys(startDate, endDate);
  console.log();

  // 4. Write transactions to Notion
  let written = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < allTransactions.length; i++) {
    const tx = allTransactions[i];
    const key = `${tx.date}|${tx.description}|${tx.amount}`;

    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }

    try {
      await createTransactionPage(tx, schema);
      written++;
      existingKeys.add(key); // Prevent dups within same run

      if (written % 25 === 0) {
        console.log(`[notion] Progress: ${written} written, ${skipped} skipped, ${errors} errors (${i + 1}/${allTransactions.length})`);
      }

      // Notion rate limit: ~3 requests/sec for writes
      if (written % 3 === 0) {
        await sleep(1100);
      }
    } catch (err) {
      errors++;
      console.error(`[ERROR] Failed to write tx ${tx.date} ${tx.description}: ${err.message}`);
      // Continue to next transaction
      await sleep(2000); // Back off on errors
    }
  }

  console.log();
  console.log(`[notion] Done: ${written} written, ${skipped} skipped, ${errors} errors`);
  console.log();

  // 5. Write P&L summaries to local state file
  console.log(`[state] Writing P&L summaries to ${PNL_STATE_FILE}...`);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(PNL_STATE_FILE, JSON.stringify(PNL_SUMMARIES, null, 2), "utf8");
  console.log("[state] P&L summaries written successfully");
  console.log();

  // 6. Summary
  const incomeTotal = allTransactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const expenseTotal = allTransactions.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  console.log("=== Summary ===");
  console.log(`Transactions processed: ${allTransactions.length}`);
  console.log(`  Written to Notion:    ${written}`);
  console.log(`  Skipped (existing):   ${skipped}`);
  console.log(`  Errors:               ${errors}`);
  console.log(`  Total inflows:        $${incomeTotal.toFixed(2)}`);
  console.log(`  Total outflows:       $${expenseTotal.toFixed(2)}`);
  console.log(`  Net:                  $${(incomeTotal - expenseTotal).toFixed(2)}`);
  console.log();
  console.log("P&L Summary: .state/found-pnl-summary.json");
  console.log("  2025 Net Profit: -$30,183.14");
  console.log("  2026 YTD Net Profit: -$168.73");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
