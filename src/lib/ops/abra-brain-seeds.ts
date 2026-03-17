import { generateEmbedding } from "@/lib/ops/abra-embeddings";

type BrainSeed = {
  title: string;
  text: string;
  tags: string[];
};

const CPG_SEEDS: BrainSeed[] = [
  {
    title: "COGS Lifecycle Stages",
    text: `The COGS (Cost of Goods Sold) lifecycle has 5 stages:
1. QUOTE — vendor provides a price estimate. This is Stage 1, a projected cost only. Record it but never treat it as actual.
2. PURCHASE ORDER (PO) — we commit to buy at the quoted price. Cost is committed but not yet incurred.
3. INVOICE — vendor bills us. Compare invoice to PO (first leg of three-way match). Cost is now accrued.
4. PAYMENT — we pay the invoice. Compare payment to invoice and PO (three-way match complete). Cash outflow recorded in bank transactions.
5. HARD COGS — PO amount, invoice amount, and payment all reconcile. This is the ACTUAL cost of goods. Only Hard COGS should be used in P&L calculations.
Three-way match rule: If PO says $10,000, invoice says $10,250, and payment is $10,250 — flag the $250 variance. The invoice/payment amount becomes the hard COGS, but the variance should be investigated.
For CPG startups, stages often compress: a small vendor may not issue formal POs, so the lifecycle is Quote → Invoice → Payment → Hard COGS.`,
    tags: ["cpg", "cogs", "lifecycle", "accounting", "reference"],
  },
  {
    title: "Unit Economics Cascade for Gummies",
    text: `Unit economics cascade for a gummy candy product:
RAW MATERIAL COST: Ingredients (gelatin/pectin, sugar, flavors, colors, vitamins) + packaging materials (bags, boxes, labels) per unit.
LANDED COST: Raw material + inbound freight + import duties (if sourcing internationally) per unit.
COGS: Landed cost + co-packer manufacturing fee + labor allocation + quality assurance per unit. For USA Gummies, Powers Confections charges a per-unit co-packing fee that includes labor.
GROSS MARGIN: (Revenue - COGS) / Revenue. Target 50-65% for premium gummies. If below 45%, pricing or cost structure needs work.
CONTRIBUTION MARGIN: Gross margin minus variable selling costs. These vary by channel:
  - DTC: payment processing (2.9%+$0.30), outbound shipping ($3-6), packaging ($0.50-1.50), customer acquisition (PPC/social)
  - Amazon: referral fee (15%), FBA fee ($3-5/unit), storage, PPC, inbound shipping to FBA warehouse
  - Wholesale: trade spend ($1-3/unit), freight allowance (3-5%), slotting fees (one-time), broker commission (3-5%)
NET MARGIN: Contribution margin minus allocated fixed costs (rent, salaries, insurance, software, G&A).
Key insight: A product with 60% gross margin can have negative net margin on Amazon if FBA+PPC+referral fees exceed 60%.`,
    tags: ["cpg", "unit_economics", "margin", "reference"],
  },
  {
    title: "Channel Margin Structures",
    text: `Three primary sales channels for CPG, each with different margin structures:
DTC (SHOPIFY): Highest gross margin (50-70%). Costs: COGS + payment processing (Shopify Payments 2.9%+$0.30) + outbound shipping ($3-6 depending on carrier/zone) + packaging + CAC (customer acquisition). Advantages: brand control, customer data, full margin. Challenges: traffic acquisition cost, fulfillment complexity.
AMAZON FBA: Revenue minus COGS minus referral fee (15% of selling price) minus FBA fulfillment fee ($3-5 based on size/weight tier) minus monthly storage ($0.75-2.40/cu ft) minus PPC advertising (target ACoS < 30%) minus inbound shipping to FBA. Net contribution typically 10-25% after all fees. Advantages: massive traffic, Prime badge, trust. Challenges: fee erosion, price competition, limited brand building.
WHOLESALE/RETAIL: Revenue is 40-50% off suggested retail (SRP). Margin: revenue minus COGS minus trade spend (promotions, $1-3/unit) minus freight allowance (3-5% of invoice) minus slotting fees (one-time, $5K-25K per SKU per chain) minus broker commission (3-5%). Net contribution 15-30%. Key metric: velocity (units/store/week). Below 1.5 units/store/week = risk of delisting.
CRITICAL RULE: Never report a "blended margin." Always decompose by channel. A blended 45% margin could mask a -5% Amazon loss subsidized by 70% DTC margin.`,
    tags: ["cpg", "channels", "margin", "dtc", "amazon", "wholesale", "reference"],
  },
  {
    title: "Production Run Tracking Protocol",
    text: `How to track a production run for cost accounting:
1. BEFORE THE RUN: Collect vendor quotes for all inputs (ingredients, packaging, co-packer fee, freight). Record each as a vendor quote with the COGS stage "quote." Calculate a PROJECTED cost per unit.
2. DURING/AFTER THE RUN: Record the production run with: manufacturer name, run date, SKUs produced, total units ordered, total units received, total cost. The system calculates yield rate and cost per unit.
3. YIELD TRACKING: Yield = units received / units ordered. Typical gummy manufacturing yield: 92-98%. If yield drops below 90%, investigate with the co-packer. Low yield directly increases per-unit cost.
4. COST PER UNIT: total_run_cost / units_received. This is the ACTUAL COGS for this batch. It supersedes any previous estimates or quotes.
5. MULTIPLE CONCURRENT RUNS: Each run gets its own cost calculation. Different runs may have different costs due to ingredient price changes, volume differences, or yield variations. Track separately and use weighted average for blended COGS reporting.
6. COST COMPONENTS: Break down total run cost into: raw materials (40-55% typical), packaging (8-15%), co-packer fee (15-25%), inbound freight (3-8%), waste/shrinkage allowance (2-10%). This breakdown helps identify which cost lever to pull for margin improvement.`,
    tags: ["cpg", "production", "manufacturing", "cogs", "reference"],
  },
  {
    title: "Cash Conversion Cycle for CPG",
    text: `The Cash Conversion Cycle (CCC) measures how long it takes to convert cash invested in inventory back into cash from sales.
FORMULA: CCC = IDO + RDO - PDO
IDO (Inventory Days Outstanding) = Average Inventory Value / Daily COGS. How many days inventory sits before selling. For gummies: 30-60 days typical (production + shipping + warehouse + channel).
RDO (Receivable Days Outstanding) = Average Accounts Receivable / Daily Revenue. How long until we get paid. DTC: 0 days (instant). Amazon: 14 days (biweekly disbursement). Wholesale: 30-60 days (Net-30 or Net-60 terms).
PDO (Payable Days Outstanding) = Average Accounts Payable / Daily Purchases. How long we take to pay vendors. Typical: 15-30 days for ingredient suppliers, COD for some small vendors.
FOR CPG STARTUPS: CCC is typically 45-90 days. This means: you pay for a production run today, and the cash from selling those units doesn't come back for 45-90 days. A $50K production run with 60-day CCC means you need $50K in working capital that's "locked up" for 2 months.
CASH FLOW IMPLICATION: Production runs require upfront payment 4-8 weeks before revenue arrives. As you scale, CCC creates a cash gap: faster growth = more working capital needed = more cash locked in inventory. This is the #1 reason CPG startups run out of cash despite growing revenue.
IMPROVING CCC: Negotiate longer payment terms with vendors (increase PDO), reduce inventory holding time (decrease IDO), offer early-pay discounts to wholesale customers (decrease RDO), or use supply chain financing.`,
    tags: ["cpg", "cash_flow", "working_capital", "reference"],
  },
  {
    title: "Scenario Planning Framework",
    text: `Scenario planning for CPG operations — how to model "what if" questions:
STRUCTURE: Always present three cases: Base (most likely), Upside (optimistic), Downside (pessimistic).
5 VARIABLES TO FLEX:
1. Ingredient/Input Costs: ±10-20%. Sugar, gelatin, pectin prices fluctuate. New supplier quotes can shift costs significantly.
2. Production Volume: MOQ step changes (5K → 10K → 25K → 50K units). Volume typically reduces per-unit cost 8-20% per step.
3. Channel Mix: Shift between DTC (high margin), Amazon (high volume), Wholesale (scale). Each has different margin profiles.
4. Pricing: ±5-15%. Test price sensitivity. A 10% price increase with 5% volume drop can improve total margin.
5. Demand: ±20-50%. Seasonality, marketing campaigns, retail placement wins/losses.
FOR EACH SCENARIO, SHOW: Revenue impact, COGS impact, gross margin %, contribution margin $, cash flow timing impact, break-even unit volume.
RULES: Label every scenario "HYPOTHETICAL — not a forecast." Base at least one input on real data (current COGS, actual pricing, real volume). State which inputs are measured and which are assumed. Never present scenarios as projections or predictions. Scenarios are decision tools, not crystal balls.
EXAMPLE: "What if ingredient costs rise 15%?" → Base: COGS $1.35/unit, 10K units, revenue $50K. Scenario: COGS $1.55/unit (+$0.20). Impact: Total COGS +$2,000 (+14.8%), gross margin drops from 59.4% to 54.4%. Decision: absorb, pass to consumer, or find alternative supplier?`,
    tags: ["cpg", "scenario", "planning", "strategy", "reference"],
  },
  {
    title: "CPG KPI Hierarchy",
    text: `CPG Key Performance Indicators organized by frequency:
DAILY (Foundational — check every morning):
• Revenue by channel (Shopify, Amazon, wholesale POs)
• Order count and units sold
• Average Order Value (AOV)
• Ad spend (total and by platform)
• Inventory position (units on hand by SKU and location)
WEEKLY (Operational — review in Monday planning):
• Sell-through rate: units sold / (units sold + units in stock). Target > 60% for first 30 days of new inventory.
• ROAS (Return on Ad Spend): revenue / ad spend. Target > 3x for profitability.
• CAC (Customer Acquisition Cost): total marketing spend / new customers. Must be < 1/3 of LTV.
• Channel mix %: what % of revenue comes from each channel. Watch for over-dependence on one channel.
• Days-of-supply by SKU: current inventory / avg daily sales. Reorder when < lead time + safety stock days.
MONTHLY (Strategic — board/investor level):
• Gross margin % by channel and blended
• Contribution margin % by channel
• LTV:CAC ratio (target > 3:1)
• Cash runway (months of cash at current burn rate)
• Production cost variance: planned vs actual COGS per unit for latest run
QUARTERLY (Executive):
• Customer retention / repeat purchase rate
• Wholesale velocity: units/store/week (target > 1.5 to avoid delisting risk)
• Category share trends (% of gummy/candy category)
• Working capital efficiency: CCC trend, inventory turns`,
    tags: ["cpg", "kpi", "metrics", "reference"],
  },
  {
    title: "MOQ and Volume Economics",
    text: `Minimum Order Quantities (MOQ) and volume pricing create step-function cost curves in CPG:
HOW IT WORKS: Suppliers and co-packers have minimum batch sizes. Going from one tier to the next drops per-unit cost, but increases total cash outlay. Example:
• 5,000 units: $1.80/unit = $9,000 total
• 10,000 units: $1.50/unit = $15,000 total (17% cost reduction, but $6K more cash needed)
• 25,000 units: $1.25/unit = $31,250 total (31% cost reduction, but $22K more cash)
• 50,000 units: $1.10/unit = $55,000 total (39% cost reduction, but $46K more cash)
THE TRAP: Ordering more units to get a lower per-unit cost only works if you can sell them before they expire or become obsolete. Gummies typically have 12-18 month shelf life. Ordering 50K units at $1.10/unit saves $35K vs 50K at $1.80/unit — but if you can only sell 20K before expiry, you lose $33K in dead inventory.
DECISION FRAMEWORK: 1) Calculate months-of-supply at each MOQ tier. 2) If > 9 months supply, the MOQ is too high — negotiate down or accept higher per-unit cost. 3) Factor in warehousing cost for holding excess inventory (~$0.50-1.00/pallet/day). 4) Consider cash opportunity cost: $46K locked in inventory for 6+ months = $46K you can't spend on marketing or other growth.
NEGOTIATION: Co-packers often have softer MOQs than stated. Start at their minimum, prove consistent ordering, then negotiate volume pricing at your actual order cadence.`,
    tags: ["cpg", "moq", "volume", "pricing", "reference"],
  },
  {
    title: "Trade Spend and Slotting Fees",
    text: `Trade spend is the hidden margin killer in CPG — money spent to get products placed and promoted in retail/wholesale channels:
TYPES OF TRADE SPEND:
• Slotting Fees: One-time payment to retailer for shelf space. $5K-25K per SKU per retailer chain. Non-refundable even if product fails. Smaller/natural retailers often waive these.
• Scan-Based Trading: Payment per unit scanned at register (sold). Alternative to slotting for some retailers. Typically $0.50-2.00/unit.
• Promotional Allowances: Temporary price reductions funded by manufacturer. "Buy one get one" or "$1 off" — manufacturer absorbs the discount. Can be 15-30% of revenue during promotions.
• Free Fills: Free cases for initial shelf stocking. Typically 1-2 cases per SKU per store.
• MCB (Manufacturer Chargeback): Retailer deducts fees from payments for damaged goods, late deliveries, labeling errors, etc.
WHY IT MATTERS: Trade spend typically runs 15-25% of wholesale revenue for established CPG brands, 30-40% for new brands trying to gain distribution. This is SEPARATE from COGS — it's a selling expense. A product with 50% gross margin can have 15% contribution margin after trade spend.
TRACKING: Trade spend should be tracked per retailer, per promotion, per SKU. Calculate trade spend ROI: incremental revenue from promotion / trade spend cost. Target > 2x ROI.
FOR USA GUMMIES: Early-stage strategy should focus on retailers with low/no slotting fees (natural grocers, co-ops, specialty stores, Faire) before investing in high-slotting-fee chains.`,
    tags: ["cpg", "trade_spend", "retail", "wholesale", "reference"],
  },
  {
    title: "Inventory Valuation Methods",
    text: `How to value inventory for COGS accuracy — critical when production runs have different costs:
FIFO (First In, First Out): Oldest inventory is sold first. COGS reflects the cost of the earliest production run still in stock. Best for gummies (perishable, sell oldest first). Example: Run 1 produced at $1.35/unit, Run 2 at $1.50/unit. Selling from Run 1 until depleted, then Run 2. COGS starts at $1.35, then jumps to $1.50.
WEIGHTED AVERAGE: All units in stock are valued at the average cost across all runs. Better for non-perishable goods or when runs are frequent. Example: 5,000 units at $1.35 + 10,000 units at $1.50 = blended cost of $1.45/unit ($21,750 / 15,000 units). Every unit sold costs $1.45 regardless of which run it came from.
FOR USA GUMMIES: Use FIFO for actual inventory management (sell oldest first for freshness), but weighted average for planning/budgeting (simpler, smooths out per-run cost fluctuations).
STANDARD COST: Set a predetermined "standard" COGS per unit at the beginning of a period (e.g., $1.40/unit). Actual vs standard variance is tracked separately. Useful for budgeting and identifying cost overruns. If actual comes in at $1.55 vs standard $1.40, the $0.15 unfavorable variance triggers investigation.
COST LAYERS: When multiple production runs overlap in inventory, maintain a "cost layer" for each run. This is especially important when ingredient prices are volatile — a run done in January at $1.30/unit and one in April at $1.60/unit have very different margin implications.`,
    tags: ["cpg", "inventory", "valuation", "accounting", "reference"],
  },
];

const AMAZON_ADS_SEEDS: BrainSeed[] = [
  {
    title: "Amazon PPC Campaign Structure — USA Gummies",
    text: `USA Gummies Amazon Sponsored Products campaign structure as of March 17, 2026:
ACTIVE CAMPAIGNS (3 campaigns, combined daily budget $55):
1. USG-Auto-Discovery — Automatic targeting, $25/day budget, Dynamic bids up+down. Default bid $0.75. Top of search placement +50%, Product pages +25%. Purpose: keyword harvesting — discover converting search terms, then graduate winners to manual campaigns. Has 16 negative phrase-match keywords to block wasteful spend (vitamins, supplement, CBD, melatonin, THC, delta, weight loss, protein, keto, collagen, ashwagandha, probiotic, sugar free, vegan, organic, kids vitamins).
2. USG-Manual-Exact — Manual exact-match keywords, $15/day budget, Dynamic bids up+down. Top of search +50%, Product pages +25%. Contains 25 exact-match keywords with competitive bids ($0.45–$3.07). Targets high-intent searches like "gummy bears," "dye free gummy bears," "natural gummy candy," "candy without artificial colors." Purpose: capture high-intent, proven-converting search terms with exact control.
3. USG-Product-Targeting — Manual product targeting, $15/day budget, Dynamic bids up+down. Top of search +50%, Product pages +25%. Targets 1 category (Gummy Candies, $0.43 bid) and 5 competitor ASINs: Black Forest Organic (B06Y6485FQ, $1.62), Black Forest Juicy Burst (B01N39RV0A), Haribo Goldbears (B01LY311CG, $1.12), NERDS Gummy Clusters (B09M1NZ92V, $3.08), YumEarth Organic (bid $1.76). Purpose: conquest — show ads on competitor product pages and in category browse.
PAUSED CAMPAIGNS (1):
4. USG-Manual-Phrase — Paused on March 17, 2026. Was consuming most of the budget with worst ROAS. Phrase-match was too broad, capturing low-intent queries.
ASIN: B0G1JK92TJ (USA Gummies Dye Free Gummy Bears)
Seller ID: A16G27VYDSSEGO, Entity ID: ENTITYM75K6QB0JZKO
BUDGET ALLOCATION: Pro-forma $6K March, $5K April, $4K May for Amazon PPC total. Daily budget ~$55/day = ~$1,700/month, well within allocation.`,
    tags: ["amazon", "ppc", "campaigns", "advertising", "reference"],
  },
  {
    title: "Amazon PPC Optimization Playbook",
    text: `Weekly Amazon PPC optimization protocol for USA Gummies:
DAILY CHECKS:
• Total spend vs daily budget (are campaigns spending fully? Under-delivery = bids too low)
• ACoS by campaign (target < 30% blended)
• Any campaign paused or budget-capped early in the day
WEEKLY OPTIMIZATION (every Monday):
1. SEARCH TERM REPORT: Pull from USG-Auto-Discovery. Find terms with 3+ clicks and a sale → add as exact match to USG-Manual-Exact. Find terms with 10+ clicks and 0 sales → add as negative exact to Auto-Discovery.
2. BID ADJUSTMENTS: For USG-Manual-Exact keywords — if ACoS > 35%, reduce bid 10-15%. If ACoS < 20% and impressions are low, increase bid 10-20% to capture more volume. Use Amazon's suggested bid range as a guide.
3. PRODUCT TARGETING REVIEW: Check USG-Product-Targeting — which competitor ASINs are converting? Increase bids on winners, pause losers after 2 weeks of data.
4. BUDGET REALLOCATION: Move budget from low-ROAS campaigns to high-ROAS. If Auto-Discovery is finding lots of winners, give it more budget temporarily.
MONTHLY REVIEW:
• Evaluate overall ACoS vs 30% target
• Check TACoS (Total ACoS = ad spend / total revenue including organic). Target < 15%.
• Assess if PPC is driving organic rank improvement (organic sales should grow over time as PPC boosts velocity)
• Compare to pro-forma budget allocation ($6K Mar, $5K Apr, $4K May)
KEY METRICS: ACoS (ad spend / ad revenue), ROAS (ad revenue / ad spend), TACoS (ad spend / total revenue), CPC (cost per click), CTR (click-through rate, target > 0.3%), Conversion Rate (target > 10% for exact match).
BIDDING STRATEGIES:
• Dynamic bids up+down: Amazon adjusts bid ±100% based on likelihood of conversion. Best for established campaigns with conversion data.
• Fixed bids: Use for testing new keywords where you want predictable spend.
• Placement adjustments: Top of search +50% is aggressive but effective — top of search has 2-3x higher conversion rate.`,
    tags: ["amazon", "ppc", "optimization", "playbook", "reference"],
  },
];

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Missing Supabase credentials");
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase ${res.status}: ${body.slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function seedCPGBrainEntries(): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  const ALL_SEEDS = [...CPG_SEEDS, ...AMAZON_ADS_SEEDS];
  for (const seed of ALL_SEEDS) {
    // Check if entry already exists by title
    const existing = (await sbFetch(
      `/rest/v1/open_brain_entries?title=eq.${encodeURIComponent(seed.title)}&select=id&limit=1`,
    )) as Array<{ id: string }>;

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    // Generate embedding
    const embedding = await generateEmbedding(`${seed.title}: ${seed.text.slice(0, 7000)}`);

    // Insert brain entry
    await sbFetch("/rest/v1/open_brain_entries", {
      method: "POST",
      headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
      body: JSON.stringify({
        source_type: "agent",
        source_ref: "cpg_seed",
        entry_type: "teaching",
        title: seed.title,
        raw_text: seed.text,
        summary_text: seed.text.slice(0, 500),
        category: "teaching",
        department: "operations",
        confidence: "high",
        priority: "normal",
        processed: true,
        tags: seed.tags,
        embedding,
      }),
    });

    created++;
  }

  return { created, skipped };
}
