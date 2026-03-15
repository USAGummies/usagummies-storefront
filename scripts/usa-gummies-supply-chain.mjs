#!/usr/bin/env node
/**
 * USA Gummies — Supply Chain & Production Orchestrator (Build 5)
 *
 * 8 autonomous agents that manage inventory levels, production scheduling,
 * supplier relationships, and fulfillment logistics. Predicts when to reorder
 * raw materials, schedule production runs, and when inventory will run out
 * based on sales velocity.
 *
 * Agents:
 *   SC1 — Inventory Level Monitor      Daily 7:00 AM
 *   SC2 — Sales Velocity Calculator     Daily 7:15 AM
 *   SC3 — Reorder Point Calculator      Daily 7:30 AM
 *   SC4 — Production Scheduler          Weekly Mon 7:00 AM
 *   SC5 — Supplier Price Tracker        Monthly 1st 8:00 AM
 *   SC6 — Fulfillment Monitor           Daily 12:00 PM
 *   SC7 — Amazon FBA Inventory Sync     Daily 1:00 PM
 *   SC8 — Self-Heal Monitor             Every 30 min
 *
 * Usage:
 *   node scripts/usa-gummies-supply-chain.mjs run SC1
 *   node scripts/usa-gummies-supply-chain.mjs run all
 *   node scripts/usa-gummies-supply-chain.mjs status
 *   node scripts/usa-gummies-supply-chain.mjs help
 */

import {
  createEngine,
  todayET,
  todayLongET,
  nowETTimestamp,
  addDaysToDate,
  daysSince,
  safeJsonRead,
  safeJsonWrite,
  fetchWithTimeout,
  textBen,
  log as sharedLog,
} from "./lib/usa-gummies-shared.mjs";

import { callLLM, parseLLMJson, loadVersionedPrompt } from "./lib/llm.mjs";
import fs from "node:fs";
import path from "node:path";

// ── Environment ──────────────────────────────────────────────────────────────

const HOME = process.env.HOME || "/Users/ben";
const ENV_FILE = path.join(HOME, ".config/usa-gummies-mcp/.env-daily-report");
const CONFIG_DIR = path.join(HOME, ".config/usa-gummies-mcp");

function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  const lines = fs.readFileSync(ENV_FILE, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

// ── Shopify Config ───────────────────────────────────────────────────────────

const SHOPIFY_STORE = "usa-gummies.myshopify.com";
const SHOPIFY_API_VERSION = "2025-01";
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_API_TOKEN || "";

async function shopifyAdmin(endpoint, method = "GET", body = null) {
  const url = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}${endpoint}`;
  const opts = {
    method,
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": SHOPIFY_TOKEN },
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetchWithTimeout(url, opts, 20000);
    if (!res.ok) return { ok: false, error: `Shopify ${res.status}: ${res.statusText}` };
    return { ok: true, data: await res.json() };
  } catch (err) { return { ok: false, error: err.message }; }
}

// ── Amazon SP-API Config ─────────────────────────────────────────────────────

const AMZN_SELLER_ID = "A16G27VYDSSEGO";
const AMZN_MARKETPLACE = "ATVPDKIKX0DER";
const AMZN_REFRESH_TOKEN = process.env.AMAZON_REFRESH_TOKEN || "";
const AMZN_CLIENT_ID = process.env.AMAZON_CLIENT_ID || "";
const AMZN_CLIENT_SECRET = process.env.AMAZON_CLIENT_SECRET || "";

async function getAmazonToken() {
  if (!AMZN_REFRESH_TOKEN || !AMZN_CLIENT_ID || !AMZN_CLIENT_SECRET) return null;
  try {
    const res = await fetchWithTimeout("https://api.amazon.com/auth/o2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(AMZN_REFRESH_TOKEN)}&client_id=${encodeURIComponent(AMZN_CLIENT_ID)}&client_secret=${encodeURIComponent(AMZN_CLIENT_SECRET)}`,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token || null;
  } catch { return null; }
}

// ── State Files ──────────────────────────────────────────────────────────────

const INVENTORY_SNAPSHOT_FILE = path.join(CONFIG_DIR, "inventory-snapshot.json");
const SALES_VELOCITY_FILE = path.join(CONFIG_DIR, "sales-velocity-cache.json");

// ── Notion DB IDs ────────────────────────────────────────────────────────────

const IDS = {
  inventoryTracker: process.env.NOTION_DB_INVENTORY_TRACKER || "",
  rawMaterials: process.env.NOTION_DB_RAW_MATERIALS || "",
  productionRuns: process.env.NOTION_DB_PRODUCTION_RUNS || "",
  supplierDirectory: process.env.NOTION_DB_SUPPLIER_DIRECTORY || "",
};

// ── Required DB Schemas ──────────────────────────────────────────────────────

const DB_SCHEMAS = {
  inventoryTracker: {
    SKU: "title",
    "Product Name": "rich_text",
    Variant: "rich_text",
    "Current Stock": "number",
    "Daily Burn Rate": "number",
    "Days Remaining": "number",
    "Reorder Point": "number",
    "Last Updated": "date",
    Channel: { select: { options: [{ name: "Shopify" }, { name: "Amazon" }, { name: "Faire" }] } },
  },
  rawMaterials: {
    "Material Name": "title",
    "Current Stock": "number",
    "Unit Cost": "number",
    Supplier: "rich_text",
    "Lead Time": "number",
    "Reorder Point": "number",
    "Reorder Quantity": "number",
    "Last Ordered Date": "date",
  },
  productionRuns: {
    "Run Date": "title",
    Products: "rich_text",
    Quantity: "number",
    "Co-Packer": "rich_text",
    Status: { select: { options: [{ name: "Planned" }, { name: "In-Production" }, { name: "Complete" }, { name: "Shipped" }] } },
    Cost: "number",
    Notes: "rich_text",
  },
  supplierDirectory: {
    "Supplier Name": "title",
    Contact: "rich_text",
    "Materials Supplied": "rich_text",
    "Last Quote Date": "date",
    "Quote Amount": "number",
    "Payment Terms": "rich_text",
    "Lead Time": "number",
  },
};

// ── Schedule Plan ────────────────────────────────────────────────────────────

const SCHEDULE_PLAN = {
  SC1: "Daily 7:00 AM",
  SC2: "Daily 7:15 AM",
  SC3: "Daily 7:30 AM",
  SC4: "Weekly Mon 7:00 AM",
  SC5: "Monthly 1st 8:00 AM",
  SC6: "Daily 12:00 PM",
  SC7: "Daily 1:00 PM",
  SC8: "Every 30 min",
};

// ── Engine Bootstrap ─────────────────────────────────────────────────────────

const engine = createEngine({
  name: "supply-chain",
  schedulePlan: SCHEDULE_PLAN,
  ids: IDS,
});

const log = (msg) => engine.log(msg);
const DRY_RUN = process.argv.includes("--dry-run");

// ── Inventory thresholds ─────────────────────────────────────────────────────

const LOW_STOCK_DAYS = 14; // Alert when <14 days remaining
const SAFETY_STOCK_DAYS = 7; // Safety stock = 7 days of sales velocity
const PRODUCTION_LEAD_DAYS = 21; // ~3 weeks via co-packer

// ══════════════════════════════════════════════════════════════════════════════
//  AGENTS
// ══════════════════════════════════════════════════════════════════════════════

// ── SC1: Inventory Level Monitor ─────────────────────────────────────────────

async function runSC1() {
  log("SC1 — Inventory Level Monitor starting...");
  if (!SHOPIFY_TOKEN) return engine.fail("SC1", "No Shopify Admin token");

  // Fetch products with inventory
  const res = await shopifyAdmin("/products.json?limit=250&fields=id,title,variants");
  if (!res.ok) return engine.fail("SC1", `Shopify error: ${res.error}`);

  const products = res.data?.products || [];
  const snapshot = safeJsonRead(INVENTORY_SNAPSHOT_FILE, { skus: {}, history: {} });
  const today = todayET();
  const alerts = [];

  for (const product of products) {
    for (const variant of product.variants || []) {
      const sku = variant.sku || `V${variant.id}`;
      const stock = variant.inventory_quantity || 0;
      const title = `${product.title} — ${variant.title}`;

      // Calculate daily burn rate from history
      const history = snapshot.history[sku] || [];
      history.push({ date: today, stock });
      // Keep last 90 days
      while (history.length > 90) history.shift();
      snapshot.history[sku] = history;

      // 7-day rolling average burn rate
      let burnRate = 0;
      if (history.length >= 2) {
        const recent = history.slice(-8); // last 8 data points for 7-day window
        if (recent.length >= 2) {
          const stockDrop = recent[0].stock - recent[recent.length - 1].stock;
          const daySpan = Math.max(1, daysSince(recent[0].date));
          burnRate = Math.max(0, stockDrop / daySpan);
        }
      }

      const daysRemaining = burnRate > 0 ? Math.round(stock / burnRate) : stock > 0 ? 999 : 0;

      snapshot.skus[sku] = {
        sku,
        productName: title,
        currentStock: stock,
        dailyBurnRate: Math.round(burnRate * 100) / 100,
        daysRemaining,
        lastUpdated: today,
        channel: "Shopify",
      };

      // Alert if low stock
      if (daysRemaining < LOW_STOCK_DAYS && stock > 0) {
        alerts.push(`⚠️ ${title}: ${stock} units left (~${daysRemaining} days)`);
      } else if (stock === 0) {
        alerts.push(`🔴 ${title}: OUT OF STOCK`);
      }
    }
  }

  snapshot.lastScan = today;
  safeJsonWrite(INVENTORY_SNAPSHOT_FILE, snapshot);

  // Write to Notion
  if (IDS.inventoryTracker && !DRY_RUN) {
    for (const [sku, data] of Object.entries(snapshot.skus).slice(0, 20)) {
      try {
        await engine.createPage(IDS.inventoryTracker, {
          SKU: { title: [{ text: { content: sku } }] },
          "Product Name": { rich_text: [{ text: { content: data.productName.slice(0, 100) } }] },
          "Current Stock": { number: data.currentStock },
          "Daily Burn Rate": { number: data.dailyBurnRate },
          "Days Remaining": { number: data.daysRemaining },
          "Last Updated": { date: { start: today } },
          Channel: { select: { name: "Shopify" } },
        });
      } catch (err) { log(`SC1 — Notion error: ${err.message}`); }
    }
  }

  // Alert Ben if any low stock
  if (alerts.length > 0 && !DRY_RUN) {
    textBen(`📦 Inventory Alert — ${todayLongET()}\n\n${alerts.slice(0, 10).join("\n")}`);
  }

  const totalSKUs = Object.keys(snapshot.skus).length;
  log(`SC1 — Done: ${totalSKUs} SKUs tracked, ${alerts.length} alerts`);
  return engine.succeed("SC1", { totalSKUs, alerts: alerts.length });
}

// ── SC2: Sales Velocity Calculator ───────────────────────────────────────────

async function runSC2() {
  log("SC2 — Sales Velocity Calculator starting...");
  if (!SHOPIFY_TOKEN) return engine.fail("SC2", "No Shopify Admin token");

  const today = todayET();
  const thirtyDaysAgo = addDaysToDate(today, -30);

  // Fetch recent orders for velocity calculation
  const res = await shopifyAdmin(
    `/orders.json?status=any&created_at_min=${thirtyDaysAgo}T00:00:00-05:00&limit=250`
  );
  if (!res.ok) return engine.fail("SC2", `Shopify error: ${res.error}`);

  const orders = res.data?.orders || [];
  const velocityData = safeJsonRead(SALES_VELOCITY_FILE, { skus: {}, lastCalculated: null });

  // Count units sold per SKU per day
  const dailySales = {}; // sku → { date → units }

  for (const order of orders) {
    const orderDate = (order.created_at || "").slice(0, 10);
    for (const item of order.line_items || []) {
      const sku = item.sku || item.variant_id?.toString() || item.title;
      if (!dailySales[sku]) dailySales[sku] = {};
      dailySales[sku][orderDate] = (dailySales[sku][orderDate] || 0) + (item.quantity || 1);
    }
  }

  // Calculate velocity for each SKU
  for (const [sku, sales] of Object.entries(dailySales)) {
    const totalUnits = Object.values(sales).reduce((s, v) => s + v, 0);
    const daysWithData = Object.keys(sales).length;
    const daySpan = Math.max(1, daysSince(thirtyDaysAgo));

    // 7-day velocity
    const sevenDaysAgo = addDaysToDate(today, -7);
    const recentUnits = Object.entries(sales)
      .filter(([d]) => d >= sevenDaysAgo)
      .reduce((s, [, v]) => s + v, 0);

    const velocity7d = recentUnits / 7;
    const velocity30d = totalUnits / daySpan;

    // Trend: compare first half to second half of 30 days
    const midDate = addDaysToDate(today, -15);
    const firstHalf = Object.entries(sales).filter(([d]) => d < midDate).reduce((s, [, v]) => s + v, 0);
    const secondHalf = Object.entries(sales).filter(([d]) => d >= midDate).reduce((s, [, v]) => s + v, 0);
    const trend = firstHalf > 0 ? ((secondHalf - firstHalf) / firstHalf) * 100 : 0;

    velocityData.skus[sku] = {
      sku,
      totalUnits30d: totalUnits,
      velocity7d: Math.round(velocity7d * 100) / 100,
      velocity30d: Math.round(velocity30d * 100) / 100,
      trend: Math.round(trend),
      trendDirection: trend > 10 ? "accelerating" : trend < -10 ? "decelerating" : "stable",
      daysWithSales: daysWithData,
      lastCalculated: today,
    };
  }

  velocityData.lastCalculated = today;
  safeJsonWrite(SALES_VELOCITY_FILE, velocityData);

  const totalSKUs = Object.keys(velocityData.skus).length;
  const accelerating = Object.values(velocityData.skus).filter((s) => s.trendDirection === "accelerating").length;
  const decelerating = Object.values(velocityData.skus).filter((s) => s.trendDirection === "decelerating").length;

  log(`SC2 — Done: ${totalSKUs} SKUs — ${accelerating} accelerating, ${decelerating} decelerating`);
  return engine.succeed("SC2", { totalSKUs, accelerating, decelerating });
}

// ── LLM: Demand Forecast ────────────────────────────────────────────────────

async function generateDemandForecast(data) {
  const fallbackSystemPrompt =
    "You are a supply chain demand planner for USA Gummies (CPG gummy bears). " +
    "Given SKU velocity data and inventory levels, provide: (1) demand forecast for next " +
    "30/60/90 days per SKU, (2) reorder recommendations with quantities, (3) seasonal " +
    "adjustments (America 250 events, summer, holidays), (4) risk assessment for stockouts. " +
    "Output JSON: {forecasts: [{sku, demand_30d, demand_60d, demand_90d, reorder_qty, risk_level}], " +
    "seasonal_notes: string, overall_risk: string}";

  let systemPrompt;
  try {
    systemPrompt = await loadVersionedPrompt("supply_demand_forecast");
  } catch (_) {
    systemPrompt = fallbackSystemPrompt;
  }

  const userMessage =
    `SKU Velocity Data:\n${JSON.stringify(data.skuVelocity, null, 2)}\n\n` +
    `Inventory Snapshot:\n${JSON.stringify(data.inventorySnapshot, null, 2)}\n\n` +
    `Seasonal Factors:\n${JSON.stringify(data.seasonalFactors, null, 2)}`;

  try {
    const raw = await callLLM({
      systemPrompt,
      userMessage,
      temperature: 0.2,
      maxTokens: 1200,
    });
    return parseLLMJson(raw);
  } catch (err) {
    log(`generateDemandForecast failed: ${err.message}`);
    return null;
  }
}

// ── SC3: Reorder Point Calculator ────────────────────────────────────────────

async function runSC3() {
  log("SC3 — Reorder Point Calculator starting...");

  const snapshot = safeJsonRead(INVENTORY_SNAPSHOT_FILE, { skus: {} });
  const velocity = safeJsonRead(SALES_VELOCITY_FILE, { skus: {} });
  const alerts = [];

  for (const [sku, inv] of Object.entries(snapshot.skus)) {
    const vel = velocity.skus[sku];
    if (!vel) continue;

    // Reorder point = (daily velocity × lead time) + safety stock
    const dailyVelocity = vel.velocity7d || vel.velocity30d || 0;
    const reorderPoint = Math.ceil(dailyVelocity * (PRODUCTION_LEAD_DAYS + SAFETY_STOCK_DAYS));
    const currentStock = inv.currentStock || 0;

    inv.reorderPoint = reorderPoint;

    if (currentStock <= reorderPoint && currentStock > 0 && dailyVelocity > 0) {
      const daysUntilStockout = Math.round(currentStock / dailyVelocity);
      alerts.push({
        sku,
        product: inv.productName,
        currentStock,
        reorderPoint,
        daysUntilStockout,
        velocity: dailyVelocity,
      });
    }
  }

  safeJsonWrite(INVENTORY_SNAPSHOT_FILE, { ...safeJsonRead(INVENTORY_SNAPSHOT_FILE, {}), skus: snapshot.skus });

  // Alert Ben for critical reorder points
  if (alerts.length > 0 && !DRY_RUN) {
    const msg = alerts.slice(0, 5).map((a) =>
      `🔄 ${a.product}: ${a.currentStock} left, reorder point ${a.reorderPoint}, ~${a.daysUntilStockout} days to stockout`
    ).join("\n");
    textBen(`📋 Reorder Alerts — ${todayLongET()}\n\n${msg}`);
  }

  log(`SC3 — Done: ${alerts.length} SKUs at/below reorder point`);
  return engine.succeed("SC3", { alerts: alerts.length });
}

// ── SC4: Production Scheduler ────────────────────────────────────────────────

async function runSC4() {
  log("SC4 — Production Scheduler starting...");

  const snapshot = safeJsonRead(INVENTORY_SNAPSHOT_FILE, { skus: {} });
  const velocity = safeJsonRead(SALES_VELOCITY_FILE, { skus: {} });
  const today = todayET();

  // Find SKUs that need production runs
  const needsProduction = [];

  for (const [sku, inv] of Object.entries(snapshot.skus)) {
    const vel = velocity.skus[sku];
    if (!vel) continue;

    const dailyVelocity = vel.velocity7d || vel.velocity30d || 0;
    if (dailyVelocity <= 0) continue;

    const daysRemaining = inv.daysRemaining || 0;

    // Need production if we'll run out before next production can arrive
    if (daysRemaining < PRODUCTION_LEAD_DAYS + SAFETY_STOCK_DAYS) {
      // Calculate quantity needed: enough for 60 days at current velocity
      const targetDays = 60;
      const targetQuantity = Math.ceil(dailyVelocity * targetDays);
      const currentStock = inv.currentStock || 0;
      const orderQuantity = Math.max(0, targetQuantity - currentStock);

      if (orderQuantity > 0) {
        needsProduction.push({
          sku,
          product: inv.productName,
          currentStock,
          dailyVelocity,
          daysRemaining,
          orderQuantity,
          targetDate: addDaysToDate(today, 7), // Start ASAP
          urgency: daysRemaining < SAFETY_STOCK_DAYS ? "Critical" : "Standard",
        });
      }
    }
  }

  // Sort by urgency
  needsProduction.sort((a, b) => a.daysRemaining - b.daysRemaining);

  // Write production recommendations to Notion
  if (IDS.productionRuns && !DRY_RUN) {
    for (const prod of needsProduction.slice(0, 5)) {
      try {
        await engine.createPage(IDS.productionRuns, {
          "Run Date": { title: [{ text: { content: `${prod.targetDate} — ${prod.product}` } }] },
          Products: { rich_text: [{ text: { content: prod.product.slice(0, 100) } }] },
          Quantity: { number: prod.orderQuantity },
          "Co-Packer": { rich_text: [{ text: { content: "Acct 65107" } }] },
          Status: { select: { name: "Planned" } },
          Notes: { rich_text: [{ text: { content: `${prod.urgency} — ${prod.daysRemaining} days remaining at ${prod.dailyVelocity}/day velocity` } }] },
        });
      } catch (err) { log(`SC4 — Notion error: ${err.message}`); }
    }
  }

  // Alert for critical items
  const critical = needsProduction.filter((p) => p.urgency === "Critical");
  if (critical.length > 0 && !DRY_RUN) {
    const msg = critical.map((p) => `🚨 ${p.product}: ${p.currentStock} left, need ${p.orderQuantity} units ASAP`).join("\n");
    textBen(`🏭 Production Alert — ${todayLongET()}\n\n${msg}`);
  }

  log(`SC4 — Done: ${needsProduction.length} production runs recommended (${critical.length} critical)`);
  return engine.succeed("SC4", { recommendations: needsProduction.length, critical: critical.length });
}

// ── SC5: Supplier Price Tracker ──────────────────────────────────────────────

async function runSC5() {
  log("SC5 — Supplier Price Tracker starting...");

  // Check Notion for suppliers needing re-quotes (>90 days since last quote)
  const today = todayET();
  let needsRequote = 0;

  if (IDS.supplierDirectory) {
    try {
      const pages = await engine.queryDb(IDS.supplierDirectory);
      for (const page of pages) {
        const lastQuote = page.properties?.["Last Quote Date"]?.date?.start;
        if (lastQuote && daysSince(lastQuote) > 90) {
          const supplier = page.properties?.["Supplier Name"]?.title?.[0]?.plain_text || "Unknown";
          const materials = page.properties?.["Materials Supplied"]?.rich_text?.[0]?.plain_text || "";
          needsRequote++;
          log(`SC5 — ${supplier} needs re-quote (${daysSince(lastQuote)} days since last): ${materials}`);
        }
      }
    } catch (err) { log(`SC5 — Notion error: ${err.message}`); }
  }

  if (needsRequote > 0 && !DRY_RUN) {
    textBen(`💰 Supplier Tracker: ${needsRequote} suppliers need price re-quotes (>90 days old). Check Notion Supplier Directory.`);
  }

  log(`SC5 — Done: ${needsRequote} suppliers need re-quotes`);
  return engine.succeed("SC5", { needsRequote });
}

// ── SC6: Fulfillment Monitor ─────────────────────────────────────────────────

async function runSC6() {
  log("SC6 — Fulfillment Monitor starting...");
  if (!SHOPIFY_TOKEN) return engine.fail("SC6", "No Shopify Admin token");

  // Fetch unfulfilled orders
  const res = await shopifyAdmin("/orders.json?fulfillment_status=unfulfilled&status=open&limit=250");
  if (!res.ok) return engine.fail("SC6", `Shopify error: ${res.error}`);

  const orders = res.data?.orders || [];
  const today = new Date();
  let overdue = 0;
  const overdueOrders = [];

  for (const order of orders) {
    const createdAt = new Date(order.created_at);
    const hoursOld = (today - createdAt) / (1000 * 60 * 60);

    if (hoursOld > 48) {
      overdue++;
      overdueOrders.push({
        orderNumber: order.order_number || order.name,
        hoursOld: Math.round(hoursOld),
        customer: `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim(),
        total: order.total_price,
      });
    }
  }

  // Fetch recently fulfilled for avg fulfillment time
  const fulfilledRes = await shopifyAdmin("/orders.json?fulfillment_status=fulfilled&status=any&limit=50");
  let avgFulfillmentHours = 0;
  if (fulfilledRes.ok) {
    const fulfilledOrders = fulfilledRes.data?.orders || [];
    const fulfillmentTimes = [];
    for (const order of fulfilledOrders) {
      const fulfillments = order.fulfillments || [];
      if (fulfillments.length > 0) {
        const created = new Date(order.created_at);
        const fulfilled = new Date(fulfillments[0].created_at);
        const hours = (fulfilled - created) / (1000 * 60 * 60);
        if (hours > 0 && hours < 720) fulfillmentTimes.push(hours); // Exclude outliers >30 days
      }
    }
    if (fulfillmentTimes.length > 0) {
      avgFulfillmentHours = Math.round(fulfillmentTimes.reduce((a, b) => a + b, 0) / fulfillmentTimes.length);
    }
  }

  // Alert for overdue orders
  if (overdue > 0 && !DRY_RUN) {
    const msg = overdueOrders.slice(0, 5).map((o) =>
      `📦 #${o.orderNumber} — ${o.customer} — $${o.total} — ${o.hoursOld}h unfulfilled`
    ).join("\n");
    textBen(`⏰ Fulfillment Alert: ${overdue} orders unfulfilled >48h\n\n${msg}`);
  }

  log(`SC6 — Done: ${orders.length} unfulfilled orders, ${overdue} overdue (>48h), avg fulfillment: ${avgFulfillmentHours}h`);
  return engine.succeed("SC6", { unfulfilled: orders.length, overdue, avgFulfillmentHours });
}

// ── SC7: Amazon FBA Inventory Sync ───────────────────────────────────────────

async function runSC7() {
  log("SC7 — Amazon FBA Inventory Sync starting...");

  const token = await getAmazonToken();
  if (!token) {
    log("SC7 — No Amazon token available (credentials missing or expired)");
    return engine.succeed("SC7", { status: "skipped", reason: "no Amazon credentials" });
  }

  try {
    // Fetch FBA inventory summaries
    const res = await fetchWithTimeout(
      `https://sellingpartnerapi-na.amazon.com/fba/inventory/v1/summaries?granularityType=Marketplace&granularityId=${AMZN_MARKETPLACE}&marketplaceIds=${AMZN_MARKETPLACE}`,
      { headers: { "x-amz-access-token": token, "Content-Type": "application/json" } },
      20000
    );

    if (!res.ok) {
      log(`SC7 — Amazon API ${res.status}: ${res.statusText}`);
      return engine.fail("SC7", `Amazon API ${res.status}`);
    }

    const data = await res.json();
    const summaries = data.payload?.inventorySummaries || [];
    const snapshot = safeJsonRead(INVENTORY_SNAPSHOT_FILE, { skus: {} });
    const alerts = [];

    for (const item of summaries) {
      const asin = item.asin || "";
      const sku = item.sellerSku || asin;
      const fbStock = item.totalFulfillableQuantity || 0;
      const inbound = item.totalInboundQuantity || 0;

      snapshot.skus[`amz-${sku}`] = {
        sku: `amz-${sku}`,
        productName: `Amazon FBA — ${item.productName || sku}`,
        currentStock: fbStock,
        inboundQuantity: inbound,
        channel: "Amazon",
        lastUpdated: todayET(),
      };

      if (fbStock < 10 && fbStock >= 0) {
        alerts.push(`📦 Amazon FBA — ${item.productName || sku}: ${fbStock} units (${inbound} inbound)`);
      }
    }

    safeJsonWrite(INVENTORY_SNAPSHOT_FILE, snapshot);

    if (alerts.length > 0 && !DRY_RUN) {
      textBen(`🔶 Amazon FBA Low Stock:\n${alerts.join("\n")}`);
    }

    log(`SC7 — Done: ${summaries.length} FBA items synced, ${alerts.length} low stock alerts`);
    return engine.succeed("SC7", { synced: summaries.length, lowStock: alerts.length });
  } catch (err) {
    log(`SC7 — Error: ${err.message}`);
    return engine.fail("SC7", err.message);
  }
}

// ── SC8: Self-Heal Monitor ───────────────────────────────────────────────────

async function runSC8() {
  return engine.runSelfHeal("SC8", AGENT_REGISTRY);
}

// ══════════════════════════════════════════════════════════════════════════════
//  REGISTRY & CLI
// ══════════════════════════════════════════════════════════════════════════════

const AGENT_REGISTRY = {
  SC1: { name: "Inventory Level Monitor", fn: runSC1, schedule: SCHEDULE_PLAN.SC1 },
  SC2: { name: "Sales Velocity Calculator", fn: runSC2, schedule: SCHEDULE_PLAN.SC2 },
  SC3: { name: "Reorder Point Calculator", fn: runSC3, schedule: SCHEDULE_PLAN.SC3 },
  SC4: { name: "Production Scheduler", fn: runSC4, schedule: SCHEDULE_PLAN.SC4 },
  SC5: { name: "Supplier Price Tracker", fn: runSC5, schedule: SCHEDULE_PLAN.SC5 },
  SC6: { name: "Fulfillment Monitor", fn: runSC6, schedule: SCHEDULE_PLAN.SC6 },
  SC7: { name: "Amazon FBA Inventory Sync", fn: runSC7, schedule: SCHEDULE_PLAN.SC7 },
  SC8: { name: "Self-Heal Monitor", fn: runSC8, schedule: SCHEDULE_PLAN.SC8 },
};

async function runAgentByName(name) {
  const key = name.toUpperCase();
  if (key === "SELF-HEAL") return runSC8();
  if (AGENT_REGISTRY[key]) return AGENT_REGISTRY[key].fn();
  log(`Unknown agent: ${name}`);
  process.exit(1);
}

async function runScheduledAgents() {
  const now = new Date();
  const etOpts = { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" };
  const parts = new Intl.DateTimeFormat("en-US", etOpts).formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0");
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0");
  const weekday = parts.find((p) => p.type === "weekday")?.value || "";
  const day = new Date().getDate();

  const toRun = [];
  for (const [key, entry] of Object.entries(AGENT_REGISTRY)) {
    const s = entry.schedule;
    if (s === "Every 30 min") { toRun.push(key); continue; }
    const dm = s.match(/Daily (\d+):(\d+)\s*(AM|PM)/);
    if (dm) {
      let h = parseInt(dm[1]);
      if (dm[3] === "PM" && h !== 12) h += 12;
      if (dm[3] === "AM" && h === 12) h = 0;
      if (h === hour && Math.abs(minute - parseInt(dm[2])) < 5) toRun.push(key);
      continue;
    }
    const wm = s.match(/Weekly (\w+) (\d+):(\d+)\s*(AM|PM)/);
    if (wm) {
      if (!weekday.startsWith(wm[1].slice(0, 3))) continue;
      let h = parseInt(wm[2]);
      if (wm[4] === "PM" && h !== 12) h += 12;
      if (wm[4] === "AM" && h === 12) h = 0;
      if (h === hour && Math.abs(minute - parseInt(wm[3])) < 5) toRun.push(key);
      continue;
    }
    const mm = s.match(/Monthly 1st (\d+):(\d+)\s*(AM|PM)/);
    if (mm) {
      if (day !== 1) continue;
      let h = parseInt(mm[1]);
      if (mm[3] === "PM" && h !== 12) h += 12;
      if (mm[3] === "AM" && h === 12) h = 0;
      if (h === hour && Math.abs(minute - parseInt(mm[2])) < 5) toRun.push(key);
    }
  }

  if (toRun.length === 0) { log("No agents scheduled for current time"); return; }
  log(`Running scheduled agents: ${toRun.join(", ")}`);
  for (const key of toRun) {
    try { await AGENT_REGISTRY[key].fn(); } catch (err) { log(`${key} error: ${err.message}`); }
  }
}

function showHelp() {
  console.log(`USA Gummies Supply Chain & Production Orchestrator (Build 5)
${"═".repeat(60)}

Commands:
  run <agent>      Run a specific agent (SC1-SC8)
  run all          Run all scheduled agents for current time
  run self-heal    Run the self-heal monitor
  status           Show system status JSON
  help             Show this help

Options:
  --dry-run        Preview actions without making changes
  --source <src>   Override run source label

Agents:
  SC1  Inventory Level Monitor         ${SCHEDULE_PLAN.SC1}
  SC2  Sales Velocity Calculator       ${SCHEDULE_PLAN.SC2}
  SC3  Reorder Point Calculator        ${SCHEDULE_PLAN.SC3}
  SC4  Production Scheduler            ${SCHEDULE_PLAN.SC4}
  SC5  Supplier Price Tracker          ${SCHEDULE_PLAN.SC5}
  SC6  Fulfillment Monitor             ${SCHEDULE_PLAN.SC6}
  SC7  Amazon FBA Inventory Sync       ${SCHEDULE_PLAN.SC7}
  SC8  Self-Heal Monitor               ${SCHEDULE_PLAN.SC8}

Thresholds:
  Low Stock Alert:    <${LOW_STOCK_DAYS} days remaining
  Safety Stock:       ${SAFETY_STOCK_DAYS} days
  Production Lead:    ${PRODUCTION_LEAD_DAYS} days

Examples:
  node scripts/usa-gummies-supply-chain.mjs run SC1   # check inventory
  node scripts/usa-gummies-supply-chain.mjs --dry-run run SC6
  node scripts/usa-gummies-supply-chain.mjs run all
  node scripts/usa-gummies-supply-chain.mjs status`);
}

// ── Main CLI ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const cmd = args[0];

if (cmd === "help" || !cmd) {
  showHelp();
} else if (cmd === "run") {
  const target = args[1];
  if (!target) { console.error("Usage: run <agent|all|self-heal>"); process.exit(1); }
  if (target === "all") {
    await runScheduledAgents();
  } else {
    await runAgentByName(target);
  }
} else if (cmd === "status") {
  const status = engine.getStatus();
  console.log(JSON.stringify(status, null, 2));
} else {
  console.error(`Unknown command: ${cmd}. Try 'help'.`);
  process.exit(1);
}
