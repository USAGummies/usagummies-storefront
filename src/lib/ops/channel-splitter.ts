/**
 * Channel Splitter — Classifies Shopify orders into sales channels.
 *
 * Separates DTC (direct-to-consumer), Faire wholesale, distributor,
 * and other orders flowing through Shopify. Faire orders appear in Shopify
 * with identifying markers (tags, source app name, notes).
 *
 * Pure logic module — no fetch calls, no side effects.
 */

import { ptDate } from "@/lib/amazon/sp-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Recognized sales channels for order classification. */
export type ChannelName = "dtc" | "faire" | "distributor" | "other";

/** A single classified order with its channel assignment. */
export type ChannelOrder = {
  /** Order display name, e.g. "#1234" */
  name: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** Total order amount in dollars */
  total: number;
  /** Classified sales channel */
  channel: ChannelName;
  /** Human-readable financial status, e.g. "paid" */
  financialStatus: string;
};

/** Per-channel aggregated metrics with individual order items. */
export type ChannelBucket = {
  revenue: number;
  orders: number;
  avgOrderValue: number;
  items: ChannelOrder[];
};

/** Full channel breakdown across all channels with totals. */
export type ChannelBreakdown = {
  dtc: ChannelBucket;
  faire: ChannelBucket;
  distributor: ChannelBucket;
  other: ChannelBucket;
  total: { revenue: number; orders: number; avgOrderValue: number };
  /** ISO timestamp — used for staleness detection by consumers. */
  lastFetched: string;
};

/** Daily revenue by channel for stacked chart rendering. */
export type DailyChannelData = {
  /** YYYY-MM-DD date string */
  date: string;
  /** Human label, e.g. "Feb 27" */
  label: string;
  /** DTC revenue for this day */
  dtc: number;
  /** Faire revenue for this day */
  faire: number;
  /** Distributor revenue for this day */
  distributor: number;
  /** Other channel revenue for this day */
  other: number;
  /** Sum of all channels */
  combined: number;
};

/**
 * Raw order node shape from Shopify Admin GraphQL.
 * Matches the fields returned by CHANNEL_ORDER_FRAGMENT.
 */
export type ShopifyOrderNode = {
  name: string;
  createdAt: string;
  displayFinancialStatus: string;
  totalPriceSet: { shopMoney: { amount: string } };
  tags: string[];
  note: string | null;
  sourceUrl: string | null;
  app: { name: string } | null;
  customer?: { numberOfOrders: number } | null;
};

// ---------------------------------------------------------------------------
// GraphQL fragment — drop into any Shopify orders query
// ---------------------------------------------------------------------------

/**
 * GraphQL field selection for orders that includes channel-classification
 * fields (tags, note, sourceUrl, app). Use inside an `orders { edges { node { ... } } }` query.
 */
export const CHANNEL_ORDER_FRAGMENT = `
  name
  createdAt
  displayFinancialStatus
  totalPriceSet { shopMoney { amount } }
  tags
  note
  sourceUrl
  app { name }
  customer { numberOfOrders }
`;

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify a single Shopify order into a sales channel.
 *
 * Detection priority:
 *  1. Tags containing "faire" (case-insensitive)
 *  2. Source app name containing "faire" (case-insensitive)
 *  3. sourceUrl containing "faire" (case-insensitive)
 *  4. Order note mentioning "faire" (case-insensitive)
 *  5. Order name prefixed with "F-" (some Faire integrations)
 *  6. "wholesale" tag + total > $200 → distributor
 *  7. Default → dtc
 */
export function classifyOrder(order: ShopifyOrderNode): ChannelName {
  const tags = (order.tags ?? []).map((t) => t.toLowerCase());
  const appName = (order.app?.name ?? "").toLowerCase();
  const sourceUrl = (order.sourceUrl ?? "").toLowerCase();
  const note = (order.note ?? "").toLowerCase();
  const orderName = order.name ?? "";

  // --- Faire detection ---
  if (tags.some((t) => t.includes("faire"))) return "faire";
  if (appName.includes("faire")) return "faire";
  if (sourceUrl.includes("faire")) return "faire";
  if (note.includes("faire")) return "faire";
  if (orderName.startsWith("F-")) return "faire";

  // --- Distributor detection ---
  const total = parseFloat(order.totalPriceSet?.shopMoney?.amount ?? "0");
  if (total > 200 && tags.includes("wholesale")) return "distributor";

  // --- Default to DTC ---
  return "dtc";
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Round to 2 decimal places. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Build a full channel breakdown from raw Shopify order nodes.
 *
 * Classifies every order, buckets it into the appropriate channel,
 * and computes per-channel and overall totals.
 */
export function buildChannelBreakdown(
  orders: ShopifyOrderNode[],
): ChannelBreakdown {
  const buckets: Record<ChannelName, ChannelOrder[]> = {
    dtc: [],
    faire: [],
    distributor: [],
    other: [],
  };

  for (const raw of orders) {
    const channel = classifyOrder(raw);
    const total = parseFloat(raw.totalPriceSet?.shopMoney?.amount ?? "0");
    buckets[channel].push({
      name: raw.name,
      createdAt: raw.createdAt,
      total: round2(total),
      channel,
      financialStatus: (raw.displayFinancialStatus ?? "")
        .toLowerCase()
        .replace(/_/g, " "),
    });
  }

  function buildBucket(items: ChannelOrder[]): ChannelBucket {
    const revenue = items.reduce((sum, o) => sum + o.total, 0);
    const count = items.length;
    return {
      revenue: round2(revenue),
      orders: count,
      avgOrderValue: count > 0 ? round2(revenue / count) : 0,
      items,
    };
  }

  const dtc = buildBucket(buckets.dtc);
  const faire = buildBucket(buckets.faire);
  const distributor = buildBucket(buckets.distributor);
  const other = buildBucket(buckets.other);

  const totalRevenue = dtc.revenue + faire.revenue + distributor.revenue + other.revenue;
  const totalOrders = dtc.orders + faire.orders + distributor.orders + other.orders;

  return {
    dtc,
    faire,
    distributor,
    other,
    total: {
      revenue: round2(totalRevenue),
      orders: totalOrders,
      avgOrderValue: totalOrders > 0 ? round2(totalRevenue / totalOrders) : 0,
    },
    lastFetched: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Daily chart data builder
// ---------------------------------------------------------------------------

/**
 * Group orders by day (Pacific Time) and channel for stacked chart rendering.
 *
 * Always returns exactly 30 entries (today minus 29 days through today)
 * so the chart has continuous data even on zero-order days.
 */
export function buildDailyChannelData(
  orders: ShopifyOrderNode[],
): DailyChannelData[] {
  // Bucket orders by PT date and channel
  const dailyMap = new Map<
    string,
    Record<ChannelName, number>
  >();

  for (const raw of orders) {
    const channel = classifyOrder(raw);
    const total = parseFloat(raw.totalPriceSet?.shopMoney?.amount ?? "0");
    const ptDay = new Date(raw.createdAt).toLocaleDateString("en-CA", {
      timeZone: "America/Los_Angeles",
    });

    let entry = dailyMap.get(ptDay);
    if (!entry) {
      entry = { dtc: 0, faire: 0, distributor: 0, other: 0 };
      dailyMap.set(ptDay, entry);
    }
    entry[channel] += total;
  }

  // Fill all 30 days for chart continuity (matches dashboard route pattern)
  const result: DailyChannelData[] = [];
  for (let i = 29; i >= 0; i--) {
    const dateStr = ptDate(i);
    const channels = dailyMap.get(dateStr) ?? {
      dtc: 0,
      faire: 0,
      distributor: 0,
      other: 0,
    };
    const d = new Date(dateStr + "T12:00:00Z");
    result.push({
      date: dateStr,
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      dtc: round2(channels.dtc),
      faire: round2(channels.faire),
      distributor: round2(channels.distributor),
      other: round2(channels.other),
      combined: round2(
        channels.dtc + channels.faire + channels.distributor + channels.other,
      ),
    });
  }

  return result;
}
