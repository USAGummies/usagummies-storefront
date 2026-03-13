#!/usr/bin/env node

/**
 * Backfill REAL Sales History into Abra Brain + KPI Timeseries
 *
 * This script:
 * 1. Pulls ALL Shopify orders (not just last 24h)
 * 2. Groups by day and writes accurate daily summaries to brain
 * 3. Writes accurate KPI timeseries rows (replacing synthetic data)
 * 4. Creates a monthly running total entry
 *
 * Run: node scripts/backfill-real-sales-history.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const ENV_PATH = resolve(PROJECT_ROOT, ".env.local");

function parseEnvLocal(content) {
  const env = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const ENV = parseEnvLocal(readFileSync(ENV_PATH, "utf8"));

function getShopifyEnv() {
  const domain = ENV.SHOPIFY_STORE || ENV.SHOPIFY_STORE_DOMAIN;
  const token = ENV.SHOPIFY_ADMIN_TOKEN || ENV.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const version = ENV.SHOPIFY_API_VERSION || "2024-10";
  if (!domain || !token) throw new Error("Missing Shopify env vars");
  return { domain, token, version };
}

function getSupabaseEnv() {
  const baseUrl = ENV.SUPABASE_URL || ENV.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = ENV.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceRoleKey) throw new Error("Missing Supabase env vars");
  return { baseUrl, serviceRoleKey };
}

function getOpenAIKey() {
  const key = ENV.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");
  return key;
}

async function sbFetch(path, init = {}) {
  const { baseUrl, serviceRoleKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceRoleKey);
  headers.set("Authorization", `Bearer ${serviceRoleKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(30000),
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

async function buildEmbedding(text) {
  const key = getOpenAIKey();
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000),
    }),
  });
  if (!res.ok) throw new Error(`OpenAI embedding failed: ${res.status}`);
  const data = await res.json();
  return data.data[0].embedding;
}

// ── Step 1: Fetch ALL Shopify orders ──

async function fetchAllShopifyOrders() {
  const { domain, token, version } = getShopifyEnv();
  const allOrders = [];
  let pageUrl = `https://${domain}/admin/api/${version}/orders.json?status=any&limit=250`;

  while (pageUrl) {
    console.log(`  Fetching: ${pageUrl.slice(0, 80)}...`);
    const res = await fetch(pageUrl, {
      headers: { "X-Shopify-Access-Token": token },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Shopify API ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const orders = data.orders || [];
    allOrders.push(...orders);
    console.log(`  Got ${orders.length} orders (total so far: ${allOrders.length})`);

    // Pagination via Link header
    const linkHeader = res.headers.get("Link") || "";
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    pageUrl = nextMatch ? nextMatch[1] : null;
  }

  return allOrders;
}

// ── Step 2: Group orders by day ──

function groupOrdersByDay(orders) {
  const days = {};
  for (const order of orders) {
    const date = order.created_at.split("T")[0]; // YYYY-MM-DD
    if (!days[date]) days[date] = [];
    days[date].push(order);
  }
  return days;
}

// ── Step 3: Group orders by month ──

function groupOrdersByMonth(orders) {
  const months = {};
  for (const order of orders) {
    const month = order.created_at.slice(0, 7); // YYYY-MM
    if (!months[month]) months[month] = [];
    months[month].push(order);
  }
  return months;
}

// ── Step 4: Write daily brain entries ──

async function writeDailyBrainEntry(date, orders) {
  const totalRevenue = orders.reduce((sum, o) => sum + parseFloat(o.total_price || "0"), 0);
  const largeOrders = orders.filter(o => parseFloat(o.total_price || "0") > 100);
  let newCustomers = 0, returningCustomers = 0;
  for (const o of orders) {
    const count = Number(o.customer?.orders_count || 0);
    if (count > 1) returningCustomers++; else newCustomers++;
  }

  const orderDetails = orders.map(o => {
    const items = (o.line_items || []).map(li => `${li.title} x${li.quantity}`).join(", ");
    return `  ${o.name || o.id}: $${parseFloat(o.total_price || "0").toFixed(2)} — ${items}`;
  }).join("\n");

  const summary = `Shopify DTC Orders (${date}): ${orders.length} orders, $${totalRevenue.toFixed(2)} total revenue. Average order: $${orders.length > 0 ? (totalRevenue / orders.length).toFixed(2) : "0.00"}. Customers: ${newCustomers} new, ${returningCustomers} returning. Large orders (>$100): ${largeOrders.length}.\n\nOrder details:\n${orderDetails}`;

  const sourceRef = `shopify-orders-${date}`;

  // Delete existing entry for this source_ref first (upsert)
  try {
    await sbFetch(`/rest/v1/open_brain_entries?source_ref=eq.${encodeURIComponent(sourceRef)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  } catch { /* may not exist */ }

  const embedding = await buildEmbedding(`Shopify Orders Summary — ${date}\n${summary}`);
  await sbFetch("/rest/v1/open_brain_entries", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      source_type: "api",
      source_ref: sourceRef,
      entry_type: "teaching",
      title: `Shopify Orders Summary — ${date}`,
      raw_text: summary,
      summary_text: summary.slice(0, 500),
      category: "sales",
      department: "sales_and_growth",
      confidence: "high",
      priority: "normal",
      processed: true,
      embedding,
      tags: ["backfill", "verified_sales_data"],
    }),
  });

  return { date, orders: orders.length, revenue: totalRevenue };
}

// ── Step 5: Write monthly total brain entries ──

async function writeMonthlyTotalEntry(month, orders) {
  const totalRevenue = orders.reduce((sum, o) => sum + parseFloat(o.total_price || "0"), 0);
  const totalUnits = orders.reduce((sum, o) => {
    return sum + (o.line_items || []).reduce((s, li) => s + (li.quantity || 0), 0);
  }, 0);

  const summary = `Shopify Monthly Total — ${month}: ${orders.length} orders, $${totalRevenue.toFixed(2)} total revenue, ${totalUnits} total units sold. Average order: $${orders.length > 0 ? (totalRevenue / orders.length).toFixed(2) : "0.00"}. This is VERIFIED data from the Shopify Admin API, not estimated.`;

  const sourceRef = `shopify-monthly-total-${month}`;

  try {
    await sbFetch(`/rest/v1/open_brain_entries?source_ref=eq.${encodeURIComponent(sourceRef)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  } catch { /* may not exist */ }

  const embedding = await buildEmbedding(`Shopify Monthly Revenue Total — ${month}\n${summary}`);
  await sbFetch("/rest/v1/open_brain_entries", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      source_type: "api",
      source_ref: sourceRef,
      entry_type: "teaching",
      title: `Shopify Monthly Revenue Total — ${month}`,
      raw_text: summary,
      summary_text: summary.slice(0, 500),
      category: "sales",
      department: "sales_and_growth",
      confidence: "high",
      priority: "important",
      processed: true,
      embedding,
      tags: ["backfill", "verified_sales_data", "monthly_total"],
    }),
  });

  return { month, orders: orders.length, revenue: totalRevenue };
}

// ── Step 6: Write real KPI timeseries (replacing synthetic data) ──

async function fetchKPIColumns() {
  const openApi = await sbFetch("/rest/v1/", {
    headers: { Accept: "application/openapi+json" },
  });
  const schema =
    openApi?.components?.schemas?.kpi_timeseries ||
    openApi?.definitions?.kpi_timeseries ||
    openApi?.definitions?.["public.kpi_timeseries"];
  if (!schema || typeof schema.properties !== "object") {
    throw new Error("Could not load kpi_timeseries schema");
  }
  return new Set(Object.keys(schema.properties));
}

async function writeKPITimeseries(dailyData) {
  const columns = await fetchKPIColumns();
  console.log(`  KPI columns: ${[...columns].join(", ")}`);

  const rows = [];
  for (const { date, orders, revenue } of dailyData) {
    const metrics = [
      { metric_name: "daily_revenue_shopify", value: revenue, dept: "sales_and_growth", group: "sales", sys: "shopify" },
      { metric_name: "daily_orders_shopify", value: orders, dept: "sales_and_growth", group: "sales", sys: "shopify" },
      { metric_name: "daily_aov", value: orders > 0 ? revenue / orders : 0, dept: "sales_and_growth", group: "sales", sys: "shopify" },
    ];
    for (const m of metrics) {
      const row = { metric_name: m.metric_name, value: m.value };
      if (columns.has("department")) row.department = m.dept;
      if (columns.has("metric_group")) row.metric_group = m.group;
      if (columns.has("source_system")) row.source_system = m.sys;
      if (columns.has("entity_ref")) row.entity_ref = "shopify";
      if (columns.has("window_type")) row.window_type = "daily";
      if (columns.has("captured_for_date")) row.captured_for_date = date;
      if (columns.has("recorded_at")) row.recorded_at = new Date(date + "T12:00:00Z").toISOString();
      rows.push(row);
    }
  }

  if (rows.length === 0) {
    console.log("  No KPI rows to write");
    return;
  }

  // Upsert — replace synthetic data with real
  const path = `/rest/v1/kpi_timeseries?on_conflict=${encodeURIComponent("metric_name,entity_ref,captured_for_date,window_type")}`;
  await sbFetch(path, {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=minimal",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(rows),
  });

  console.log(`  Upserted ${rows.length} KPI rows (replacing any synthetic data)`);
}

// ── Step 7: Delete synthetic KPI data that doesn't have real orders ──

async function deleteSyntheticKPIData(realDates) {
  const realDateSet = new Set(realDates);

  // Fetch all existing shopify KPI data
  const existing = await sbFetch(
    `/rest/v1/kpi_timeseries?metric_name=eq.daily_revenue_shopify&entity_ref=eq.shopify&window_type=eq.daily&select=captured_for_date`,
  );

  if (!Array.isArray(existing)) return;

  const syntheticDates = existing
    .filter(row => {
      const isNotReal = !realDateSet.has(row.captured_for_date);
      return isNotReal;
    })
    .map(row => row.captured_for_date);

  if (syntheticDates.length === 0) {
    console.log("  No synthetic KPI data found to clean up");
    return;
  }

  // Delete synthetic rows for all three metrics
  for (const metric of ["daily_revenue_shopify", "daily_orders_shopify", "daily_aov"]) {
    for (const date of syntheticDates) {
      try {
        await sbFetch(
          `/rest/v1/kpi_timeseries?metric_name=eq.${metric}&entity_ref=eq.shopify&captured_for_date=eq.${date}&window_type=eq.daily`,
          { method: "DELETE", headers: { Prefer: "return=minimal" } },
        );
      } catch { /* best effort */ }
    }
  }

  console.log(`  Cleaned up ${syntheticDates.length} days of synthetic Shopify KPI data`);
}

// ── Step 8: Write a financial data integrity correction ──

async function writeCorrectionEntry() {
  const correction = `CRITICAL CORRECTION — Financial Data Integrity Rules:

1. REVENUE: The ONLY source of truth for revenue is the Shopify Admin API and Amazon SP-API. Brain entries tagged with "verified_sales_data" contain real numbers. Everything else is unverified.

2. CASH POSITION: Do NOT cite any specific dollar amount for cash on hand, capital, or bank balance unless it comes from bank statements, QuickBooks exports, or Rene's finance reports. The "$102,800" figure previously cited was from a conversation, NOT a verified financial record.

3. MARGINS: Do NOT cite specific margin percentages unless they come from actual cost accounting. Research entries about "typical CPG margins" are industry benchmarks, NOT USA Gummies' actual margins.

4. RULE: When asked about financials, ONLY cite verified data. If you don't have it, say "I don't have verified financial data for this. We should check with Rene or pull from our accounting system."

5. Monthly totals: Only cite from entries explicitly titled "Monthly Revenue Total" with "verified_sales_data" tag. Do NOT add up daily snapshots yourself.`;

  const sourceRef = "correction-financial-data-integrity";

  try {
    await sbFetch(`/rest/v1/open_brain_entries?source_ref=eq.${encodeURIComponent(sourceRef)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  } catch { /* may not exist */ }

  const embedding = await buildEmbedding(`CORRECTION: Financial Data Integrity\n${correction}`);
  await sbFetch("/rest/v1/open_brain_entries", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      source_type: "manual",
      source_ref: sourceRef,
      entry_type: "finding",
      title: "CORRECTION: Financial Data Integrity — Never Fabricate Numbers",
      raw_text: correction,
      summary_text: correction.slice(0, 500),
      category: "financial",
      department: "finance",
      confidence: "high",
      priority: "critical",
      processed: true,
      embedding,
      tags: ["correction", "critical", "financial_integrity"],
    }),
  });

  console.log("  Wrote financial integrity correction (priority: critical)");
}

// ── Main ──

async function main() {
  console.log("=== Backfill Real Sales History ===\n");

  // Step 1: Correction entry
  console.log("[1/6] Writing financial integrity correction...");
  await writeCorrectionEntry();

  // Step 2: Fetch all Shopify orders
  console.log("\n[2/6] Fetching ALL Shopify orders...");
  const allOrders = await fetchAllShopifyOrders();
  console.log(`  Total orders: ${allOrders.length}`);

  if (allOrders.length === 0) {
    console.log("  No orders found. Exiting.");
    return;
  }

  // Step 3: Write daily brain entries
  console.log("\n[3/6] Writing daily brain entries...");
  const dailyGroups = groupOrdersByDay(allOrders);
  const dates = Object.keys(dailyGroups).sort();
  const dailyResults = [];

  for (const date of dates) {
    const result = await writeDailyBrainEntry(date, dailyGroups[date]);
    dailyResults.push(result);
    console.log(`  ${date}: ${result.orders} orders, $${result.revenue.toFixed(2)}`);
    await new Promise(r => setTimeout(r, 300)); // Rate limit embeddings
  }

  // Step 4: Write monthly totals
  console.log("\n[4/6] Writing monthly total entries...");
  const monthlyGroups = groupOrdersByMonth(allOrders);
  const months = Object.keys(monthlyGroups).sort();

  for (const month of months) {
    const result = await writeMonthlyTotalEntry(month, monthlyGroups[month]);
    console.log(`  ${month}: ${result.orders} orders, $${result.revenue.toFixed(2)}`);
    await new Promise(r => setTimeout(r, 300));
  }

  // Step 5: Write real KPI timeseries
  console.log("\n[5/6] Writing real KPI timeseries data...");
  await writeKPITimeseries(dailyResults);

  // Step 6: Clean up synthetic KPI data
  console.log("\n[6/6] Cleaning up synthetic KPI data...");
  const realDates = dailyResults.map(r => r.date);
  await deleteSyntheticKPIData(realDates);

  // Summary
  console.log("\n=== BACKFILL COMPLETE ===");
  console.log(`  Days with orders: ${dates.length}`);
  console.log(`  Months covered: ${months.join(", ")}`);
  console.log(`  Total orders: ${allOrders.length}`);
  const totalRev = allOrders.reduce((sum, o) => sum + parseFloat(o.total_price || "0"), 0);
  console.log(`  Total all-time Shopify revenue: $${totalRev.toFixed(2)}`);
  console.log(`  KPI rows written: ${dailyResults.length * 3}`);
  console.log(`  Brain entries: ${dates.length} daily + ${months.length} monthly + 1 correction`);
}

main().catch(err => {
  console.error("FATAL:", err.message || err);
  process.exit(1);
});
