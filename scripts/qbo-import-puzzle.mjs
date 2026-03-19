#!/usr/bin/env node
/**
 * QBO Historical Import Script
 *
 * Imports pre-bank-feed transactions from Puzzle CSV into QBO
 * via the deployed API endpoints.
 *
 * Usage: node scripts/qbo-import-puzzle.mjs [--dry-run]
 */

import fs from "fs";

const DRY_RUN = process.argv.includes("--dry-run");
const BASE_URL = "https://www.usagummies.com";

// ─── Categorization Rules ───────────────────────────────────────────────────

const CATEGORIZATION_RULES = [
  // Software
  { pattern: "ANTHROPIC", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "APOLLO", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "CLAUDE", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "CLOUDFLARE", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "INVIDEO", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "METRICOOL", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "MIDJOURNEY", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "NOTION LABS", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "OPENAI", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "N8N", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "SPARK", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "SLACK", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "X CORP", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "VERCEL", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "PADDLE.NET", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "GOOGLE *GSUITE", accountId: 165, accountName: "Software - Operating Expense" },

  // Advertising
  { pattern: "FACEBK", accountId: 16, accountName: "Advertising & marketing" },
  { pattern: "FACEBOOK", accountId: 16, accountName: "Advertising & marketing" },
  { pattern: "META ADS", accountId: 16, accountName: "Advertising & marketing" },
  { pattern: "GOOGLE ADS", accountId: 16, accountName: "Advertising & marketing" },
  { pattern: "TIKTOK", accountId: 16, accountName: "Advertising & marketing" },
  { pattern: "CRAIGSLIST", accountId: 16, accountName: "Advertising & marketing" },
  { pattern: "AMAZON ADS", accountId: 16, accountName: "Advertising & marketing" },

  // Shipping
  { pattern: "PIRATE SHIP", accountId: 159, accountName: "Shipping & Delivery" },
  { pattern: "USPS", accountId: 159, accountName: "Shipping & Delivery" },

  // Insurance
  { pattern: "GEICO", accountId: 42, accountName: "Insurance" },

  // Utilities
  { pattern: "T-MOBILE", accountId: 91, accountName: "Utilities" },
  { pattern: "TMOBILE", accountId: 91, accountName: "Utilities" },

  // Ground Transport
  { pattern: "EXXON", accountId: 162, accountName: "Ground Transportation" },
  { pattern: "SHELL OIL", accountId: 162, accountName: "Ground Transportation" },
  { pattern: "MAVERIK", accountId: 162, accountName: "Ground Transportation" },

  // Tax & Accounting
  { pattern: "PILOT", accountId: 158, accountName: "Tax and Accounting" },

  // Hosting / COGS
  { pattern: "SHOPIFY", accountId: 166, accountName: "Hosting Fees" },

  // Bank Fees
  { pattern: "WIRE TRANSFER FEE", accountId: 160, accountName: "Bank Fees" },
  { pattern: "Wire transfer fee", accountId: 160, accountName: "Bank Fees" },
  { pattern: "PAST DUE FEE", accountId: 160, accountName: "Bank Fees" },
  { pattern: "MONTHLY FEE", accountId: 160, accountName: "Bank Fees" },
  { pattern: "SERVICE CHARGE", accountId: 160, accountName: "Bank Fees" },

  // Interest
  { pattern: "INTEREST CHARGE", accountId: 163, accountName: "Interest Expense" },

  // Payment Processing
  { pattern: "STRIPE", accountId: 168, accountName: "Transfers in Transit" },
  { pattern: "SQUARESPACE PAYM", accountId: 168, accountName: "Transfers in Transit" },

  // Credit Card Payments (internal transfers)
  { pattern: "CAPITAL ONE DES:MOBILE PMT", accountId: 169, accountName: "Credit Card Payments" },
  { pattern: "CAPITAL ONE MOBILE PYMT", accountId: 169, accountName: "Credit Card Payments" },

  // Hardware
  { pattern: "APPLE.COM", accountId: 156, accountName: "Computers & Hardware" },
  { pattern: "APPLE STORE", accountId: 156, accountName: "Computers & Hardware" },

  // Contractors
  { pattern: "UPWORK", accountId: 157, accountName: "Independent Contractors" },

  // Entertainment
  { pattern: "RANCH WORLD", accountId: 37, accountName: "Entertainment" },
  { pattern: "SVS RAINIER", accountId: 37, accountName: "Entertainment" },

  // Supplies
  { pattern: "VISTAPRINT", accountId: 83, accountName: "Supplies" },

  // Lodging
  { pattern: "HAMPTON", accountId: 161, accountName: "Lodging" },

  // *** CRITICAL: Rene investor money = LIABILITY ***
  { pattern: "RENE G. GONZALEZ", accountId: 167, accountName: "Investor Loan - Rene" },
  { pattern: "GONZALEZ, RENE", accountId: 167, accountName: "Investor Loan - Rene" },
  { pattern: "RENE G GONZALEZ", accountId: 167, accountName: "Investor Loan - Rene" },
];

function categorize(description) {
  const upper = description.toUpperCase();
  for (const rule of CATEGORIZATION_RULES) {
    if (upper.includes(rule.pattern.toUpperCase())) {
      return { accountId: rule.accountId, accountName: rule.accountName };
    }
  }
  return null;
}

// ─── CSV Parser ─────────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  fields.push(current.trim());
  return fields;
}

// ─── QBO API Calls via deployed endpoint proxy ──────────────────────────────

// We need the access token. Since our serverless functions have it in KV,
// let's call our own API which proxies to QBO.
// But we don't have a generic QBO proxy endpoint...
// Instead, let's call the QBO API directly using the token from our KV.
// The simplest approach: hit our own import endpoint with POST.
// But that reads from local disk too...

// Actually, let's just call the QBO API through our own deployed endpoints.
// We'll create transactions by calling a small import batch endpoint.

async function callImportBatch(transactions) {
  const res = await fetch(`${BASE_URL}/api/ops/qbo/import-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions }),
  });
  return res.json();
}

// ─── Main ───────────────────────────────────────────────────────────────────

const BOFA_CHECKING_ID = 153;
const UNCATEGORIZED_EXPENSE_ID = 39; // General business expenses

async function main() {
  console.log(`\n🏦 QBO Historical Import from Puzzle.io`);
  console.log(`   Mode: ${DRY_RUN ? "DRY RUN" : "LIVE IMPORT"}\n`);

  const csvPath = "/Users/ben/Downloads/84d0a5bc-66eb-4b9b-80b0-8e256b2c8402-3152920.csv";
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV not found: ${csvPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(csvPath, "utf-8");
  const lines = raw.split("\n");
  const headers = lines[3].split(",").map((h) => h.replace(/"/g, "").trim());

  // 90-day cutoff
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const transactions = [];
  let categorized = 0;
  let uncategorized = 0;
  let transfers = 0;

  for (let i = 4; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseCSVLine(line);
    const row = {};
    headers.forEach((h, idx) => { row[h] = fields[idx] || ""; });

    if (!row.Institution?.includes("Bank of America")) continue;
    if (row.Date >= cutoffStr) continue;

    const amount = parseFloat(row.Amount || "0");
    const desc = row.Description || "";
    const cat = categorize(desc);

    const isTransfer =
      cat?.accountName === "Credit Card Payments" ||
      cat?.accountName === "Transfers in Transit";

    if (isTransfer) {
      transfers++;
      continue; // Skip internal transfers
    }

    const isIncome = amount > 0;
    const isInvestorLoan = cat?.accountName === "Investor Loan - Rene";
    const accountId = cat?.accountId || UNCATEGORIZED_EXPENSE_ID;

    if (cat) categorized++;
    else uncategorized++;

    transactions.push({
      date: row.Date,
      description: desc,
      amount,
      accountId,
      categoryName: cat?.accountName || "General business expenses",
      isIncome: isIncome || isInvestorLoan,
      isInvestorLoan,
      bankAccountId: BOFA_CHECKING_ID,
    });
  }

  console.log(`📊 Summary:`);
  console.log(`   Total historical (pre-${cutoffStr}): ${transactions.length + transfers}`);
  console.log(`   To import: ${transactions.length}`);
  console.log(`   Categorized: ${categorized}`);
  console.log(`   Uncategorized: ${uncategorized} (→ General business expenses)`);
  console.log(`   Skipped transfers: ${transfers}`);
  console.log();

  // Show investor loan transactions
  const investorTxns = transactions.filter((t) => t.isInvestorLoan);
  if (investorTxns.length > 0) {
    console.log(`💰 Investor Loan (Rene) transactions:`);
    for (const t of investorTxns) {
      console.log(`   ${t.date} | $${t.amount.toFixed(2)} | ${t.description}`);
    }
    console.log();
  }

  // Show category breakdown
  const byCat = {};
  for (const t of transactions) {
    byCat[t.categoryName] = (byCat[t.categoryName] || 0) + 1;
  }
  console.log(`📂 Category breakdown:`);
  for (const [cat, count] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${cat}: ${count}`);
  }
  console.log();

  if (DRY_RUN) {
    console.log(`🔍 Dry run complete. Run without --dry-run to import.`);
    return;
  }

  // Send in batches to our import endpoint
  console.log(`🚀 Importing ${transactions.length} transactions...`);

  const BATCH_SIZE = 20;
  let created = 0;
  let errors = 0;

  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const batch = transactions.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(transactions.length / BATCH_SIZE);

    process.stdout.write(`   Batch ${batchNum}/${totalBatches}...`);

    try {
      const result = await callImportBatch(batch);
      if (result.error) {
        console.log(` ❌ ${result.error}`);
        errors += batch.length;
      } else {
        created += result.created || 0;
        errors += result.errors || 0;
        console.log(` ✅ ${result.created || 0} created, ${result.errors || 0} errors`);
      }
    } catch (err) {
      console.log(` ❌ ${err.message}`);
      errors += batch.length;
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\n✅ Import complete: ${created} created, ${errors} errors`);
}

main().catch(console.error);
