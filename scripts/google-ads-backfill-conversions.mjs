#!/usr/bin/env node
/**
 * USA Gummies — Google Ads offline-conversion backfill
 *
 * WHY: From Sept 2025 through April 2026 we ran Google Ads with NO conversion
 * tag installed. Smart Bidding has never seen a purchase signal. When we
 * finally create the Purchase conversion action in the Google Ads UI, this
 * script pulls every Shopify order from that window, matches each order to a
 * Google click-ID (GCLID) captured via URL param / UTM / attribution window,
 * and uploads them to the Google Ads API as offline conversions. That gives
 * Smart Bidding a retroactive training set instead of starting from zero.
 *
 * PREREQS (run only after all are set):
 *   - Purchase conversion action created in Google Ads UI (category=Purchase,
 *     include-in-conversions=YES, count=one, attribution=data-driven). Copy
 *     the full resource name: customers/7754142374/conversionActions/XXXXXX
 *   - GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
 *     GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID (=7754142374) env vars
 *   - GOOGLE_ADS_PURCHASE_CONVERSION_ACTION (resource name from UI)
 *   - SHOPIFY_ADMIN_TOKEN
 *
 * USAGE:
 *   node scripts/google-ads-backfill-conversions.mjs --since 2025-09-01 --dry
 *   node scripts/google-ads-backfill-conversions.mjs --since 2025-09-01
 *
 * NOTE: Google Ads accepts offline conversions up to 90 days old by default.
 * Anything older than 90 days requires raising the conversion-action's
 * click-through conversion window in the UI first.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ── Env loading ─────────────────────────────────────────────────────────────
const envPath = resolve(process.env.HOME || "", ".config/usa-gummies-mcp/.env-daily-report");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
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

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry");
const SINCE_IDX = args.indexOf("--since");
const SINCE = SINCE_IDX >= 0 ? args[SINCE_IDX + 1] : "2025-09-01";

const REQUIRED = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_CUSTOMER_ID",
  "GOOGLE_ADS_PURCHASE_CONVERSION_ACTION",
  "SHOPIFY_ADMIN_TOKEN",
];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length && !DRY_RUN) {
  console.error(`Missing env: ${missing.join(", ")}`);
  console.error("Run with --dry to preview Shopify orders without uploading.");
  process.exit(1);
}

const CUSTOMER_ID = (process.env.GOOGLE_ADS_CUSTOMER_ID || "7754142374").replace(/\D/g, "");
const CONVERSION_ACTION = process.env.GOOGLE_ADS_PURCHASE_CONVERSION_ACTION || "";
const SHOPIFY_STORE = "usa-gummies.myshopify.com";
const SHOPIFY_API_VERSION = "2025-01";
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || "";

// ── Shopify: pull orders since SINCE ────────────────────────────────────────
async function fetchShopifyOrders(sinceIso) {
  const orders = [];
  let url =
    `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/orders.json` +
    `?status=any&created_at_min=${encodeURIComponent(sinceIso)}&limit=250&financial_status=paid`;
  while (url) {
    const res = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
    const data = await res.json();
    orders.push(...(data.orders || []));
    // Pagination via Link header
    const link = res.headers.get("link") || "";
    const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;
  }
  return orders;
}

// Extract GCLID from order — Shopify stores landing URL + referral params in
// the `note_attributes` / `landing_site` / `referring_site` fields.
function extractGclid(order) {
  const note = order.note_attributes || [];
  for (const a of note) {
    if (/gclid/i.test(a.name) && a.value) return String(a.value);
  }
  const landing = order.landing_site || "";
  const refer = order.referring_site || "";
  for (const src of [landing, refer]) {
    const m = src.match(/[?&]gclid=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
  }
  // Shop Pay flow: GCLID may have been stored as a cart attribute
  const cartAttrs = order.cart_token ? order.note_attributes : [];
  for (const a of cartAttrs || []) {
    if (a.value && /^[A-Za-z0-9_-]{30,}$/.test(a.value)) {
      // looks like a gclid-shaped token; skip unless labelled
    }
  }
  return null;
}

// ── Google Ads OAuth ────────────────────────────────────────────────────────
let cachedToken = null;
let cachedExp = 0;
async function getAccessToken() {
  if (cachedToken && Date.now() < cachedExp) return cachedToken;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`OAuth: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = data.access_token;
  cachedExp = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

// ── Google Ads: uploadClickConversions in batches of 2000 ──────────────────
async function uploadConversions(rows) {
  const token = await getAccessToken();
  const url =
    `https://googleads.googleapis.com/v18/customers/${CUSTOMER_ID}:uploadClickConversions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      conversions: rows,
      partialFailure: true,
      validateOnly: false,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`uploadClickConversions ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== Google Ads offline-conversion backfill ===`);
  console.log(`Since: ${SINCE}  Dry run: ${DRY_RUN}`);
  console.log(`Customer: ${CUSTOMER_ID}  Conversion action: ${CONVERSION_ACTION || "(not set)"}`);

  const orders = await fetchShopifyOrders(`${SINCE}T00:00:00Z`);
  console.log(`\nPulled ${orders.length} paid Shopify orders since ${SINCE}`);

  const withGclid = [];
  const withoutGclid = [];
  for (const o of orders) {
    const gclid = extractGclid(o);
    (gclid ? withGclid : withoutGclid).push({ order: o, gclid });
  }
  console.log(`  With GCLID attribution: ${withGclid.length}`);
  console.log(`  Without GCLID (lost attribution): ${withoutGclid.length}`);

  if (!withGclid.length) {
    console.log(
      `\nNo GCLID-attributed orders found. This is expected for the pre-tag ` +
        `period — Shopify never captured gclid because the landing JS wasn't ` +
        `wired to persist it into cart attributes. Going forward (post deploy ` +
        `of commit 73bde0c), gclid WILL be captured and future runs will have ` +
        `data to backfill.`,
    );
    return;
  }

  const rows = withGclid.map(({ order, gclid }) => ({
    conversionAction: CONVERSION_ACTION,
    conversionDateTime: new Date(order.created_at)
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d+Z$/, "+00:00"),
    conversionValue: Number(order.total_price || 0),
    currencyCode: order.currency || "USD",
    orderId: String(order.id),
    gclid,
  }));

  if (DRY_RUN) {
    console.log(`\nDRY RUN — would upload ${rows.length} conversions:`);
    for (const r of rows.slice(0, 10)) {
      console.log(`  ${r.conversionDateTime} | $${r.conversionValue} | ${r.orderId} | ${r.gclid.slice(0, 20)}…`);
    }
    if (rows.length > 10) console.log(`  …and ${rows.length - 10} more`);
    return;
  }

  // Batches of 2000 per Google Ads API limit
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000);
    console.log(`\nUploading batch ${i / 2000 + 1} (${chunk.length} rows)...`);
    const result = await uploadConversions(chunk);
    const ok = (result.results || []).filter((r) => r.gclidDateTimePair).length;
    const errs = result.partialFailureError?.details || [];
    console.log(`  Accepted: ${ok}  Errors: ${errs.length}`);
    if (errs.length) console.log(`  First error: ${JSON.stringify(errs[0]).slice(0, 300)}`);
  }

  console.log(`\nDone.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
