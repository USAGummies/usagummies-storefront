/**
 * Smart Reorder System
 *
 * Monitors inventory velocity and triggers alerts/actions at thresholds:
 *  - 45 days runway → INFO: start planning
 *  - 30 days runway → WARNING: draft PO to Powers
 *  - 14 days runway → CRITICAL: escalate to Ben
 *
 * Calculates optimal order quantities based on velocity + safety stock.
 */

import { notifyAlert, notifyDaily } from "@/lib/ops/notify";
import { proposeAndMaybeExecute } from "@/lib/ops/abra-actions";

export type ReorderAnalysis = {
  currentUnits: number;
  dailyVelocity: number;
  runwayDays: number;
  reorderPoint: number; // Units at which to reorder
  suggestedOrderQty: number;
  estimatedOrderCost: number;
  alertLevel: "ok" | "plan" | "order" | "critical";
  actions: string[];
  timestamp: string;
};

// USA Gummies production parameters
const COGS_PER_UNIT = 1.557;
const COPACKER_RATE = 0.385;
const MIN_ORDER_QTY = 25000; // Minimum viable production run
const LEAD_TIME_DAYS = 21; // Powers production lead time
const SAFETY_STOCK_DAYS = 14; // Buffer for demand spikes

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function getCurrentInventory(): Promise<number> {
  // Pull from Shopify Admin API via internal endpoint
  try {
    const host = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.NEXT_PUBLIC_SITE_URL || "https://www.usagummies.com";
    const cronSecret = (process.env.CRON_SECRET || "").trim();

    const res = await fetch(`${host}/api/ops/abra/chat?mode=health`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({ message: "health" }),
      signal: AbortSignal.timeout(10000),
    });

    // Fallback: use brain entries for latest inventory count
    const env = getSupabaseEnv();
    if (!env) return 0;

    const rows = await fetch(
      `${env.baseUrl}/rest/v1/open_brain_entries?title=ilike.*inventory*&select=summary_text&order=created_at.desc&limit=1`,
      {
        headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!rows.ok) return 0;

    const data = (await rows.json()) as Array<{ summary_text: string }>;
    const text = data[0]?.summary_text || "";
    const match = text.match(/(\d+)\s*units?\s*(remaining|left|on hand|in stock|available)/i);
    return match ? parseInt(match[1]) : 0;
  } catch {
    return 0;
  }
}

async function getDailyVelocity(): Promise<number> {
  const env = getSupabaseEnv();
  if (!env) return 6.7; // Default from brain

  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const res = await fetch(
      `${env.baseUrl}/rest/v1/kpi_timeseries?window_type=eq.daily&metric_name=in.(daily_orders_shopify,daily_orders_amazon)&captured_for_date=gte.${thirtyDaysAgo}&select=value&limit=500`,
      {
        headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) return 6.7;

    const rows = (await res.json()) as Array<{ value: number }>;
    const totalOrders = Array.isArray(rows) ? rows.reduce((s, r) => s + (Number(r.value) || 0), 0) : 0;
    // Assume ~1.5 units per order on average
    return totalOrders > 0 ? Math.round((totalOrders * 1.5 / 30) * 100) / 100 : 6.7;
  } catch {
    return 6.7;
  }
}

export async function analyzeReorderStatus(): Promise<ReorderAnalysis> {
  const [currentUnits, dailyVelocity] = await Promise.all([
    getCurrentInventory(),
    getDailyVelocity(),
  ]);

  const runwayDays = dailyVelocity > 0 ? Math.round(currentUnits / dailyVelocity) : 999;
  const reorderPoint = Math.round(dailyVelocity * (LEAD_TIME_DAYS + SAFETY_STOCK_DAYS));

  // Calculate suggested order: enough for 90 days + lead time, minimum 25K
  const targetDays = 90 + LEAD_TIME_DAYS;
  const suggestedQty = Math.max(MIN_ORDER_QTY, Math.ceil((dailyVelocity * targetDays) / 1000) * 1000);
  const estimatedCost = Math.round(suggestedQty * COGS_PER_UNIT * 100) / 100;

  let alertLevel: ReorderAnalysis["alertLevel"] = "ok";
  const actions: string[] = [];

  if (runwayDays <= 14) {
    alertLevel = "critical";
    actions.push("CRITICAL: Initiate production run immediately");
    actions.push(`Order ${suggestedQty.toLocaleString()} units from Powers ($${estimatedCost.toLocaleString()})`);
    actions.push("Contact Greg Kroetch at Powers — gregk@powers-inc.com");
  } else if (runwayDays <= 30) {
    alertLevel = "order";
    actions.push("Place production order with Powers this week");
    actions.push(`Recommended: ${suggestedQty.toLocaleString()} units ($${estimatedCost.toLocaleString()})`);
  } else if (runwayDays <= 45) {
    alertLevel = "plan";
    actions.push("Start planning next production run");
    actions.push(`Current velocity: ${dailyVelocity} units/day`);
  }

  const result: ReorderAnalysis = {
    currentUnits,
    dailyVelocity,
    runwayDays,
    reorderPoint,
    suggestedOrderQty: suggestedQty,
    estimatedOrderCost: estimatedCost,
    alertLevel,
    actions,
    timestamp: new Date().toISOString(),
  };

  // Send alerts based on level
  if (alertLevel === "critical") {
    void notifyAlert(
      `🚨 *INVENTORY CRITICAL — ${runwayDays} days runway*\n${currentUnits} units remaining at ${dailyVelocity} units/day\nInitiate ${suggestedQty.toLocaleString()} unit production run NOW\nEstimated cost: $${estimatedCost.toLocaleString()}`,
      true, // SMS alert
    );

    // Auto-draft email to Powers
    void proposeAndMaybeExecute({
      action_type: "draft_email_reply",
      title: "Urgent: Production Run Order — Powers Confections",
      description: `Auto-generated: inventory at ${runwayDays} days runway, need ${suggestedQty.toLocaleString()} unit production run`,
      department: "operations",
      risk_level: "high",
      requires_approval: true,
      confidence: 0.9,
      params: {
        to: "gregk@powers-inc.com",
        subject: "Production Run Order — USA Gummies",
        body: `Hi Greg,\n\nWe need to initiate our next production run. Our inventory is at ${currentUnits} units with ${runwayDays} days of runway.\n\nRequested order:\n- Quantity: ${suggestedQty.toLocaleString()} units\n- Timeline: ASAP\n\nCan you confirm availability and lead time? Happy to discuss details.\n\nBest,\nBen Stutman\nUSA Gummies`,
        auto_generated: true,
      },
    }).catch(() => {});
  } else if (alertLevel === "order") {
    void notifyDaily(
      `📦 *Inventory Alert — ${runwayDays} days runway*\n${currentUnits} units at ${dailyVelocity}/day velocity\nRecommended: Order ${suggestedQty.toLocaleString()} units ($${estimatedCost.toLocaleString()})`,
    );
  }

  return result;
}
