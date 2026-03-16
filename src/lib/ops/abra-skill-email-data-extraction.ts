/**
 * Abra Skill: Email Data Extraction & Classification
 *
 * Teaches Abra agents how to find, extract, and classify financial and
 * operational data from email threads. This skill codifies the methodology
 * used to populate product_config COGS data from supplier emails.
 *
 * Usage:
 *   import { EMAIL_EXTRACTION_SKILL } from "@/lib/ops/abra-skill-email-data-extraction";
 *   // Inject into LLM system prompt when Abra needs to extract data from emails
 */

// ---------------------------------------------------------------------------
// Skill Definition
// ---------------------------------------------------------------------------

export const EMAIL_EXTRACTION_SKILL = {
  name: "email_data_extraction",
  version: "1.0.0",
  description: "Find, extract, and classify financial/operational data from email threads",

  /**
   * The full skill prompt — inject into system context when Abra needs to
   * pull data from emails (e.g., updating COGS, finding freight quotes,
   * extracting pricing from supplier correspondence).
   */
  prompt: `
## Skill: Email Data Extraction & Classification

You are extracting financial and operational data from email threads. Follow this methodology precisely.

### Step 1: Identify Data Sources by Relationship Type

Search emails using these relationship categories and known contacts:

**SUPPLIERS (cost data — what we pay)**
- Albanese Confectionery (Bill Thurner, BillT@albaneseconfectionery.com) — bulk candy pricing, freight quotes
- Belmark Inc (Jonathan Reimer, Joe Gagliardi) — packaging film pricing, art prep fees
- Powers Inc (Greg Kroetch, gregk@powers-inc.com) — co-packing labor rates, production specs
- Dutch Valley Foods (Bill Yoder, Devon Martin) — East Coast packing, film quotes (legacy partner)

**DISTRIBUTORS (revenue data — what they pay us)**
- Inderbitzin Distributors (Brent Overman, brento@inderbitzin.com) — wholesale pricing, volume commitments
- Faire marketplace — wholesale account orders
- Mitchell & Company (Reid Mitchell) — broker/rep relationships

**INTERNAL (projections, models, strategy)**
- Ben → Rene Gonzalez — Pro Forma models with consolidated unit economics
- Ben → Andrew Slater — forwarded supplier/distributor threads with commentary

### Step 2: Search Strategy (Multi-Pass)

Never rely on a single search. Use layered queries:

1. **By sender**: \`from:gregk@powers-inc.com\` — gets all messages from a known contact
2. **By subject keywords**: \`subject:credit application\` OR \`subject:film order\`
3. **By financial terms**: \`price per pound\` OR \`quote\` OR \`invoice\` OR \`cost per unit\`
4. **By product terms**: \`50270\` (Albanese SKU), \`gummy\`, \`film\`, \`packing fee\`
5. **By forwarded threads**: \`from:ben@usagummies.com to:andrew@usagummies.com\` — Ben often forwards supplier emails to Andrew with context

Read the FULL thread — pricing is often buried in reply chains, not the most recent message.

### Step 3: Extract & Normalize Data Points

For each data point found, capture:

| Field | Description | Example |
|-------|-------------|---------|
| **value** | The number | 0.350 |
| **unit** | Per-what | per unit, per lb, per 1000 impressions |
| **currency** | Always USD unless stated | USD |
| **source_contact** | Who provided it | Greg Kroetch, Powers Inc |
| **source_date** | Email date | 2026-02-20 |
| **context** | Quote vs invoice vs estimate | quote |
| **conditions** | Volume brackets, FOB terms | FOB Spokane, 10K-50K bags |
| **thread_subject** | For traceability | RE: Credit Application |

**Normalization rules:**
- Always convert to per-unit cost (our unit = 1 bag/pouch of gummy bears)
- If quoted per-lb: multiply by oz-per-bag (7.5 oz = 0.46875 lb), then divide
- If quoted per-case: divide by units-per-case (36 units/case for Powers)
- If quoted per-1000-impressions: divide by 1000
- Round to 3 decimal places

### Step 4: Classify Data Status

**CRITICAL DISTINCTION — this is the most important step:**

| Status | Meaning | When to use |
|--------|---------|-------------|
| **QUOTED** | Supplier gave us a price, but we haven't paid | Email contains "quote", pricing discussion, no PO/payment confirmation |
| **INVOICED** | We received an invoice but haven't paid yet | Email contains attached invoice, "please see attached invoice" |
| **PAID** | Invoice paid, money left the bank | Payment confirmation, ACH transfer complete, bank statement match |
| **ESTIMATED** | We calculated this, not from supplier | Derived from Pro Forma model, internal projection |

**Default to QUOTED unless there is explicit evidence of payment.** A supplier sending pricing information is ALWAYS a quote until we pay. Even if Ben says "let's do it" or "sounds great" — that's intent to buy, not payment.

**How to verify PAID status:**
- Cross-reference with bank ledger (\`financial_ledger\` table in Supabase)
- Look for ACH confirmation emails
- Check for "payment received" replies from supplier
- If none found → it's QUOTED, not PAID

### Step 5: Handle Bracket/Volume Pricing

Suppliers often quote tiered pricing. Capture ALL tiers:

Example (Albanese candy):
- 19,440–37,259 lbs → $1.96/lb
- 37,260+ lbs → $1.92/lb

Store the tier that matches our CURRENT order size, but note higher-volume pricing for future reference.

### Step 6: Handle Freight Separately

Freight is NOT part of COGS in the Pro Forma model — it's a separate line item. But for landed cost analysis, we need both.

**Freight data points to extract:**
- Total freight cost (e.g., $5,852.50)
- Route (origin → destination, e.g., Merrillville IN → Spokane WA)
- Pallet count and weight
- Per-unit freight (total / units produced)
- Whether FOB origin or FOB destination

**Freight alternatives to flag:**
- Self-pickup (Ben has driven IN→WA before, ~$2,500 vs $5,852 carrier)
- Supplier-arranged vs third-party carrier
- Consolidated shipping with other orders

### Step 7: Output Format

When storing extracted data to \`product_config\` in Supabase:

\`\`\`json
{
  "config_key": "cogs_candy_per_unit",
  "config_value": "0.919",
  "config_type": "number",
  "description": "QUOTED — Albanese SKU 50270, $1.96/lb at 23,400 lbs (Bill Thurner, Mar 11 2026)",
  "updated_by": "abra-claude-quoted"
}
\`\`\`

**Description format:** \`{STATUS} — {what} {price basis} ({source contact}, {date})\`
**updated_by format:** \`abra-claude-{status}\` where status = quoted|invoiced|paid|estimated

### Step 8: Cross-Reference & Validate

After extraction, validate against:
1. **Pro Forma model** — do extracted costs match the model? If not, flag the discrepancy
2. **Other email threads** — same supplier may quote different prices in different threads (use most recent)
3. **Production specs** — Greg at Powers confirmed 49,920 units from 13 pallets, 53,760 from 14 pallets. Use these to validate per-unit math
4. **Bank ledger** — if we claim something is PAID, it must appear in the ledger

### Known Contacts & Their Data Types

| Contact | Company | Data They Provide |
|---------|---------|-------------------|
| Bill Thurner | Albanese | Candy pricing (per-lb brackets), freight quotes, PO confirmations |
| Greg Kroetch | Powers Inc | Packing labor rates, production specs (pallets→units), lead times |
| Jonathan Reimer | Belmark | Film pricing (per-impression), art prep fees, die line specs |
| Joe Gagliardi | Belmark | Film specs, printing process (digital vs flexo) |
| Bill Yoder | Dutch Valley | Legacy packing costs, film quotes (2025 production) |
| Devon Martin | Dutch Valley | Film pricing tiers, SVP Manufacturing |
| Brent Overman | Inderbitzin | Wholesale pricing ($2.10/unit), clip strip structure, PO format |
| Reid Mitchell | Mitchell & Co | Broker intel, retailer buyer relationships |

### Anti-Patterns (What NOT to Do)

1. **Don't assume a quote = paid cost.** This was a real mistake — we treated supplier quotes as actual COGS. They're not actual until the invoice is paid.
2. **Don't ignore freight.** The Pro Forma showed $1.413/unit COGS but freight adds $0.109/unit — that's a 7.7% hidden cost.
3. **Don't use stale pricing.** Dutch Valley 2025 prices ≠ Powers 2026 prices. Always use most recent quote from current supplier.
4. **Don't round prematurely.** Keep 3 decimal places in per-unit costs. Rounding errors compound across 50K+ units.
5. **Don't conflate FOB origin vs destination.** Albanese quotes FOB Merrillville — freight to Spokane is our cost on top.
`.trim(),
};

// ---------------------------------------------------------------------------
// Helpers for agents that use this skill
// ---------------------------------------------------------------------------

export type ExtractedCostData = {
  config_key: string;
  value: number;
  unit: string;
  status: "quoted" | "invoiced" | "paid" | "estimated";
  source_contact: string;
  source_date: string;
  conditions?: string;
  thread_subject?: string;
};

export type CostClassification = {
  component: "candy" | "film" | "packing" | "freight" | "other";
  is_cogs: boolean; // freight is NOT cogs in our model
  per_unit: number;
  total_for_run?: number;
};

/**
 * Known supplier contacts — used by agents to identify cost-relevant emails.
 */
export const SUPPLIER_CONTACTS = [
  { name: "Bill Thurner", email: "billt@albaneseconfectionery.com", company: "Albanese Confectionery", provides: ["candy_pricing", "freight_quotes"] },
  { name: "Greg Kroetch", email: "gregk@powers-inc.com", company: "Powers Inc", provides: ["packing_labor", "production_specs"] },
  { name: "Jonathan Reimer", email: "jonathan.reimer@belmark.com", company: "Belmark Inc", provides: ["film_pricing", "art_prep"] },
  { name: "Joe Gagliardi", email: "joe.gagliardi@belmark.com", company: "Belmark Inc", provides: ["film_specs", "printing_process"] },
  { name: "Bill Yoder", email: "wyoder@dutchvalleyfoods.com", company: "Dutch Valley Foods", provides: ["legacy_packing", "film_quotes"] },
  { name: "Devon Martin", email: "dwmartin@dutchvalleyfoods.com", company: "Dutch Valley Foods", provides: ["film_pricing_tiers"] },
] as const;

/**
 * Known distributor contacts — used by agents to identify revenue-relevant emails.
 */
export const DISTRIBUTOR_CONTACTS = [
  { name: "Brent Overman", email: "brento@inderbitzin.com", company: "Inderbitzin Distributors", provides: ["wholesale_pricing", "volume_commitments"] },
  { name: "Reid Mitchell", email: "rmitchell@mitchellandcompanyinc.com", company: "Mitchell & Company", provides: ["broker_intel", "retailer_relationships"] },
] as const;

/**
 * Current production specs — used to validate per-unit math.
 */
export const PRODUCTION_SPECS = {
  bag_size_oz: 7.5,
  bags_per_case: 36,
  lbs_per_pallet: 1800, // Albanese pallets
  /** 13 pallets = 23,400 lbs = 49,920 units; 14 pallets = 25,200 lbs = 53,760 units */
  pallet_to_units: (pallets: number) => Math.floor((pallets * 1800) / (7.5 / 16)),
  /** Convert per-lb candy price to per-unit cost */
  candy_per_lb_to_per_unit: (pricePerLb: number) =>
    Math.round(pricePerLb * (7.5 / 16) * 1000) / 1000,
} as const;
