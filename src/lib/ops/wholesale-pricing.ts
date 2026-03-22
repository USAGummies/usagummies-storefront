/**
 * Wholesale Pricing Calculator
 *
 * Calculates wholesale pricing based on the Inderbitzin deal structure:
 *   - COGS: $1.557/unit (Albanese $0.919 + Belmark $0.144 + Powers $0.385 + freight $0.109)
 *   - Packaging: 6 bags/case, 36 units/master carton
 *   - Shipping: estimated per unit based on destination
 *   - Margin targets: floor 20%, target 35-45%
 *
 * Deal reference: Inderbitzin PO #009180
 *   - 28 master cartons × 36 units = 1,008 units
 *   - $2.10/unit delivered
 *   - Gross margin: ~27.5% ($0.543 profit/unit)
 */

export type WholesaleQuote = {
  customer: string;
  units: number;
  unitPrice: number;
  totalRevenue: number;
  cogsPerUnit: number;
  totalCogs: number;
  shippingPerUnit: number;
  totalShipping: number;
  grossProfitPerUnit: number;
  totalGrossProfit: number;
  grossMarginPct: number;
  casesNeeded: number;
  masterCartonsNeeded: number;
  volumeDiscount: number;
  priceAfterDiscount: number;
  meetsFloor: boolean;
  meetsTarget: boolean;
  tiers: Array<{ label: string; units: number; price: number; margin: number }>;
};

// Product structure
const UNITS_PER_CASE = 6;
const CASES_PER_MASTER_CARTON = 6; // 36 units per master carton
const UNITS_PER_MASTER_CARTON = UNITS_PER_CASE * CASES_PER_MASTER_CARTON;

// Costs
const FORWARD_COGS = 1.557; // Per unit all-in
const COGS_BREAKDOWN = {
  albanese: 0.919,    // Raw gummy candy
  belmark: 0.144,     // Packaging film
  powers: 0.385,      // Co-packing
  freight: 0.109,     // Inbound freight
};

// Shipping estimates (per unit, varies by destination)
const SHIPPING_ESTIMATES: Record<string, number> = {
  local: 0.15,       // Same state
  regional: 0.25,    // Adjacent states
  national: 0.40,    // Cross-country
  delivered: 0,      // Price includes shipping
};

// Margin thresholds
const MARGIN_FLOOR = 0.20;   // 20% minimum acceptable
const MARGIN_TARGET = 0.35;  // 35% target

// Volume discount tiers
const VOLUME_DISCOUNTS: Array<{ minUnits: number; discount: number; label: string }> = [
  { minUnits: 5000, discount: 0.05, label: "5,000+ units: 5% off" },
  { minUnits: 2500, discount: 0.03, label: "2,500+ units: 3% off" },
  { minUnits: 1000, discount: 0.01, label: "1,000+ units: 1% off" },
  { minUnits: 0, discount: 0, label: "Standard pricing" },
];

function getVolumeDiscount(units: number): number {
  for (const tier of VOLUME_DISCOUNTS) {
    if (units >= tier.minUnits) return tier.discount;
  }
  return 0;
}

/**
 * Calculate a wholesale quote for a given customer, quantity, and price.
 */
export function calculateWholesaleQuote(
  customer: string,
  units: number,
  pricePerUnit: number,
  shippingType: keyof typeof SHIPPING_ESTIMATES = "national",
): WholesaleQuote {
  const shippingPerUnit = SHIPPING_ESTIMATES[shippingType] || SHIPPING_ESTIMATES.national;
  const totalCogs = Math.round(units * FORWARD_COGS * 100) / 100;
  const totalShipping = Math.round(units * shippingPerUnit * 100) / 100;
  const totalRevenue = Math.round(units * pricePerUnit * 100) / 100;
  const totalGrossProfit = Math.round((totalRevenue - totalCogs - totalShipping) * 100) / 100;
  const grossProfitPerUnit = Math.round(((pricePerUnit - FORWARD_COGS - shippingPerUnit)) * 1000) / 1000;
  const grossMarginPct = totalRevenue > 0 ? Math.round((totalGrossProfit / totalRevenue) * 10000) / 100 : 0;

  const volumeDiscount = getVolumeDiscount(units);
  const priceAfterDiscount = Math.round(pricePerUnit * (1 - volumeDiscount) * 100) / 100;

  const casesNeeded = Math.ceil(units / UNITS_PER_CASE);
  const masterCartonsNeeded = Math.ceil(units / UNITS_PER_MASTER_CARTON);

  // Generate pricing tiers for comparison
  const tiers = [
    { label: "Floor (20%)", units, price: Math.round((FORWARD_COGS + shippingPerUnit) / (1 - 0.20) * 100) / 100, margin: 20 },
    { label: "Target (35%)", units, price: Math.round((FORWARD_COGS + shippingPerUnit) / (1 - 0.35) * 100) / 100, margin: 35 },
    { label: "Premium (45%)", units, price: Math.round((FORWARD_COGS + shippingPerUnit) / (1 - 0.45) * 100) / 100, margin: 45 },
    { label: "Quoted", units, price: pricePerUnit, margin: grossMarginPct },
  ];

  return {
    customer,
    units,
    unitPrice: pricePerUnit,
    totalRevenue,
    cogsPerUnit: FORWARD_COGS,
    totalCogs,
    shippingPerUnit,
    totalShipping,
    grossProfitPerUnit,
    totalGrossProfit,
    grossMarginPct,
    casesNeeded,
    masterCartonsNeeded,
    volumeDiscount,
    priceAfterDiscount,
    meetsFloor: grossMarginPct >= MARGIN_FLOOR * 100,
    meetsTarget: grossMarginPct >= MARGIN_TARGET * 100,
    tiers,
  };
}

/**
 * Format a wholesale quote as a Slack-friendly message.
 */
export function formatQuote(q: WholesaleQuote): string {
  const marginEmoji = q.meetsTarget ? "🟢" : q.meetsFloor ? "🟡" : "🔴";

  return [
    `📊 *Wholesale Quote — ${q.customer}*`,
    "",
    `| | Per Unit | Total |`,
    `|---|---|---|`,
    `| Revenue | $${q.unitPrice.toFixed(2)} | $${q.totalRevenue.toLocaleString()} |`,
    `| COGS | $${q.cogsPerUnit.toFixed(3)} | $${q.totalCogs.toLocaleString()} |`,
    `| Shipping | $${q.shippingPerUnit.toFixed(2)} | $${q.totalShipping.toLocaleString()} |`,
    `| **Gross Profit** | **$${q.grossProfitPerUnit.toFixed(3)}** | **$${q.totalGrossProfit.toLocaleString()}** |`,
    "",
    `${marginEmoji} **Margin: ${q.grossMarginPct}%** ${q.meetsTarget ? "(meets target)" : q.meetsFloor ? "(above floor)" : "⚠️ BELOW FLOOR"}`,
    "",
    `Packaging: ${q.casesNeeded} cases (${q.masterCartonsNeeded} master cartons)`,
    q.volumeDiscount > 0 ? `Volume discount: ${(q.volumeDiscount * 100).toFixed(0)}% → $${q.priceAfterDiscount}/unit` : "",
    "",
    `*Pricing tiers:*`,
    ...q.tiers.map(t => `  • ${t.label}: $${t.price.toFixed(2)}/unit (${t.margin}% margin)`),
    "",
    `_COGS breakdown: Albanese $${COGS_BREAKDOWN.albanese} + Belmark $${COGS_BREAKDOWN.belmark} + Powers $${COGS_BREAKDOWN.powers} + freight $${COGS_BREAKDOWN.freight}_`,
  ].filter(Boolean).join("\n");
}
