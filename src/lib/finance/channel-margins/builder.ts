/**
 * Pure builder for the channel margins table.
 *
 * Inputs are constants and overridable estimates. The output is a
 * deterministic snapshot the dashboard renders + a programmatic
 * surface for "is this channel healthy?" queries.
 *
 * Doctrine sources:
 *   • Forward COGS — $1.557/bag (daily-pnl.ts canonical)
 *   • Wholesale tier prices — pricing-tiers.ts (B2 $3.49, B3 $3.50,
 *     B4 $3.25, B5 $3.25 per v2.4)
 *   • Margin floor — $2.12/bag per
 *     /contracts/off-grid-pricing-escalation.md
 *
 * Cells flagged unavailable: channel fee % and shipping cost
 * estimates that don't have QBO actuals wired today. Replacing
 * those with QBO-pulled actuals is a follow-up commit (Missing #21
 * receipt-OCR mapping unblocks it).
 */
import type { ChannelId, ChannelMarginRow, ChannelMarginsTable } from "./types";

/** Canonical forward COGS per bag (Powers + Belmark + inbound freight). */
export const FORWARD_COGS_PER_BAG_USD = 1.557;

/** Margin floor per off-grid escalation doctrine. */
export const MARGIN_FLOOR_USD = 2.12;

/**
 * Default per-channel input table. Caller can override individual
 * cells via the `overrides` parameter — useful for the future
 * "Rene fills in the actuals" form path.
 */
export interface ChannelMarginInputs {
  /** Bag prices per channel (USD). */
  grossRevenuePerBag: Record<ChannelId, number>;
  /** Channel-fee per bag (USD). Estimates today. */
  channelFeesPerBag: Record<ChannelId, number>;
  /** Outbound shipping cost per bag (USD). Estimates today. */
  shippingCostPerBag: Record<ChannelId, number>;
  /** Pricing tier for the wholesale rows. */
  pricingTier: Partial<Record<ChannelId, ChannelMarginRow["pricingTier"]>>;
  /** Display labels. */
  displayName: Record<ChannelId, string>;
}

const DEFAULT_INPUTS: ChannelMarginInputs = {
  grossRevenuePerBag: {
    "amazon-fba": 8.99,
    "amazon-fbm": 8.99,
    "shopify-dtc": 5.99,
    faire: 3.49,
    "wholesale-master-landed": 3.49, // B2
    "wholesale-master-buyer-pays": 3.5, // B3 (v2.4 +$0.01)
    "wholesale-pallet-landed": 3.25, // B4
    "wholesale-pallet-buyer-pays": 3.25, // B5 (v2.4 +$0.25)
    "distributor-delivered": 2.1, // Inderbitzin commitment
    "trade-show-booth": 3.25,
  },
  channelFeesPerBag: {
    // Amazon referral 15% + FBA $3.74 (small-light) per bag
    "amazon-fba": 8.99 * 0.15 + 3.74,
    // Amazon referral 15% only
    "amazon-fbm": 8.99 * 0.15,
    // Shopify Payments 2.9% + $0.30 (allocated as-if 1 bag/order;
    // real DTC orders are ~5 bags so this is conservatively high)
    "shopify-dtc": 5.99 * 0.029 + 0.3,
    // Faire 25% commission first order. Reorders are 15% — using
    // the more conservative first-order rate so the row reflects
    // the worst case.
    faire: 3.49 * 0.25,
    "wholesale-master-landed": 0,
    "wholesale-master-buyer-pays": 0,
    "wholesale-pallet-landed": 0,
    "wholesale-pallet-buyer-pays": 0,
    "distributor-delivered": 0,
    "trade-show-booth": 0,
  },
  shippingCostPerBag: {
    "amazon-fba": 0, // FBA handles fulfillment
    "amazon-fbm": 0.2, // USPS Ground / UPS Ground Saver allocated
    "shopify-dtc": 1.1, // 5-bag mailer at $5.50 (allocated)
    faire: 0, // Faire pays first-order freight; reorders buyer-pays
    "wholesale-master-landed": 0.21, // master carton @ $7.50 / 36 bags
    "wholesale-master-buyer-pays": 0,
    "wholesale-pallet-landed": 0.18, // 900-bag pallet @ $164 LTL
    "wholesale-pallet-buyer-pays": 0,
    "distributor-delivered": 0.21,
    "trade-show-booth": 0,
  },
  pricingTier: {
    "amazon-fba": "retail",
    "amazon-fbm": "retail",
    "shopify-dtc": "retail",
    faire: "retail",
    "wholesale-master-landed": "B2",
    "wholesale-master-buyer-pays": "B3",
    "wholesale-pallet-landed": "B4",
    "wholesale-pallet-buyer-pays": "B5",
    "distributor-delivered": "retail",
    "trade-show-booth": "retail",
  },
  displayName: {
    "amazon-fba": "Amazon FBA",
    "amazon-fbm": "Amazon FBM",
    "shopify-dtc": "Shopify DTC",
    faire: "Faire wholesale",
    "wholesale-master-landed": "Wholesale — master, landed (B2)",
    "wholesale-master-buyer-pays": "Wholesale — master, buyer pays (B3)",
    "wholesale-pallet-landed": "Wholesale — pallet, landed (B4)",
    "wholesale-pallet-buyer-pays": "Wholesale — pallet, buyer pays (B5)",
    "distributor-delivered": "Distributor delivered (Inderbitzin/Glacier)",
    "trade-show-booth": "Trade show — booth special",
  },
};

/** Cells that are estimates today (not QBO actuals). */
const ESTIMATE_FLAGS: Partial<Record<
  ChannelId,
  { channelFees: boolean; shipping: boolean; reason?: string }
>> = {
  "amazon-fba": {
    channelFees: true,
    shipping: false,
    reason: "Amazon FBA referral % + FBA fee per-bag are catalog estimates; real fees vary by month and SKU size tier. Replace once SP-API settlement-fee actuals land in the brief.",
  },
  "amazon-fbm": {
    channelFees: true,
    shipping: true,
    reason: "Amazon FBM referral % is a catalog estimate; shipping is allocated from auto-ship cron averages, not booked QBO labels.",
  },
  "shopify-dtc": {
    channelFees: true,
    shipping: true,
    reason: "Shopify Payments % + per-order $0.30 allocated as-if 1 bag/order; real DTC orders average ~5 bags so the per-bag fee load is overstated. Allocated shipping cost is based on a 5-bag mailer; smaller orders allocate more per-bag.",
  },
  faire: {
    channelFees: false,
    shipping: true,
    reason: "Faire 25% commission rate is locked in their seller agreement (real number). Shipping = $0 only when the buyer pays freight (Faire's reorder default); first-orders ship freight-free which we'd absorb. The row reflects the reorder shape; first-order rows will be lower margin.",
  },
};

function classifyCell(channel: ChannelId): {
  channelFees: boolean;
  shipping: boolean;
  reason?: string;
} {
  return (
    ESTIMATE_FLAGS[channel] ?? {
      channelFees: false,
      shipping: false,
    }
  );
}

/**
 * Build the per-channel margin row.
 */
function buildRow(
  channel: ChannelId,
  inputs: ChannelMarginInputs,
): ChannelMarginRow {
  const grossRevenue = inputs.grossRevenuePerBag[channel];
  const channelFees = inputs.channelFeesPerBag[channel];
  const shipping = inputs.shippingCostPerBag[channel];
  const cogs = FORWARD_COGS_PER_BAG_USD;

  const netRevenue = round2(grossRevenue - channelFees);
  const grossMargin = round2(netRevenue - cogs - shipping);
  const grossMarginPct =
    grossRevenue > 0 ? round2((grossMargin / grossRevenue) * 100) / 100 : 0;
  const flags = classifyCell(channel);
  return {
    channel,
    displayName: inputs.displayName[channel],
    pricingTier: inputs.pricingTier[channel],
    grossRevenuePerBagUsd: round2(grossRevenue),
    channelFeesPerBagUsd: round2(channelFees),
    cogsPerBagUsd: cogs, // canonical 3-decimal — no rounding
    shippingCostPerBagUsd: round2(shipping),
    netRevenuePerBagUsd: netRevenue,
    grossMarginPerBagUsd: grossMargin,
    grossMarginPct,
    belowMarginFloor: grossMargin < MARGIN_FLOOR_USD,
    unavailable: flags,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Build the full table. Caller can pass `overrides` to swap in QBO
 * actuals as they land — same shape as the defaults; missing keys
 * fall through to the default.
 */
export function buildChannelMarginsTable(opts: {
  asOf?: Date;
  overrides?: Partial<{
    grossRevenuePerBag: Partial<Record<ChannelId, number>>;
    channelFeesPerBag: Partial<Record<ChannelId, number>>;
    shippingCostPerBag: Partial<Record<ChannelId, number>>;
  }>;
} = {}): ChannelMarginsTable {
  const asOf = opts.asOf ?? new Date();

  // Merge overrides into defaults.
  const inputs: ChannelMarginInputs = {
    ...DEFAULT_INPUTS,
    grossRevenuePerBag: {
      ...DEFAULT_INPUTS.grossRevenuePerBag,
      ...(opts.overrides?.grossRevenuePerBag ?? {}),
    },
    channelFeesPerBag: {
      ...DEFAULT_INPUTS.channelFeesPerBag,
      ...(opts.overrides?.channelFeesPerBag ?? {}),
    },
    shippingCostPerBag: {
      ...DEFAULT_INPUTS.shippingCostPerBag,
      ...(opts.overrides?.shippingCostPerBag ?? {}),
    },
  };

  const channels: ChannelId[] = [
    "amazon-fba",
    "amazon-fbm",
    "shopify-dtc",
    "faire",
    "wholesale-master-landed",
    "wholesale-master-buyer-pays",
    "wholesale-pallet-landed",
    "wholesale-pallet-buyer-pays",
    "distributor-delivered",
    "trade-show-booth",
  ];
  const rows = channels.map((c) => buildRow(c, inputs));

  // Health summary.
  const sortedByMargin = [...rows].sort(
    (a, b) => b.grossMarginPerBagUsd - a.grossMarginPerBagUsd,
  );
  const healthiestChannel = sortedByMargin[0]?.channel ?? null;
  const leastHealthyChannel =
    sortedByMargin[sortedByMargin.length - 1]?.channel ?? null;
  const belowFloorCount = rows.filter((r) => r.belowMarginFloor).length;

  return {
    asOf: asOf.toISOString(),
    rows,
    sources: [
      {
        system: "doctrine:wholesale-pricing.md",
        retrievedAt: asOf.toISOString(),
        note: "B-tier prices locked in /contracts/wholesale-pricing.md v2.4",
      },
      {
        system: "doctrine:daily-pnl.ts",
        retrievedAt: asOf.toISOString(),
        note: `Forward COGS $${FORWARD_COGS_PER_BAG_USD}/bag (Powers + Belmark + inbound freight)`,
      },
      {
        system: "doctrine:off-grid-pricing-escalation.md",
        retrievedAt: asOf.toISOString(),
        note: `Margin floor $${MARGIN_FLOOR_USD}/bag — Class C pricing.change required to ship below this`,
      },
    ],
    summary: {
      rowCount: rows.length,
      belowFloorCount,
      healthiestChannel,
      leastHealthyChannel,
    },
    marginFloorUsd: MARGIN_FLOOR_USD,
  };
}
