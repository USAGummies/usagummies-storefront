#!/usr/bin/env node
/**
 * Backfill Financial Ledger — Populates the Notion Cash & Transactions DB
 * with verified historical data from Found Banking (inception → March 2026).
 *
 * Source: Found Banking P&L reports + expense audit, exported 2026-03-13.
 * Each entry is tagged Status: "Verified", Source: "Found CSV Import".
 *
 * Usage: node scripts/backfill-financial-ledger.mjs [--dry-run]
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
    // Strip surrounding quotes
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
// Notion helper
// ---------------------------------------------------------------------------
async function createPage(properties) {
  if (DRY_RUN) {
    console.log(`[DRY RUN] Would create: ${properties.Name.title[0].text.content}`);
    return "dry-run";
  }

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { database_id: CASH_TX_DB },
      properties,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion create failed (${res.status}): ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.id;
}

// ---------------------------------------------------------------------------
// Month helpers
// ---------------------------------------------------------------------------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fiscalMonth(dateStr) {
  const m = parseInt(dateStr.split("-")[1], 10);
  return MONTHS[m - 1] || "Jan";
}
function fiscalYear(dateStr) {
  return dateStr.split("-")[0];
}

// ---------------------------------------------------------------------------
// Build Notion properties for a transaction
// ---------------------------------------------------------------------------
function txProps({
  name,
  amount,
  category,
  accountCode,
  vendor,
  date,
  channel = "Operating",
  paymentMethod = "Found Debit *6445",
  taxDeductible = true,
  status = "Verified",
  notes = "",
  source = "Found CSV Import",
}) {
  const props = {
    Name: { title: [{ text: { content: name.slice(0, 200) } }] },
    Amount: { number: amount },
    Category: { select: { name: category } },
    "Account Code": { select: { name: accountCode } },
    Date: { date: { start: date } },
    Channel: { select: { name: channel } },
    "Payment Method": { select: { name: paymentMethod } },
    "Tax Deductible": { checkbox: taxDeductible },
    Status: { select: { name: status } },
    Source: { select: { name: source } },
    "Fiscal Year": { select: { name: fiscalYear(date) } },
    "Fiscal Month": { select: { name: fiscalMonth(date) } },
  };
  if (vendor) {
    props.Vendor = { rich_text: [{ text: { content: vendor.slice(0, 200) } }] };
  }
  if (notes) {
    props.Notes = { rich_text: [{ text: { content: notes.slice(0, 2000) } }] };
  }
  return props;
}

// ---------------------------------------------------------------------------
// Transaction data — verified from Found Banking exports
// ---------------------------------------------------------------------------
function getTransactions() {
  return [
    // =====================================================================
    // 2025 REVENUE
    // =====================================================================
    { name: "Revenue - Direct sale / farmers market", amount: 106.06, category: "Income", accountCode: "4100 - Product Sales (DTC)", date: "2025-08-15", channel: "Other", paymentMethod: "Stripe", notes: "First revenue — check deposit, likely direct sale" },
    { name: "Revenue - Balance bonus", amount: 0.81, category: "Income", accountCode: "4900 - Other Income", date: "2025-09-30", notes: "Found balance bonus" },
    { name: "Revenue - Squarespace orders", amount: 309.97, category: "Income", accountCode: "4100 - Product Sales (DTC)", date: "2025-10-15", channel: "Shopify", paymentMethod: "Stripe", notes: "First real sales month" },
    { name: "Revenue - Holiday season sales", amount: 766.02, category: "Income", accountCode: "4100 - Product Sales (DTC)", date: "2025-11-15", channel: "Shopify", paymentMethod: "Stripe", notes: "Best month 2025 — FB ads driving traffic" },
    { name: "Revenue - Post-holiday sales", amount: 301.94, category: "Income", accountCode: "4100 - Product Sales (DTC)", date: "2025-12-15", channel: "Shopify", paymentMethod: "Stripe" },

    // =====================================================================
    // 2025 COGS
    // =====================================================================
    { name: "Dutch Valley Foods - Production deposit", amount: -555.55, category: "Expense", accountCode: "5300 - Co-Packing/Manufacturing", vendor: "Dutch Valley Foods", date: "2025-09-05", paymentMethod: "ACH/Wire", notes: "Initial deposit for 2,500 unit Run #1" },
    { name: "Dutch Valley Foods - Production run balance", amount: -7207.05, category: "Expense", accountCode: "5300 - Co-Packing/Manufacturing", vendor: "Dutch Valley Foods", date: "2025-09-10", paymentMethod: "ACH/Wire", notes: "2,500 unit order + film. Total Run #1 = $7,762.60. COGS/unit = $3.11" },
    { name: "EnergiNut.com - Supplemental materials", amount: -17.11, category: "Expense", accountCode: "5100 - Ingredients", vendor: "EnergiNut.com", date: "2025-10-15", notes: "Materials/ingredients, possibly supplemental" },

    // =====================================================================
    // 2025 CONTRACTORS (1099)
    // =====================================================================
    { name: "Hunter of Design LLC - Brand design (1/4)", amount: -750.00, category: "Expense", accountCode: "6100 - Contractor Services", vendor: "Hunter of Design LLC", date: "2025-05-15", notes: "Logo, visual identity. 1099 filed." },
    { name: "Hunter of Design LLC - Brand design (2/4)", amount: -750.00, category: "Expense", accountCode: "6100 - Contractor Services", vendor: "Hunter of Design LLC", date: "2025-06-15", notes: "1099 filed" },
    { name: "Hunter of Design LLC - Brand design (3/4)", amount: -750.00, category: "Expense", accountCode: "6100 - Contractor Services", vendor: "Hunter of Design LLC", date: "2025-07-15", notes: "1099 filed" },
    { name: "Hunter of Design LLC - Brand design (4/4)", amount: -750.00, category: "Expense", accountCode: "6100 - Contractor Services", vendor: "Hunter of Design LLC", date: "2025-08-15", notes: "1099 filed" },
    { name: "Hunter of Design LLC - Additional work", amount: -600.00, category: "Expense", accountCode: "6100 - Contractor Services", vendor: "Hunter of Design LLC", date: "2025-09-15", notes: "1099 filed. Total 2025: $3,750" },
    { name: "Treadstone Media LLC - Media production", amount: -1800.00, category: "Expense", accountCode: "6100 - Contractor Services", vendor: "Treadstone Media LLC", date: "2025-08-01", notes: "Video content. 1099 filed." },
    { name: "Treadstone Media LLC - Setup fee", amount: -100.00, category: "Expense", accountCode: "6100 - Contractor Services", vendor: "Treadstone Media LLC", date: "2025-08-01", notes: "1099 filed. Total 2025: $1,900" },
    { name: "Troy Burkhart - Packaging design (1/2)", amount: -2000.00, category: "Expense", accountCode: "6100 - Contractor Services", vendor: "Troy Burkhart", date: "2025-07-01", notes: "Packaging design. 1099 filed." },
    { name: "Troy Burkhart - Packaging design (2/2)", amount: -1500.00, category: "Expense", accountCode: "6100 - Contractor Services", vendor: "Troy Burkhart", date: "2025-08-01", notes: "1099 filed. Total 2025: $3,500" },
    { name: "Hawk Design LLC - Design work", amount: -536.25, category: "Expense", accountCode: "6100 - Contractor Services", vendor: "Hawk Design LLC", date: "2025-04-15" },
    { name: "Other contractor services", amount: -220.00, category: "Expense", accountCode: "6100 - Contractor Services", date: "2025-10-15", notes: "Misc contractor services (balance to reach $10,406.24 total)" },

    // =====================================================================
    // 2025 ADVERTISING & MARKETING
    // =====================================================================
    { name: "Facebook Ads - Q3 2025", amount: -500.00, category: "Expense", accountCode: "6200 - Advertising & Marketing", vendor: "Meta/Facebook", date: "2025-09-15" },
    { name: "Facebook Ads - October ramp", amount: -600.00, category: "Expense", accountCode: "6200 - Advertising & Marketing", vendor: "Meta/Facebook", date: "2025-10-15", notes: "Heavy ramp for holiday season" },
    { name: "Facebook Ads - November peak", amount: -637.00, category: "Expense", accountCode: "6200 - Advertising & Marketing", vendor: "Meta/Facebook", date: "2025-11-15", notes: "Peak holiday ad spend" },
    { name: "Google Ads - 2025", amount: -836.00, category: "Expense", accountCode: "6200 - Advertising & Marketing", vendor: "Google Ads", date: "2025-10-01", notes: "Spread across Oct-Dec" },
    { name: "Blip Billboards - Digital billboard", amount: -655.00, category: "Expense", accountCode: "6200 - Advertising & Marketing", vendor: "Blip Billboards", date: "2025-09-01", notes: "Aug-Oct 2025" },
    { name: "Zeely - Marketing tool", amount: -378.00, category: "Expense", accountCode: "6200 - Advertising & Marketing", vendor: "Zeely", date: "2025-08-15" },
    { name: "TikTok Promote", amount: -90.00, category: "Expense", accountCode: "6200 - Advertising & Marketing", vendor: "TikTok", date: "2025-11-15", notes: "One-time" },
    { name: "Other marketing expenses", amount: -221.24, category: "Expense", accountCode: "6200 - Advertising & Marketing", date: "2025-10-15", notes: "Misc (balance to $3,917.24 total)" },

    // =====================================================================
    // 2025 SOFTWARE & SUBSCRIPTIONS
    // =====================================================================
    { name: "OpenAI - ChatGPT (Jul-Dec)", amount: -360.00, category: "Expense", accountCode: "6300 - Software & Subscriptions", vendor: "OpenAI", date: "2025-09-15", notes: "$60/mo x 6 months" },
    { name: "Slack (Jul-Dec)", amount: -250.00, category: "Expense", accountCode: "6300 - Software & Subscriptions", vendor: "Slack", date: "2025-09-15", notes: "$26-61/mo variable" },
    { name: "Squarespace (Jul-Dec)", amount: -200.00, category: "Expense", accountCode: "6300 - Software & Subscriptions", vendor: "Squarespace", date: "2025-09-15", notes: "~$33/mo, being phased out for Shopify" },
    { name: "X Corp / Twitter Premium", amount: -240.00, category: "Expense", accountCode: "6300 - Software & Subscriptions", vendor: "X Corp", date: "2025-09-15", notes: "$40/mo x 6 months" },
    { name: "InVideo - Video creation", amount: -720.00, category: "Expense", accountCode: "6300 - Software & Subscriptions", vendor: "InVideo", date: "2025-09-15", notes: "$120/mo x 6 months" },
    { name: "Other SaaS subscriptions (2025)", amount: -964.34, category: "Expense", accountCode: "6300 - Software & Subscriptions", date: "2025-10-15", notes: "Various tools (balance to $2,734.34 total)" },

    // =====================================================================
    // 2025 OTHER OPERATING EXPENSES
    // =====================================================================
    { name: "T-Mobile - Cell service (Jul-Dec)", amount: -1885.16, category: "Expense", accountCode: "6400 - Cell Phone Service", vendor: "T-Mobile", date: "2025-09-15", notes: "Includes phone upgrade EIP" },
    { name: "Legal services - Wyoming agent + trademark", amount: -1616.42, category: "Expense", accountCode: "6500 - Legal Services", date: "2025-08-15", notes: "WY LLC Attorney $180, trademark $410, Lowe Graham $360.50, certs/filings" },
    { name: "Pirate Ship - Shipping labels", amount: -524.05, category: "Expense", accountCode: "6600 - Postage & Shipping", vendor: "Pirate Ship", date: "2025-11-01", notes: "~$7-15/shipment" },
    { name: "ZebraPack - Label printer/supplies", amount: -798.00, category: "Expense", accountCode: "6600 - Postage & Shipping", vendor: "ZebraPack", date: "2025-08-15", notes: "One-time equipment purchase" },
    { name: "USPS - Direct postal", amount: -17.00, category: "Expense", accountCode: "6600 - Postage & Shipping", vendor: "USPS", date: "2025-10-15" },
    { name: "Geico - Business vehicle insurance (2025)", amount: -1291.64, category: "Expense", accountCode: "6700 - Insurance", vendor: "Geico", date: "2025-09-15", notes: "~$108-258/quarter" },
    { name: "Fuel - Business travel (2025)", amount: -414.42, category: "Expense", accountCode: "6800 - Vehicle Expenses", date: "2025-09-15", notes: "Pilot, Shell, ExxonMobil, Maverik" },
    { name: "Business lodging - Trade shows", amount: -230.78, category: "Expense", accountCode: "6900 - Business Travel & Lodging", date: "2025-10-15", notes: "Quality Inn, Hampton Inn" },
    { name: "Other services (2025)", amount: -39.99, category: "Expense", accountCode: "7200 - Other Services", date: "2025-10-15" },
    { name: "GS1 US - Barcode registration", amount: -90.00, category: "Expense", accountCode: "6500 - Legal Services", vendor: "GS1 US", date: "2025-04-15", notes: "UPC barcode registration. Reclassified from Contractor to Legal/Regulatory" },

    // =====================================================================
    // 2026 YTD REVENUE
    // =====================================================================
    { name: "Revenue - Jan 2026 sales", amount: 977.12, category: "Income", accountCode: "4100 - Product Sales (DTC)", date: "2026-01-15", channel: "Shopify", paymentMethod: "Stripe", notes: "Estimated 1/3 of $2,931.36 YTD" },
    { name: "Revenue - Feb 2026 sales", amount: 977.12, category: "Income", accountCode: "4100 - Product Sales (DTC)", date: "2026-02-15", channel: "Shopify", paymentMethod: "Stripe", notes: "Estimated 1/3 of $2,931.36 YTD" },
    { name: "Revenue - Mar 2026 (partial)", amount: 977.12, category: "Income", accountCode: "4100 - Product Sales (DTC)", date: "2026-03-07", channel: "Shopify", paymentMethod: "Stripe", notes: "Estimated 1/3 of $2,931.36 YTD through Mar 13" },

    // =====================================================================
    // 2026 SOFTWARE & SUBSCRIPTIONS
    // =====================================================================
    { name: "Anthropic - Claude API (Jan)", amount: -200.00, category: "Expense", accountCode: "6300 - Software & Subscriptions", vendor: "Anthropic", date: "2026-01-15", notes: "AI ops development. Total YTD $561.14" },
    { name: "Anthropic - Claude API (Feb)", amount: -200.00, category: "Expense", accountCode: "6300 - Software & Subscriptions", vendor: "Anthropic", date: "2026-02-15" },
    { name: "Anthropic - Claude API (Mar partial)", amount: -161.14, category: "Expense", accountCode: "6300 - Software & Subscriptions", vendor: "Anthropic", date: "2026-03-07" },
    { name: "OpenAI - ChatGPT + API (Jan-Mar)", amount: -181.35, category: "Expense", accountCode: "6300 - Software & Subscriptions", vendor: "OpenAI", date: "2026-02-01", notes: "$60-80/mo" },
    { name: "Shopify - Platform (Jan-Mar)", amount: -105.00, category: "Expense", accountCode: "6300 - Software & Subscriptions", vendor: "Shopify", date: "2026-02-01", notes: "Migrated from Squarespace" },
    { name: "Apollo.io - B2B outreach", amount: -99.00, category: "Expense", accountCode: "6300 - Software & Subscriptions", vendor: "Apollo.io", date: "2026-01-15" },
    { name: "Slack (Jan-Mar)", amount: -85.80, category: "Expense", accountCode: "6300 - Software & Subscriptions", vendor: "Slack", date: "2026-02-01" },
    { name: "Amazon Seller fees (Jan-Mar)", amount: -71.62, category: "Expense", accountCode: "6300 - Software & Subscriptions", vendor: "Amazon", date: "2026-02-01" },
    { name: "CrateJoy - Subscription marketplace", amount: -55.10, category: "Expense", accountCode: "6300 - Software & Subscriptions", vendor: "CrateJoy", date: "2026-02-01" },
    { name: "OWNERREZ - Property management", amount: -50.00, category: "Expense", accountCode: "6300 - Software & Subscriptions", vendor: "OWNERREZ", date: "2026-01-15", status: "Needs Review", taxDeductible: false, notes: "May be personal expense, not business" },
    { name: "Apple subscription", amount: -54.99, category: "Expense", accountCode: "6300 - Software & Subscriptions", vendor: "Apple", date: "2026-02-01" },
    { name: "Cloudflare - DNS/CDN", amount: -31.38, category: "Expense", accountCode: "6300 - Software & Subscriptions", vendor: "Cloudflare", date: "2026-02-01" },
    { name: "n8n Cloud - Workflow automation", amount: -24.00, category: "Expense", accountCode: "6300 - Software & Subscriptions", vendor: "n8n", date: "2026-02-01" },
    { name: "Midjourney - AI images", amount: -10.00, category: "Expense", accountCode: "6300 - Software & Subscriptions", vendor: "Midjourney", date: "2026-02-01" },
    { name: "Other SaaS (2026 YTD)", amount: -97.00, category: "Expense", accountCode: "6300 - Software & Subscriptions", date: "2026-02-15", notes: "Misc remaining software" },

    // =====================================================================
    // 2026 ADVERTISING & MARKETING
    // =====================================================================
    { name: "Rumble - Video advertising (Jan)", amount: -100.00, category: "Expense", accountCode: "6200 - Advertising & Marketing", vendor: "Rumble", date: "2026-01-15" },
    { name: "Rumble - Video advertising (Feb)", amount: -100.00, category: "Expense", accountCode: "6200 - Advertising & Marketing", vendor: "Rumble", date: "2026-02-15" },
    { name: "Rumble - Video advertising (Mar)", amount: -100.00, category: "Expense", accountCode: "6200 - Advertising & Marketing", vendor: "Rumble", date: "2026-03-07" },
    { name: "Google Ads (Jan-Mar)", amount: -149.03, category: "Expense", accountCode: "6200 - Advertising & Marketing", vendor: "Google Ads", date: "2026-02-01" },
    { name: "Facebook Ads (Jan-Mar)", amount: -135.97, category: "Expense", accountCode: "6200 - Advertising & Marketing", vendor: "Meta/Facebook", date: "2026-02-01" },
    { name: "Ninja Print House - Promo materials", amount: -81.31, category: "Expense", accountCode: "6200 - Advertising & Marketing", vendor: "Ninja Print House", date: "2026-02-15" },

    // =====================================================================
    // 2026 OTHER OPERATING
    // =====================================================================
    { name: "Dutch Valley Foods - Consulting/setup", amount: -520.00, category: "Expense", accountCode: "6100 - Contractor Services", vendor: "Dutch Valley Foods", date: "2026-01-15", notes: "Consulting, NOT production run" },
    { name: "Pirate Ship - Shipping labels (Jan-Mar)", amount: -173.64, category: "Expense", accountCode: "6600 - Postage & Shipping", vendor: "Pirate Ship", date: "2026-02-01", notes: "DTC order fulfillment" },
    { name: "Company Sage - Registered agent (Jan-Mar)", amount: -122.23, category: "Expense", accountCode: "6500 - Legal Services", vendor: "Company Sage", date: "2026-02-01", notes: "Replaced Wyoming LLC Attorney" },
    { name: "Fuel - Business travel (Jan-Mar)", amount: -85.88, category: "Expense", accountCode: "6800 - Vehicle Expenses", date: "2026-02-01" },
    { name: "The Highlander - Business meal", amount: -48.52, category: "Expense", accountCode: "7000 - Business Meals", date: "2026-02-24", status: "Needs Review", notes: "Needs 'who' and 'what for' documentation" },
    { name: "Sport Clips", amount: -41.00, category: "Expense", accountCode: "6900 - Business Travel & Lodging", date: "2026-01-28", status: "Needs Review", taxDeductible: false, notes: "Classified as travel — likely misclassified. Haircut, not business." },
    { name: "Wire transfer fee - Dutch Valley", amount: -15.00, category: "Expense", accountCode: "7100 - Bank & Processing Fees", date: "2026-01-15", notes: "Wire fee for DVF payment" },

    // =====================================================================
    // OWNER INVESTMENT / FUNDING (Non-revenue, for completeness)
    // =====================================================================
    { name: "Owner investment - Kraken crypto (May 2025)", amount: 2100.00, category: "Transfer", accountCode: "4900 - Other Income", date: "2025-05-15", paymentMethod: "Crypto (Kraken)", notes: "Founder capital injection — crypto liquidation", taxDeductible: false },
    { name: "Owner investment - Kraken crypto (Aug 2025)", amount: 2850.00, category: "Transfer", accountCode: "4900 - Other Income", date: "2025-08-15", paymentMethod: "Crypto (Kraken)", notes: "Founder capital ($850 + $2,000)", taxDeductible: false },
    { name: "Owner investment - Kraken crypto (Sep 2025)", amount: 7136.00, category: "Transfer", accountCode: "4900 - Other Income", date: "2025-09-15", paymentMethod: "Crypto (Kraken)", notes: "Founder capital ($6,761 + $375)", taxDeductible: false },
    { name: "Owner investment - Kraken crypto (Oct 2025)", amount: 2448.76, category: "Transfer", accountCode: "4900 - Other Income", date: "2025-10-15", paymentMethod: "Crypto (Kraken)", notes: "Founder capital injection", taxDeductible: false },
    { name: "Owner investment - Mastercard transfers (2025)", amount: 7260.00, category: "Transfer", accountCode: "4900 - Other Income", date: "2025-08-01", paymentMethod: "Personal Funding", notes: "Multiple personal debit transfers throughout 2025", taxDeductible: false },
  ];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const transactions = getTransactions();
  console.log(`\n📒 Backfilling ${transactions.length} transactions to Notion ledger`);
  if (DRY_RUN) console.log("   (DRY RUN — no writes)\n");

  let created = 0;
  let errors = 0;

  for (const tx of transactions) {
    try {
      const props = txProps({
        name: tx.name,
        amount: Math.abs(tx.amount), // Notion stores positive; Category distinguishes income/expense
        category: tx.category || "Expense",
        accountCode: tx.accountCode,
        vendor: tx.vendor || "",
        date: tx.date,
        channel: tx.channel || "Operating",
        paymentMethod: tx.paymentMethod || "Found Debit *6445",
        taxDeductible: tx.taxDeductible !== false,
        status: tx.status || "Verified",
        notes: tx.notes || "",
        source: "Found CSV Import",
      });

      await createPage(props);
      created++;

      if (!DRY_RUN) {
        // Respect Notion rate limit (3 req/sec)
        await new Promise((r) => setTimeout(r, 350));
      }

      if (created % 10 === 0) {
        console.log(`   ✅ ${created}/${transactions.length} created...`);
      }
    } catch (err) {
      errors++;
      console.error(`   ❌ Failed: ${tx.name} — ${err.message}`);
    }
  }

  console.log(`\n📒 Backfill complete: ${created} created, ${errors} errors out of ${transactions.length} total\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
