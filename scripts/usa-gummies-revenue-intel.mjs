#!/usr/bin/env node
/**
 * USA Gummies — Revenue Intelligence Engine (Build 2)
 *
 * Unified revenue analytics across all channels: Shopify DTC, Shopify B2B,
 * Amazon SP-API, Faire. Pulls GA4 traffic data. Auto-generates investor-ready
 * metrics. Replaces the old daily-report.mjs with something 10x more powerful.
 *
 * 12 agents — R1 through R12
 *
 * Usage:
 *   node scripts/usa-gummies-revenue-intel.mjs run R1
 *   node scripts/usa-gummies-revenue-intel.mjs run R7        # daily digest
 *   node scripts/usa-gummies-revenue-intel.mjs run all
 *   node scripts/usa-gummies-revenue-intel.mjs status
 */

import fs from "node:fs";
import path from "node:path";
import {
  createEngine,
  todayET,
  todayLongET,
  nowETTimestamp,
  etParts,
  addDaysToDate,
  daysSince,
  safeJsonRead,
  safeJsonWrite,
  fetchWithTimeout,
  queryDatabaseAll,
  getPage,
  updatePage,
  createPageInDb,
  ensureFields,
  buildProperties,
  getPlainText,
  getPropByName,
  richTextValue,
  blockParagraph,
  blockHeading,
  sendIMessage,
  textBen,
  loadGA4ServiceAccount,
  GA4_PROPERTY_ID,
  CONFIG_DIR,
  HOME,
} from "./lib/usa-gummies-shared.mjs";

// ── Load env file (same pattern as daily-report.mjs) ─────────────────────────

const envPath = path.resolve(HOME, ".config/usa-gummies-mcp/.env-daily-report");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (val && !process.env[key]) process.env[key] = val;
    }
  }
}

// ── Config ───────────────────────────────────────────────────────────────────

const SHOPIFY_STORE = "usa-gummies.myshopify.com";
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || "";
const SHOPIFY_API_VERSION = "2025-01";

const AMZ_LWA_CLIENT_ID = process.env.LWA_CLIENT_ID || "";
const AMZ_LWA_CLIENT_SECRET = process.env.LWA_CLIENT_SECRET || "";
const AMZ_LWA_REFRESH_TOKEN = process.env.LWA_REFRESH_TOKEN || "";
const AMZ_MARKETPLACE_ID = process.env.MARKETPLACE_ID || "ATVPDKIKX0DER";
const AMZ_SP_ENDPOINT = process.env.SP_API_ENDPOINT || "https://sellingpartnerapi-na.amazon.com";

// ── Schedule Plan ────────────────────────────────────────────────────────────

const SCHEDULE_PLAN = {
  R1:  { label: "Shopify DTC Collector",    hour: 21, minute: 0, graceMinutes: 120 },
  R2:  { label: "Shopify B2B Collector",    hour: 21, minute: 5, graceMinutes: 120 },
  R3:  { label: "Amazon Collector",         hour: 21, minute: 10, graceMinutes: 120 },
  R4:  { label: "Faire Collector",          hour: 21, minute: 15, graceMinutes: 120 },
  R5:  { label: "GA4 Traffic Collector",    hour: 21, minute: 20, graceMinutes: 120 },
  R6:  { label: "COGS Calculator",          hour: 21, minute: 25, graceMinutes: 120 },
  R7:  { label: "Daily Digest Compiler",    hour: 21, minute: 30, graceMinutes: 120 },
  R8:  { label: "Weekly Trend Analyzer",    hour: 22, minute: 0, graceMinutes: 240, dayOfWeek: "Sun" },
  R9:  { label: "Monthly Investor Snapshot", hour: 22, minute: 0, graceMinutes: 480, dayOfMonth: 1 },
  R10: { label: "Anomaly Detector",         hour: 21, minute: 35, graceMinutes: 120 },
  R11: { label: "Forecast Engine",          hour: 22, minute: 30, graceMinutes: 240, dayOfWeek: "Sun" },
  R12: { label: "Self-Heal Monitor",        intervalMinutes: 30, graceMinutes: 60 },
};

// ── Notion Database IDs ──────────────────────────────────────────────────────

const IDS = {
  dailySnapshots:  process.env.REVENUE_DAILY_SNAPSHOTS_DB || "",
  weeklyReports:   process.env.REVENUE_WEEKLY_REPORTS_DB || "",
  monthlyReports:  process.env.REVENUE_MONTHLY_REPORTS_DB || "",
  revenueConfig:   process.env.REVENUE_CONFIG_DB || "",
  runLog:          process.env.REVENUE_RUNLOG_DB || "",
};

// ── State Files ──────────────────────────────────────────────────────────────

const DAILY_CACHE_FILE = path.join(CONFIG_DIR, "revenue-intel-daily-cache.json");

// ── Create Engine ────────────────────────────────────────────────────────────

const engine = createEngine({
  name: "revenue-intel",
  schedulePlan: SCHEDULE_PLAN,
  ids: IDS,
});

// ── Required DB Fields ───────────────────────────────────────────────────────

const REQUIRED_DAILY_FIELDS = {
  Name:                   { title: {} },
  Date:                   { date: {} },
  "Shopify DTC Revenue":  { number: { format: "dollar" } },
  "Shopify B2B Revenue":  { number: { format: "dollar" } },
  "Amazon Revenue":       { number: { format: "dollar" } },
  "Faire Revenue":        { number: { format: "dollar" } },
  "Total Revenue":        { number: { format: "dollar" } },
  COGS:                   { number: { format: "dollar" } },
  "Gross Margin":         { number: { format: "dollar" } },
  "Gross Margin %":       { number: { format: "percent" } },
  "GA4 Sessions":         { number: {} },
  "GA4 Users":            { number: {} },
  "Conversion Rate":      { number: { format: "percent" } },
  AOV:                    { number: { format: "dollar" } },
  "New Customers":        { number: {} },
  "Returning Customers":  { number: {} },
  "Shopify DTC Orders":   { number: {} },
  "Shopify B2B Orders":   { number: {} },
  "Amazon Orders":        { number: {} },
  "Faire Orders":         { number: {} },
  "Bounce Rate":          { number: { format: "percent" } },
  "Top Pages":            { rich_text: {} },
  "Traffic Sources":      { rich_text: {} },
  Notes:                  { rich_text: {} },
};

const REQUIRED_WEEKLY_FIELDS = {
  Name:                   { title: {} },
  "Week Start":           { date: {} },
  "Week End":             { date: {} },
  "Total Revenue":        { number: { format: "dollar" } },
  "WoW Revenue Change %": { number: { format: "percent" } },
  "Avg Daily Revenue":    { number: { format: "dollar" } },
  "DTC %":                { number: { format: "percent" } },
  "B2B %":                { number: { format: "percent" } },
  "Amazon %":             { number: { format: "percent" } },
  "Avg Sessions":         { number: {} },
  "Avg Conversion Rate":  { number: { format: "percent" } },
  "Avg AOV":              { number: { format: "dollar" } },
  Notes:                  { rich_text: {} },
};

const REQUIRED_MONTHLY_FIELDS = {
  Name:                   { title: {} },
  Month:                  { date: {} },
  "Total Revenue":        { number: { format: "dollar" } },
  "MoM Revenue Change %": { number: { format: "percent" } },
  "Total Orders":         { number: {} },
  "Gross Margin %":       { number: { format: "percent" } },
  "Total COGS":           { number: { format: "dollar" } },
  "Net Revenue":          { number: { format: "dollar" } },
  "Avg AOV":              { number: { format: "dollar" } },
  "Total Sessions":       { number: {} },
  "New Customers":        { number: {} },
  "Returning Customers":  { number: {} },
  "Est LTV":              { number: { format: "dollar" } },
  "Burn Rate":            { number: { format: "dollar" } },
  "Months Runway":        { number: {} },
  Notes:                  { rich_text: {} },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function pctChange(today, yesterday) {
  if (!yesterday || yesterday === 0) return today > 0 ? 100 : 0;
  return ((today - yesterday) / yesterday) * 100;
}

function pctStr(val) {
  return `${val >= 0 ? "+" : ""}${val.toFixed(0)}%`;
}

function dateRangePT(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const [m, day, y] = d.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles", month: "2-digit", day: "2-digit", year: "numeric",
  }).split("/");
  return `${y}-${m}-${day}`;
}

// ── API Fetchers ─────────────────────────────────────────────────────────────

async function fetchShopifyOrders(dateMin, dateMax) {
  if (!SHOPIFY_ADMIN_TOKEN) return [];
  const headers = { "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN, "Content-Type": "application/json" };
  const base = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}`;
  const url = `${base}/orders.json?status=any&created_at_min=${dateMin}&created_at_max=${dateMax}&limit=250`;
  try {
    const res = await fetchWithTimeout(url, { headers }, 30000);
    const data = await res.json();
    return data.orders || [];
  } catch (err) {
    engine.log(`Shopify API error: ${err.message}`);
    return [];
  }
}

async function getAmzAccessToken() {
  const res = await fetchWithTimeout("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: AMZ_LWA_REFRESH_TOKEN,
      client_id: AMZ_LWA_CLIENT_ID,
      client_secret: AMZ_LWA_CLIENT_SECRET,
    }),
  }, 15000);
  const data = await res.json();
  if (!data.access_token) throw new Error("Amazon LWA token exchange failed");
  return data.access_token;
}

async function fetchAmazonOrders(after, before) {
  if (!AMZ_LWA_CLIENT_ID || !AMZ_LWA_REFRESH_TOKEN) return [];
  try {
    const accessToken = await getAmzAccessToken();
    const params = new URLSearchParams({
      MarketplaceIds: AMZ_MARKETPLACE_ID,
      CreatedAfter: after,
      CreatedBefore: before,
    });
    const res = await fetchWithTimeout(`${AMZ_SP_ENDPOINT}/orders/v0/orders?${params}`, {
      headers: { "x-amz-access-token": accessToken, "Content-Type": "application/json" },
    }, 30000);
    const data = await res.json();
    return data.payload?.Orders || [];
  } catch (err) {
    engine.log(`Amazon API error: ${err.message}`);
    return [];
  }
}

async function fetchGA4Data(startDate, endDate, dimensions = [], metrics = [], limit = 0) {
  try {
    const { google } = await import("googleapis");
    const creds = loadGA4ServiceAccount();
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    });
    const analyticsData = google.analyticsdata({ version: "v1beta", auth });
    const requestBody = {
      dateRanges: [{ startDate, endDate }],
      metrics: metrics.map((name) => ({ name })),
    };
    if (dimensions.length) requestBody.dimensions = dimensions.map((name) => ({ name }));
    if (limit) {
      requestBody.limit = limit;
      requestBody.orderBys = [{ metric: { metricName: metrics[0] }, desc: true }];
    }
    const report = await analyticsData.properties.runReport({
      property: `properties/${GA4_PROPERTY_ID}`,
      requestBody,
    });
    return report.data;
  } catch (err) {
    engine.log(`GA4 API error: ${err.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// R1 — Shopify DTC Collector
// ═══════════════════════════════════════════════════════════════════════════════

async function runR1_ShopifyDTCCollector(opts = {}) {
  engine.log("R1 — Shopify DTC Collector starting...");
  const dryRun = opts.dryRun || false;

  const todayPT = dateRangePT(0);
  const tomorrowPT = dateRangePT(-1);
  const todayStartISO = `${todayPT}T00:00:00-08:00`;
  const tomorrowStartISO = `${tomorrowPT}T00:00:00-08:00`;

  const allOrders = await fetchShopifyOrders(todayStartISO, tomorrowStartISO);

  // Filter out B2B orders (tagged with "b2b" or "wholesale")
  const b2bTags = ["b2b", "wholesale", "bulk"];
  const dtcOrders = allOrders.filter((o) => {
    const tags = String(o.tags || "").toLowerCase();
    return !b2bTags.some((t) => tags.includes(t));
  });

  const revenue = dtcOrders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
  const count = dtcOrders.length;
  const aov = count > 0 ? revenue / count : 0;
  const discountUsed = dtcOrders.filter((o) => parseFloat(o.total_discounts || 0) > 0).length;

  // Top products
  const productCounts = {};
  for (const order of dtcOrders) {
    for (const item of order.line_items || []) {
      productCounts[item.title] = (productCounts[item.title] || 0) + item.quantity;
    }
  }
  const topProducts = Object.entries(productCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);

  // New vs returning
  const newCustomers = dtcOrders.filter((o) => o.customer?.orders_count === 1).length;
  const returning = count - newCustomers;

  const cache = safeJsonRead(DAILY_CACHE_FILE, {});
  cache[todayPT] = cache[todayPT] || {};
  cache[todayPT].dtc = { revenue, orders: count, aov, newCustomers, returning, discountUsed, topProducts };
  if (!dryRun) safeJsonWrite(DAILY_CACHE_FILE, cache);

  engine.log(`R1: DTC revenue=$${revenue.toFixed(2)}, orders=${count}, AOV=$${aov.toFixed(2)}, new=${newCustomers}, returning=${returning}`);

  await engine.logRun({
    agentName: "R1 — Shopify DTC Collector",
    recordsProcessed: count,
    status: "Success",
    notes: `rev=$${revenue.toFixed(2)}, orders=${count}, aov=$${aov.toFixed(2)}`,
  });

  return { status: "success", revenue, orders: count, aov, newCustomers, returning, topProducts };
}

// ═══════════════════════════════════════════════════════════════════════════════
// R2 — Shopify B2B Collector
// ═══════════════════════════════════════════════════════════════════════════════

async function runR2_ShopifyB2BCollector(opts = {}) {
  engine.log("R2 — Shopify B2B Collector starting...");
  const dryRun = opts.dryRun || false;

  const todayPT = dateRangePT(0);
  const tomorrowPT = dateRangePT(-1);
  const allOrders = await fetchShopifyOrders(`${todayPT}T00:00:00-08:00`, `${tomorrowPT}T00:00:00-08:00`);

  const b2bTags = ["b2b", "wholesale", "bulk"];
  const b2bOrders = allOrders.filter((o) => {
    const tags = String(o.tags || "").toLowerCase();
    return b2bTags.some((t) => tags.includes(t));
  });

  const revenue = b2bOrders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
  const count = b2bOrders.length;
  const avgOrderSize = count > 0 ? revenue / count : 0;

  const cache = safeJsonRead(DAILY_CACHE_FILE, {});
  cache[todayPT] = cache[todayPT] || {};
  cache[todayPT].b2b = { revenue, orders: count, avgOrderSize };
  if (!dryRun) safeJsonWrite(DAILY_CACHE_FILE, cache);

  engine.log(`R2: B2B revenue=$${revenue.toFixed(2)}, orders=${count}, avgSize=$${avgOrderSize.toFixed(2)}`);

  await engine.logRun({
    agentName: "R2 — Shopify B2B Collector",
    recordsProcessed: count,
    status: "Success",
    notes: `rev=$${revenue.toFixed(2)}, orders=${count}`,
  });

  return { status: "success", revenue, orders: count, avgOrderSize };
}

// ═══════════════════════════════════════════════════════════════════════════════
// R3 — Amazon Collector
// ═══════════════════════════════════════════════════════════════════════════════

async function runR3_AmazonCollector(opts = {}) {
  engine.log("R3 — Amazon Collector starting...");
  const dryRun = opts.dryRun || false;

  const todayPT = dateRangePT(0);
  const tomorrowPT = dateRangePT(-1);
  const nowISO = new Date(Date.now() - 3 * 60 * 1000).toISOString();

  const orders = await fetchAmazonOrders(`${todayPT}T00:00:00-08:00`, nowISO);
  const revenue = orders.reduce((s, o) => s + parseFloat(o.OrderTotal?.Amount || 0), 0);
  const count = orders.length;
  const aov = count > 0 ? revenue / count : 0;

  // Amazon fees estimate (~15% referral + ~$3 FBA per unit)
  const estimatedFees = revenue * 0.15;
  const netRevenue = revenue - estimatedFees;

  const cache = safeJsonRead(DAILY_CACHE_FILE, {});
  cache[todayPT] = cache[todayPT] || {};
  cache[todayPT].amazon = { revenue, orders: count, aov, estimatedFees, netRevenue };
  if (!dryRun) safeJsonWrite(DAILY_CACHE_FILE, cache);

  engine.log(`R3: Amazon revenue=$${revenue.toFixed(2)}, orders=${count}, net=$${netRevenue.toFixed(2)}`);

  await engine.logRun({
    agentName: "R3 — Amazon Collector",
    recordsProcessed: count,
    status: "Success",
    notes: `rev=$${revenue.toFixed(2)}, orders=${count}, fees=$${estimatedFees.toFixed(2)}`,
  });

  return { status: "success", revenue, orders: count, aov, netRevenue };
}

// ═══════════════════════════════════════════════════════════════════════════════
// R4 — Faire Collector
// ═══════════════════════════════════════════════════════════════════════════════

async function runR4_FaireCollector(opts = {}) {
  engine.log("R4 — Faire Collector starting...");
  // Faire API integration is pending (no official API — uses credential scraping)
  // For now: log placeholder and check for manual entries in daily cache

  const todayPT = dateRangePT(0);
  const cache = safeJsonRead(DAILY_CACHE_FILE, {});
  cache[todayPT] = cache[todayPT] || {};

  if (!cache[todayPT].faire) {
    cache[todayPT].faire = { revenue: 0, orders: 0, commission: 0, netRevenue: 0 };
  }

  if (!opts.dryRun) safeJsonWrite(DAILY_CACHE_FILE, cache);

  engine.log("R4: Faire — manual entry mode (API integration pending). Set values in daily cache.");

  await engine.logRun({
    agentName: "R4 — Faire Collector",
    recordsProcessed: 0,
    status: "Success",
    notes: "manual_entry_mode — Faire API pending",
  });

  return { status: "success", revenue: cache[todayPT].faire.revenue, notes: "manual_mode" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// R5 — GA4 Traffic Collector
// ═══════════════════════════════════════════════════════════════════════════════

async function runR5_GA4TrafficCollector(opts = {}) {
  engine.log("R5 — GA4 Traffic Collector starting...");
  const dryRun = opts.dryRun || false;
  const todayPT = dateRangePT(0);

  const [mainReport, topPagesReport, sourcesReport] = await Promise.all([
    fetchGA4Data(todayPT, todayPT, [], ["sessions", "screenPageViews", "newUsers", "bounceRate", "averageSessionDuration", "conversions"]),
    fetchGA4Data(todayPT, todayPT, ["pagePath"], ["screenPageViews"], 5),
    fetchGA4Data(todayPT, todayPT, ["sessionDefaultChannelGroup"], ["sessions"], 5),
  ]);

  const row = mainReport?.rows?.[0]?.metricValues || [];
  const sessions = Number(row[0]?.value || 0);
  const pageViews = Number(row[1]?.value || 0);
  const newUsers = Number(row[2]?.value || 0);
  const bounceRate = Number(row[3]?.value || 0);
  const avgDuration = Number(row[4]?.value || 0);
  const conversions = Number(row[5]?.value || 0);

  const topPages = (topPagesReport?.rows || []).map(
    (r) => `${r.dimensionValues[0].value} (${r.metricValues[0].value})`
  ).join(", ");

  const totalSrcSessions = (sourcesReport?.rows || []).reduce(
    (s, r) => s + Number(r.metricValues[0].value), 0
  );
  const sources = (sourcesReport?.rows || []).map((r) => {
    const pct = totalSrcSessions ? Math.round((Number(r.metricValues[0].value) / totalSrcSessions) * 100) : 0;
    return `${r.dimensionValues[0].value} ${pct}%`;
  }).join(", ");

  const cache = safeJsonRead(DAILY_CACHE_FILE, {});
  cache[todayPT] = cache[todayPT] || {};
  cache[todayPT].ga4 = { sessions, pageViews, newUsers, bounceRate, avgDuration, conversions, topPages, sources };
  if (!dryRun) safeJsonWrite(DAILY_CACHE_FILE, cache);

  engine.log(`R5: GA4 sessions=${sessions}, users=${newUsers}, bounce=${(bounceRate * 100).toFixed(0)}%, conversions=${conversions}`);

  await engine.logRun({
    agentName: "R5 — GA4 Traffic Collector",
    recordsProcessed: sessions,
    status: sessions > 0 || !GA4_PROPERTY_ID ? "Success" : "Partial",
    notes: `sessions=${sessions}, users=${newUsers}, conversions=${conversions}`,
  });

  return { status: "success", sessions, pageViews, newUsers, bounceRate, conversions, topPages, sources };
}

// ═══════════════════════════════════════════════════════════════════════════════
// R6 — COGS Calculator
// ═══════════════════════════════════════════════════════════════════════════════

async function runR6_COGSCalculator(opts = {}) {
  engine.log("R6 — COGS Calculator starting...");

  // Default COGS per bag (to be refined from Notion config or FinOps data)
  const cogsPerBag = 3.50; // Estimated: ingredients + packaging + labor

  const todayPT = dateRangePT(0);
  const cache = safeJsonRead(DAILY_CACHE_FILE, {});
  const day = cache[todayPT] || {};

  const dtcUnits = day.dtc?.orders || 0;
  const b2bUnits = day.b2b?.orders || 0;
  const amzUnits = day.amazon?.orders || 0;
  const faireUnits = day.faire?.orders || 0;
  const totalUnits = dtcUnits + b2bUnits + amzUnits + faireUnits;

  const totalCOGS = totalUnits * cogsPerBag;
  const totalRevenue = (day.dtc?.revenue || 0) + (day.b2b?.revenue || 0) + (day.amazon?.revenue || 0) + (day.faire?.revenue || 0);
  const grossMargin = totalRevenue - totalCOGS;
  const grossMarginPct = totalRevenue > 0 ? grossMargin / totalRevenue : 0;

  cache[todayPT] = cache[todayPT] || {};
  cache[todayPT].cogs = { cogsPerBag, totalCOGS, grossMargin, grossMarginPct, totalUnits };
  if (!opts.dryRun) safeJsonWrite(DAILY_CACHE_FILE, cache);

  engine.log(`R6: COGS=$${totalCOGS.toFixed(2)}, margin=$${grossMargin.toFixed(2)} (${(grossMarginPct * 100).toFixed(0)}%), units=${totalUnits}`);

  await engine.logRun({
    agentName: "R6 — COGS Calculator",
    recordsProcessed: totalUnits,
    status: "Success",
    notes: `cogs=$${totalCOGS.toFixed(2)}, margin=${(grossMarginPct * 100).toFixed(0)}%`,
  });

  return { status: "success", totalCOGS, grossMargin, grossMarginPct };
}

// ═══════════════════════════════════════════════════════════════════════════════
// R7 — Daily Digest Compiler
// Combines R1-R6 into a single daily snapshot.
// ═══════════════════════════════════════════════════════════════════════════════

async function runR7_DailyDigestCompiler(opts = {}) {
  engine.log("R7 — Daily Digest Compiler starting...");
  const dryRun = opts.dryRun || false;
  const todayPT = dateRangePT(0);
  const yesterdayPT = dateRangePT(1);

  const cache = safeJsonRead(DAILY_CACHE_FILE, {});
  const today = cache[todayPT] || {};
  const yesterday = cache[yesterdayPT] || {};

  // Aggregate today's numbers
  const dtcRev = today.dtc?.revenue || 0;
  const b2bRev = today.b2b?.revenue || 0;
  const amzRev = today.amazon?.revenue || 0;
  const faireRev = today.faire?.revenue || 0;
  const totalRevenue = dtcRev + b2bRev + amzRev + faireRev;

  const dtcOrders = today.dtc?.orders || 0;
  const b2bOrders = today.b2b?.orders || 0;
  const amzOrders = today.amazon?.orders || 0;
  const faireOrders = today.faire?.orders || 0;
  const totalOrders = dtcOrders + b2bOrders + amzOrders + faireOrders;

  const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const cogs = today.cogs?.totalCOGS || 0;
  const grossMargin = totalRevenue - cogs;
  const grossMarginPct = totalRevenue > 0 ? grossMargin / totalRevenue : 0;

  const sessions = today.ga4?.sessions || 0;
  const users = today.ga4?.newUsers || 0;
  const bounceRate = today.ga4?.bounceRate || 0;
  const convRate = sessions > 0 ? totalOrders / sessions : 0;
  const newCustomers = today.dtc?.newCustomers || 0;
  const returning = today.dtc?.returning || 0;

  // Yesterday comparison
  const yTotal = (yesterday.dtc?.revenue || 0) + (yesterday.b2b?.revenue || 0) + (yesterday.amazon?.revenue || 0) + (yesterday.faire?.revenue || 0);
  const revChange = pctChange(totalRevenue, yTotal);
  const ySessions = yesterday.ga4?.sessions || 0;
  const sessChange = pctChange(sessions, ySessions);

  // Write to Notion daily snapshots DB
  if (IDS.dailySnapshots && !dryRun) {
    try {
      await ensureFields(IDS.dailySnapshots, REQUIRED_DAILY_FIELDS);
      const props = buildProperties(IDS.dailySnapshots, {
        Name: `${todayLongET()} Revenue Report`,
        Date: todayPT,
        "Shopify DTC Revenue": dtcRev,
        "Shopify B2B Revenue": b2bRev,
        "Amazon Revenue": amzRev,
        "Faire Revenue": faireRev,
        "Total Revenue": totalRevenue,
        COGS: cogs,
        "Gross Margin": grossMargin,
        "Gross Margin %": grossMarginPct,
        "GA4 Sessions": sessions,
        "GA4 Users": users,
        "Conversion Rate": convRate,
        AOV: aov,
        "New Customers": newCustomers,
        "Returning Customers": returning,
        "Shopify DTC Orders": dtcOrders,
        "Shopify B2B Orders": b2bOrders,
        "Amazon Orders": amzOrders,
        "Faire Orders": faireOrders,
        "Bounce Rate": bounceRate,
        "Top Pages": today.ga4?.topPages || "",
        "Traffic Sources": today.ga4?.sources || "",
      });
      await createPageInDb(IDS.dailySnapshots, props);
    } catch (err) {
      engine.log(`Failed to write daily snapshot: ${err.message}`);
    }
  }

  // Text iMessage summary
  const msg = [
    `📊 USA Gummies — ${todayLongET()}`,
    ``,
    `💰 Revenue: $${totalRevenue.toFixed(2)} (${pctStr(revChange)} vs yesterday)`,
    `  • DTC: $${dtcRev.toFixed(2)} (${dtcOrders} orders)`,
    `  • B2B: $${b2bRev.toFixed(2)} (${b2bOrders} orders)`,
    `  • Amazon: $${amzRev.toFixed(2)} (${amzOrders} orders)`,
    faireRev > 0 ? `  • Faire: $${faireRev.toFixed(2)} (${faireOrders} orders)` : null,
    ``,
    `📈 Margin: $${grossMargin.toFixed(2)} (${(grossMarginPct * 100).toFixed(0)}%)`,
    `📉 AOV: $${aov.toFixed(2)} | Conv: ${(convRate * 100).toFixed(1)}%`,
    ``,
    `🌐 Traffic: ${sessions} sessions (${pctStr(sessChange)})`,
    `  • New: ${newCustomers} | Return: ${returning}`,
    `  • Bounce: ${(bounceRate * 100).toFixed(0)}%`,
    sessions > 0 ? `  • Sources: ${today.ga4?.sources || "n/a"}` : null,
  ].filter(Boolean).join("\n");

  if (!dryRun) {
    textBen(msg);
  } else {
    engine.log(`[DRY RUN] Would text:\n${msg}`);
  }

  engine.log("R7 — Daily Digest complete.");

  await engine.logRun({
    agentName: "R7 — Daily Digest Compiler",
    recordsProcessed: totalOrders,
    status: "Success",
    notes: `totalRev=$${totalRevenue.toFixed(2)}, orders=${totalOrders}, sessions=${sessions}`,
  });

  return { status: "success", totalRevenue, totalOrders, grossMarginPct, sessions };
}

// ═══════════════════════════════════════════════════════════════════════════════
// R8 — Weekly Trend Analyzer
// ═══════════════════════════════════════════════════════════════════════════════

async function runR8_WeeklyTrendAnalyzer(opts = {}) {
  engine.log("R8 — Weekly Trend Analyzer starting...");
  const dryRun = opts.dryRun || false;
  const cache = safeJsonRead(DAILY_CACHE_FILE, {});

  const today = dateRangePT(0);
  const weekDates = [];
  for (let i = 0; i < 7; i++) weekDates.push(dateRangePT(i));
  const prevWeekDates = [];
  for (let i = 7; i < 14; i++) prevWeekDates.push(dateRangePT(i));

  // Aggregate this week
  let weekRevenue = 0, weekOrders = 0, weekSessions = 0, weekConversions = 0;
  let dtcRev = 0, b2bRev = 0, amzRev = 0;

  for (const date of weekDates) {
    const day = cache[date] || {};
    const dayDtc = day.dtc?.revenue || 0;
    const dayB2b = day.b2b?.revenue || 0;
    const dayAmz = day.amazon?.revenue || 0;
    const dayFaire = day.faire?.revenue || 0;
    weekRevenue += dayDtc + dayB2b + dayAmz + dayFaire;
    dtcRev += dayDtc;
    b2bRev += dayB2b;
    amzRev += dayAmz;
    weekOrders += (day.dtc?.orders || 0) + (day.b2b?.orders || 0) + (day.amazon?.orders || 0) + (day.faire?.orders || 0);
    weekSessions += day.ga4?.sessions || 0;
  }

  // Previous week
  let prevWeekRevenue = 0;
  for (const date of prevWeekDates) {
    const day = cache[date] || {};
    prevWeekRevenue += (day.dtc?.revenue || 0) + (day.b2b?.revenue || 0) + (day.amazon?.revenue || 0) + (day.faire?.revenue || 0);
  }

  const wowChange = pctChange(weekRevenue, prevWeekRevenue);
  const avgDailyRev = weekRevenue / 7;
  const avgSessions = weekSessions / 7;
  const avgConvRate = weekSessions > 0 ? weekOrders / weekSessions : 0;
  const avgAOV = weekOrders > 0 ? weekRevenue / weekOrders : 0;
  const dtcPct = weekRevenue > 0 ? dtcRev / weekRevenue : 0;
  const b2bPct = weekRevenue > 0 ? b2bRev / weekRevenue : 0;
  const amzPct = weekRevenue > 0 ? amzRev / weekRevenue : 0;

  const weekStart = weekDates[weekDates.length - 1];
  const weekEnd = weekDates[0];

  if (IDS.weeklyReports && !dryRun) {
    try {
      await ensureFields(IDS.weeklyReports, REQUIRED_WEEKLY_FIELDS);
      const props = buildProperties(IDS.weeklyReports, {
        Name: `Week of ${weekStart}`,
        "Week Start": weekStart,
        "Week End": weekEnd,
        "Total Revenue": weekRevenue,
        "WoW Revenue Change %": wowChange / 100,
        "Avg Daily Revenue": avgDailyRev,
        "DTC %": dtcPct,
        "B2B %": b2bPct,
        "Amazon %": amzPct,
        "Avg Sessions": avgSessions,
        "Avg Conversion Rate": avgConvRate,
        "Avg AOV": avgAOV,
      });
      await createPageInDb(IDS.weeklyReports, props);
    } catch (err) {
      engine.log(`Failed to write weekly report: ${err.message}`);
    }
  }

  engine.log(`R8: Weekly rev=$${weekRevenue.toFixed(2)} (${pctStr(wowChange)} WoW), avgDaily=$${avgDailyRev.toFixed(2)}`);

  if (!dryRun) {
    textBen(
      `📊 Weekly Trend (${weekStart} to ${weekEnd}):\n` +
      `Rev: $${weekRevenue.toFixed(0)} (${pctStr(wowChange)} WoW)\n` +
      `Mix: DTC ${(dtcPct * 100).toFixed(0)}% | B2B ${(b2bPct * 100).toFixed(0)}% | AMZ ${(amzPct * 100).toFixed(0)}%\n` +
      `Avg AOV: $${avgAOV.toFixed(2)} | Conv: ${(avgConvRate * 100).toFixed(1)}%`
    );
  }

  await engine.logRun({
    agentName: "R8 — Weekly Trend Analyzer",
    recordsProcessed: 7,
    status: "Success",
    notes: `rev=$${weekRevenue.toFixed(0)}, wow=${pctStr(wowChange)}`,
  });

  return { status: "success", weekRevenue, wowChange, avgDailyRev, avgAOV };
}

// ═══════════════════════════════════════════════════════════════════════════════
// R9 — Monthly Investor Snapshot
// ═══════════════════════════════════════════════════════════════════════════════

async function runR9_MonthlyInvestorSnapshot(opts = {}) {
  engine.log("R9 — Monthly Investor Snapshot starting...");
  const dryRun = opts.dryRun || false;
  const cache = safeJsonRead(DAILY_CACHE_FILE, {});

  const today = dateRangePT(0);
  const currentMonth = today.slice(0, 7);
  const lastMonth = (() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();

  // Aggregate current month from cache
  let monthRev = 0, monthOrders = 0, monthSessions = 0, monthNew = 0, monthReturn = 0;

  for (const [date, day] of Object.entries(cache)) {
    if (!date.startsWith(currentMonth)) continue;
    monthRev += (day.dtc?.revenue || 0) + (day.b2b?.revenue || 0) + (day.amazon?.revenue || 0) + (day.faire?.revenue || 0);
    monthOrders += (day.dtc?.orders || 0) + (day.b2b?.orders || 0) + (day.amazon?.orders || 0) + (day.faire?.orders || 0);
    monthSessions += day.ga4?.sessions || 0;
    monthNew += day.dtc?.newCustomers || 0;
    monthReturn += day.dtc?.returning || 0;
  }

  // Last month for MoM comparison
  let lastMonthRev = 0;
  for (const [date, day] of Object.entries(cache)) {
    if (!date.startsWith(lastMonth)) continue;
    lastMonthRev += (day.dtc?.revenue || 0) + (day.b2b?.revenue || 0) + (day.amazon?.revenue || 0) + (day.faire?.revenue || 0);
  }

  const momChange = pctChange(monthRev, lastMonthRev);
  const avgAOV = monthOrders > 0 ? monthRev / monthOrders : 0;
  const estLTV = avgAOV * 2.5; // Rough LTV estimate: 2.5x AOV
  const grossMarginPct = 0.60; // From COGS calculator, rough estimate
  const monthCOGS = monthRev * (1 - grossMarginPct);
  const netRevenue = monthRev - monthCOGS;

  if (IDS.monthlyReports && !dryRun) {
    try {
      await ensureFields(IDS.monthlyReports, REQUIRED_MONTHLY_FIELDS);
      const props = buildProperties(IDS.monthlyReports, {
        Name: `${currentMonth} Monthly Report`,
        Month: `${currentMonth}-01`,
        "Total Revenue": monthRev,
        "MoM Revenue Change %": momChange / 100,
        "Total Orders": monthOrders,
        "Gross Margin %": grossMarginPct,
        "Total COGS": monthCOGS,
        "Net Revenue": netRevenue,
        "Avg AOV": avgAOV,
        "Total Sessions": monthSessions,
        "New Customers": monthNew,
        "Returning Customers": monthReturn,
        "Est LTV": estLTV,
      });
      await createPageInDb(IDS.monthlyReports, props);
    } catch (err) {
      engine.log(`Failed to write monthly report: ${err.message}`);
    }
  }

  if (!dryRun) {
    textBen(
      `📊 Monthly Snapshot (${currentMonth}):\n` +
      `Revenue: $${monthRev.toFixed(0)} (${pctStr(momChange)} MoM)\n` +
      `Orders: ${monthOrders} | AOV: $${avgAOV.toFixed(2)}\n` +
      `Est LTV: $${estLTV.toFixed(0)} | Margin: ${(grossMarginPct * 100).toFixed(0)}%\n` +
      `New: ${monthNew} | Return: ${monthReturn} | Sessions: ${monthSessions}`
    );
  }

  engine.log(`R9: Monthly rev=$${monthRev.toFixed(0)}, MoM=${pctStr(momChange)}, orders=${monthOrders}`);

  await engine.logRun({
    agentName: "R9 — Monthly Investor Snapshot",
    recordsProcessed: monthOrders,
    status: "Success",
    notes: `rev=$${monthRev.toFixed(0)}, mom=${pctStr(momChange)}`,
  });

  return { status: "success", monthRev, momChange, monthOrders, avgAOV, estLTV };
}

// ═══════════════════════════════════════════════════════════════════════════════
// R10 — Anomaly Detector
// ═══════════════════════════════════════════════════════════════════════════════

async function runR10_AnomalyDetector(opts = {}) {
  engine.log("R10 — Anomaly Detector starting...");
  const dryRun = opts.dryRun || false;
  const cache = safeJsonRead(DAILY_CACHE_FILE, {});
  const anomalies = [];

  // Get last 7 days for rolling average
  const recentDates = [];
  for (let i = 1; i <= 7; i++) recentDates.push(dateRangePT(i));

  const recentRevs = [];
  const recentSessions = [];
  for (const date of recentDates) {
    const day = cache[date] || {};
    const dayRev = (day.dtc?.revenue || 0) + (day.b2b?.revenue || 0) + (day.amazon?.revenue || 0) + (day.faire?.revenue || 0);
    recentRevs.push(dayRev);
    recentSessions.push(day.ga4?.sessions || 0);
  }

  const todayPT = dateRangePT(0);
  const today = cache[todayPT] || {};
  const todayRev = (today.dtc?.revenue || 0) + (today.b2b?.revenue || 0) + (today.amazon?.revenue || 0) + (today.faire?.revenue || 0);
  const todaySessions = today.ga4?.sessions || 0;

  // Compute mean and stddev
  function meanAndStd(arr) {
    if (arr.length === 0) return { mean: 0, std: 0 };
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    const variance = arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / arr.length;
    return { mean, std: Math.sqrt(variance) };
  }

  const revStats = meanAndStd(recentRevs);
  const sessStats = meanAndStd(recentSessions);

  // Check for >2 standard deviations
  if (revStats.std > 0 && Math.abs(todayRev - revStats.mean) > 2 * revStats.std) {
    const direction = todayRev > revStats.mean ? "spike" : "drop";
    anomalies.push(`Revenue ${direction}: $${todayRev.toFixed(0)} vs 7d avg $${revStats.mean.toFixed(0)} (±$${revStats.std.toFixed(0)})`);
  }

  if (sessStats.std > 0 && Math.abs(todaySessions - sessStats.mean) > 2 * sessStats.std) {
    const direction = todaySessions > sessStats.mean ? "spike" : "drop";
    anomalies.push(`Traffic ${direction}: ${todaySessions} sessions vs 7d avg ${sessStats.mean.toFixed(0)} (±${sessStats.std.toFixed(0)})`);
  }

  if (anomalies.length > 0 && !dryRun) {
    textBen(`🚨 Anomaly Alert:\n${anomalies.join("\n")}`);
    engine.log(`Anomalies detected: ${anomalies.join("; ")}`);
  } else {
    engine.log("R10: No anomalies detected.");
  }

  await engine.logRun({
    agentName: "R10 — Anomaly Detector",
    recordsProcessed: 1,
    status: "Success",
    notes: anomalies.length ? anomalies.join("; ") : "no_anomalies",
  });

  return { status: "success", anomalies };
}

// ═══════════════════════════════════════════════════════════════════════════════
// R11 — Forecast Engine
// ═══════════════════════════════════════════════════════════════════════════════

async function runR11_ForecastEngine(opts = {}) {
  engine.log("R11 — Forecast Engine starting...");
  const dryRun = opts.dryRun || false;
  const cache = safeJsonRead(DAILY_CACHE_FILE, {});

  // Get last 30 days of revenue
  const dataPoints = [];
  for (let i = 0; i < 30; i++) {
    const date = dateRangePT(i);
    const day = cache[date] || {};
    const dayRev = (day.dtc?.revenue || 0) + (day.b2b?.revenue || 0) + (day.amazon?.revenue || 0) + (day.faire?.revenue || 0);
    dataPoints.push({ x: 30 - i, y: dayRev }); // x=1 is oldest, x=30 is today
  }

  const validPoints = dataPoints.filter((p) => p.y > 0);

  if (validPoints.length < 7) {
    engine.log("R11: Not enough data for forecast (need 7+ days). Skipping.");
    return { status: "success", notes: "insufficient_data" };
  }

  // Simple linear regression
  const n = validPoints.length;
  const sumX = validPoints.reduce((s, p) => s + p.x, 0);
  const sumY = validPoints.reduce((s, p) => s + p.y, 0);
  const sumXY = validPoints.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = validPoints.reduce((s, p) => s + p.x * p.x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Project forward from x=30 (today)
  const forecast7d = Array.from({ length: 7 }, (_, i) => Math.max(0, slope * (31 + i) + intercept)).reduce((s, v) => s + v, 0);
  const forecast30d = Array.from({ length: 30 }, (_, i) => Math.max(0, slope * (31 + i) + intercept)).reduce((s, v) => s + v, 0);
  const forecast90d = Array.from({ length: 90 }, (_, i) => Math.max(0, slope * (31 + i) + intercept)).reduce((s, v) => s + v, 0);

  const trend = slope > 0 ? "upward" : slope < 0 ? "downward" : "flat";

  engine.log(`R11: Trend=${trend} (slope=$${slope.toFixed(2)}/day), 7d=$${forecast7d.toFixed(0)}, 30d=$${forecast30d.toFixed(0)}, 90d=$${forecast90d.toFixed(0)}`);

  if (!dryRun) {
    textBen(
      `📈 Revenue Forecast:\n` +
      `Trend: ${trend} ($${slope.toFixed(2)}/day)\n` +
      `Next 7d: $${forecast7d.toFixed(0)}\n` +
      `Next 30d: $${forecast30d.toFixed(0)}\n` +
      `Next 90d: $${forecast90d.toFixed(0)}`
    );
  }

  await engine.logRun({
    agentName: "R11 — Forecast Engine",
    recordsProcessed: validPoints.length,
    status: "Success",
    notes: `trend=${trend}, slope=$${slope.toFixed(2)}/day, 30d=$${forecast30d.toFixed(0)}`,
  });

  return { status: "success", forecast7d, forecast30d, forecast90d, slope, trend };
}

// ═══════════════════════════════════════════════════════════════════════════════
// R12 — Self-Heal Monitor
// ═══════════════════════════════════════════════════════════════════════════════

async function runR12_SelfHealMonitor(opts = {}) {
  engine.log("R12 — Self-Heal Monitor starting...");

  if (!engine.tryAcquireSelfHealLock()) {
    engine.log("Another self-heal is running. Skipping.");
    return { status: "success", notes: "locked" };
  }

  try {
    const status = engine.loadSystemStatus();
    const nowET = etParts(new Date());
    const repairs = [];

    for (const [agentKey, agentState] of Object.entries(status.agents || {})) {
      if (agentKey === "R12") continue;

      if (engine.shouldRepairAgentNow(agentKey, agentState, nowET)) {
        const reason = agentState.lastStatus === "failed"
          ? `retry_after_failure (last: ${agentState.lastRunAtET || "never"})`
          : `missed_schedule (last: ${agentState.lastRunAtET || "never"})`;

        engine.log(`Self-heal: repairing ${agentKey} — ${reason}`);
        repairs.push({ agent: agentKey, reason });

        try {
          await runAgentByName(agentKey, { source: "self-heal" });
        } catch (err) {
          engine.log(`Self-heal repair failed for ${agentKey}: ${err.message}`);
        }
      }
    }

    status.selfHeal = {
      lastRunAt: new Date().toISOString(),
      lastActionSummary: repairs.length ? repairs.map((r) => `${r.agent}: ${r.reason}`).join("; ") : "all_healthy",
      actions: repairs,
    };
    engine.saveSystemStatus(status);

    if (repairs.length > 0) {
      engine.log(`Self-heal complete: repaired ${repairs.length} agents`);
    } else {
      engine.log("Self-heal complete: all agents healthy");
    }

    return { status: "success", repairs };
  } finally {
    engine.releaseSelfHealLock();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Agent Registry & CLI
// ═══════════════════════════════════════════════════════════════════════════════

const AGENT_REGISTRY = {
  R1:  { fn: runR1_ShopifyDTCCollector,       label: "Shopify DTC Collector" },
  R2:  { fn: runR2_ShopifyB2BCollector,       label: "Shopify B2B Collector" },
  R3:  { fn: runR3_AmazonCollector,           label: "Amazon Collector" },
  R4:  { fn: runR4_FaireCollector,            label: "Faire Collector" },
  R5:  { fn: runR5_GA4TrafficCollector,       label: "GA4 Traffic Collector" },
  R6:  { fn: runR6_COGSCalculator,            label: "COGS Calculator" },
  R7:  { fn: runR7_DailyDigestCompiler,       label: "Daily Digest Compiler" },
  R8:  { fn: runR8_WeeklyTrendAnalyzer,       label: "Weekly Trend Analyzer" },
  R9:  { fn: runR9_MonthlyInvestorSnapshot,   label: "Monthly Investor Snapshot" },
  R10: { fn: runR10_AnomalyDetector,          label: "Anomaly Detector" },
  R11: { fn: runR11_ForecastEngine,           label: "Forecast Engine" },
  R12: { fn: runR12_SelfHealMonitor,          label: "Self-Heal Monitor" },
};

async function runAgentByName(name, context = {}) {
  const upper = String(name || "").toUpperCase();
  const entry = AGENT_REGISTRY[upper];
  if (!entry) throw new Error(`Unknown agent: ${name}. Available: ${Object.keys(AGENT_REGISTRY).join(", ")}`);

  return engine.runSingleAgentWithMonitoring(upper, () => entry.fn(context), {
    source: context.source || "manual",
  });
}

async function runScheduledAgents() {
  const nowET = etParts(new Date());
  engine.log(`Running scheduled agents at ${nowET.date} ${String(nowET.hour).padStart(2, "0")}:${String(nowET.minute).padStart(2, "0")} ET`);

  for (const [key, schedule] of Object.entries(SCHEDULE_PLAN)) {
    if (key === "R12") continue;
    if (schedule.dayOfWeek && schedule.dayOfWeek !== nowET.weekday) continue;
    if (schedule.dayOfMonth && parseInt(nowET.day, 10) !== schedule.dayOfMonth) continue;
    if (schedule.hour !== undefined) {
      const scheduledMinutes = schedule.hour * 60 + schedule.minute;
      const currentMinutes = nowET.minutesOfDay;
      if (Math.abs(currentMinutes - scheduledMinutes) > 15) continue;
    }
    if (schedule.intervalMinutes) {
      const status = engine.loadSystemStatus();
      const lastRun = status.agents?.[key]?.lastRunAt;
      if (lastRun) {
        const ageMin = (Date.now() - Date.parse(lastRun)) / 60000;
        if (ageMin < schedule.intervalMinutes) continue;
      }
    }
    engine.log(`Scheduled: running ${key} (${schedule.label})`);
    try {
      await runAgentByName(key, { source: "cron" });
    } catch (err) {
      engine.log(`Scheduled agent ${key} failed: ${err.message}`);
    }
  }
}

function showStatus() {
  const status = engine.loadSystemStatus();
  console.log(JSON.stringify(status, null, 2));
}

function showHelp() {
  console.log(`
USA Gummies Revenue Intelligence Engine (Build 2)
═══════════════════════════════════════════════════

Commands:
  run <agent>      Run a specific agent (R1-R12)
  run all          Run all scheduled agents for current time
  run self-heal    Run the self-heal monitor
  status           Show system status JSON
  help             Show this help

Options:
  --dry-run        Preview actions without making changes
  --source <src>   Override run source label

Agents:
  R1   Shopify DTC Collector           Daily 9:00 PM
  R2   Shopify B2B Collector           Daily 9:05 PM
  R3   Amazon Collector                Daily 9:10 PM
  R4   Faire Collector                 Daily 9:15 PM
  R5   GA4 Traffic Collector           Daily 9:20 PM
  R6   COGS Calculator                 Daily 9:25 PM
  R7   Daily Digest Compiler           Daily 9:30 PM
  R8   Weekly Trend Analyzer           Weekly Sun 10:00 PM
  R9   Monthly Investor Snapshot       Monthly 1st 10:00 PM
  R10  Anomaly Detector                Daily 9:35 PM
  R11  Forecast Engine                 Weekly Sun 10:30 PM
  R12  Self-Heal Monitor               Every 30 min

Replaces: scripts/daily-report.mjs (legacy 9pm iMessage summary)

Examples:
  node scripts/usa-gummies-revenue-intel.mjs run R7     # daily digest
  node scripts/usa-gummies-revenue-intel.mjs --dry-run run R1
  node scripts/usa-gummies-revenue-intel.mjs run all
  node scripts/usa-gummies-revenue-intel.mjs status
`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = engine.parseArgs(process.argv.slice(2));

  switch (args.cmd) {
    case "run": {
      const target = String(args.arg || "").toLowerCase();
      if (target === "all") {
        await runScheduledAgents();
      } else if (target === "self-heal") {
        await runAgentByName("R12", { source: args.source || "manual" });
      } else {
        const agentName = target.toUpperCase();
        if (!AGENT_REGISTRY[agentName]) {
          console.error(`Unknown agent: ${target}. Use: ${Object.keys(AGENT_REGISTRY).join(", ")}`);
          process.exit(1);
        }
        const result = await runAgentByName(agentName, {
          source: args.source || "manual",
          dryRun: args.dryRun || false,
        });
        console.log(JSON.stringify(result, null, 2));
      }
      break;
    }
    case "status":
      showStatus();
      break;
    case "help":
    default:
      showHelp();
      break;
  }
}

main().catch((err) => {
  console.error(`Revenue Intel engine fatal error: ${err.message}`);
  process.exit(1);
});
