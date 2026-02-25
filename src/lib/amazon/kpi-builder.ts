/**
 * Amazon KPI Builder — shared computation logic for both API routes.
 *
 * Extracts the KPI computation from the route handlers to avoid duplication.
 * Uses sequential order fetching to respect SP-API rate limits.
 * Uses batch unit estimation instead of per-order item fetching.
 */

import type { AmazonKPIs, AmazonOrder, FBAInventorySummary, FeeEstimate } from "./types";
import {
  fetchOrdersSequential,
  fetchFBAInventory,
  fetchFeesEstimate,
  fetchOrderItems,
  ptDateISO,
  nowMinusBuffer,
  weekStartPT,
  lastWeekStartPT,
  monthStartPT,
} from "./sp-api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sumRevenue(orders: AmazonOrder[]): number {
  return orders.reduce((sum, o) => {
    const amt = o.OrderTotal?.Amount;
    return sum + (amt ? parseFloat(amt) : 0);
  }, 0);
}

function countByStatus(orders: AmazonOrder[]) {
  const counts = { pending: 0, unshipped: 0, shipped: 0, canceled: 0 };
  for (const o of orders) {
    switch (o.OrderStatus) {
      case "Pending":
      case "PendingAvailability":
        counts.pending++;
        break;
      case "Unshipped":
      case "PartiallyShipped":
        counts.unshipped++;
        break;
      case "Shipped":
        counts.shipped++;
        break;
      case "Canceled":
      case "Unfulfillable":
        counts.canceled++;
        break;
    }
  }
  return counts;
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Estimate total units from orders.
 * Fetches items for a small sample (max 5) in parallel, then extrapolates.
 * Much faster than the previous per-order sequential approach.
 */
async function estimateUnits(orders: AmazonOrder[]): Promise<number> {
  if (orders.length === 0) return 0;

  // Sample up to 5 orders (not 20!) to stay fast and within rate limits
  const sampleSize = Math.min(5, orders.length);
  const sample = orders.slice(0, sampleSize);

  // Fetch item details in parallel (OrderItems API has higher rate limits)
  const itemResults = await Promise.all(
    sample.map(async (order) => {
      try {
        const items = await fetchOrderItems(order.AmazonOrderId);
        return items.reduce((sum, item) => sum + item.QuantityOrdered, 0);
      } catch {
        return 1; // fallback: 1 unit per order
      }
    }),
  );

  const sampleTotal = itemResults.reduce((a, b) => a + b, 0);

  // Extrapolate if needed
  if (orders.length <= sampleSize) return sampleTotal;

  const avgUnitsPerOrder = sampleTotal / sampleSize;
  return Math.round(avgUnitsPerOrder * orders.length);
}

function aggregateInventory(inventory: FBAInventorySummary[]) {
  let fulfillable = 0,
    inboundWorking = 0,
    inboundShipped = 0,
    reserved = 0,
    unfulfillable = 0,
    totalQuantity = 0;

  for (const inv of inventory) {
    const d = inv.inventoryDetails;
    if (d) {
      fulfillable += d.fulfillableQuantity || 0;
      inboundWorking += d.inboundWorkingQuantity || 0;
      inboundShipped += d.inboundShippedQuantity || 0;
      reserved += d.reservedQuantity?.totalReservedQuantity || 0;
      unfulfillable += d.unfulfillableQuantity?.totalUnfulfillableQuantity || 0;
    }
    totalQuantity += inv.totalQuantity || 0;
  }

  return { fulfillable, inboundWorking, inboundShipped, reserved, unfulfillable, totalQuantity };
}

function buildFees(fees: FeeEstimate, avgPrice: number) {
  return {
    referralFee: Math.round(fees.referralFee * 100) / 100,
    fbaFee: Math.round(fees.fbaFee * 100) / 100,
    totalFee: Math.round(fees.totalFee * 100) / 100,
    estimatedNetMargin:
      avgPrice > 0 ? Math.round(((avgPrice - fees.totalFee) / avgPrice) * 100) : 0,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Main KPI builder
// ---------------------------------------------------------------------------

/**
 * Build the complete Amazon KPI payload.
 * Fetches orders SEQUENTIALLY to respect SP-API rate limits.
 * Fetches inventory in parallel with the first order batch.
 */
export async function buildAmazonKPIs(): Promise<AmazonKPIs> {
  const now = nowMinusBuffer();
  const todayStart = ptDateISO(0);
  const yesterdayStart = ptDateISO(1);
  const weekStart = weekStartPT();
  const lastWeekStart = lastWeekStartPT();
  const monthStart = monthStartPT();

  // Start inventory fetch in parallel (different API, different rate limit)
  const inventoryPromise = fetchFBAInventory();

  // Fetch orders SEQUENTIALLY to respect 1-req/5s rate limit
  const [todayOrders, yesterdayOrders, weekOrders, lastWeekOrders, monthOrders] =
    await fetchOrdersSequential([
      { after: todayStart, before: now },
      { after: yesterdayStart, before: todayStart },
      { after: weekStart, before: now },
      { after: lastWeekStart, before: weekStart },
      { after: monthStart, before: now },
    ]);

  // Wait for inventory
  const inventory = await inventoryPromise;

  // Revenue calculations
  const todayRevenue = sumRevenue(todayOrders);
  const yesterdayRevenue = sumRevenue(yesterdayOrders);
  const weekRevenue = sumRevenue(weekOrders);
  const lastWeekRevenue = sumRevenue(lastWeekOrders);
  const monthRevenue = sumRevenue(monthOrders);

  // Unit estimates (parallel, small sample per set)
  const [todayUnits, weekUnits, monthUnits, lastWeekUnits] = await Promise.all([
    estimateUnits(todayOrders),
    estimateUnits(weekOrders),
    estimateUnits(monthOrders),
    estimateUnits(lastWeekOrders),
  ]);

  // Order status from recent orders
  const orderStatus = countByStatus([...todayOrders, ...yesterdayOrders]);

  // Inventory aggregation
  const inv = aggregateInventory(inventory);

  // Velocity
  const unitsPerDay7d = weekUnits > 0 ? Math.round((weekUnits / 7) * 10) / 10 : 0;
  const daysOfSupply = unitsPerDay7d > 0 ? Math.round(inv.fulfillable / unitsPerDay7d) : 999;
  const lastWeekVelocity = lastWeekUnits > 0 ? lastWeekUnits / 7 : 0;
  const trend: "up" | "down" | "flat" =
    unitsPerDay7d > lastWeekVelocity * 1.1
      ? "up"
      : unitsPerDay7d < lastWeekVelocity * 0.9
        ? "down"
        : "flat";

  // Fee estimates
  const avgPrice = todayOrders.length > 0 ? todayRevenue / todayOrders.length : 29.99;
  const fees = await fetchFeesEstimate(avgPrice);

  return {
    orders: {
      today: todayOrders.length,
      yesterday: yesterdayOrders.length,
      weekToDate: weekOrders.length,
      lastWeek: lastWeekOrders.length,
      monthToDate: monthOrders.length,
    },
    revenue: {
      today: round2(todayRevenue),
      yesterday: round2(yesterdayRevenue),
      weekToDate: round2(weekRevenue),
      lastWeek: round2(lastWeekRevenue),
      monthToDate: round2(monthRevenue),
    },
    aov: {
      today: todayOrders.length > 0 ? round2(todayRevenue / todayOrders.length) : 0,
      weekToDate: weekOrders.length > 0 ? round2(weekRevenue / weekOrders.length) : 0,
    },
    unitsSold: { today: todayUnits, weekToDate: weekUnits, monthToDate: monthUnits },
    orderStatus,
    inventory: {
      ...inv,
      daysOfSupply,
      restockAlert: daysOfSupply < 14,
    },
    fees: buildFees(fees, avgPrice),
    velocity: { unitsPerDay7d, trend },
    comparison: {
      todayVsYesterday: {
        revenueDelta: round2(todayRevenue - yesterdayRevenue),
        revenuePct: pctChange(todayRevenue, yesterdayRevenue),
        ordersDelta: todayOrders.length - yesterdayOrders.length,
        ordersPct: pctChange(todayOrders.length, yesterdayOrders.length),
      },
      weekOverWeek: {
        revenueDelta: round2(weekRevenue - lastWeekRevenue),
        revenuePct: pctChange(weekRevenue, lastWeekRevenue),
        ordersDelta: weekOrders.length - lastWeekOrders.length,
        ordersPct: pctChange(weekOrders.length, lastWeekOrders.length),
      },
    },
    lastUpdated: new Date().toISOString(),
  };
}
