#!/usr/bin/env node
/**
 * abra-educate.mjs — Direct brain injection for Abra education
 *
 * Bypasses web auth by writing directly to Supabase open_brain_entries
 * with OpenAI embeddings. Same as /api/ops/abra/teach but scriptable.
 *
 * Usage: node scripts/abra-educate.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env.local manually (no dotenv dep needed)
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
} catch { /* .env.local may not exist */ }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_KEY) {
  console.error('Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or OPENAI_API_KEY');
  process.exit(1);
}

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

async function teach(department, title, content) {
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
      source_ref: `teaching-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      entry_type: 'teaching',
      title,
      raw_text: `Taught by founder (Ben Stutman):\n${content}`,
      summary_text: content.slice(0, 500),
      category: 'teaching',
      department: department || 'executive',
      confidence: 'high',
      priority: 'important',
      processed: true,
      embedding,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase insert failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  const rows = await res.json();
  return rows[0]?.id;
}

// ═══════════════════════════════════════════════════════════
// TEACHINGS — Only facts, no guesses
// ═══════════════════════════════════════════════════════════

const TEACHINGS = [

  // ── Company Identity & Culture ──
  {
    dept: 'executive',
    title: 'USA Gummies — Company Overview',
    content: `USA Gummies is a consumer packaged goods (CPG) company specializing in gummy vitamins and supplements. The company sells direct-to-consumer (DTC) through its Shopify storefront at usagummies.com, on Amazon as a third-party seller, and wholesale through Faire and direct outreach to retail buyers. The company is based in the United States. USA Gummies is in early-stage growth — the founder is the primary operator, handling everything from sales and marketing to supply chain, finance, and technology. The company has a lean operating model with no full-time employees yet besides the founder. The brand positioning is premium American-made gummy vitamins at accessible price points.`
  },
  {
    dept: 'executive',
    title: 'USA Gummies — Brand Values and Culture',
    content: `USA Gummies core brand values: (1) Made in USA — all products manufactured domestically, this is central to the brand identity and name. (2) Quality — using premium ingredients, proper dosing, third-party tested. (3) Accessibility — gummies as a delivery format make vitamins easy and enjoyable to take. (4) Transparency — honest labeling, no proprietary blends, clear ingredient lists. The company culture is founder-driven, scrappy, and execution-focused. Speed matters more than perfection. The founder prefers to ship fast, learn, and iterate rather than over-plan. The motto is basically "move fast and figure it out." There is an aggressive growth mindset — the goal is to scale from early revenue into a real CPG brand with retail distribution.`
  },

  // ── Founder Profile ──
  {
    dept: 'executive',
    title: 'Ben Stutman — Founder Profile',
    content: `Ben Stutman is the founder and sole operator of USA Gummies. He is a technical founder who built the entire technology stack himself — the Shopify storefront, the ops dashboard, the Abra AI system, all integrations. He handles sales, marketing, supply chain, finance, and operations personally. Ben is based in the United States. His approach is hands-on and data-driven. He is comfortable with code, APIs, databases, and AI/ML tooling. He built Abra (this AI system) to scale himself — to handle the operational complexity of running a CPG company as a solo founder. Ben's communication style is direct and action-oriented. He prefers concise answers with specific next steps over long explanations. When interacting with Ben, be direct, efficient, and assume he can handle technical complexity. He does not need things simplified.`
  },

  // ── Business Finance for CPG ──
  {
    dept: 'finance',
    title: 'CPG Business Finance Fundamentals',
    content: `Key financial metrics for a CPG (consumer packaged goods) company like USA Gummies: (1) Gross Margin = (Revenue - COGS) / Revenue. For gummy vitamins, target gross margin is 60-70% on DTC, 40-50% on Amazon (after fees), and 45-55% on wholesale. (2) COGS (Cost of Goods Sold) for gummies includes: raw ingredients, manufacturing/co-packer fees, packaging materials, labels, bottle/caps, shrink bands, inbound freight from manufacturer, quality testing fees. (3) Customer Acquisition Cost (CAC) — for DTC this includes ad spend (Meta, Google), influencer costs, content creation. Target CAC should be under 1/3 of customer lifetime value. (4) Contribution Margin = Revenue - COGS - Variable Selling Costs (shipping, payment processing, marketplace fees). This is the true unit economics metric. (5) Cash Conversion Cycle matters hugely in CPG — you pay the co-packer 30-60 days before you receive inventory, then inventory sits until sold. Wholesale buyers pay Net 30-60. This means you can have 90-120 days of cash tied up in each unit. Cash flow management is critical. (6) Break-even analysis: Fixed costs (rent, software, insurance) + variable costs per unit need to be covered by contribution margin. (7) Revenue recognition: DTC revenue recognized at shipment, wholesale at delivery/acceptance, Amazon when payment settles.`
  },
  {
    dept: 'finance',
    title: 'Accounting Basics for a CPG Startup',
    content: `Accounting fundamentals for USA Gummies: (1) Chart of Accounts structure for CPG: Revenue accounts separated by channel (DTC, Amazon, Wholesale, Faire). COGS sub-accounts for ingredients, packaging, manufacturing labor, freight-in, testing. Operating expense accounts for marketing, shipping/fulfillment, software/tech, professional services, insurance. (2) Accrual basis accounting is recommended for CPG — matches revenue with the period it was earned, not when cash was received. This matters for wholesale where Net 30/60 terms mean cash comes later. (3) Inventory accounting: Use weighted average cost method. Track inventory as an asset on the balance sheet. When sold, move from inventory asset to COGS expense. (4) Sales tax: Must collect and remit in states with nexus (physical or economic). Shopify handles DTC collection. Amazon handles marketplace tax. Wholesale requires proper exemption certificates from buyers. (5) Monthly close process: Reconcile bank accounts, review AR/AP aging, record inventory adjustments, accrue expenses, review revenue by channel, generate P&L and Balance Sheet. (6) Key financial statements: P&L (income statement), Balance Sheet, Cash Flow Statement. For investors, also prepare a monthly financial package with these three plus key metrics.`
  },

  // ── QuickBooks ──
  {
    dept: 'finance',
    title: 'QuickBooks Integration for CPG',
    content: `QuickBooks Online (QBO) is the target accounting system for USA Gummies. Key setup requirements: (1) Chart of Accounts: Create income accounts per channel (DTC Sales, Amazon Sales, Wholesale Sales, Faire Sales). Create COGS sub-accounts (Ingredients, Packaging, Manufacturing, Freight-In, Testing). Create expense categories for marketing, shipping, software, etc. (2) QuickBooks has an API (Intuit Developer) that supports OAuth 2.0 authentication. The API allows programmatic creation of invoices, bills, journal entries, and pulling financial reports. (3) Integration points for USA Gummies: Shopify orders → QBO sales receipts or invoices. Amazon settlement reports → QBO deposits + fees. Wholesale invoices → QBO invoices with Net 30/60 terms. Bill entry for co-packer invoices, ingredient purchases. (4) Bank feeds: Connect business bank account(s) to QBO for automatic transaction import and matching. (5) Classes or Locations feature in QBO can be used to track P&L by channel (DTC vs Amazon vs Wholesale). (6) QBO subscription: Simple Start or Essentials tier is sufficient initially. Plus tier needed if tracking inventory in QBO (though may use separate inventory system). (7) Reports to generate monthly: P&L by channel, Balance Sheet, AR Aging, AP Aging, Cash Flow Statement, Sales Tax Liability.`
  },

  // ── Gummy Bear Production & Supply Chain ──
  {
    dept: 'supply_chain',
    title: 'Gummy Vitamin Manufacturing Process',
    content: `Gummy vitamin production process: (1) Formulation: A formula specifies active ingredients (vitamins, minerals, botanicals), inactive ingredients (gelatin or pectin base, sweeteners, flavors, colors), and dosage per gummy. Formulas must comply with FDA dietary supplement regulations (21 CFR 111). (2) Manufacturing: USA Gummies uses a contract manufacturer (co-packer) — the company does not own manufacturing equipment. Co-packers handle: ingredient sourcing/procurement, batching/mixing, cooking (gummies are cooked like candy), depositing into molds, cooling/curing (gummies need 24-48 hours to set), coating (citric acid, sugar, or other coatings), quality testing (potency, microbial, heavy metals), packaging into bottles and labeling. (3) Minimum Order Quantities (MOQs): Co-packers typically require MOQs of 5,000-25,000 bottles per SKU per run. This means significant upfront capital tied to inventory. (4) Lead times: Typical manufacturing lead time is 6-12 weeks from PO to delivery, depending on ingredient availability and production schedule. (5) Key supply chain risks: ingredient shortages (especially popular vitamins like Vitamin D, Elderberry), long lead times, MOQ cash requirements, shelf life management (gummies typically have 18-24 month shelf life).`
  },
  {
    dept: 'supply_chain',
    title: 'USA Gummies Supply Chain Structure',
    content: `USA Gummies supply chain: (1) Co-packer/Manufacturer: Contract manufacturer handles all production. USA Gummies provides the formula and brand specifications, co-packer produces finished goods. (2) Inbound logistics: Finished goods ship from co-packer to storage/fulfillment location. (3) Storage: Inventory stored at fulfillment center or warehouse. Gummies require climate-controlled storage — heat and humidity can degrade product quality (gummies melt, stick together). Ideal storage: 60-75°F, below 65% humidity. (4) Fulfillment: DTC orders fulfilled through the storage location (pick, pack, ship). Amazon FBA requires shipping inventory to Amazon fulfillment centers. Wholesale orders ship palletized to retailers or distributor warehouses. (5) Packaging hierarchy: Individual gummy → bottle (typically 60-count) → carton (retail display) → case (6-12 bottles) → pallet. (6) UPC/barcodes required for retail and Amazon. Each SKU needs a unique UPC. (7) Compliance: FDA-registered facility, GMP (Good Manufacturing Practice) compliant, proper supplement facts panel, all required warnings and disclaimers on label.`
  },

  // ── Retail Buyer Strategy / Memorial Day Push ──
  {
    dept: 'sales_and_growth',
    title: 'Retail Buyer Push Strategy — Memorial Day 2026 Deadline',
    content: `USA Gummies has an aggressive timeline to get products into retail stores before Memorial Day (May 25, 2026). This is a strategic push because: (1) Memorial Day kicks off the summer health/wellness buying season. (2) Retailers set their summer planograms and promotional calendars 8-12 weeks in advance, meaning buyer meetings need to happen in March-April 2026. (3) Target retail channels: Independent health food stores, regional grocery chains, convenience stores, vitamin/supplement specialty retailers, pharmacies. (4) The approach: Direct outreach to retail buyers via email, phone, and in-person visits where possible. Faire marketplace for independent retailers (Faire handles payments and logistics for indie retail). Distributor partnerships (like UNFI, KeHE) for larger chain access — though distributor onboarding can take 3-6 months. (5) What buyers need to see: Sell sheet with product images, pricing, and margin structure. Suggested retail price (SRP) that gives retailers 40-50% margin. Case pack information, UPC codes, shelf dimensions. Any existing sales data (Amazon reviews, DTC traction) as social proof. (6) Wholesale pricing: Typically 50% off SRP for direct wholesale, 60-65% off SRP if going through a distributor (distributor takes 15-25% margin). (7) Terms: New brands often start with Net 30. Some retailers demand free fills or slotting fees.`
  },
  {
    dept: 'sales_and_growth',
    title: 'B2B Sales Process for CPG Retail',
    content: `How to sell a CPG product into retail stores: (1) Identify target accounts — make a list of stores that carry similar products (competitor audit on shelf). (2) Find the buyer — for chain retailers, this is a "Category Buyer" or "Category Manager" for vitamins/supplements. For independent stores, it's usually the owner or store manager. (3) Initial outreach — email with a concise pitch: who you are, what's the product, why it will sell in their store (local angle, trending category, competitive pricing, existing demand proof). (4) Buyer meeting — present your sell sheet, provide samples, discuss pricing/terms/minimum orders. (5) Trial order — many retailers start with a small trial order (1-2 cases) to test velocity. (6) Follow-up — after product is on shelf, support with demos, promotions, marketing, and check sell-through data. (7) Key metrics buyers care about: Velocity (units/store/week), margin, brand support (marketing, demos), turn rate, category trends. (8) For USA Gummies specifically: The "Made in USA" angle is strong for independent and regional retailers. Gummy format is the fastest-growing delivery format in supplements. Health-conscious consumers are the target demographic.`
  },

  // ── Company Operations ──
  {
    dept: 'operations',
    title: 'Running an Early-Stage CPG Company Effectively',
    content: `Key operational principles for running an early-stage CPG company like USA Gummies: (1) Cash is king — track cash position daily. A CPG company can be profitable on paper but run out of cash due to inventory timing. Know exactly how many weeks of cash runway you have at all times. (2) Inventory planning — forecast demand by channel, order inventory with enough lead time (8-12 weeks), but don't over-order. Dead inventory ties up cash and can expire. (3) Channel prioritization — focus on the channels with best unit economics first. DTC has highest margin but highest CAC. Amazon has built-in traffic but high fees (30-40% total). Wholesale has lowest margin but highest volume potential. (4) Weekly operating rhythm: Monday — review last week's sales by channel, check inventory levels, review cash position. Wednesday — marketing review, ad performance, content pipeline. Friday — supply chain check, outstanding POs, inbound shipments. (5) Monthly: close books, generate financial reports, review KPIs vs targets, plan next month's priorities. (6) Quarterly: strategic review, adjust annual plan, set next quarter OKRs. (7) Key hires to make as revenue grows: First hire should be either (a) marketing/sales person to drive revenue or (b) operations/fulfillment person to handle logistics. Don't hire for overhead functions (admin, finance) until revenue supports it — use tools and automation instead. That's exactly what Abra is for.`
  },
  {
    dept: 'operations',
    title: 'Operational KPIs for USA Gummies',
    content: `Critical KPIs that Abra should track and report on: (1) Revenue: Daily revenue by channel (Shopify DTC, Amazon, Wholesale/Faire). Weekly and monthly totals. Month-over-month growth rate. (2) Orders: Daily order count by channel, average order value (AOV), units per order. (3) Traffic: Website sessions (GA4), conversion rate, top traffic sources. Amazon sessions and conversion rate. (4) Inventory: Units on hand by SKU, weeks of supply remaining, units in transit, Amazon FBA inventory levels. (5) Cash: Bank balance, accounts receivable (outstanding invoices), accounts payable (bills due), projected cash position in 30/60/90 days. (6) Customer metrics: New vs returning customer ratio, customer acquisition cost by channel, email list size and growth rate. (7) Supply chain: Days of inventory on hand, lead time from co-packer, order fill rate. (8) Profitability: Gross margin by channel, contribution margin by channel, monthly burn rate (operating expenses), path to profitability timeline. (9) AI operations: Monthly AI spend (Abra target under $1K/month), brain entries count, feed health status, queries answered per day.`
  },

  // ── Funding Context ──
  {
    dept: 'finance',
    title: 'USA Gummies — Funding and Capital Structure',
    content: `USA Gummies is receiving $100,000 in funding (expected March 11, 2026). This is a significant milestone for the company. Key considerations for deploying this capital: (1) The $100K needs a clear allocation plan — how much goes to inventory (the biggest cash need for a CPG company), marketing/customer acquisition, operations/tech, and working capital reserve. (2) Inventory investment is critical — to supply retail orders for the Memorial Day push, manufacturing runs need to be ordered 8-12 weeks in advance, meaning POs to the co-packer need to go out in March 2026. (3) Marketing investment — allocate budget for Meta/Google ads for DTC, Amazon PPC, retail buyer outreach (samples, travel). (4) Working capital reserve — always keep 2-3 months of operating expenses in reserve. Never deploy 100% of funding into inventory or growth. (5) A pro forma financial model should project monthly revenue, expenses, and cash position for 12-18 months, showing how the $100K is deployed and when additional capital might be needed. Pro forma projections are estimates based on assumptions — they should be clearly labeled as projections, not actuals. (6) Financial discipline: Track actual vs projected monthly. Review variances. Adjust projections quarterly based on actuals.`
  },

  // ── Sales Channels ──
  {
    dept: 'sales_and_growth',
    title: 'USA Gummies Sales Channel Details',
    content: `USA Gummies sells through multiple channels: (1) DTC (Direct-to-Consumer) via Shopify storefront at usagummies.com — highest margin channel (~65% gross margin). Customer pays retail price, company handles fulfillment. Payment processing through Shopify Payments (2.9% + $0.30 per transaction). (2) Amazon — sells as a third-party FBA (Fulfillment by Amazon) seller. Amazon Seller ID: A16G27VYDSSEGO. Amazon takes approximately 15% referral fee + FBA fulfillment fees (~$3-5 per unit depending on size/weight) + storage fees. Effective margin after all Amazon fees is approximately 40%. Amazon provides massive traffic but less brand control. (3) Faire — wholesale marketplace for independent retailers. Faire handles payment processing, offers Net 60 terms to retailers, and provides logistics support. Commission is 25% on first order from a retailer, 15% on reorders. Good for reaching independent health food stores and boutiques. (4) Direct Wholesale — selling directly to retailers or distributors with Net 30/60 terms. Requires sales team effort but highest volume potential and no marketplace fees. Typical wholesale discount is 50% off SRP. (5) Each channel needs separate marketing strategy, pricing strategy, and fulfillment workflow.`
  },
  {
    dept: 'executive',
    title: 'USA Gummies Product Line',
    content: `USA Gummies product line consists of gummy vitamin and supplement products. All products are manufactured in the USA by FDA-registered, GMP-compliant contract manufacturers. Products are sold in bottles (typically 60-count). The product line targets health-conscious consumers who prefer the gummy delivery format over pills, capsules, or tablets. Gummy vitamins are the fastest-growing segment of the dietary supplement market. Key selling points: great taste, easy to take, made in USA, quality ingredients, proper dosing. All products carry a Supplement Facts panel as required by FDA regulations for dietary supplements. Products need UPC barcodes for retail and Amazon distribution.`
  },

  // ── Technology Stack ──
  {
    dept: 'operations',
    title: 'USA Gummies Technology Infrastructure',
    content: `USA Gummies technology stack (built and maintained by the founder): (1) Storefront: Next.js 15 on Vercel, Shopify Storefront API for product data and cart, custom checkout flow. (2) Ops Dashboard: 15-page internal dashboard at /ops/ with role-based access (admin, investor, employee, partner). Pages include: main dashboard, agents, alerts, channels, finance, forecast, inbox, KPIs, logs, marketing, pipeline, settings, supply chain, wholesale, and the Abra AI chat. (3) AI System (Abra): Custom AI assistant built on Claude (Anthropic) and OpenAI embeddings. Uses Supabase (PostgreSQL + pgvector) as the brain/knowledge store. Has 80+ agents across 8 engines handling B2B outreach, SEO, DTC optimization, supply chain, revenue intelligence, and more. (4) Integrations: Shopify Admin API, Amazon SP-API, Notion API (CRM), Google Analytics 4, Slack (notifications), Gmail SMTP (transactional email), Upstash (QStash scheduling + Redis state). (5) The Abra system is designed to scale the founder — automating operational tasks, tracking KPIs, detecting anomalies, and providing intelligent recommendations so one person can run the complexity of a multi-channel CPG operation.`
  },
];

// ═══════════════════════════════════════════════════════════
// Run all teachings
// ═══════════════════════════════════════════════════════════

async function main() {
  console.log(`\n🧠 ABRA EDUCATION — ${TEACHINGS.length} teachings to inject\n`);
  console.log('═'.repeat(60));

  let success = 0;
  let failed = 0;

  for (let i = 0; i < TEACHINGS.length; i++) {
    const t = TEACHINGS[i];
    const num = `[${i + 1}/${TEACHINGS.length}]`;
    process.stdout.write(`${num} ${t.dept.padEnd(18)} ${t.title.slice(0, 50).padEnd(52)} `);

    try {
      const id = await teach(t.dept, t.title, t.content);
      console.log(`✅ ${id?.slice(0, 8) || 'ok'}`);
      success++;
    } catch (err) {
      console.log(`❌ ${err.message.slice(0, 80)}`);
      failed++;
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`✅ Success: ${success}  ❌ Failed: ${failed}  📚 Total: ${TEACHINGS.length}`);
  console.log('═'.repeat(60) + '\n');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
