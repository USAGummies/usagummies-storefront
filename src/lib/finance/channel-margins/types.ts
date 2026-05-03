/**
 * Per-channel margin model — types only.
 *
 * Per-bag economics for each channel USA Gummies sells through:
 * Amazon FBA, Amazon FBM, Shopify DTC, Faire, Wholesale direct
 * (B2/B3 master carton; B4/B5 pallet), Distributor delivered, Trade
 * show booth.
 *
 * The numbers in the rows are computed from canonical sources where
 * available (forward COGS = $1.557/bag from daily-pnl.ts; B-tier
 * prices from wholesale/pricing-tiers.ts) and explicitly marked
 * `[needs QBO actual]` when no live data source is wired (channel
 * fee actuals, Amazon ad spend allocation, etc.).
 *
 * No fabrication: every cell is either a real number with a citation
 * or an explicit `unavailableReason`.
 */

export type ChannelId =
  | "amazon-fba"
  | "amazon-fbm"
  | "shopify-dtc"
  | "faire"
  | "wholesale-master-landed" // B2
  | "wholesale-master-buyer-pays" // B3
  | "wholesale-pallet-landed" // B4
  | "wholesale-pallet-buyer-pays" // B5
  | "distributor-delivered"
  | "trade-show-booth";

export interface ChannelMarginRow {
  channel: ChannelId;
  /** Human-readable label for the table. */
  displayName: string;
  /** Bag pricing tier — "B1"-"B5" wholesale rows, retail otherwise. */
  pricingTier?: "B1" | "B2" | "B3" | "B4" | "B5" | "retail";
  /**
   * Per-bag retail/wholesale price (USD). Required — every row has
   * a known price (we set it).
   */
  grossRevenuePerBagUsd: number;
  /**
   * Channel fees per bag. Includes:
   *   • Amazon FBA: referral 15% + FBA $3.74/bag (Q1 2026 small-light)
   *   • Amazon FBM: referral 15% only
   *   • Shopify DTC: Shopify Payments 2.9% + $0.30
   *   • Faire: 25% commission on first order, 15% on reorders
   *   • Wholesale: 0
   *   • Distributor: 0
   *   • Trade show: 0
   */
  channelFeesPerBagUsd: number;
  /**
   * COGS per bag (forward $1.557 from Powers + Belmark + freight inbound).
   * Same across every channel — production cost is channel-agnostic.
   */
  cogsPerBagUsd: number;
  /**
   * Per-bag freight allocation (outbound). Channel-specific:
   *   • Amazon FBA: $0 (FBA handles fulfillment)
   *   • Amazon FBM: ~$0.20/bag (USPS Ground Advantage / UPS Ground Saver)
   *   • Shopify DTC: ~$1.10/bag (5-bag mailer at $5.50)
   *   • Faire: $0 (Faire pays freight on first orders, buyer pays on reorders)
   *   • Wholesale-landed: ~$0.21/bag (master carton @ $7.50 / 36 bags)
   *   • Wholesale-buyer-pays: $0 (buyer arranges)
   *   • Distributor: $0.21/bag
   *   • Trade show: $0 (buyer hand-carries from booth)
   */
  shippingCostPerBagUsd: number;
  /**
   * Net revenue per bag = gross - channelFees.
   */
  netRevenuePerBagUsd: number;
  /**
   * Gross margin $ per bag = net - cogs - shipping.
   */
  grossMarginPerBagUsd: number;
  /**
   * Gross margin % = grossMargin / grossRevenue.
   */
  grossMarginPct: number;
  /**
   * True when grossMarginPerBagUsd < $2.12 (per
   * `/contracts/off-grid-pricing-escalation.md` minimum-margin floor).
   */
  belowMarginFloor: boolean;
  /**
   * Optional notes — flagging which numbers are estimates vs actuals.
   * Caller-supplied or default-populated by the builder.
   */
  notes?: string;
  /**
   * Unavailable cells — per-cell flag for "we don't have this data
   * source wired yet." Empty when the row is fully computed.
   */
  unavailable: {
    /** True when channelFeesPerBagUsd is an estimate, not a QBO actual. */
    channelFees: boolean;
    /** True when shippingCostPerBagUsd is an estimate, not a QBO actual. */
    shipping: boolean;
    reason?: string;
  };
}

export interface ChannelMarginsTable {
  asOf: string;
  rows: ChannelMarginRow[];
  /** Per-row source citations (governance.md §1 #2). */
  sources: Array<{
    system: string;
    retrievedAt: string;
    note?: string;
  }>;
  /** Summary roll-up: how many channels are below the $2.12 floor. */
  summary: {
    rowCount: number;
    belowFloorCount: number;
    healthiestChannel: ChannelId | null;
    leastHealthyChannel: ChannelId | null;
  };
  /**
   * Doctrine citation for the minimum-margin floor.
   */
  marginFloorUsd: number;
}
