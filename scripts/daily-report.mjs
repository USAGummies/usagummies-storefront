#!/usr/bin/env node

/**
 * USA Gummies — Daily Analytics Report
 * Runs at 9pm PT via launchd, texts a summary via iMessage.
 *
 * Setup:
 *   1. Set env vars in ~/.config/usa-gummies-mcp/.env-daily-report
 *   2. launchctl load ~/Library/LaunchAgents/com.usagummies.daily-report.plist
 */

import { google } from 'googleapis';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ── Load env file ───────────────────────────────────────────────────────────
const envPath = resolve(process.env.HOME, '.config/usa-gummies-mcp/.env-daily-report');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (val && !process.env[key]) process.env[key] = val;
    }
  }
}

// ── Config ──────────────────────────────────────────────────────────────────
const PHONE_NUMBERS = ['4358967765', '6102356973'];
const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID || '';
const SHOPIFY_STORE = 'usa-gummies.myshopify.com';
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || '';
const GA4_SERVICE_ACCOUNT_PATH = resolve(
  process.env.HOME,
  '.config/usa-gummies-mcp/ga4-service-account.json'
);
const SHOPIFY_API_VERSION = '2025-01';

// Amazon SP-API
const AMZ_LWA_CLIENT_ID = process.env.LWA_CLIENT_ID || '';
const AMZ_LWA_CLIENT_SECRET = process.env.LWA_CLIENT_SECRET || '';
const AMZ_LWA_REFRESH_TOKEN = process.env.LWA_REFRESH_TOKEN || '';
const AMZ_MARKETPLACE_ID = process.env.MARKETPLACE_ID || 'ATVPDKIKX0DER';
const AMZ_SP_ENDPOINT = process.env.SP_API_ENDPOINT || 'https://sellingpartnerapi-na.amazon.com';

// ── Helpers ─────────────────────────────────────────────────────────────────
function pctChange(today, yesterday) {
  if (!yesterday || yesterday === 0) return today > 0 ? '+100%' : '0%';
  const pct = ((today - yesterday) / yesterday) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function todayStr() {
  return new Date().toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles'
  });
}

function dateRange(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  // Use PT date, not UTC — at 9pm PT the UTC date is already tomorrow
  const [m, day, y] = d.toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles', month: '2-digit', day: '2-digit', year: 'numeric'
  }).split('/');
  return `${y}-${m}-${day}`;
}

// ── GA4 Data ────────────────────────────────────────────────────────────────
async function fetchGA4() {
  if (!GA4_PROPERTY_ID) return null;

  let creds;
  try {
    creds = JSON.parse(readFileSync(GA4_SERVICE_ACCOUNT_PATH, 'utf8'));
  } catch {
    console.error('Could not read GA4 service account JSON');
    return null;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
  });

  const analyticsData = google.analyticsdata({ version: 'v1beta', auth });
  const today = dateRange(0);
  const yesterday = dateRange(1);

  // Today's report
  const [todayReport, yesterdayReport, topPages, sources] = await Promise.all([
    analyticsData.properties.runReport({
      property: GA4_PROPERTY_ID,
      requestBody: {
        dateRanges: [{ startDate: today, endDate: today }],
        metrics: [
          { name: 'sessions' },
          { name: 'screenPageViews' },
          { name: 'newUsers' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
          { name: 'conversions' },
        ],
      },
    }),
    analyticsData.properties.runReport({
      property: GA4_PROPERTY_ID,
      requestBody: {
        dateRanges: [{ startDate: yesterday, endDate: yesterday }],
        metrics: [{ name: 'sessions' }],
      },
    }),
    analyticsData.properties.runReport({
      property: GA4_PROPERTY_ID,
      requestBody: {
        dateRanges: [{ startDate: today, endDate: today }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 5,
      },
    }),
    analyticsData.properties.runReport({
      property: GA4_PROPERTY_ID,
      requestBody: {
        dateRanges: [{ startDate: today, endDate: today }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 5,
      },
    }),
  ]);

  const row = todayReport.data.rows?.[0]?.metricValues || [];
  const ySessions = Number(yesterdayReport.data.rows?.[0]?.metricValues?.[0]?.value || 0);

  const sessions = Number(row[0]?.value || 0);
  const pageViews = Number(row[1]?.value || 0);
  const newUsers = Number(row[2]?.value || 0);
  const bounceRate = Number(row[3]?.value || 0);
  const avgDuration = Number(row[4]?.value || 0);
  const conversions = Number(row[5]?.value || 0);

  const topPagesStr = (topPages.data.rows || [])
    .map(r => `${r.dimensionValues[0].value} (${r.metricValues[0].value})`)
    .join(', ');

  const totalSrcSessions = (sources.data.rows || []).reduce(
    (s, r) => s + Number(r.metricValues[0].value), 0
  );
  const sourcesStr = (sources.data.rows || [])
    .map(r => {
      const pct = totalSrcSessions ? Math.round((Number(r.metricValues[0].value) / totalSrcSessions) * 100) : 0;
      return `${r.dimensionValues[0].value} ${pct}%`;
    })
    .join(', ');

  return {
    sessions,
    sessionChange: pctChange(sessions, ySessions),
    pageViews,
    newUsers,
    bounceRate: (bounceRate * 100).toFixed(0),
    avgDuration: formatDuration(avgDuration),
    conversions,
    topPages: topPagesStr,
    sources: sourcesStr,
  };
}

// ── Shopify Data ────────────────────────────────────────────────────────────
async function fetchShopify() {
  if (!SHOPIFY_ADMIN_TOKEN) return null;

  const headers = {
    'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
    'Content-Type': 'application/json',
  };
  const base = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}`;

  // Build PT-aware date boundaries (same approach as GA4 / Amazon)
  const todayPT = dateRange(0);
  const yesterdayPT = dateRange(1);
  const tomorrowPT = dateRange(-1);

  const todayStartISO = `${todayPT}T00:00:00-08:00`;
  const yesterdayStartISO = `${yesterdayPT}T00:00:00-08:00`;
  const tomorrowStartISO = `${tomorrowPT}T00:00:00-08:00`;

  const [todayOrders, yesterdayOrders] = await Promise.all([
    fetch(
      `${base}/orders.json?status=any&created_at_min=${todayStartISO}&created_at_max=${tomorrowStartISO}&limit=250`,
      { headers }
    ).then(r => r.json()),
    fetch(
      `${base}/orders.json?status=any&created_at_min=${yesterdayStartISO}&created_at_max=${todayStartISO}&limit=250`,
      { headers }
    ).then(r => r.json()),
  ]);

  const tOrders = todayOrders.orders || [];
  const yOrders = yesterdayOrders.orders || [];

  const tRevenue = tOrders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
  const yRevenue = yOrders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
  const tCount = tOrders.length;
  const yCount = yOrders.length;
  const aov = tCount > 0 ? (tRevenue / tCount).toFixed(2) : '0.00';

  // Top products today
  const productCounts = {};
  for (const order of tOrders) {
    for (const item of order.line_items || []) {
      productCounts[item.title] = (productCounts[item.title] || 0) + item.quantity;
    }
  }
  const topProduct = Object.entries(productCounts)
    .sort((a, b) => b[1] - a[1])[0];

  return {
    orders: tCount,
    orderChange: pctChange(tCount, yCount),
    revenue: tRevenue.toFixed(2),
    revenueChange: pctChange(tRevenue, yRevenue),
    aov,
    topProduct: topProduct ? `${topProduct[0]} (${topProduct[1]} sold)` : 'None',
  };
}

// ── Amazon SP-API Data ──────────────────────────────────────────────────────
async function getAmzAccessToken() {
  const res = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: AMZ_LWA_REFRESH_TOKEN,
      client_id: AMZ_LWA_CLIENT_ID,
      client_secret: AMZ_LWA_CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Amazon LWA token exchange failed');
  return data.access_token;
}

async function fetchAmazon() {
  if (!AMZ_LWA_CLIENT_ID || !AMZ_LWA_REFRESH_TOKEN) return null;

  const accessToken = await getAmzAccessToken();

  // Build PT-aware date boundaries (same approach as GA4)
  const todayPT = dateRange(0);
  const yesterdayPT = dateRange(1);

  const todayStartISO = `${todayPT}T00:00:00-08:00`;
  const yesterdayStartISO = `${yesterdayPT}T00:00:00-08:00`;
  // Use "now minus 3 min" for upper bound — Amazon requires CreatedBefore to be in the past
  const nowISO = new Date(Date.now() - 3 * 60 * 1000).toISOString();

  const headers = {
    'x-amz-access-token': accessToken,
    'Content-Type': 'application/json',
  };

  // Fetch orders using PT-aware date strings
  const fetchOrders = async (after, before) => {
    const params = new URLSearchParams({
      MarketplaceIds: AMZ_MARKETPLACE_ID,
      CreatedAfter: after,
      CreatedBefore: before,
    });
    const res = await fetch(`${AMZ_SP_ENDPOINT}/orders/v0/orders?${params}`, { headers });
    const data = await res.json();
    if (data.errors) {
      console.error('Amazon API errors:', JSON.stringify(data.errors));
    }
    return data.payload?.Orders || [];
  };

  const [tOrders, yOrders] = await Promise.all([
    fetchOrders(todayStartISO, nowISO),
    fetchOrders(yesterdayStartISO, todayStartISO),
  ]);

  const tCount = tOrders.length;
  const yCount = yOrders.length;
  const tRevenue = tOrders.reduce((s, o) => {
    const amt = o.OrderTotal?.Amount;
    return s + (amt ? parseFloat(amt) : 0);
  }, 0);
  const yRevenue = yOrders.reduce((s, o) => {
    const amt = o.OrderTotal?.Amount;
    return s + (amt ? parseFloat(amt) : 0);
  }, 0);
  const aov = tCount > 0 ? (tRevenue / tCount).toFixed(2) : '0.00';

  return {
    orders: tCount,
    orderChange: pctChange(tCount, yCount),
    revenue: tRevenue.toFixed(2),
    revenueChange: pctChange(tRevenue, yRevenue),
    aov,
  };
}

// ── iMessage ────────────────────────────────────────────────────────────────
function sendIMessage(message) {
  const escaped = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  for (const phone of PHONE_NUMBERS) {
    const script = `
      tell application "Messages"
        set targetService to 1st account whose service type = iMessage
        set targetBuddy to participant "${phone}" of targetService
        send "${escaped}" to targetBuddy
      end tell
    `;
    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
  }
}

// ── Behavior Summary ─────────────────────────────────────────────────────────
function behaviorSummary(ga4) {
  const lines = [];

  // Session trend
  const dir = ga4.sessions > 0 && ga4.sessionChange.startsWith('+') ? 'up' : 'down';
  lines.push(
    `Traffic is ${dir} today with ${ga4.sessions} sessions (${ga4.sessionChange} vs yesterday), ${ga4.newUsers} of which are new visitors.`
  );

  // Engagement quality
  const bounce = Number(ga4.bounceRate);
  const engageNote = bounce >= 80
    ? `Bounce rate is high at ${bounce}% — most visitors are leaving after one page.`
    : bounce >= 50
      ? `Bounce rate is moderate at ${bounce}% — about half of visitors explore beyond the landing page.`
      : `Bounce rate is low at ${bounce}% — visitors are actively browsing multiple pages.`;
  lines.push(`${engageNote} Average session lasts ${ga4.avgDuration}.`);

  // Top traffic source
  if (ga4.sources) {
    const topSrc = ga4.sources.split(',')[0]?.trim();
    if (topSrc) lines.push(`Top traffic source is ${topSrc}.`);
  }

  // Conversions callout
  if (ga4.conversions > 0) {
    lines.push(`${ga4.conversions} conversion${ga4.conversions === 1 ? '' : 's'} tracked today.`);
  }

  return lines.join(' ');
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[${new Date().toISOString()}] Running daily report...`);

  const [ga4, shopify, amazon] = await Promise.all([
    fetchGA4().catch(e => { console.error('GA4 error:', e.message); return null; }),
    fetchShopify().catch(e => { console.error('Shopify error:', e.message); return null; }),
    fetchAmazon().catch(e => { console.error('Amazon error:', e.message); return null; }),
  ]);

  let msg = `USA Gummies Daily — ${todayStr()}\n`;

  if (ga4) {
    msg += `\nTRAFFIC: ${ga4.sessions} sessions (${ga4.sessionChange}) | ${ga4.newUsers} new users`;
    msg += `\nPAGES: ${ga4.topPages}`;
    msg += `\nSOURCES: ${ga4.sources}`;
    msg += `\nBOUNCE: ${ga4.bounceRate}% | AVG: ${ga4.avgDuration}`;
    msg += `\n\n${behaviorSummary(ga4)}`;
  } else {
    msg += `\nTRAFFIC: [GA4 unavailable]`;
  }

  if (shopify) {
    msg += `\n\nSHOPIFY: ${shopify.orders} orders (${shopify.orderChange}) | $${shopify.revenue} (${shopify.revenueChange})`;
    msg += `\nAOV: $${shopify.aov} | Top: ${shopify.topProduct}`;
  } else {
    msg += `\n\nSHOPIFY: [unavailable]`;
  }

  if (amazon) {
    msg += `\n\nAMAZON: ${amazon.orders} orders (${amazon.orderChange})`;
  } else {
    msg += `\n\nAMAZON: [unavailable]`;
  }

  console.log('Report:\n' + msg);

  try {
    sendIMessage(msg);
    console.log('iMessage sent successfully.');
  } catch (e) {
    console.error('Failed to send iMessage:', e.message);
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
