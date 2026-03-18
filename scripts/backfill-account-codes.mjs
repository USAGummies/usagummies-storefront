#!/usr/bin/env node
/**
 * Backfill Account Codes — Reads all Notion Cash & Transactions rows and
 * reclassifies Account Code to the standard USA Gummies Chart of Accounts.
 *
 * Uses deterministic vendor/keyword matching (no LLM needed).
 *
 * Usage: node scripts/backfill-account-codes.mjs [--dry-run]
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Manual .env.local loader (dotenv not in deps)
try {
  const envPath = resolve(process.cwd(), ".env.local");
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env.local not found — rely on existing env vars
}

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const CASH_TX_DB = process.env.NOTION_CASH_TX_DB_ID || "6325d16870024b83876b9e591b3d2d9c";
const DRY_RUN = process.argv.includes("--dry-run");

if (!NOTION_API_KEY) {
  console.error("Missing NOTION_API_KEY");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Standard Chart of Accounts (from abra-financial-seeds.ts)
// ---------------------------------------------------------------------------
const STANDARD_CODES = new Set([
  "4100 - Product Sales (DTC)",
  "4200 - Product Sales (Amazon)",
  "4300 - Product Sales (Wholesale)",
  "4900 - Other Income",
  "5100 - Ingredients",
  "5200 - Packaging",
  "5300 - Co-Packing/Manufacturing",
  "5400 - Items Purchased for Resale",
  "6100 - Contractor Services",
  "6200 - Advertising & Marketing",
  "6300 - Software & Subscriptions",
  "6400 - Cell Phone Service",
  "6500 - Legal Services",
  "6600 - Postage & Shipping",
  "6700 - Insurance",
  "6800 - Vehicle Expenses",
  "6900 - Business Travel & Lodging",
  "7000 - Business Meals",
  "7100 - Bank & Processing Fees",
  "7200 - Other Services",
  "8100 - Income Tax Expense",
]);

// ---------------------------------------------------------------------------
// Vendor/keyword → Account Code classification rules
// ---------------------------------------------------------------------------
const VENDOR_RULES = [
  // Transfers (internal Found pocket moves, owner funding)
  { test: (v, n) => /social media to primary|primary to social media|pocket.to.pocket/i.test(n), code: "1000 - Found Checking *6445" },
  { test: (v, n) => /mastercard debit|owner.*(invest|fund|transfer)|personal fund/i.test(n + v), code: "1000 - Found Checking *6445" },
  { test: (v, n) => /bank account \d+/i.test(n), code: "1000 - Found Checking *6445" },
  // "INV" entries from Found — owner investment deposits
  { test: (v, n) => /^\d{4}-\d{2}-\d{2}\s+INV$/i.test(n.trim()), code: "1000 - Found Checking *6445" },

  // Revenue
  { test: (v, n, cat) => cat === "Income" && /amazon/i.test(n + v), code: "4200 - Product Sales (Amazon)" },
  { test: (v, n, cat) => cat === "Income" && /wholesale|b2b|distributor/i.test(n + v), code: "4300 - Product Sales (Wholesale)" },
  { test: (v, n, cat) => cat === "Income" && /balance bonus|interest|cashback|cash back|referral bonus|found plus/i.test(n), code: "4900 - Other Income" },
  { test: (v, n, cat) => cat === "Income", code: "4100 - Product Sales (DTC)" },
  // Revenue detected by name pattern (USA GUMMIES deposits, SQUARESPACE PAYM, Shopify payouts)
  { test: (v, n) => /USA GUMMIES|SQUARESPACE PAYM|shopify.*payout|check deposit/i.test(n + v), code: "4100 - Product Sales (DTC)" },
  { test: (v, n) => /referral bonus|cash back|found plus|balance bonus/i.test(n), code: "4900 - Other Income" },

  // COGS — order matters (specific before general)
  { test: (v, n) => /dutch valley|co.?pack|manufacturing|production run|ashford valley/i.test(n + v), code: "5300 - Co-Packing/Manufacturing" },
  { test: (v, n) => /ingredient|flavoring|coloring|gummy base|energinut/i.test(n + v), code: "5100 - Ingredients" },
  { test: (v, n) => /packaging|pouch|label|film|box(?:es)?|zebra\s?pack|ninjaprinthouse/i.test(n + v) && !/pirate/i.test(v + n), code: "5200 - Packaging" },
  { test: (v, n) => /resale|purchased for resale/i.test(n + v), code: "5400 - Items Purchased for Resale" },

  // Contractors (1099)
  { test: (v, n) => /hunter of design|treadstone|troy burkhart|hawk design|ryan cross|zach mason|upwork/i.test(n + v), code: "6100 - Contractor Services" },
  { test: (v, n) => /contractor/i.test(n + v), code: "6100 - Contractor Services" },

  // Advertising & Marketing
  { test: (v, n) => /facebook|meta\/facebook|google ads|rumble|blip|tiktok|zeely|billboard|advertis|marketing|promo|vistaprint|wrist.?band|logo.*team|cmpgns/i.test(n + v), code: "6200 - Advertising & Marketing" },

  // Software & Subscriptions (expanded)
  { test: (v, n) => /anthropic|openai|chatgpt|shopify|slack|squarespace|invideo|apollo|cratejoy|cloudflare|n8n|midjourney|ownerrez|apple sub|amazon seller|x corp|twitter|saas|subscription|software|google.?\*?svcs|google.*workspace|workspace_|brave\.com|deevid|metricool|spark mail|spark\b|rangeme|qrtiger|privacypr|worksp|websit|domain\b/i.test(n + v), code: "6300 - Software & Subscriptions" },
  // Apple charges (non-subscription keyword but likely App Store / iCloud)
  { test: (v, n) => /^[\d-]+ apple$/i.test(n.trim()), code: "6300 - Software & Subscriptions" },
  // Amazon without "seller" in a non-income context (marketplace fees)
  { test: (v, n, cat) => cat !== "Income" && /amzn|amazon/i.test(n + v) && !/seller/i.test(n + v), code: "6300 - Software & Subscriptions" },

  // Cell Phone
  { test: (v, n) => /t-mobile|t.mobile|cell phone|mobile service/i.test(n + v), code: "6400 - Cell Phone Service" },

  // Legal
  { test: (v, n) => /company sage|attorney|legal|trademark|gs1|barcode|lowe graham|wyoming|usptofee|certicopy|atlm/i.test(n + v), code: "6500 - Legal Services" },

  // Shipping & Postage
  { test: (v, n) => /pirate ship|usps|u\.s\. post office|shipping label|postage|fedex|ups(?:\s|$)/i.test(n + v), code: "6600 - Postage & Shipping" },

  // Insurance
  { test: (v, n) => /geico|insurance/i.test(n + v), code: "6700 - Insurance" },

  // Vehicle
  { test: (v, n) => /fuel|shell|exxon|maverik|pilot|gas station|vehicle/i.test(n + v), code: "6800 - Vehicle Expenses" },

  // Travel & Lodging
  { test: (v, n) => /hotel|lodging|hampton|quality inn|trade show|highlander/i.test(n + v), code: "6900 - Business Travel & Lodging" },

  // Business Meals
  { test: (v, n) => /meal|restaurant|dining|client meeting|sport clips/i.test(n + v), code: "7000 - Business Meals" },

  // Bank & Processing Fees
  { test: (v, n) => /wire.*(fee|transfer)|processing fee|bank fee|stripe fee|payment processing/i.test(n + v), code: "7100 - Bank & Processing Fees" },

  // Tax
  { test: (v, n) => /income tax|tax payment|irs/i.test(n + v), code: "8100 - Income Tax Expense" },
];

// Old/non-standard codes that the coarse mapping produced
const REMAP_OLD_CODES = {
  "5000 - Cost of Goods Sold": true,
  "4000 - Product Sales Revenue": true,
  "5200 - Shipping & Fulfillment": true,
  "5300 - Selling Expenses": true,
  "6600 - Professional Services": true,
  "1500 - Equipment & Assets": true,
  "4900 - Returns & Refunds": true,
  "1000 - Found Checking *6445": true,
  "6900 - Other Operating Expenses": true,
};

function classifyRow(name, vendor, category, currentCode) {
  const v = vendor || "";
  const n = name || "";
  const cat = category || "";

  for (const rule of VENDOR_RULES) {
    if (rule.test(v, n, cat)) return rule.code;
  }

  // Fallback: keep current if it's already standard
  if (currentCode && STANDARD_CODES.has(currentCode)) return currentCode;

  return "7200 - Other Services";
}

// ---------------------------------------------------------------------------
// Notion API helpers
// ---------------------------------------------------------------------------
async function queryAllPages() {
  const pages = [];
  let cursor = undefined;
  let pageNum = 0;

  while (true) {
    pageNum++;
    console.log(`  Querying page ${pageNum}...`);

    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const res = await fetch(`https://api.notion.com/v1/databases/${CASH_TX_DB}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Notion query failed (${res.status}): ${err.slice(0, 300)}`);
    }

    const data = await res.json();
    pages.push(...data.results);

    if (!data.has_more) break;
    cursor = data.next_cursor;
  }

  return pages;
}

async function updatePage(pageId, accountCode) {
  if (DRY_RUN) return true;

  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        "Account Code": { select: { name: accountCode } },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`  [ERROR] PATCH ${pageId} failed: ${err.slice(0, 200)}`);
    return false;
  }
  return true;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Extract fields from a Notion page
// ---------------------------------------------------------------------------
function extractFields(page) {
  const props = page.properties || {};

  const titleArr = props.Name?.title || [];
  const name = titleArr.map((t) => t.plain_text).join("") || "(untitled)";

  const vendorArr = props.Vendor?.rich_text || [];
  const vendor = vendorArr.map((t) => t.plain_text).join("") || "";

  const category = props.Category?.select?.name || "";
  const accountCode = props["Account Code"]?.select?.name || "";

  return { id: page.id, name, vendor, category, accountCode };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n=== Backfill Account Codes ${DRY_RUN ? "(DRY RUN)" : "(LIVE)"} ===\n`);

  console.log("Reading all transactions from Notion...");
  const pages = await queryAllPages();
  console.log(`  Found ${pages.length} transactions.\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < pages.length; i++) {
    const { id, name, vendor, category, accountCode } = extractFields(pages[i]);
    const newCode = classifyRow(name, vendor, category, accountCode);

    // Skip if already correct
    if (accountCode === newCode) {
      skipped++;
      continue;
    }

    // Skip if current code is already a standard code AND the new code is the fallback
    if (STANDARD_CODES.has(accountCode) && newCode === "7200 - Other Services") {
      skipped++;
      continue;
    }

    const label = DRY_RUN ? "[DRY RUN]" : "[UPDATED]";
    const oldLabel = accountCode || "(empty)";
    console.log(`${label} "${name.slice(0, 60)}" — ${oldLabel} → ${newCode}`);

    const ok = await updatePage(id, newCode);
    if (ok) {
      updated++;
    } else {
      errors++;
    }

    // Rate limit: 3 req/sec for Notion API
    if (!DRY_RUN && (i + 1) % 3 === 0) {
      await sleep(1100);
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped (already correct): ${skipped}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Total: ${pages.length}\n`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
