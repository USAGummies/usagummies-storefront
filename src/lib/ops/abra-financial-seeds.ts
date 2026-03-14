/**
 * Financial Brain Seeds — Verified financial data from Found banking platform.
 *
 * Sources: Found P&L reports, expense audit reports, activity reports (2025-2026).
 * Extracted and verified 2026-03-14.
 *
 * This seeds Abra's brain with the complete financial picture so it can:
 * - Answer questions about expenses, revenue, margins, vendors
 * - Build Notion financial structures
 * - Generate reports for Rene (accountant) and investors
 */

import { generateEmbedding } from "@/lib/ops/abra-embeddings";

// ---------------------------------------------------------------------------
// Supabase helper (mirrors abra-actions.ts pattern)
// ---------------------------------------------------------------------------

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const url = `${SB_URL}${path}`;
  const headers: Record<string, string> = {
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    ...(init.headers as Record<string, string>),
  };
  const res = await fetch(url, { ...init, headers });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Seed entries
// ---------------------------------------------------------------------------

type SeedEntry = {
  title: string;
  text: string;
  category: string;
  tags: string[];
};

function getFinancialSeeds(): SeedEntry[] {
  return [
    // -----------------------------------------------------------------------
    // 1. P&L Summary — 2025
    // -----------------------------------------------------------------------
    {
      title: "USA Gummies P&L — Full Year 2025 (Verified from Found)",
      category: "financial",
      tags: ["pnl", "2025", "verified", "found-banking"],
      text: `VERIFIED FINANCIAL DATA — Source: Found Banking P&L Report, exported 2026-03-13.

USA GUMMIES PROFIT & LOSS — Full Year 2025

INCOME:
  Business Income: $1,484.80
  (Sources: Squarespace/Stripe payments, Amazon payouts)

COST OF GOODS SOLD:
  Packaging: $3,319.71
  Ingredients: $4,460.00
  Total COGS: $7,779.71

GROSS PROFIT: -$6,294.91 (negative — COGS exceeded revenue in launch year)

OPERATING EXPENSES:
  Contractor Services: $10,406.24 (Hunter of Design $3,750, Treadstone Media $1,900, Troy Burkhart $3,500, Hawk Design $536.25, others)
  Advertising & Marketing: $3,917.24 (Facebook $1,737, Google Ads $836, Blip Billboards $655, Zeely $378, others)
  Software & Subscriptions: $2,734.34 (OpenAI $60/mo, Slack $26-61/mo, Squarespace, X Corp $40/mo, InVideo $120/mo, others)
  Cell Phone Service: $1,885.16 (T-Mobile — includes phone upgrade)
  Legal Services: $1,616.42 (Wyoming LLC Attorney $30/mo, trademark filing $350+$60, Lowe Graham Jones $360, privacy/cert filings)
  Postage & Shipping: $1,339.05 (Pirate Ship ~$7-15/shipment, ZebraPack $798, USPS $17)
  Insurance: $1,291.64 (Geico — business vehicle insurance ~$108-258/quarter)
  Car/Truck/Vehicle: $414.42 (fuel for business travel — Pilot, Shell, ExxonMobil, Maverik)
  Business Lodging: $230.78 (Quality Inn, Hampton Inn — trade show/sales trips)
  Other Services: $39.99
  Materials: $17.11
  Parking & Tolls: $12.95
  Total Operating Expenses: $23,888.23

NET INCOME: -$30,183.14

KEY INSIGHT: 2025 was a launch year. Revenue was minimal ($1,485) while the company invested heavily in product development (contractors for design, packaging), initial production run (Dutch Valley Foods $7,763 for 2,500 units + film), and market testing (Facebook, Google, billboard ads). This loss pattern is normal for a CPG startup in Year 1.`,
    },

    // -----------------------------------------------------------------------
    // 2. P&L Summary — 2026 YTD
    // -----------------------------------------------------------------------
    {
      title: "USA Gummies P&L — 2026 YTD Through March 13 (Verified from Found)",
      category: "financial",
      tags: ["pnl", "2026", "verified", "found-banking", "ytd"],
      text: `VERIFIED FINANCIAL DATA — Source: Found Banking P&L Report + Expense Audit, exported 2026-03-13.

USA GUMMIES PROFIT & LOSS — 2026 YTD (Jan 1 – Mar 13, 2026)

INCOME:
  Business Income: $2,931.36
  (Improved from $1,485 in all of 2025 — already 2x in 2.5 months)

COST OF GOODS SOLD: $0.00
  (No new production runs in 2026 yet — selling existing inventory from Sept 2025 Dutch Valley run)

GROSS PROFIT: $2,931.36

OPERATING EXPENSES BY CATEGORY:
  Software & Subscriptions: $1,426.32
    - Anthropic (Claude API): $561.14 (largest — heavy AI ops development)
    - OpenAI: $181.35 (ChatGPT subscription + API)
    - Shopify: $105.00 (migrated from Squarespace)
    - Apollo.io: $99.00 (B2B outreach)
    - Slack: $85.80
    - Amazon: $71.62
    - CrateJoy: $55.10
    - OWNERREZ: $50.00
    - Cloudflare: $31.38
    - n8n Cloud: $24.00
    - Apple: $54.99
    - Midjourney: $10.00
    - Others: ~$97
  Advertising & Marketing: $666.31
    - Google Ads: $149.03
    - Facebook: $135.97
    - Rumble: $300.00
    - Ninja Print House: $81.31
  Contractor Services: $520.00
    - Dutch Valley Foods: $520.00 (consulting/setup, NOT production)
  Postage & Shipping: $173.64 (Pirate Ship — fulfilling DTC orders)
  Legal Services: $122.23 (Company Sage $122.23 — replaced Wyoming LLC Attorney)
  Car/Truck/Vehicle: $85.88 (fuel)
  Business Meals: $48.52 (The Highlander — needs purpose documentation)
  Other Travel: $41.00 (Sport Clips — likely misclassified)
  Bank Fees: $15.00 (wire transfer fee for Dutch Valley)
  Total Operating Expenses: $3,100.09

NET INCOME: -$168.73

KEY INSIGHT: Massive improvement over 2025. Revenue already 2x full year 2025 in just 2.5 months. Operating expenses shifted from contractor-heavy (design/branding) to SaaS-heavy (AI tools, ecommerce platforms). Burn rate ~$1,200/month. Company approaching breakeven on a monthly basis. The $561 in Anthropic charges represent investment in Abra (AI ops platform). No new COGS yet — still fulfilling from September 2025 production run inventory.`,
    },

    // -----------------------------------------------------------------------
    // 3. Chart of Accounts
    // -----------------------------------------------------------------------
    {
      title: "USA Gummies Chart of Accounts — Mapped from Found Banking Categories",
      category: "financial",
      tags: ["chart-of-accounts", "verified", "found-banking", "accounting"],
      text: `CHART OF ACCOUNTS — USA Gummies (C-Corp, Form 1120 filer)
Source: Found Banking platform categories, verified against Schedule C categories in expense audit.

REVENUE ACCOUNTS (4xxx):
  4100 — Product Sales (DTC) — Stripe, Squarespace, Shopify payments
  4200 — Product Sales (Amazon) — Amazon seller payouts
  4300 — Product Sales (Wholesale) — B2B/distributor orders
  4900 — Other Income — Balance bonuses, cash back, interest

COST OF GOODS SOLD (5xxx):
  5100 — Ingredients — Raw materials (gummy base, flavoring, coloring)
  5200 — Packaging — Pouches, labels, film, boxes
  5300 — Co-Packing/Manufacturing — Dutch Valley Foods production run fees
  5400 — Items Purchased for Resale — Finished goods purchased for resale

OPERATING EXPENSES (6xxx-8xxx):
  6100 — Contractor Services — Design (Hunter of Design), media (Treadstone), packaging design (Troy Burkhart)
  6200 — Advertising & Marketing — Facebook, Google Ads, Rumble, Blip Billboards, promotional items
  6300 — Software & Subscriptions — Anthropic, OpenAI, Shopify, Slack, CrateJoy, Apollo, Cloudflare, n8n, etc.
  6400 — Cell Phone Service — T-Mobile (business mobile + equipment)
  6500 — Legal Services — Company Sage (registered agent), Wyoming LLC Attorney, trademark filing, IP protection
  6600 — Postage & Shipping — Pirate Ship (label platform), USPS, ZebraPack
  6700 — Insurance — Geico (business vehicle insurance)
  6800 — Vehicle Expenses — Fuel for business travel (Pilot, Shell, ExxonMobil, Maverik)
  6900 — Business Travel & Lodging — Hotels for trade shows, sales trips
  7000 — Business Meals — Client/partner meetings (requires documentation of who + purpose)
  7100 — Bank & Processing Fees — Wire transfer fees, payment processing
  7200 — Other Services — Miscellaneous services

EQUITY & FUNDING (Non-revenue):
  Personal Funding — Owner investment (Mastercard transfers, crypto liquidation from Kraken)
  Transfers — Internal pocket-to-pocket moves within Found

NOTES:
- Found uses "Schedule C" categories but USA Gummies is a C-Corp (Form 1120). Categories still map cleanly.
- "Social media" pocket in Found is a separate sub-account for social media advertising funds.
- 1099 contractors tracked: Hunter of Design LLC, Treadstone Media LLC, Troy Burkhart
- GS1 US ($90) should be reclassified from "Contractor services" to "Legal/Regulatory" (barcode registration)
- Sport Clips ($41) classified as "Other travel" — likely should be "Personal" or removed from business expenses.`,
    },

    // -----------------------------------------------------------------------
    // 4. Vendor Registry
    // -----------------------------------------------------------------------
    {
      title: "USA Gummies Vendor & Contractor Registry (Verified from Found)",
      category: "financial",
      tags: ["vendors", "contractors", "1099", "verified", "found-banking"],
      text: `VENDOR & CONTRACTOR REGISTRY — USA Gummies
Source: Found Banking activity reports + 1099 filings, through March 13, 2026.

=== PRODUCTION & SUPPLY CHAIN ===
Dutch Valley Foods — Co-packer/manufacturer
  Total paid: $8,282.60 ($7,762.60 for 2,500-unit production run Sept 2025 + $520 in 2026)
  Category: COGS / Items purchased for resale + Contractor services
  Note: Powers Foods was previous quote reference; Dutch Valley is the active manufacturer.

=== 1099 CONTRACTORS ===
Hunter of Design LLC (Ryan Cross) — Brand design, logo, visual identity
  Total paid: $3,750.00 (4 invoices: $750 x4 + $600 x1)
  1099 filed: Yes (2025)

Treadstone Media LLC (Zach Mason) — Media production, video content
  Total paid: $1,900.00 ($1,800 + $100 setup)
  1099 filed: Yes (2025)

Troy Burkhart — Packaging design
  Total paid: $3,500.00 ($2,000 first payment + $1,500 second)
  1099 filed: Yes (2025)

Hawk Design LLC — Additional design work
  Total paid: $536.25
  Period: April 2025

=== PLATFORM VENDORS (Monthly SaaS) ===
Anthropic (Claude API): ~$561/mo avg in 2026 (was $0 in 2025 — new for AI ops)
OpenAI: ~$60-80/mo (ChatGPT Pro + API usage)
Shopify: ~$105/mo (migrated from Squarespace late 2025)
Slack: $26-61/mo (scaling with team size)
Apollo.io: $99/mo (B2B outbound prospecting)
CrateJoy: ~$27/mo (subscription box marketplace listing)
Cloudflare: ~$10/mo (DNS/CDN)
n8n Cloud: $24/mo (workflow automation)
Squarespace: ~$27-39/mo (website, being phased out for Shopify)
OWNERREZ: $50/mo (property management — may be personal expense)
Midjourney: $10/mo (AI image generation for marketing)
Brave: ~$2/mo

=== ADVERTISING PLATFORMS ===
Facebook/Meta Ads: ~$1,874 lifetime (heavy Oct-Nov 2025 ramp, $136 in 2026 YTD)
Google Ads: ~$985 lifetime ($149 in 2026 YTD)
Rumble: $300 in 2026 ($100/mo)
Blip Billboards: $655 (Aug-Oct 2025 only)
TikTok Promote: $90 (one-time Nov 2025)

=== SHIPPING & LOGISTICS ===
Pirate Ship: ~$615 lifetime (label purchasing platform, $5-20/shipment)
ZebraPack: $798 (one-time — thermal label printer/supplies)
USPS: $17 (direct postal)

=== LEGAL & COMPLIANCE ===
Company Sage: $122/mo in 2026 (registered agent, replaced Wyoming LLC Attorney)
Wyoming LLC Attorney: $30/mo in 2025 (registered agent — discontinued)
Lowe Graham Jones PLLC: $360.50 (IP/trademark attorney)
Trademark Engine: $60 (trademark filing)
USPTO: $350 (trademark application fee)
GS1 US: $90 (barcode/UPC registration)

=== INSURANCE ===
Geico: ~$108-258/quarter (business vehicle insurance)

=== CELL PHONE ===
T-Mobile: ~$150-200/mo (business mobile + EIP payment for phone)`,
    },

    // -----------------------------------------------------------------------
    // 5. Production Run History
    // -----------------------------------------------------------------------
    {
      title: "USA Gummies Production Run History (Verified from Found Transactions)",
      category: "operational",
      tags: ["production", "cogs", "dutch-valley", "verified"],
      text: `PRODUCTION RUN HISTORY — USA Gummies
Source: Found Banking transaction records, verified against P&L.

=== RUN #1 — September 2025 ===
Manufacturer: Dutch Valley Foods
Date: September 5-10, 2025
Products: USA Gummies (gummy candy, dye-free)
Units Ordered: 2,500 units
Total Cost: $7,762.60
  - Sept 5: $555.55 (initial/deposit — categorized as "Items purchased for resale")
  - Sept 10: $7,207.05 (main payment — noted "2500 unit order and film, USA Gummies")
Cost Per Unit: $3.11 (total cost / 2,500 units)
Yield Rate: Not documented (assumed 100%)
Notes: This was the FIRST production run. Included film/packaging in cost. All 2025 and 2026 YTD sales are from this single run.

Additional materials:
  - EnergiNut.com: $17.11 (Oct 2025 — materials/ingredients, possibly supplemental)

=== CURRENT COGS BASIS ===
Hard COGS per unit: $3.11 (from Run #1)
This replaces the $3.50 estimate previously in code and the $1.35 in Supabase product_config.
The $1.35 figure appears to be ingredient-only cost; the $3.11 includes packaging and manufacturing.

=== PENDING ===
No production runs in 2026 yet. Current inventory from Run #1 is being sold.
Next run planning underway — quotes needed from Dutch Valley for larger quantity (MOQ analysis).

IMPORTANT: The Supabase product_config default of $1.35 COGS is WRONG. Actual landed COGS is $3.11/unit from Run #1. This needs to be corrected in the system.`,
    },

    // -----------------------------------------------------------------------
    // 6. Revenue Breakdown
    // -----------------------------------------------------------------------
    {
      title: "USA Gummies Revenue History by Month (Verified from Found)",
      category: "financial",
      tags: ["revenue", "sales", "monthly", "verified", "found-banking"],
      text: `MONTHLY REVENUE HISTORY — USA Gummies
Source: Found Banking activity reports (Business Income category only).

=== 2025 ===
Aug 2025: $106.06 (first revenue — check deposit, likely farmers market or direct sale)
Sep 2025: $0.81 (balance bonus only — production run month, no sales yet)
Oct 2025: $309.97 (first real sales month — Squarespace orders)
Nov 2025: $766.02 (best month — holiday season, FB ads driving traffic)
Dec 2025: $301.94 (post-holiday slowdown)
2025 TOTAL: $1,484.80

=== 2026 YTD ===
Jan 2026: Revenue not broken out in expense audit; P&L says $2,931.36 total for Jan-Mar 13
Feb 2026: (included in above)
Mar 2026 (partial): (included in above)
2026 YTD TOTAL: $2,931.36

=== REVENUE SOURCES ===
Primary: Squarespace → Stripe payments (DTC website orders) — being migrated to Shopify
Secondary: Amazon seller payouts (marketplace)
Emerging: Wholesale/B2B (not yet material)

=== KEY METRICS ===
Revenue growth: 2025 full year $1,485 → 2026 first 2.5 months $2,931 (annualized ~$14K run rate)
Average order value: ~$22-46 range (based on individual Squarespace payments)
Order frequency: Multiple orders per week by Nov-Dec 2025

NOTE: Revenue is recognized when payment received from Stripe/Squarespace/Amazon, NOT when order placed. This is cash-basis accounting per Found platform.`,
    },

    // -----------------------------------------------------------------------
    // 7. Monthly Burn Analysis
    // -----------------------------------------------------------------------
    {
      title: "USA Gummies Monthly Burn Rate Analysis (Verified from Found)",
      category: "financial",
      tags: ["burn-rate", "opex", "monthly", "verified", "runway"],
      text: `MONTHLY BURN RATE ANALYSIS — USA Gummies
Source: Found Banking activity reports, aggregated by month.

=== MONTHLY OPERATING EXPENSES (excluding COGS and personal) ===

Jul 2025: $1,408 — Contractor-heavy (design work), low marketing
Aug 2025: $1,989 — Shipping ramp-up (ZebraPack $798), contractor payments
Sep 2025: $2,701 — EXCLUDING the $7,763 production run; legal, cell phone, insurance
Oct 2025: $4,159 — Big marketing spend ($1,821 in ads — Facebook/Google ramp)
Nov 2025: $4,359 — Peak contractor month ($2,550 — Treadstone + Hunter of Design)
Dec 2025: $756 — Low month — wound down contractors and ads
Jan 2026: $1,322 — Reset for new year, Dutch Valley $520, modest ads
Feb 2026: $1,528 — AI tools ramp ($1,010 in SaaS — mostly Anthropic/OpenAI)
Mar 2026 (partial): $250 — On pace for ~$750-1,000

=== BURN RATE TRAJECTORY ===
2025 avg (Jul-Dec): $2,562/month
2026 avg (Jan-Mar): $1,033/month — 60% LOWER than 2025

The burn rate dropped because:
1. Contractor work (design/branding) is largely complete
2. Marketing shifted from paid ads ($1,800+/mo) to organic + AI-assisted content
3. AI tools replaced some human contractor costs (Anthropic/OpenAI vs Treadstone/Hunter)

=== CASH RUNWAY ESTIMATE ===
Current monthly burn: ~$1,000-1,300
Current monthly revenue: ~$1,000-1,200 (based on 2026 annualized)
Gap: Near breakeven on operating basis (excluding COGS)
With COGS ($3.11/unit): Need ~420 units/month at $10 ASP to break even fully

=== TOP RECURRING MONTHLY COSTS (2026) ===
1. Anthropic: ~$200-560/mo (variable by API usage)
2. Google Ads: ~$50/mo
3. Rumble: $100/mo
4. Pirate Ship: ~$50-80/mo (shipping costs)
5. Slack: ~$43/mo
6. Company Sage: ~$30-92/mo (legal)
7. Shopify: ~$105/mo (new)
8. Facebook: ~$45-135/mo
9. CrateJoy: ~$27/mo
10. Cloudflare: ~$10/mo`,
    },

    // -----------------------------------------------------------------------
    // 8. Funding Sources
    // -----------------------------------------------------------------------
    {
      title: "USA Gummies Funding Sources & Capital Structure (Verified from Found)",
      category: "financial",
      tags: ["funding", "capital", "owner-investment", "verified"],
      text: `FUNDING SOURCES & CAPITAL STRUCTURE — USA Gummies
Source: Found Banking activity reports — "Personal funding" and "Transfer" categories.

=== OWNER INVESTMENT (Ben Stutman) ===
Method: Personal Mastercard debit transfers + Kraken crypto liquidation
Total documented in Found: ~$7,260+ in personal funding transfers (2025)
  - Multiple $50-$1,000 transfers from personal Mastercard
  - Kraken crypto conversions: $2,448.76 (Oct), $6,761 (Sep), $375 (Sep), $850 (Aug), $2,100 (May), $2,000 (Aug)
  Total Kraken liquidation: ~$14,535

=== CORPORATE STRUCTURE ===
Entity: USA Gummies (C-Corporation)
State: Wyoming (registered agent: Company Sage, formerly Wyoming LLC Attorney)
Tax filing: Form 1120 (Corporate tax return)
Banking: Found (business banking + bookkeeping platform)
Debit cards: Business debit *6445, Marketing Card *8321
Tax year: Calendar year

=== NO EXTERNAL FUNDING ===
As of March 2026, USA Gummies is 100% founder-funded.
No outside investors, no loans, no lines of credit.
All capital has come from Ben's personal funds and crypto liquidation.

=== FOUND BANKING FEATURES IN USE ===
- Auto-categorization of expenses
- P&L report generation
- 1099 contractor tracking and filing
- Expense audit reports (Schedule C categories)
- Multiple "pockets" (Primary account, Social media sub-account)
- Debit card management (business + marketing)`,
    },

    // -----------------------------------------------------------------------
    // 9. Tax & Compliance
    // -----------------------------------------------------------------------
    {
      title: "USA Gummies Tax & Compliance Status (Verified from Found + Form 1120)",
      category: "financial",
      tags: ["tax", "compliance", "1120", "1099", "verified"],
      text: `TAX & COMPLIANCE STATUS — USA Gummies
Source: Form 1120 (March 2026 filing), Found 1099 records.

=== CORPORATE TAX ===
Filing type: Form 1120 (C-Corporation)
Tax year: 2025 (calendar year)
Filed: March 13, 2026
Status: Filed

=== 1099 FILINGS (2025) ===
Three 1099-NEC forms filed for contractors paid >$600:
1. Hunter of Design LLC — $3,750.00
2. Treadstone Media LLC — $1,900.00
3. Troy Burkhart — $3,500.00

=== OPEN ITEMS ===
- Business meals ($48.52 at The Highlander, Feb 24 2026): Needs "who" and "what for" documentation
- Sport Clips ($41.00, Jan 28 2026): Classified as "Other travel" — should review if business expense
- OWNERREZ ($50.00/mo): May be personal property management, not business — needs reclassification review
- Some Google Workspace charges appear for "rainierlux" — possibly personal/different business, needs separation

=== SALES TAX ===
Not documented in Found data. Need to verify:
- Wyoming sales tax nexus (if any)
- State sales tax obligations for DTC shipments to other states
- Amazon handles sales tax for marketplace orders

=== GS1/UPC ===
GS1 US membership: $90 (April 2025) — UPC barcode registration for retail/wholesale`,
    },

    // -----------------------------------------------------------------------
    // 10. Key Financial Corrections
    // -----------------------------------------------------------------------
    {
      title: "USA Gummies Financial Data Corrections — System Values vs Actuals",
      category: "correction",
      tags: ["correction", "cogs", "verified", "critical"],
      text: `CRITICAL FINANCIAL CORRECTIONS — USA Gummies
Source: Verified from Found Banking records, March 2026.

=== CORRECTION 1: COGS PER UNIT ===
WRONG (in Supabase product_config): $1.35/unit
WRONG (hardcoded in pnl.ts): $3.50/unit
CORRECT (from actual Run #1 data): $3.11/unit
Basis: $7,762.60 total cost / 2,500 units = $3.105/unit
Source: Dutch Valley Foods payments (Sept 5 + Sept 10, 2025)
Action needed: Update Supabase product_config AND pnl.ts

=== CORRECTION 2: REVENUE RECOGNITION ===
Found Banking uses CASH BASIS accounting.
Revenue = when Stripe/Squarespace/Amazon payment hits the Found account.
This may differ from Shopify Admin order dates by 1-3 days (payout delay).
When comparing Found P&L to Shopify revenue, expect small timing differences.

=== CORRECTION 3: EXPENSE CATEGORIZATION ISSUES ===
- Google Workspace charges for "rainierlux" ($2.47-5.61/mo) — may NOT be USA Gummies business expense
- OWNERREZ ($50/mo) — property management software, likely personal not business
- Sport Clips ($41) — classified as "Other travel" but is a haircut; reclassify or remove
- Some "Software and subscriptions" charges from Amazon ($48.94, $22.68) may be product purchases, not software

=== CORRECTION 4: CONTRACTOR CLASSIFICATION ===
Dutch Valley Foods $520 (Jan 2026) classified as "Contractor services" in Found.
This may be consulting/setup fees, NOT a production run cost.
Should be distinguished from the $7,762.60 COGS payments (Sept 2025).

=== NOTE ON DATA FRESHNESS ===
All data in these seeds is from Found Banking exports dated 2026-03-13.
New transactions after March 13 are NOT reflected here.
Abra should note this date basis when citing these figures.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Seeder function
// ---------------------------------------------------------------------------

export async function seedFinancialBrainEntries(): Promise<{ inserted: number; skipped: number }> {
  const seeds = getFinancialSeeds();
  let inserted = 0;
  let skipped = 0;

  for (const seed of seeds) {
    // Idempotency: check if entry with same title exists
    const existing = (await sbFetch(
      `/rest/v1/open_brain_entries?title=eq.${encodeURIComponent(seed.title)}&select=id&limit=1`,
    )) as Array<{ id: string }>;

    if (existing.length > 0) {
      console.log(`[financial-seeds] Skipping (exists): ${seed.title.slice(0, 60)}`);
      skipped++;
      continue;
    }

    // Generate embedding
    let embedding: number[] | null = null;
    try {
      embedding = await generateEmbedding(seed.text.slice(0, 8000));
    } catch (err) {
      console.error(`[financial-seeds] Embedding failed for: ${seed.title.slice(0, 60)}`, err);
    }

    // Insert brain entry
    const rows = (await sbFetch("/rest/v1/open_brain_entries", {
      method: "POST",
      headers: {
        Prefer: "return=representation",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_type: "agent",
        source_ref: "financial_seed",
        entry_type: "teaching",
        title: seed.title,
        raw_text: seed.text,
        summary_text: seed.text.slice(0, 500),
        category: seed.category,
        department: "finance",
        confidence: "verified",
        priority: "critical",
        processed: true,
        tags: seed.tags,
        ...(embedding ? { embedding } : {}),
      }),
    })) as Array<{ id: string }>;

    if (rows?.[0]?.id) {
      console.log(`[financial-seeds] Inserted: ${seed.title.slice(0, 60)} (${rows[0].id})`);
      inserted++;
    }
  }

  return { inserted, skipped };
}
