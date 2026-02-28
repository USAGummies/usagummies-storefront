/**
 * Amazon KPI Builder — shared computation logic for both API routes.
 *
 * KEY OPTIMIZATION: Fetches all orders from last 30 days in a SINGLE API call
 * (instead of 5 sequential calls), then derives all period aggregates locally.
 * This is ~4x faster and uses fewer API quota.
 *
 * Also computes daily breakdown for chart data.
 */

import type { AmazonKPIs, AmazonOrder, DailyDataPoint } from "./types";
import {
  fetchOrders,
  fetchFBAInventory,
  fetchFeesEstimate,
  fetchOrderItems,
  ptDateISO,
  ptDate,
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Filter orders within a date range.
 * Both boundaries are ISO strings; `after` is inclusive, `before` is exclusive.
 */
function ordersInRange(
  allOrders: AmazonOrder[],
  after: string,
  before: string,
): AmazonOrder[] {
  const afterTime = new Date(after).getTime();
  const beforeTime = new Date(before).getTime();
  return allOrders.filter((o) => {
    const t = new Date(o.PurchaseDate).getTime();
    return t >= afterTime && t < beforeTime;
  });
}

/**
 * Estimate total units from orders.
 * Fetches items for a small sample (max 5) in parallel, then extrapolates.
 */
async function estimateUnits(orders: AmazonOrder[]): Promise<number> {
  if (orders.length === 0) return 0;

  const sampleSize = Math.min(5, orders.length);
  const sample = orders.slice(0, sampleSize);

  const itemResults = await Promise.all(
    sample.map(async (order) => {
      try {
        const items = await fetchOrderItems(order.AmazonOrderId);
        return items.reduce((sum, item) => sum + item.QuantityOrdered, 0);
      } catch {
        return 1;
      }
    }),
  );

  const sampleTotal = itemResults.reduce((a, b) => a + b, 0);
  if (orders.length <= sampleSize) return sampleTotal;

  const avgUnitsPerOrder = sampleTotal / sampleSize;
  return Math.round(avgUnitsPerOrder * orders.length);
}

function aggregateInventory(
  inventory: { inventoryDetails?: {
    fulfillableQuantity?: number;
    inboundWorkingQuantity?: number;
    inboundShippedQuantity?: number;
    reservedQuantity?: { totalReservedQuantity?: number };
    unfulfillableQuantity?: { totalUnfulfillableQuantity?: number };
  }; totalQuantity?: number }[],
) {
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

/**
 * Build daily breakdown from all orders for chart data.
 * Groups orders by Pacific Time date and returns sorted array.
 */
function buildDailyBreakdown(
  allOrders: AmazonOrder[],
  daysBack: number,
): DailyDataPoint[] {
  // Build map of date → {revenue, orders}
  const dailyMap = new Map<string, { revenue: number; orders: number }>();

  for (const order of allOrders) {
    const ptDay = new Date(order.PurchaseDate).toLocaleDateString("en-CA", {
      timeZone: "America/Los_Angeles",
    });
    const existing = dailyMap.get(ptDay) || { revenue: 0, orders: 0 };
    const amt = order.OrderTotal?.Amount;
    existing.revenue += amt ? parseFloat(amt) : 0;
    existing.orders += 1;
    dailyMap.set(ptDay, existing);
  }

  // Fill in all days (including zero-order days) for clean chart
  const result: DailyDataPoint[] = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const dateStr = ptDate(i);
    const data = dailyMap.get(dateStr) || { revenue: 0, orders: 0 };
    const d = new Date(dateStr + "T12:00:00Z"); // noon UTC to avoid timezone shift
    result.push({
      date: dateStr,
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      revenue: round2(data.revenue),
      orders: data.orders,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main KPI builder
// ---------------------------------------------------------------------------

/**
 * Build the complete Amazon KPI payload.
 *
 * OPTIMIZATION: Fetches all orders from last 30 days in ONE API call
 * (vs. 5 sequential calls in v1). Then derives period aggregates locally.
 * Also returns daily breakdown for chart rendering.
 */
export async function buildAmazonKPIs(): Promise<AmazonKPIs> {
  const now = nowMinusBuffer();
  const todayStart = ptDateISO(0);
  const yesterdayStart = ptDateISO(1);
  const weekStart = weekStartPT();
  const lastWeekStart = lastWeekStartPT();
  const monthStart = monthStartPT();
  const thirtyDaysAgo = ptDateISO(30);

  // Determine earliest date we need (whichever is earlier: 30 days ago or lastWeekStart)
  const fetchFrom =
    new Date(thirtyDaysAgo).getTime() < new Date(lastWeekStart).getTime()
      ? thirtyDaysAgo
      : lastWeekStart;

  // SINGLE order fetch (30 days) + inventory in parallel
  const [allOrders, inventoryResult] = await Promise.all([
    fetchOrders(fetchFrom, now),
    fetchFBAInventory(),
  ]);
  const inventory = inventoryResult.items || [];

  // Derive period subsets locally (no additional API calls!)
  const todayOrders = ordersInRange(allOrders, todayStart, now);
  const yesterdayOrders = ordersInRange(allOrders, yesterdayStart, todayStart);
  const weekOrders = ordersInRange(allOrders, weekStart, now);
  const lastWeekOrders = ordersInRange(allOrders, lastWeekStart, weekStart);
  const monthOrders = ordersInRange(allOrders, monthStart, now);

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

  // Daily breakdown for charts
  const dailyBreakdown = buildDailyBreakdown(allOrders, 30);

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
    fees: {
      referralFee: round2(fees.referralFee),
      fbaFee: round2(fees.fbaFee),
      totalFee: round2(fees.totalFee),
      estimatedNetMargin:
        avgPrice > 0 ? Math.round(((avgPrice - fees.totalFee) / avgPrice) * 100) : 0,
    },
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
    dailyBreakdown,
    lastUpdated: new Date().toISOString(),
  };
}
