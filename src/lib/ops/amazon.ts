/**
 * AMAZON — FBA Operations Specialist for USA Gummies
 *
 * Monitors FBA inventory, tracks sell-through velocity, calculates
 * restock points, and provides PPC/listing health data.
 *
 * Data persisted in Vercel KV under amazon:* keys.
 * Uses Shopify Admin API for Amazon channel orders when SP-API unavailable.
 */

import { kv } from "@vercel/kv";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FBAInventorySnapshot {
  asin: string;
  sku: string;
  product_name: string;
  fulfillable_quantity: number;
  inbound_quantity: number;
  reserved_quantity: number;
  total_quantity: number;
  days_of_supply: number; // computed from velocity
  restock_needed: boolean;
  restock_alert_level: "ok" | "low" | "critical" | "stockout";
  snapshot_date: string;
}

export interface SalesVelocity {
  asin: string;
  period_days: number;
  units_sold: number;
  revenue: number;
  avg_daily_units: number;
  avg_daily_revenue: number;
  trend: "up" | "flat" | "down";
}

export interface RestockRecommendation {
  asin: string;
  sku: string;
  current_fba_units: number;
  daily_velocity: number;
  days_until_stockout: number;
  recommended_send_qty: number;
  recommended_send_by: string; // ISO date
  lead_time_days: number;
  warehouse_available: number; // units at Ashford
  status: "ok" | "plan_shipment" | "urgent" | "stockout_imminent";
}

export interface PPCSummary {
  campaign_count: number;
  total_spend: number;
  total_sales: number;
  acos: number; // advertising cost of sales %
  impressions: number;
  clicks: number;
  ctr: number; // click-through rate %
  orders: number;
  conversion_rate: number;
  period: string;
  fetched_at: string;
}

export interface ListingHealth {
  asin: string;
  title: string;
  status: "active" | "suppressed" | "inactive" | "unknown";
  buy_box_owned: boolean;
  current_price: number;
  rating?: number;
  review_count?: number;
  issues: string[];
  last_checked: string;
}

export interface FBAHealthReport {
  inventory: FBAInventorySnapshot[];
  velocity: SalesVelocity[];
  restock: RestockRecommendation[];
  ppc?: PPCSummary;
  listings: ListingHealth[];
  alerts: string[];
  generated_at: string;
}

// ---------------------------------------------------------------------------
// KV Keys
// ---------------------------------------------------------------------------

const KV_INVENTORY_SNAPSHOTS = "amazon:inventory_snapshots";
const KV_SALES_HISTORY = "amazon:sales_history";
const KV_PPC_HISTORY = "amazon:ppc_history";
const KV_LISTING_HEALTH = "amazon:listing_health";

// ---------------------------------------------------------------------------
// Inventory & Velocity Tracking
// ---------------------------------------------------------------------------

export async function recordInventorySnapshot(
  snapshot: FBAInventorySnapshot
): Promise<FBAInventorySnapshot> {
  const all = (await kv.get<FBAInventorySnapshot[]>(KV_INVENTORY_SNAPSHOTS)) || [];
  all.push(snapshot);
  if (all.length > 365) all.splice(0, all.length - 365); // Keep ~1 year daily
  await kv.set(KV_INVENTORY_SNAPSHOTS, all);
  return snapshot;
}

export async function getLatestInventory(): Promise<FBAInventorySnapshot[]> {
  const all = (await kv.get<FBAInventorySnapshot[]>(KV_INVENTORY_SNAPSHOTS)) || [];
  if (all.length === 0) return [];

  // Get most recent date's snapshots
  const latestDate = all[all.length - 1].snapshot_date;
  return all.filter((s) => s.snapshot_date === latestDate);
}

export async function recordSalesData(data: {
  asin: string;
  date: string;
  units_sold: number;
  revenue: number;
}): Promise<void> {
  const all = (await kv.get<Array<typeof data>>(KV_SALES_HISTORY)) || [];
  all.push(data);
  if (all.length > 730) all.splice(0, all.length - 730); // 2 years daily
  await kv.set(KV_SALES_HISTORY, all);
}

export async function getSalesVelocity(
  asin: string,
  periodDays = 30,
): Promise<SalesVelocity> {
  const all = (await kv.get<Array<{
    asin: string; date: string; units_sold: number; revenue: number;
  }>>(KV_SALES_HISTORY)) || [];

  const cutoff = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const recent = all.filter((s) => s.asin === asin && s.date >= cutoff);

  const totalUnits = recent.reduce((sum, s) => sum + s.units_sold, 0);
  const totalRevenue = recent.reduce((sum, s) => sum + s.revenue, 0);
  const daysWithData = Math.max(1, recent.length);

  // Trend: compare first half to second half
  const mid = Math.floor(recent.length / 2);
  const firstHalfUnits = recent.slice(0, mid).reduce((sum, s) => sum + s.units_sold, 0);
  const secondHalfUnits = recent.slice(mid).reduce((sum, s) => sum + s.units_sold, 0);
  let trend: "up" | "flat" | "down" = "flat";
  if (secondHalfUnits > firstHalfUnits * 1.2) trend = "up";
  else if (secondHalfUnits < firstHalfUnits * 0.8) trend = "down";

  return {
    asin,
    period_days: periodDays,
    units_sold: totalUnits,
    revenue: Math.round(totalRevenue * 100) / 100,
    avg_daily_units: Math.round((totalUnits / daysWithData) * 10) / 10,
    avg_daily_revenue: Math.round((totalRevenue / daysWithData) * 100) / 100,
    trend,
  };
}

// ---------------------------------------------------------------------------
// Restock Calculator
// ---------------------------------------------------------------------------

export async function checkRestock(params?: {
  lead_time_days?: number;
  target_days_of_supply?: number;
}): Promise<RestockRecommendation[]> {
  const leadTime = params?.lead_time_days || 14; // 2 weeks default
  const targetDOS = params?.target_days_of_supply || 60; // 2 months supply

  const inventory = await getLatestInventory();
  const recommendations: RestockRecommendation[] = [];

  // Get warehouse on-hand from INVENTORY specialist
  let warehouseUnits = 0;
  try {
    const locations = (await kv.get<Array<{ location: string; units: number }>>("inventory:locations")) || [];
    const ashford = locations.find((l) => l.location === "Ashford");
    if (ashford) warehouseUnits = ashford.units;
  } catch { /* ignore */ }

  for (const inv of inventory) {
    const velocity = await getSalesVelocity(inv.asin, 30);
    const dailyRate = velocity.avg_daily_units || 0.5; // min 0.5/day to avoid division by zero

    const daysUntilStockout = inv.fulfillable_quantity > 0
      ? Math.round(inv.fulfillable_quantity / dailyRate)
      : 0;

    const recommendedQty = Math.max(0, Math.ceil((targetDOS * dailyRate) - inv.fulfillable_quantity - inv.inbound_quantity));
    const sendByDate = new Date(Date.now() + Math.max(0, (daysUntilStockout - leadTime)) * 24 * 60 * 60 * 1000);

    let status: RestockRecommendation["status"] = "ok";
    if (daysUntilStockout <= 0) status = "stockout_imminent";
    else if (daysUntilStockout <= leadTime) status = "urgent";
    else if (daysUntilStockout <= leadTime * 2) status = "plan_shipment";

    recommendations.push({
      asin: inv.asin,
      sku: inv.sku,
      current_fba_units: inv.fulfillable_quantity,
      daily_velocity: dailyRate,
      days_until_stockout: daysUntilStockout,
      recommended_send_qty: recommendedQty,
      recommended_send_by: sendByDate.toISOString().split("T")[0],
      lead_time_days: leadTime,
      warehouse_available: warehouseUnits,
      status,
    });
  }

  return recommendations;
}

// ---------------------------------------------------------------------------
// PPC Tracking
// ---------------------------------------------------------------------------

export async function recordPPCSummary(summary: PPCSummary): Promise<void> {
  const all = (await kv.get<PPCSummary[]>(KV_PPC_HISTORY)) || [];
  all.push(summary);
  if (all.length > 365) all.splice(0, all.length - 365);
  await kv.set(KV_PPC_HISTORY, all);
}

export async function getLatestPPC(): Promise<PPCSummary | null> {
  const all = (await kv.get<PPCSummary[]>(KV_PPC_HISTORY)) || [];
  return all.length > 0 ? all[all.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Listing Health
// ---------------------------------------------------------------------------

export async function recordListingHealth(listing: ListingHealth): Promise<void> {
  const all = (await kv.get<ListingHealth[]>(KV_LISTING_HEALTH)) || [];
  const idx = all.findIndex((l) => l.asin === listing.asin);
  if (idx >= 0) all[idx] = listing;
  else all.push(listing);
  await kv.set(KV_LISTING_HEALTH, all);
}

export async function getListingHealth(): Promise<ListingHealth[]> {
  return (await kv.get<ListingHealth[]>(KV_LISTING_HEALTH)) || [];
}

// ---------------------------------------------------------------------------
// Comprehensive Health Report
// ---------------------------------------------------------------------------

export async function generateFBAHealthReport(): Promise<FBAHealthReport> {
  const inventory = await getLatestInventory();
  const listings = await getListingHealth();
  const ppc = await getLatestPPC();
  const restock = await checkRestock();

  const velocity: SalesVelocity[] = [];
  for (const inv of inventory) {
    velocity.push(await getSalesVelocity(inv.asin, 30));
  }

  const alerts: string[] = [];

  // Check for stockout risks
  for (const r of restock) {
    if (r.status === "stockout_imminent") {
      alerts.push(`🔴 STOCKOUT IMMINENT: ${r.sku} — ${r.days_until_stockout} days left at current velocity`);
    } else if (r.status === "urgent") {
      alerts.push(`🟡 RESTOCK URGENT: ${r.sku} — send ${r.recommended_send_qty} units by ${r.recommended_send_by}`);
    }
  }

  // Check for listing issues
  for (const l of listings) {
    if (l.status === "suppressed") {
      alerts.push(`🔴 LISTING SUPPRESSED: ${l.asin} — ${l.issues.join(", ")}`);
    }
    if (!l.buy_box_owned) {
      alerts.push(`🟡 LOST BUY BOX: ${l.asin}`);
    }
  }

  // Check PPC health
  if (ppc && ppc.acos > 30) {
    alerts.push(`🟡 HIGH ACOS: ${ppc.acos.toFixed(1)}% — review PPC campaigns`);
  }

  return {
    inventory,
    velocity,
    restock,
    ppc: ppc || undefined,
    listings,
    alerts,
    generated_at: new Date().toISOString(),
  };
}
