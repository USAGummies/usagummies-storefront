#!/usr/bin/env node

/**
 * Backfill REAL Amazon Sales History into Abra Brain + KPI Timeseries
 *
 * This script:
 * 1. Pulls ALL Amazon orders via SP-API (going back 180 days max)
 * 2. Groups by day and writes accurate daily summaries to brain
 * 3. Writes accurate KPI timeseries rows (replacing synthetic data)
 * 4. Creates monthly running total entries
 *
 * Run: node scripts/backfill-amazon-sales-history.mjs
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

function getAmazonEnv() {
  const clientId = ENV.LWA_CLIENT_ID;
  const clientSecret = ENV.LWA_CLIENT_SECRET;
  const refreshToken = ENV.LWA_REFRESH_TOKEN;
  const marketplaceId = ENV.MARKETPLACE_ID || "ATVPDKIKX0DER";
  const endpoint = ENV.SP_API_ENDPOINT || "https://sellingpartnerapi-na.amazon.com";
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing Amazon SP-API env vars (LWA_CLIENT_ID, LWA_CLIENT_SECRET, LWA_REFRESH_TOKEN)");
  }
  return { clientId, clientSecret, refreshToken, marketplaceId, endpoint };
}

// ── Supabase helpers ──

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

// ── Amazon SP-API helpers ──

let _cachedToken = null;

async function getAccessToken() {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt) {
    return _cachedToken.token;
  }

  const { clientId, clientSecret, refreshToken } = getAmazonEnv();
  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LWA token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error("LWA token exchange returned no access_token");

  _cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + 50 * 60 * 1000,
  };

  return data.access_token;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function spApiGet(path, params = {}) {
  const { endpoint } = getAmazonEnv();
  const url = new URL(path, endpoint);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const accessToken = await getAccessToken();
      const res = await fetch(url.toString(), {
        headers: {
          "x-amz-access-token": accessToken,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(20000),
      });

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
        console.log(`  Rate limited, waiting ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`SP-API ${path} failed: ${res.status} — ${text.slice(0, 300)}`);
      }

      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < 2) await sleep(2000 * (attempt + 1));
    }
  }

  throw lastError || new Error(`SP-API ${path} failed after 3 attempts`);
}

// ── Step 1: Fetch ALL Amazon orders (up to 180 days back) ──

async function fetchAllAmazonOrders() {
  const { marketplaceId } = getAmazonEnv();
  // Amazon Orders API allows fetching orders going back ~2 years
  // We'll go back 180 days to be safe
  const daysBack = 180;
  const createdAfter = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const createdBefore = new Date(Date.now() - 3 * 60 * 1000).toISOString(); // 3 min buffer

  console.log(`  Fetching orders from ${createdAfter.split("T")[0]} to ${createdBefore.split("T")[0]}`);

  const allOrders = [];
  let nextToken = null;

  do {
    const params = nextToken
      ? { NextToken: nextToken }
      : {
          MarketplaceIds: marketplaceId,
          CreatedAfter: createdAfter,
          CreatedBefore: createdBefore,
        };

    const res = await spApiGet("/orders/v0/orders", params);

    if (res.errors?.length) {
      console.error("  Orders API errors:", JSON.stringify(res.errors));
      break;
    }

    const orders = res.payload?.Orders || [];
    allOrders.push(...orders);
    console.log(`  Got ${orders.length} orders (total so far: ${allOrders.length})`);

    nextToken = res.payload?.NextToken;

    // Amazon rate limit: 1 request per 5 seconds for orders
    if (nextToken) {
      console.log("  Waiting for rate limit (6s)...");
      await sleep(6000);
    }
  } while (nextToken);

  return allOrders;
}

// ── Step 2: Group orders by day ──

function groupOrdersByDay(orders) {
  const days = {};
  for (const order of orders) {
    const purchaseDate = order.PurchaseDate || order.CreatedDate;
    if (!purchaseDate) continue;
    const date = purchaseDate.split("T")[0]; // YYYY-MM-DD
    if (!days[date]) days[date] = [];
    days[date].push(order);
  }
  return days;
}

// ── Step 3: Group orders by month ──

function groupOrdersByMonth(orders) {
  const months = {};
  for (const order of orders) {
    const purchaseDate = order.PurchaseDate || order.CreatedDate;
    if (!purchaseDate) continue;
    const month = purchaseDate.slice(0, 7); // YYYY-MM
    if (!months[month]) months[month] = [];
    months[month].push(order);
  }
  return months;
}

// ── Step 4: Write daily brain entries ──

async function writeDailyBrainEntry(date, orders) {
  const totalRevenue = orders.reduce((sum, o) => sum + parseFloat(o.OrderTotal?.Amount || "0"), 0);
  const totalUnits = orders.reduce((sum, o) => {
    return sum + (o.NumberOfItemsShipped || 0) + (o.NumberOfItemsUnshipped || 0);
  }, 0);

  const fbaOrders = orders.filter(o => o.FulfillmentChannel === "AFN").length;
  const fbmOrders = orders.filter(o => o.FulfillmentChannel === "MFN").length;

  const orderDetails = orders.map(o => {
    const amount = parseFloat(o.OrderTotal?.Amount || "0").toFixed(2);
    const channel = o.FulfillmentChannel === "AFN" ? "FBA" : "FBM";
    return `  ${o.AmazonOrderId || "unknown"}: $${amount} (${channel}, ${(o.NumberOfItemsShipped || 0) + (o.NumberOfItemsUnshipped || 0)} units)`;
  }).join("\n");

  const summary = `Amazon Marketplace Orders (${date}): ${orders.length} orders, $${totalRevenue.toFixed(2)} total revenue. ${totalUnits} total units. FBA: ${fbaOrders}, FBM: ${fbmOrders}. Average order: $${orders.length > 0 ? (totalRevenue / orders.length).toFixed(2) : "0.00"}.\n\nOrder details:\n${orderDetails}`;

  const sourceRef = `amazon-orders-${date}`;

  // Delete existing entry for this source_ref first (upsert)
  try {
    await sbFetch(`/rest/v1/open_brain_entries?source_ref=eq.${encodeURIComponent(sourceRef)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  } catch { /* may not exist */ }

  const embedding = await buildEmbedding(`Amazon Orders Summary — ${date}\n${summary}`);
  await sbFetch("/rest/v1/open_brain_entries", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      source_type: "api",
      source_ref: sourceRef,
      entry_type: "teaching",
      title: `Amazon Orders Summary — ${date}`,
      raw_text: summary,
      summary_text: summary.slice(0, 500),
      category: "sales",
      department: "sales_and_growth",
      confidence: "high",
      priority: "normal",
      processed: true,
      embedding,
      tags: ["backfill", "verified_sales_data", "amazon"],
    }),
  });

  return { date, orders: orders.length, revenue: totalRevenue, units: totalUnits };
}

// ── Step 5: Write monthly total brain entries ──

async function writeMonthlyTotalEntry(month, orders) {
  const totalRevenue = orders.reduce((sum, o) => sum + parseFloat(o.OrderTotal?.Amount || "0"), 0);
  const totalUnits = orders.reduce((sum, o) => {
    return sum + (o.NumberOfItemsShipped || 0) + (o.NumberOfItemsUnshipped || 0);
  }, 0);
  const fbaOrders = orders.filter(o => o.FulfillmentChannel === "AFN").length;
  const fbmOrders = orders.filter(o => o.FulfillmentChannel === "MFN").length;

  const summary = `Amazon Monthly Total — ${month}: ${orders.length} orders, $${totalRevenue.toFixed(2)} total revenue, ${totalUnits} total units sold. FBA: ${fbaOrders}, FBM: ${fbmOrders}. Average order: $${orders.length > 0 ? (totalRevenue / orders.length).toFixed(2) : "0.00"}. This is VERIFIED data from the Amazon SP-API Orders endpoint, not estimated.`;

  const sourceRef = `amazon-monthly-total-${month}`;

  try {
    await sbFetch(`/rest/v1/open_brain_entries?source_ref=eq.${encodeURIComponent(sourceRef)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  } catch { /* may not exist */ }

  const embedding = await buildEmbedding(`Amazon Monthly Revenue Total — ${month}\n${summary}`);
  await sbFetch("/rest/v1/open_brain_entries", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      source_type: "api",
      source_ref: sourceRef,
      entry_type: "teaching",
      title: `Amazon Monthly Revenue Total — ${month}`,
      raw_text: summary,
      summary_text: summary.slice(0, 500),
      category: "sales",
      department: "sales_and_growth",
      confidence: "high",
      priority: "important",
      processed: true,
      embedding,
      tags: ["backfill", "verified_sales_data", "monthly_total", "amazon"],
    }),
  });

  return { month, orders: orders.length, revenue: totalRevenue, units: totalUnits };
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
  for (const { date, orders, revenue, units } of dailyData) {
    const metrics = [
      { metric_name: "daily_revenue_amazon", value: revenue, dept: "sales_and_growth", group: "sales", sys: "amazon" },
      { metric_name: "daily_orders_amazon", value: orders, dept: "sales_and_growth", group: "sales", sys: "amazon" },
      { metric_name: "daily_units_amazon", value: units, dept: "sales_and_growth", group: "sales", sys: "amazon" },
    ];
    for (const m of metrics) {
      const row = { metric_name: m.metric_name, value: m.value };
      if (columns.has("department")) row.department = m.dept;
      if (columns.has("metric_group")) row.metric_group = m.group;
      if (columns.has("source_system")) row.source_system = m.sys;
      if (columns.has("entity_ref")) row.entity_ref = "amazon";
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

// ── Step 7: Delete synthetic Amazon KPI data that doesn't have real orders ──

async function deleteSyntheticKPIData(realDates) {
  const realDateSet = new Set(realDates);

  const existing = await sbFetch(
    `/rest/v1/kpi_timeseries?metric_name=eq.daily_revenue_amazon&entity_ref=eq.amazon&window_type=eq.daily&select=captured_for_date`,
  );

  if (!Array.isArray(existing)) return;

  const syntheticDates = existing
    .filter(row => !realDateSet.has(row.captured_for_date))
    .map(row => row.captured_for_date);

  if (syntheticDates.length === 0) {
    console.log("  No synthetic Amazon KPI data found to clean up");
    return;
  }

  for (const metric of ["daily_revenue_amazon", "daily_orders_amazon", "daily_units_amazon"]) {
    for (const date of syntheticDates) {
      try {
        await sbFetch(
          `/rest/v1/kpi_timeseries?metric_name=eq.${metric}&entity_ref=eq.amazon&captured_for_date=eq.${date}&window_type=eq.daily`,
          { method: "DELETE", headers: { Prefer: "return=minimal" } },
        );
      } catch { /* best effort */ }
    }
  }

  console.log(`  Cleaned up ${syntheticDates.length} days of synthetic Amazon KPI data`);
}

// ── Step 8: Clean ALL remaining synthetic KPI data from seed script ──

async function cleanAllSyntheticData() {
  // The seed-kpi-timeseries.mjs wrote data with entity_ref="global" for metrics like:
  // shopify_revenue_daily, amazon_revenue_daily, ga4_sessions_daily, etc.
  // These are ALL fake. Delete them.
  const syntheticMetrics = [
    "shopify_revenue_daily",
    "amazon_revenue_daily",
    "ga4_sessions_daily",
    "ga4_conversion_rate",
    "shopify_orders_daily",
    "amazon_orders_daily",
    "gross_margin_pct",
    "cac_blended",
    // Also the "canonical" duplicates the seeder wrote:
    "daily_sessions",
    "conversion_rate",
  ];

  let totalDeleted = 0;
  for (const metric of syntheticMetrics) {
    try {
      // Delete all rows with entity_ref="global" for these metrics — they're all synthetic
      await sbFetch(
        `/rest/v1/kpi_timeseries?metric_name=eq.${metric}&entity_ref=eq.global&window_type=eq.daily`,
        { method: "DELETE", headers: { Prefer: "return=minimal" } },
      );
      totalDeleted++;
    } catch { /* best effort */ }
  }

  console.log(`  Cleaned synthetic data for ${totalDeleted} metric types (entity_ref=global)`);
}

// ── Main ──

async function main() {
  console.log("=== Backfill Amazon Sales History ===\n");

  // Step 1: Fetch all Amazon orders
  console.log("[1/5] Fetching ALL Amazon orders (last 180 days)...");
  let allOrders;
  try {
    allOrders = await fetchAllAmazonOrders();
  } catch (err) {
    console.error(`  Failed to fetch Amazon orders: ${err.message}`);
    console.log("  If this is a 403, the SP-API app may not have Orders API access.");
    console.log("  Proceeding to clean synthetic data only...\n");
    console.log("[CLEANUP] Cleaning ALL remaining synthetic KPI data...");
    await cleanAllSyntheticData();
    return;
  }

  console.log(`  Total Amazon orders: ${allOrders.length}`);

  if (allOrders.length === 0) {
    console.log("  No Amazon orders found. Cleaning synthetic data only...\n");
    console.log("[CLEANUP] Cleaning ALL remaining synthetic KPI data...");
    await cleanAllSyntheticData();
    console.log("\n=== BACKFILL COMPLETE (no Amazon orders) ===");
    return;
  }

  // Step 2: Write daily brain entries
  console.log("\n[2/5] Writing daily brain entries...");
  const dailyGroups = groupOrdersByDay(allOrders);
  const dates = Object.keys(dailyGroups).sort();
  const dailyResults = [];

  for (const date of dates) {
    const result = await writeDailyBrainEntry(date, dailyGroups[date]);
    dailyResults.push(result);
    console.log(`  ${date}: ${result.orders} orders, $${result.revenue.toFixed(2)}, ${result.units} units`);
    await sleep(300); // Rate limit embeddings
  }

  // Step 3: Write monthly totals
  console.log("\n[3/5] Writing monthly total entries...");
  const monthlyGroups = groupOrdersByMonth(allOrders);
  const months = Object.keys(monthlyGroups).sort();

  for (const month of months) {
    const result = await writeMonthlyTotalEntry(month, monthlyGroups[month]);
    console.log(`  ${month}: ${result.orders} orders, $${result.revenue.toFixed(2)}, ${result.units} units`);
    await sleep(300);
  }

  // Step 4: Write real KPI timeseries
  console.log("\n[4/5] Writing real KPI timeseries data...");
  await writeKPITimeseries(dailyResults);

  // Step 5: Clean up synthetic KPI data
  console.log("\n[5/5] Cleaning up ALL synthetic KPI data...");
  const realDates = dailyResults.map(r => r.date);
  await deleteSyntheticKPIData(realDates);
  await cleanAllSyntheticData();

  // Summary
  const totalRev = allOrders.reduce((sum, o) => sum + parseFloat(o.OrderTotal?.Amount || "0"), 0);
  const totalUnits = allOrders.reduce((sum, o) => {
    return sum + (o.NumberOfItemsShipped || 0) + (o.NumberOfItemsUnshipped || 0);
  }, 0);

  console.log("\n=== BACKFILL COMPLETE ===");
  console.log(`  Days with orders: ${dates.length}`);
  console.log(`  Months covered: ${months.join(", ")}`);
  console.log(`  Total orders: ${allOrders.length}`);
  console.log(`  Total units: ${totalUnits}`);
  console.log(`  Total all-time Amazon revenue: $${totalRev.toFixed(2)}`);
  console.log(`  KPI rows written: ${dailyResults.length * 3}`);
  console.log(`  Brain entries: ${dates.length} daily + ${months.length} monthly`);
}

main().catch(err => {
  console.error("FATAL:", err.message || err);
  process.exit(1);
});
