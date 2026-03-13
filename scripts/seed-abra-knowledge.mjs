#!/usr/bin/env node
/**
 * seed-abra-knowledge.mjs — One-time script to seed Abra's brain with
 * high-value domain knowledge entries. Each entry is embedded via the
 * Supabase `embed-and-store` edge function and stored in `open_brain_entries`.
 *
 * Usage: node scripts/seed-abra-knowledge.mjs
 *
 * Requires env vars (in .env.local or exported):
 *   SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync } from "fs";

// Load .env.local manually (no dotenv dependency needed)
try {
  const envFile = readFileSync(".env.local", "utf8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env.local may not exist — rely on exported env vars
}

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const EDGE_FN_URL = `${SUPABASE_URL}/functions/v1/embed-and-store`;

// ─── Knowledge Entries ───

const entries = [
  // === CPG Startup Playbook ===
  {
    title: "CPG Unit Economics Framework",
    category: "financial",
    department: "finance",
    tags: ["unit-economics", "cogs", "margin", "ltv", "cac"],
    raw_text: `CPG Unit Economics for Gummy/Confection Category:

COGS breakdown: Raw ingredients (30-40%), packaging (10-15%), co-packer labor (15-20%), freight-to-warehouse (5-8%). Target landed COGS for premium gummies: $3-5/unit retail.

Gross margin targets by channel:
- DTC (Shopify): 65-75% gross margin (highest, no trade spend)
- Amazon FBA: 40-55% after FBA fees + PPC
- Wholesale/Retail: 35-50% after trade spend + slotting

Key ratios:
- CAC (DTC): $8-15 for impulse purchase CPG, target <$12
- LTV: 2.5-4x first purchase for subscription/repeat buyers
- LTV:CAC ratio: minimum 3:1, target 4:1+
- Contribution margin after fulfillment: target >45% DTC, >25% wholesale

Break-even math: Fixed costs / contribution margin per unit = break-even units. For a funded CPG startup with $100K capital, aim for break-even within 6-9 months.`,
  },
  {
    title: "CPG Channel Strategy Playbook",
    category: "sales",
    department: "sales",
    tags: ["channels", "dtc", "wholesale", "amazon", "retail"],
    raw_text: `CPG Channel Strategy for Emerging Brands:

Phase 1 — DTC Foundation (months 1-3): Launch Shopify store, establish brand voice, build email list, validate product-market fit via direct customer feedback. Target: 50-200 orders/month.

Phase 2 — Amazon Expansion (months 2-5): FBA enrollment, optimized listings (A+ content, keyword-rich titles), PPC campaigns at 25-35% ACoS target. Use Amazon as discovery + validation. Target: $5K-15K/month.

Phase 3 — Wholesale Pipeline (months 3-8): Target independent retailers, specialty grocery, and natural food stores first (lower barrier than big box). Use DTC/Amazon traction as proof points. Trade spend budget: 15-25% of wholesale revenue.

Phase 4 — Retail Velocity (months 6-12): Once in stores, focus on velocity (units/store/week). Below 1 unit/store/week = risk of discontinuation. Run demos, cross-promote, manage shelf placement.

Channel conflict management: Maintain MAP (minimum advertised price) across channels. DTC should offer exclusive bundles/subscriptions, not undercut wholesale partners.`,
  },
  {
    title: "Retail Velocity & Trade Promotion Math",
    category: "sales",
    department: "sales",
    tags: ["retail", "velocity", "trade-spend", "promotions", "acv"],
    raw_text: `Retail Velocity & Trade Promotion for Emerging CPG Brands:

Key metrics:
- Velocity: units sold per store per week (target >1.5 for natural channel, >2.0 for conventional)
- ACV (All Commodity Volume): % of total category $ sold at stores carrying your product
- Distribution points: number of stores × SKUs per store
- Trade spend per unit: total trade dollars / units sold through trade
- Promo lift: ratio of promoted vs baseline velocity (healthy: 2-3x lift)

Slotting fees: $200-2,000/SKU for independent chains, $5K-50K for major retailers. Negotiate: free-fill (donate initial inventory instead of cash), guaranteed buyback, performance-based slots.

Promotion types ranked by ROI:
1. Demo/sampling (highest trial conversion, 15-25% in natural channel)
2. Temporary price reduction (TPR) — 20-30% off, drives 2-3x velocity
3. BOGO — highest volume lift but lowest margin
4. Digital coupon (Ibotta, retailer apps) — growing, trackable

Distributor margins: UNFI/KeHE take 25-30%. Your wholesale price should allow 40%+ gross margin after distributor cut.`,
  },
  {
    title: "Inventory Management for Small CPG",
    category: "supply_chain",
    department: "supply_chain",
    tags: ["inventory", "safety-stock", "reorder", "moq", "turns"],
    raw_text: `Inventory Management for Funded CPG Startups:

Formulas:
- Safety stock = Z-score × √(lead time) × demand std deviation. For 95% service level, Z=1.65.
- Reorder point = (avg daily demand × lead time days) + safety stock
- Economic order quantity (EOQ) = √(2 × annual demand × order cost / holding cost per unit)
- Inventory turns = COGS / average inventory value. Target: 6-12x/year for gummies (shelf-stable).
- Days of supply = current inventory / avg daily demand

Co-packer MOQ negotiation: Start with smallest MOQ possible (even at higher per-unit cost). As volume grows, negotiate down. Typical co-packer MOQs: 5,000-25,000 units for gummies.

Cash flow impact: Inventory ties up cash. With $100K capital, keep no more than 30-45 days of supply on hand. Use just-in-time ordering when possible. Factor in co-packer lead time (typically 2-4 weeks for gummies).

Shelf life management: Gummies typically 12-18 months. FIFO (first in, first out). Alert at 6 months remaining for retail, 4 months for wholesale (retailers won't accept <6 months).`,
  },
  {
    title: "Amazon FBA Strategy for CPG Brands",
    category: "market_intel",
    department: "sales",
    tags: ["amazon", "fba", "ppc", "listing", "marketplace"],
    raw_text: `Amazon FBA Strategy for Premium Gummy Brand:

Listing optimization:
- Title: Brand + Keyword + Count + Key Differentiator (e.g., "USA Gummies Dye-Free Gummy Bears 12oz - No Artificial Colors, Made in USA")
- Bullets: Lead with benefits, include keywords naturally, address objections
- A+ Content: Comparison chart vs competitors, lifestyle images, ingredient callouts
- Backend keywords: 250 bytes max, no commas needed, include misspellings

PPC strategy for launch:
- Week 1-2: Auto campaigns at $50-100/day, broad match to discover keywords
- Week 3-4: Harvest converting keywords into exact match campaigns
- Ongoing: Target ACoS of 25-35% (break-even is fine during launch for ranking)
- Sponsored Brands: Use once you have 3+ ASINs and brand registered

Key metrics:
- Session rate (click-through): target >0.3% (organic)
- Conversion rate: 10-15% for well-optimized CPG listing
- BSR (Best Seller Rank): track weekly, lower = better
- Review velocity: target 1-2 reviews/week minimum

Vine program: Enroll new ASINs immediately (up to 30 free units for reviews). Critical for launch velocity.`,
  },

  // === USA Gummies Specifics ===
  {
    title: "USA Gummies Company Profile",
    category: "company_info",
    department: "executive",
    tags: ["company", "team", "funding", "mission"],
    raw_text: `USA Gummies — Company Profile (Updated March 2026):

Mission: Premium, dye-free gummy bears made in America. "Better gummies for everyone."

Team:
- Ben Stutman (CEO/Sales) — handles sales pipeline, investor relations, strategy
- Andrew (Ops) — operations, supply chain, production coordination
- Rene (Finance) — bookkeeping, financial reporting, cash management

Funding: $102,800 total ($2,800 initial → $100K loan/investment). This is borrowing capital — every dollar must generate returns.

Production: Powers Confections, Spokane WA. Co-packing arrangement. Lead time ~2-3 weeks.

Positioning: Premium dye-free gummy bears in a market dominated by artificial colors. Target audience: health-conscious consumers, parents, natural food shoppers.

Growth target: 3-4x revenue within 3 months of funding. Operational motto: "Leaner, lighter, meaner, faster."

Current channels: Shopify DTC (usagummies.com), Amazon FBA, wholesale/B2B pipeline in development.`,
  },
  {
    title: "USA Gummies Product Line & SKU Details",
    category: "company_info",
    department: "supply_chain",
    tags: ["products", "skus", "gummies", "pricing"],
    raw_text: `USA Gummies Product Line:

Hero product: Dye-Free Gummy Bears — made with natural fruit juices and colors derived from fruits/vegetables. No Red 40, Blue 1, Yellow 5, or any synthetic dyes.

SKU structure:
- Standard sizes: single-serve (2oz), shareable (5oz), family (12oz), bulk (2lb)
- Shopify DTC pricing: premium positioning ($1-2 above conventional gummies)
- Amazon pricing: competitive with natural/organic gummy segment
- Wholesale pricing: 40-50% off MSRP to distributors

Key differentiators vs competition (Haribo, Trolli, Black Forest, SmartSweets):
1. Dye-free (biggest differentiator — parents care deeply about this)
2. Made in USA (vs imported from overseas)
3. Real fruit juice ingredients
4. Direct-to-consumer brand with story/transparency

Product development pipeline: seasonal flavors, sour variety, vitamin gummies (future SKU expansion after hero product establishes velocity).`,
  },
  {
    title: "USA Gummies Vendor & Partner Relationships",
    category: "company_info",
    department: "supply_chain",
    tags: ["vendors", "partners", "co-packer", "fulfillment"],
    raw_text: `USA Gummies Key Vendor Relationships:

Production:
- Powers Confections (Spokane, WA) — primary co-packer for all gummy products
- Relationship: contract manufacturing, minimum order quantities negotiated
- Lead time: approximately 2-3 weeks from PO to finished goods

Fulfillment:
- Shopify DTC: direct ship from warehouse
- Amazon FBA: ship to Amazon fulfillment centers per FBA requirements
- Wholesale: ship to distributor warehouses or direct-to-store

Technology stack:
- Shopify (storefront + order management)
- Amazon Seller Central (marketplace)
- Notion (CRM, operations, meeting notes, KPIs)
- Supabase (AI ops platform — Abra)
- Vercel (hosting)
- GA4 (analytics)

Banking: Relay (business banking). Plaid integration for cash flow monitoring.`,
  },

  // === Financial Operations ===
  {
    title: "Cash Flow Management for Funded Startup",
    category: "financial",
    department: "finance",
    tags: ["cash-flow", "burn-rate", "runway", "capital"],
    raw_text: `Cash Flow Management for a $100K Funded CPG Startup:

Capital deployment priorities:
1. Inventory (40-50%): Product is the business. Maintain 30-45 days supply.
2. Marketing/Customer Acquisition (20-30%): DTC ads, Amazon PPC, trade show attendance
3. Operations (10-15%): Packaging, shipping supplies, software tools
4. Reserve (10-15%): Emergency fund, unexpected costs, seasonal demand spikes

Burn rate monitoring:
- Weekly cash position check (every Monday)
- Monthly P&L review with projections
- 13-week rolling cash flow forecast
- Alert triggers: <$20K remaining (caution), <$10K (critical)

Revenue milestones to track:
- Month 1 post-funding: $5K-10K revenue (proving channels work)
- Month 2: $15K-25K (scaling what works)
- Month 3: $30K-50K (3-4x target range)

Key rule: This is BORROWED capital. Every expense must have a clear path to revenue generation. No nice-to-haves until revenue covers operating costs.`,
  },
  {
    title: "P&L Structure for CPG Startup",
    category: "financial",
    department: "finance",
    tags: ["p&l", "income-statement", "margins", "reporting"],
    raw_text: `Profit & Loss Structure for CPG/Gummy Business:

Revenue lines:
- Shopify DTC sales (gross minus Shopify transaction fees ~2.9% + 30¢)
- Amazon marketplace sales (gross minus FBA fees ~30-35%)
- Wholesale revenue (net of trade spend/allowances)

COGS (Cost of Goods Sold):
- Raw ingredients + manufacturing (co-packer invoice)
- Packaging materials
- Inbound freight (ingredients to co-packer)
- Outbound freight to warehouse

Gross Profit = Revenue - COGS (target: 55-70% blended across channels)

Operating Expenses:
- Marketing & advertising (Amazon PPC, Meta/Google ads, influencer)
- Shipping & fulfillment (DTC shipping, FBA prep)
- Software (Shopify, tools, subscriptions)
- Salaries/contractor payments
- Insurance, legal, accounting
- Travel & trade shows

Operating Income = Gross Profit - OpEx

Report format: Monthly P&L with prior month comparison and YTD totals. Include % of revenue for each line item.`,
  },

  // === Department Playbooks ===
  {
    title: "Sales Department Best Practices",
    category: "operational",
    department: "sales",
    tags: ["sales", "pipeline", "outreach", "closing"],
    raw_text: `Sales Department Playbook for USA Gummies:

B2B Pipeline Management:
- Stages: Lead → Qualified → Sample Sent → Negotiating → Closed Won / Lost
- Target: 20+ active prospects in pipeline at all times
- Follow-up cadence: Day 1 (intro), Day 3 (follow-up), Day 7 (value-add), Day 14 (check-in), Day 30 (re-engage or close)

Prospect targeting:
- Tier 1: Natural/specialty grocery (Whole Foods, Sprouts, Natural Grocers) — highest margin, best brand fit
- Tier 2: Independent retailers, co-ops, health food stores — lower barrier to entry
- Tier 3: Convenience stores, gas stations — volume play, lower margin
- Tier 4: Online retailers (Thrive Market, Vitacost) — DTC-adjacent

Outreach templates should include: personal hook, dye-free differentiator, made-in-USA angle, sampling offer, clear CTA.

Wholesale pricing structure: MSRP → Distributor price (50% off MSRP) → Retailer price (40% off MSRP). Maintain MAP policy.`,
  },
  {
    title: "Marketing Department SOPs",
    category: "operational",
    department: "marketing",
    tags: ["marketing", "content", "social", "email", "seo"],
    raw_text: `Marketing Department SOPs for USA Gummies:

Content pillars:
1. Dye-free education (why artificial dyes are bad, what we use instead)
2. Made in USA story (Powers Confections, American manufacturing)
3. Product usage (recipes, gift ideas, snacking occasions)
4. Behind the scenes (team, production, growth journey)

Channel strategy:
- Instagram/TikTok: Short-form video, UGC reposts, product showcases. Post 4-5x/week.
- Email: Welcome series (5 emails), monthly newsletter, abandoned cart, post-purchase review request
- Blog/SEO: Long-form content targeting "dye-free gummy bears", "best gummy bears", "natural candy" keywords
- Amazon: A+ content, storefront optimization, Vine reviews

Metrics to track weekly:
- Email list growth rate (target: 5-10% month-over-month)
- Social engagement rate (target: 3-5%)
- Blog organic traffic (track keyword rankings monthly)
- Conversion rate by channel (DTC target: 2-4%)

Budget allocation: 60% paid acquisition (Meta + Amazon PPC), 25% content creation, 15% tools/software.`,
  },
  {
    title: "Supply Chain Optimization",
    category: "operational",
    department: "supply_chain",
    tags: ["supply-chain", "production", "logistics", "optimization"],
    raw_text: `Supply Chain Optimization for USA Gummies:

Production planning:
- Monthly production forecast based on: trailing 30-day sales velocity + pipeline commitments + seasonal adjustments
- Reorder trigger: when inventory hits reorder point (see inventory management entry)
- Production batch sizing: balance MOQ constraints with cash flow — don't over-order

Quality control checkpoints:
1. Pre-production: ingredient specs verification
2. During production: in-line sampling (color, texture, weight)
3. Post-production: finished goods inspection before shipping
4. Warehouse receiving: count verification, damage check, lot tracking

Freight optimization:
- Consolidate shipments when possible (full pallet > partial pallet > parcel)
- Negotiate freight rates as volume increases (quarterly rate reviews)
- FBA inbound: use Amazon's partnered carrier program for discounted rates

Vendor scorecard (review quarterly):
- On-time delivery rate (target: >95%)
- Quality rejection rate (target: <2%)
- Price competitiveness (benchmark annually)
- Communication responsiveness`,
  },

  // === Agentic Architecture ===
  {
    title: "Abra's Department System Architecture",
    category: "system_log",
    department: "executive",
    tags: ["abra", "departments", "architecture", "ai-ops"],
    raw_text: `Abra Department System — How It Works:

Abra manages 20 departments, each with a specific operational domain:
executive, sales, marketing, finance, supply_chain, customer_success, product, analytics, legal, hr, engineering, quality, sustainability, partnerships, investor_relations, brand, logistics, procurement, research, competitive_intel

Each department can:
1. Receive messages/tasks via the chat interface
2. Log artifacts to Notion (meeting notes, reports, action items)
3. Track KPIs in the kpi_timeseries table
4. Run initiatives (multi-step projects with milestones)
5. Participate in cross-department strategy sessions

Department routing: When a user asks a question, Abra detects the relevant department(s) based on keywords, context, and intent. Multi-department queries trigger the strategy orchestrator for coordinated responses.

Action system: Abra has action handlers that execute real operations:
- send_email, send_slack, update_notion, create_notion_page, record_transaction
- search_shopify, analyze_financials, run_strategy
- Auto-exec policies allow low-risk actions to execute without human approval

Memory system: Brain entries (open_brain_entries) with vector embeddings enable RAG-powered recall of past decisions, knowledge, and context.`,
  },
  {
    title: "How to Use Abra Effectively",
    category: "system_log",
    department: "executive",
    tags: ["abra", "usage", "tips", "best-practices"],
    raw_text: `How to Use Abra — Tips for the USA Gummies Team:

Abra is an OPERATOR, not an advisor. Ask it to DO things, not just explain them.

Effective prompts:
- "Record the $500 payment to Powers Confections for March production" → creates transaction in Notion
- "Create a weekly sales report for this week" → generates report and saves to Notion
- "What's our pipeline look like?" → shows B2B pipeline snapshot with deal stages
- "Diagnose yourself" → runs self-diagnostics on all integrations and feeds
- "Draft an outreach email to Natural Grocers about our dye-free line" → drafts and queues email
- "What should our Amazon PPC budget be this month?" → gives data-backed recommendation

Department delegation:
- Start messages with department context for best results: "Sales: review our top 5 prospects"
- For cross-department initiatives: "Strategy: plan a Q2 retail launch across sales, marketing, and supply chain"

Artifacts: Abra automatically saves reports, meeting notes, and analyses to the appropriate Notion database. Every artifact gets a clickable link in the response.

Diagnostics: Ask "are you working?" or "system health" anytime to get a full status report on integrations, feeds, and brain health.`,
  },
];

// ─── Seed Logic ───

async function seedEntry(entry, index) {
  const record = {
    source_type: "manual",
    source_ref: `seed-abra-knowledge-${entry.category}-${index}`,
    entry_type: "research",
    title: entry.title,
    raw_text: entry.raw_text,
    summary_text: entry.title,
    category: entry.category,
    department: entry.department || "executive",
    confidence: "high",
    priority: "important",
    tags: entry.tags || [],
    processed: true,
  };

  const res = await fetch(EDGE_FN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ table: "open_brain_entries", record }),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (res.ok) {
    console.log(`✅ [${index + 1}/${entries.length}] ${entry.title} → id=${data.id}`);
  } else {
    console.error(`❌ [${index + 1}/${entries.length}] ${entry.title} — ${res.status}: ${text.slice(0, 200)}`);
  }

  // Rate limit: 1 entry per second to avoid OpenAI rate limits
  await new Promise((r) => setTimeout(r, 1200));
}

async function main() {
  console.log(`\n🧠 Seeding Abra brain with ${entries.length} knowledge entries...\n`);
  console.log(`   Edge function: ${EDGE_FN_URL}`);
  console.log(`   Supabase URL: ${SUPABASE_URL}\n`);

  for (let i = 0; i < entries.length; i++) {
    await seedEntry(entries[i], i);
  }

  console.log(`\n✅ Done. ${entries.length} entries seeded.\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
