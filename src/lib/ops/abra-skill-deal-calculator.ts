/**
 * Abra Skill: Deal Calculator
 *
 * Instantly calculates margins, pricing, and profitability for any wholesale
 * deal. Abra can use this skill to evaluate deals during conversation, compare
 * channel economics, and recommend pricing.
 *
 * Usage:
 *   import { DEAL_CALCULATOR_SKILL, calculateDeal } from "@/lib/ops/abra-skill-deal-calculator";
 *   // Inject DEAL_CALCULATOR_SKILL.prompt into system context
 *   // Call calculateDeal() for structured deal analysis
 */

// ---------------------------------------------------------------------------
// Cost constants (source: Pro Forma v24, verified from supplier quotes)
// ---------------------------------------------------------------------------

export const COST_STRUCTURE = {
  /** All-in COGS per unit */
  cogsPerUnit: 1.522,
  /** Component breakdown */
  components: {
    candy: 0.919,       // Albanese bulk gummy
    packaging: 0.144,   // Belmark film
    copacking: 0.350,   // Powers Inc labor
    freight: 0.109,     // Inbound freight per unit
  },
  /** Retail MSRP */
  msrp: 4.99,
};

// ---------------------------------------------------------------------------
// Channel fee schedules
// ---------------------------------------------------------------------------

export type ChannelType = "dtc" | "amazon" | "wholesale_direct" | "faire" | "wholesale_broker";

export const CHANNEL_FEES: Record<ChannelType, {
  name: string;
  feePercent: number;
  fixedFeePerUnit: number;
  typicalPrice: number;
  notes: string;
}> = {
  dtc: {
    name: "DTC (Shopify)",
    feePercent: 0.029,        // Shopify Payments 2.9%
    fixedFeePerUnit: 0.30,    // + $0.30 per transaction
    typicalPrice: 4.99,
    notes: "Best margin. Payment processing only.",
  },
  amazon: {
    name: "Amazon FBA",
    feePercent: 0.15,         // 15% referral fee
    fixedFeePerUnit: 3.22,    // FBA pick+pack+ship
    typicalPrice: 4.99,
    notes: "Worst margin. FBA fees + referral eat most revenue.",
  },
  wholesale_direct: {
    name: "Direct Wholesale",
    feePercent: 0,
    fixedFeePerUnit: 0,
    typicalPrice: 2.50,       // 50% off MSRP standard wholesale
    notes: "No platform fees. Ship direct to distributor.",
  },
  faire: {
    name: "Faire Wholesale",
    feePercent: 0.15,         // 15% first order, 0% reorder (use blended ~9%)
    fixedFeePerUnit: 0,
    typicalPrice: 2.50,
    notes: "15% commission on first orders, 0% on reorders. Blended ~9%.",
  },
  wholesale_broker: {
    name: "Broker/Rep",
    feePercent: 0.05,         // 5% broker commission
    fixedFeePerUnit: 0,
    typicalPrice: 2.50,
    notes: "5% broker commission (e.g., Mitchell & Company).",
  },
};

// ---------------------------------------------------------------------------
// Deal calculation
// ---------------------------------------------------------------------------

export type DealInput = {
  /** Customer/distributor name */
  customerName: string;
  /** Channel through which deal flows */
  channel: ChannelType;
  /** Price per unit (override typical if provided) */
  pricePerUnit?: number;
  /** Number of units */
  units: number;
  /** Optional: override COGS per unit */
  cogsOverride?: number;
  /** Optional: custom fee percent override */
  feePercentOverride?: number;
  /** Optional: freight per unit override */
  freightOverride?: number;
};

export type DealResult = {
  customerName: string;
  channel: string;
  units: number;
  pricePerUnit: number;
  grossRevenue: number;
  channelFees: number;
  netRevenue: number;
  totalCogs: number;
  cogsPerUnit: number;
  grossProfit: number;
  grossMarginPct: number;
  contributionPerUnit: number;
  breakEvenUnits: number;
  recommendation: string;
  comparison: {
    channel: string;
    marginPct: number;
    profitPerUnit: number;
  }[];
};

export function calculateDeal(input: DealInput): DealResult {
  const channelConfig = CHANNEL_FEES[input.channel];
  const pricePerUnit = input.pricePerUnit ?? channelConfig.typicalPrice;
  const cogsPerUnit = input.cogsOverride ?? COST_STRUCTURE.cogsPerUnit;
  const feePercent = input.feePercentOverride ?? channelConfig.feePercent;
  const freightPerUnit = input.freightOverride ?? 0; // outbound freight for wholesale

  const grossRevenue = pricePerUnit * input.units;

  // Channel fees
  const percentFee = grossRevenue * feePercent;
  const fixedFee = channelConfig.fixedFeePerUnit * input.units;
  const channelFees = percentFee + fixedFee;

  const netRevenue = grossRevenue - channelFees;
  const totalCogs = (cogsPerUnit + freightPerUnit) * input.units;
  const grossProfit = netRevenue - totalCogs;
  const grossMarginPct = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
  const contributionPerUnit = input.units > 0 ? grossProfit / input.units : 0;

  // Break-even: how many units needed to cover a $500 monthly fixed cost target
  const breakEvenUnits = contributionPerUnit > 0
    ? Math.ceil(500 / contributionPerUnit)
    : Infinity;

  // Compare across all channels
  const comparison = (Object.keys(CHANNEL_FEES) as ChannelType[]).map((ch) => {
    const cfg = CHANNEL_FEES[ch];
    const price = ch === input.channel ? pricePerUnit : cfg.typicalPrice;
    const rev = price;
    const fees = rev * cfg.feePercent + cfg.fixedFeePerUnit;
    const net = rev - fees;
    const profit = net - cogsPerUnit;
    return {
      channel: cfg.name,
      marginPct: net > 0 ? (profit / net) * 100 : 0,
      profitPerUnit: profit,
    };
  });

  // Recommendation
  let recommendation: string;
  if (grossMarginPct >= 40) {
    recommendation = `Strong deal. ${grossMarginPct.toFixed(1)}% margin — proceed.`;
  } else if (grossMarginPct >= 25) {
    recommendation = `Acceptable deal. ${grossMarginPct.toFixed(1)}% margin — proceed if strategic.`;
  } else if (grossMarginPct >= 10) {
    recommendation = `Thin margin (${grossMarginPct.toFixed(1)}%). Only proceed for volume commitment or market entry.`;
  } else {
    recommendation = `Unprofitable or near-zero margin (${grossMarginPct.toFixed(1)}%). Negotiate higher price or decline.`;
  }

  return {
    customerName: input.customerName,
    channel: channelConfig.name,
    units: input.units,
    pricePerUnit: round2(pricePerUnit),
    grossRevenue: round2(grossRevenue),
    channelFees: round2(channelFees),
    netRevenue: round2(netRevenue),
    totalCogs: round2(totalCogs),
    cogsPerUnit: round2(cogsPerUnit),
    grossProfit: round2(grossProfit),
    grossMarginPct: round2(grossMarginPct),
    contributionPerUnit: round2(contributionPerUnit),
    breakEvenUnits,
    recommendation,
    comparison,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Skill prompt (injected into Abra's system prompt when deal-related)
// ---------------------------------------------------------------------------

export const DEAL_CALCULATOR_SKILL = {
  name: "deal_calculator",
  version: "1.0.0",
  description: "Calculate margins, pricing, and profitability for wholesale deals",

  prompt: `
## Skill: Deal Calculator

You have access to a Deal Calculator that computes exact profitability for any deal. Use it when users ask about pricing, margins, deal evaluation, or "should we take this deal?"

### Current Cost Structure (verified from supplier quotes, March 2026)
- **All-in COGS per unit**: $1.522
  - Candy (Albanese): $0.919
  - Film/Packaging (Belmark): $0.144
  - Co-Packing (Powers): $0.350
  - Freight: $0.109
- **MSRP**: $4.99

### Channel Economics Quick Reference
| Channel | Typical Price | Fees | Net/Unit | Margin |
|---------|--------------|------|----------|--------|
| DTC (Shopify) | $4.99 | 2.9% + $0.30 | $4.54 | 66.5% |
| Direct Wholesale | $2.50 | None | $2.50 | 39.1% |
| Faire (blended) | $2.50 | ~9% blended | $2.275 | 33.1% |
| Broker (5%) | $2.50 | 5% | $2.375 | 35.9% |
| Amazon FBA | $4.99 | 15% + $3.22 FBA | $1.02 | -49.2% |

### How to Present Deal Analysis
When asked to evaluate a deal, structure your response as:

1. **Deal Summary**: Customer, channel, units, price
2. **Revenue**: Gross → Net (after fees)
3. **Costs**: COGS breakdown
4. **Profit**: Gross profit, margin %, profit per unit
5. **Recommendation**: Strong / Acceptable / Thin / Unprofitable
6. **Channel Comparison**: Show how this deal compares to alternatives

### Pricing Negotiation Rules
- **Floor price** (break-even): $1.52/unit (= COGS, 0% margin)
- **Minimum viable price**: $1.90/unit (~20% margin, only for 1000+ unit commitments)
- **Target wholesale price**: $2.50/unit (~39% margin)
- **Premium/specialty price**: $3.00/unit (~49% margin, for specialty retailers)
- **NEVER** go below $1.90/unit — it's better to decline than destroy margin

### Action: When the user asks you to calculate a deal, emit an action directive:
<action>{"action_type": "calculate_deal", "customer": "NAME", "channel": "wholesale_direct|faire|amazon|dtc|wholesale_broker", "units": NUMBER, "price_per_unit": NUMBER}</action>
`,
};
