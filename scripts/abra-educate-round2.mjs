#!/usr/bin/env node
/**
 * abra-educate-round2.mjs — Deep domain education for Abra
 * Round 2: More specific operational knowledge, processes, and procedures
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

async function getEmbedding(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000), dimensions: 1536 }),
  });
  if (!res.ok) throw new Error(`Embedding failed: ${res.status}`);
  const data = await res.json();
  return data.data[0].embedding;
}

async function teach(department, title, content, category = 'teaching') {
  const embText = `${title}. ${content}`;
  const embedding = await getEmbedding(embText);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/open_brain_entries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      source_type: 'manual',
      source_ref: `teaching-r2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      entry_type: 'teaching',
      title,
      raw_text: `Taught by founder (Ben Stutman):\n${content}`,
      summary_text: content.slice(0, 500),
      category,
      department: department || 'executive',
      confidence: 'high',
      priority: 'important',
      processed: true,
      embedding,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Insert failed (${res.status}): ${errText.slice(0, 300)}`);
  }
  const rows = await res.json();
  return rows[0]?.id;
}

const TEACHINGS = [

  // ── Finance Deep Dive ──
  {
    dept: 'finance',
    title: 'Chart of Accounts Structure for USA Gummies',
    cat: 'financial',
    content: `Recommended Chart of Accounts for USA Gummies in QuickBooks Online:

REVENUE (4000s):
- 4100 DTC Sales (Shopify)
- 4200 Amazon Sales
- 4300 Wholesale Sales (Direct)
- 4350 Faire Sales
- 4400 Returns & Allowances (contra-revenue)
- 4500 Shipping Revenue (if charged to customers)

COST OF GOODS SOLD (5000s):
- 5100 Ingredients / Raw Materials
- 5200 Manufacturing / Co-Packer Fees
- 5300 Packaging Materials (bottles, labels, caps, shrink bands)
- 5400 Inbound Freight (from manufacturer to warehouse)
- 5500 Quality Testing & Lab Fees
- 5600 Amazon FBA Fees
- 5700 Shipping & Fulfillment (DTC orders)
- 5800 Merchant Processing Fees (Shopify Payments, Amazon)

OPERATING EXPENSES (6000s-8000s):
- 6100 Marketing & Advertising (Meta ads, Google ads)
- 6200 Amazon PPC / Sponsored Ads
- 6300 Software & Technology (Shopify, Vercel, Supabase, etc.)
- 6400 Professional Services (legal, accounting, consulting)
- 6500 Insurance (product liability, general liability)
- 6600 Office & Administrative
- 6700 Travel & Meals (buyer meetings, trade shows)
- 6800 Samples & Promotions
- 7000 Payroll & Benefits (when applicable)
- 8000 Interest & Bank Fees

This structure enables tracking gross margin by channel and clear visibility into unit economics.`
  },

  {
    dept: 'finance',
    title: 'Cash Flow Management for CPG Startups',
    cat: 'financial',
    content: `Cash flow is the number one killer of CPG startups. Key cash flow management principles for USA Gummies:

1. The Cash Conversion Cycle: You pay the co-packer 30 days before receiving finished goods. Inventory sits 30-90 days before selling. Wholesale customers pay Net 30-60 after delivery. Total: 90-180 days from cash out to cash in. This means you need working capital equal to roughly 3-6 months of COGS.

2. Cash Flow Forecasting: Build a 13-week rolling cash flow forecast. Update weekly. Track: Starting cash + Expected receivables - Expected payables - Operating expenses = Ending cash. Flag any week where ending cash drops below 2 weeks of operating expenses.

3. Inventory Cash Trap: Every dollar in inventory is a dollar NOT available for marketing, operations, or emergencies. Order the minimum quantity that gets acceptable per-unit pricing from the co-packer. Don't over-order "just in case."

4. Accelerate Receivables: For wholesale, offer 2/10 Net 30 terms (2% discount for payment within 10 days). Use Faire's payment guarantee feature. For Amazon, cash settles every 2 weeks.

5. Stretch Payables (carefully): Negotiate Net 45 or Net 60 with co-packer if possible. Pay on the last day of terms, not early. But NEVER miss a payment — co-packer relationships are critical.

6. Seasonal Planning: Supplement sales have seasonal patterns. Q1 (New Year's resolutions) and Q4 (holiday gifting) are typically strongest. Plan inventory builds 8-12 weeks ahead of peak seasons.

7. Emergency Reserve: Always maintain minimum 8 weeks of operating expenses in cash. If cash drops below this, cut discretionary spending immediately.`
  },

  // ── QuickBooks Deep Dive ──
  {
    dept: 'finance',
    title: 'QuickBooks Online API Integration Details',
    cat: 'financial',
    content: `QuickBooks Online API integration for automated bookkeeping:

1. Authentication: OAuth 2.0 via Intuit Developer platform. Need a QuickBooks app (client_id + client_secret). Authorization flow: redirect user to Intuit auth → receive auth code → exchange for access_token + refresh_token. Access tokens expire in 1 hour. Refresh tokens expire in 100 days. Must persist and auto-refresh tokens.

2. Key API Endpoints:
   - POST /v3/company/{realmId}/invoice — Create wholesale invoices
   - POST /v3/company/{realmId}/salesreceipt — Record DTC sales
   - POST /v3/company/{realmId}/bill — Record co-packer bills
   - POST /v3/company/{realmId}/deposit — Record Amazon settlements
   - POST /v3/company/{realmId}/journalentry — General journal entries
   - GET /v3/company/{realmId}/reports/ProfitAndLoss — P&L report
   - GET /v3/company/{realmId}/reports/BalanceSheet — Balance sheet

3. Shopify → QBO Sync: Each Shopify order becomes a Sales Receipt in QBO. Map Shopify line items to QBO income account (4100). Map shipping to 4500. Map Shopify Payments processing fee to 5800. Run daily batch sync.

4. Amazon → QBO Sync: Amazon settlement reports (bi-weekly) become Deposits in QBO. Break down: product sales → 4200, FBA fees → 5600, referral fees → 5800, advertising charges → 6200.

5. Wholesale → QBO Sync: Each wholesale PO becomes an Invoice in QBO. Set payment terms (Net 30/60). Track AR aging. When payment received, apply to invoice.

6. The integration should be built as an Abra feed that runs daily, pulling data from Shopify/Amazon APIs and creating/updating QBO records automatically. This is a Phase 10+ feature.`
  },

  // ── Supply Chain Deep Dive ──
  {
    dept: 'supply_chain',
    title: 'Gummy Vitamin Ingredient Sourcing',
    cat: 'supply_chain',
    content: `Key ingredients in gummy vitamin manufacturing and sourcing considerations:

1. Gummy Base: Either gelatin (pork or beef-derived, cheaper, traditional) or pectin (plant-based, vegan-friendly, growing demand). Pectin gummies are harder to formulate but appeal to a larger market. Most major co-packers can do both.

2. Active Ingredients (vitamins/minerals): Sourced from specialty ingredient suppliers. Key considerations: (a) Form matters — Vitamin D3 as cholecalciferol, Vitamin C as ascorbic acid, etc. (b) Potency overage — gummies lose potency over shelf life, so formulas include 20-30% overage at manufacture to ensure label claim at expiration. (c) Ingredient suppliers typically require MOQs and have lead times of 4-8 weeks.

3. Sweeteners: Sugar, glucose syrup, or sugar-free alternatives (stevia, erythritol, allulose). Sugar-free is a growing trend but more expensive and harder to formulate.

4. Flavors & Colors: Natural flavors and colors are strongly preferred in the current market. "No artificial colors or flavors" is a key marketing claim. Common natural colors: beet juice, turmeric, spirulina, carrot juice.

5. Coatings: Citric acid (sour), sugar, or oil-based coatings prevent gummies from sticking together. The coating affects taste, appearance, and shelf stability.

6. Supply Chain Risks: (a) Gelatin prices fluctuate with livestock markets. (b) Popular ingredients (Elderberry, Vitamin D) can go on allocation during high-demand periods (like flu season). (c) Natural color availability varies seasonally. (d) Shipping delays from overseas ingredient suppliers.

7. Quality Requirements: All ingredients must be tested for identity, potency, purity, and contaminants (heavy metals, pesticides, microbial). The co-packer handles most testing but the brand (USA Gummies) is ultimately responsible for product safety.`
  },

  {
    dept: 'supply_chain',
    title: 'Inventory Management for USA Gummies',
    cat: 'operational',
    content: `Inventory management strategy for a multi-channel CPG brand:

1. SKU Management: Each unique product (formula + count + flavor) is a separate SKU. Track inventory by SKU across all locations: main warehouse, Amazon FBA, in-transit. Use UPC barcodes for all tracking.

2. Reorder Point Formula: Reorder Point = (Average Daily Sales × Lead Time in Days) + Safety Stock. Example: If a SKU sells 20 units/day, lead time is 60 days, and safety stock is 14 days: Reorder Point = (20 × 60) + (20 × 14) = 1,200 + 280 = 1,480 units. When inventory drops to 1,480, place a new PO with the co-packer.

3. Safety Stock: Keep 2-4 weeks of safety stock per SKU. More for bestsellers, less for slow movers. Safety stock protects against demand spikes and supply delays.

4. Amazon FBA Inventory: Amazon charges monthly storage fees ($0.87/cubic ft Oct-Jan, $0.56/cubic ft Feb-Sep for standard size). Long-term storage fees kick in after 365 days. Keep 60-90 days of supply in FBA — not more. Replenish every 2-4 weeks based on velocity.

5. Expiration Date Management (FEFO): Gummies have 18-24 month shelf life. Use First-Expired-First-Out (FEFO) rotation. Track expiration dates per batch. Amazon requires minimum 90 days remaining shelf life for FBA inbound. Most retailers require minimum 12 months remaining.

6. Inventory Turns: Target 4-6 inventory turns per year (replenishing every 2-3 months). Higher turns = less cash tied up, lower storage costs, fresher product. Lower turns = fewer production runs, better per-unit cost but more risk.

7. Shrinkage: Budget 1-3% for damages, quality holds, and samples. Track actual shrinkage monthly.`
  },

  // ── Retail Sales Deep Dive ──
  {
    dept: 'sales_and_growth',
    title: 'How to Get Into Retail Stores — Step by Step',
    cat: 'sales',
    content: `Detailed playbook for getting USA Gummies into retail stores:

PREPARATION (before reaching out to any buyer):
1. Professional sell sheet — 1-page PDF with: hero product photos, key benefits, pricing (wholesale + suggested retail), case pack info, UPC codes, brand story (2 sentences), contact info. No clutter.
2. Samples ready to ship — have sample kits pre-packed. Include sell sheet, business card, and 1-2 product samples per SKU.
3. Pricing finalized — know your MAP (Minimum Advertised Price), wholesale price, and distributor price. Standard: 50% off SRP for wholesale, 60-65% off for distributor pricing.
4. Insurance — Product liability insurance (minimum $1M/$2M) is required by most retailers. Get it before pitching.
5. UPC codes — purchased through GS1. One per SKU.
6. Case pack configuration — standard cases of 6 or 12 units. Shelf-ready display cases are a plus for independent retailers.

OUTREACH:
1. Research the buyer — what similar products do they carry? What's their price range?
2. Email pitch — subject line: "[Brand Name] — New American-Made Gummy Vitamins for [Store Name]". Keep email under 150 words. Attach sell sheet. Offer to send samples.
3. Follow up — 3 touches over 2 weeks. Email → phone call → email. Then wait 30 days and try again.
4. Trade shows — Natural Products Expo West/East are the biggest supplement trade shows. Expensive but high-value buyer meetings.

CLOSING:
1. Buyer says yes → send order form or set up on Faire → ship within agreed timeline.
2. First order is typically small (1-2 cases per SKU per store location).
3. Follow up 30 days after delivery — check sell-through rate, offer a demo day.`
  },

  {
    dept: 'sales_and_growth',
    title: 'Faire Marketplace Strategy for Wholesale',
    cat: 'sales',
    content: `Faire.com is a wholesale marketplace that connects brands with independent retailers. Key details for USA Gummies:

1. How Faire Works: Retailers browse and order products. Faire handles payment (Net 60 to retailers), and provides a risk-free guarantee to retailers (free returns within 60 days on first orders). Brands ship directly to retailers.

2. Faire Commission: 25% commission on first orders from new retailers, 15% on reorders. This is high, but the platform provides customer acquisition. Once a relationship is established, you can negotiate direct orders (cutting out Faire commission).

3. Pricing on Faire: Set your wholesale price (typically 50% of SRP). Faire adds their retailer discount on top. You receive your wholesale price minus the Faire commission.

4. Faire Best Practices: (a) High-quality product photos — lifestyle shots perform best. (b) Detailed product descriptions with ingredient lists and certifications. (c) Respond to retailer messages within 24 hours. (d) Offer a "Faire Direct" option for repeat customers at reduced commission. (e) Set MOQs per retailer (minimum order of 1-2 cases).

5. Faire for USA Gummies: The platform is ideal for reaching health food stores, specialty retailers, and boutiques. The "Made in USA" tag performs well on Faire. Category: Health & Wellness → Vitamins & Supplements.

6. Logistics: Ship within 3-5 business days of order. Use trackable shipping. Pack securely — damaged products hurt your Faire rating. Include sell sheet and business card in every shipment.`
  },

  // ── Company Operations Deep Dive ──
  {
    dept: 'operations',
    title: 'Weekly Operating Rhythm for USA Gummies',
    cat: 'operational',
    content: `The weekly operating cadence that Abra should help enforce:

MONDAY — Week Start Review:
- Review last week's sales by channel (Shopify, Amazon, Faire/Wholesale)
- Check inventory levels across all locations
- Review cash position (bank balance, outstanding AR, upcoming AP)
- Prioritize the week's top 3 objectives

TUESDAY — Sales & Marketing Focus:
- Review ad performance (Meta, Google, Amazon PPC)
- Check email campaign metrics
- Review Faire/wholesale pipeline — any pending orders or inquiries?
- B2B outreach: send 5-10 buyer emails or make calls

WEDNESDAY — Operations & Supply Chain:
- Check outstanding POs with co-packer
- Review Amazon FBA inventory levels — need to send more?
- Process any wholesale orders
- Review shipping/fulfillment metrics

THURSDAY — Finance & Admin:
- Review any outstanding invoices (AR aging)
- Pay bills coming due (AP)
- Categorize bank transactions in QuickBooks
- Review subscription/recurring costs

FRIDAY — Planning & Strategy:
- Review week's KPIs vs targets
- Plan next week's priorities
- Address any open customer service issues
- Update any forecasts or projections if needed

Abra should be able to generate a morning brief each day focused on that day's priorities, pull relevant data, and flag anything that needs immediate attention.`
  },

  {
    dept: 'operations',
    title: 'Abra Role and Capabilities — What Abra Should Do',
    cat: 'operational',
    content: `Abra's role as the company operating system for USA Gummies:

WHAT ABRA SHOULD DO:
1. Daily: Pull sales data from Shopify and Amazon. Calculate daily metrics. Generate morning brief. Flag anomalies.
2. Daily: Monitor inventory levels. Alert when SKUs approach reorder point.
3. Daily: Triage incoming emails — categorize as sales inquiry, supplier communication, customer service, or noise.
4. Weekly: Generate a comprehensive weekly digest covering all departments.
5. Weekly: Review B2B pipeline — flag stalled deals, suggest follow-ups.
6. Monthly: Generate monthly financial summary (revenue by channel, margins, cash flow).
7. On-demand: Answer questions about any aspect of the business using the brain (knowledge base).
8. On-demand: Help plan new initiatives (like "get finance under control" or "prepare for retail launch").
9. On-demand: Research topics the company needs to understand (new markets, regulations, etc.).

WHAT ABRA SHOULD NOT DO:
1. Never make financial commitments or purchases without explicit founder approval.
2. Never send external communications (emails to customers/buyers) without approval.
3. Never modify production code without going through the deploy approval gate.
4. Never provide medical, legal, or tax advice — flag these as needing professional consultation.
5. Never guess at financial numbers — if data isn't available, say so clearly.

ABRA'S TONE:
- Direct and concise, matching the founder's communication style
- Data-first: lead with numbers, then analysis
- Action-oriented: always end with specific recommended next steps
- Confident but transparent about uncertainty — say "I'm 85% confident" not "I think maybe"
- Never fluffy or corporate — no buzzwords, no filler language`
  },

  // ── Competitive Landscape ──
  {
    dept: 'sales_and_growth',
    title: 'Gummy Vitamin Competitive Landscape',
    cat: 'competitive',
    content: `Key competitors in the gummy vitamin market for USA Gummies' awareness:

MAJOR BRANDS:
- Olly: Owned by Unilever. Premium positioning, strong Instagram presence, available at Target/CVS/Walmart. Known for trendy formulas and attractive packaging.
- Vitafusion: One of the original gummy vitamin brands. Mass market, available everywhere. Competitive pricing. Owned by Church & Dwight.
- SmartyPants: Premium brand, strong organic/clean label positioning. Available at Whole Foods, Target, Amazon. Recently acquired by Unilever.
- Nature's Way: Established supplement brand with a gummy line (Alive! Gummies). Available at major retailers.
- Zarbee's: Strong in children's vitamins. Naturals-focused. Owned by Haleon (GSK spinoff).

USA GUMMIES COMPETITIVE ADVANTAGES:
1. "Made in USA" — clear, differentiated positioning that resonates with patriotic consumers and "buy American" trend.
2. DTC + marketplace + wholesale — multi-channel from day one.
3. Lean operations — can price competitively against larger brands that have high overhead.
4. Speed/agility — can launch new SKUs faster than big CPG companies (no bureaucracy).
5. Technology-first — AI-powered operations is a genuine operational advantage.

COMPETITIVE RISKS:
1. Big brands have massive marketing budgets and existing retailer relationships.
2. Private label gummies (store brands) are growing and compete on price.
3. Market is fragmented — hundreds of small gummy brands on Amazon.
4. Key differentiator ("Made in USA") can be copied.`
  },

  // ── Amazon Strategy ──
  {
    dept: 'sales_and_growth',
    title: 'Amazon Selling Strategy for Supplements',
    cat: 'sales',
    content: `Amazon strategy for USA Gummies (Seller ID: A16G27VYDSSEGO, US marketplace):

1. FBA (Fulfillment by Amazon): Ship inventory to Amazon fulfillment centers. Amazon handles pick, pack, ship, returns, customer service. Required for Prime badge. FBA fees: referral fee (15% for Health & Beauty) + fulfillment fee ($3-5/unit) + monthly storage fee.

2. Listing Optimization: (a) Title: Include main keyword, brand, key ingredient, count (e.g., "USA Gummies Vitamin D3 Gummies 5000 IU - 60 Count, Made in USA"). (b) Bullet points: 5 bullets covering key benefits, ingredients, quality claims, serving info. (c) A+ Content: Enhanced brand content with comparison charts, lifestyle images, ingredient spotlight. (d) Backend keywords: 250 characters of search terms.

3. Amazon PPC: Three ad types — Sponsored Products (highest ROI), Sponsored Brands (brand awareness), Sponsored Display (retargeting). Start with auto campaigns to gather keyword data. Move winning keywords to manual campaigns. Target ACoS (advertising cost of sale) of 25-35% for launch phase, optimize to under 20%.

4. Reviews: Reviews are critical on Amazon. Enroll in Amazon Vine program for early reviews ($200/SKU). Use Amazon's "Request a Review" button. Never pay for reviews — this violates TOS and can get the account suspended.

5. Subscribe & Save: Enroll in Subscribe & Save to drive repeat purchases. Vitamins are a natural subscription product — customers take them daily and reorder monthly.

6. Pricing: Be competitive but not cheapest. Price within 10-15% of comparable branded gummies. Use coupons and Lightning Deals strategically. Never race to the bottom on price.

7. Inventory Management: Send 60-90 days of inventory to FBA. Monitor IPI (Inventory Performance Index) — stay above 400 to avoid storage limits. Use restock recommendations but verify with your own demand forecast.`
  },

  // ── Regulatory ──
  {
    dept: 'operations',
    title: 'FDA Regulatory Requirements for Dietary Supplements',
    cat: 'regulatory',
    content: `FDA regulatory compliance requirements for USA Gummies (dietary supplement manufacturer/marketer):

1. Facility Registration: The co-packer's facility must be registered with the FDA as a dietary supplement manufacturing facility. USA Gummies as the brand owner should also register as a distributor.

2. GMP Compliance: 21 CFR Part 111 — Current Good Manufacturing Practice for dietary supplements. The co-packer must follow GMP. Key areas: ingredient identity testing, master manufacturing records, batch records, equipment calibration, quality control, personnel training.

3. Supplement Facts Panel: Required on every product label. Must include: serving size, amount per serving, % Daily Value (if established), list of all dietary ingredients with amounts. Must use FDA's format and font size requirements.

4. Label Requirements: Product name, statement of identity ("Dietary Supplement"), net quantity, manufacturer/distributor name and address, supplement facts panel, other ingredients list, allergen warnings (if applicable), recommended use/dosage.

5. Claims: (a) Structure/function claims allowed (e.g., "Supports immune health") — must have disclaimer: "This statement has not been evaluated by the FDA. This product is not intended to diagnose, treat, cure, or prevent any disease." (b) Health claims require FDA authorization. (c) Never make disease claims (e.g., "cures the flu").

6. Adverse Event Reporting: Must report serious adverse events to FDA within 15 business days. Must maintain records of all complaints.

7. New Dietary Ingredient (NDI) Notification: If using an ingredient not marketed in the US before October 15, 1994, must file an NDI notification with FDA 75 days before marketing.

8. State Registration: Some states require separate dietary supplement registration (e.g., California, Florida, New York). Check each state's requirements.`
  },
];

async function main() {
  console.log(`\n🧠 ABRA EDUCATION — Round 2: ${TEACHINGS.length} deep-dive teachings\n`);
  console.log('═'.repeat(60));

  let success = 0;
  let failed = 0;

  for (let i = 0; i < TEACHINGS.length; i++) {
    const t = TEACHINGS[i];
    const num = `[${i + 1}/${TEACHINGS.length}]`;
    process.stdout.write(`${num} ${t.dept.padEnd(18)} ${t.title.slice(0, 50).padEnd(52)} `);

    try {
      const id = await teach(t.dept, t.title, t.content, t.cat || 'teaching');
      console.log(`✅ ${id?.slice(0, 8) || 'ok'}`);
      success++;
    } catch (err) {
      console.log(`❌ ${err.message.slice(0, 80)}`);
      failed++;
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`✅ Success: ${success}  ❌ Failed: ${failed}  📚 Total: ${TEACHINGS.length}`);
  console.log('═'.repeat(60) + '\n');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
