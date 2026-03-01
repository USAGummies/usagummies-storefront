#!/usr/bin/env node
/**
 * Fix Listings API call + get all orders with pagination
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env.local");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

const clientId = process.env.LWA_CLIENT_ID;
const clientSecret = process.env.LWA_CLIENT_SECRET;
const refreshToken = process.env.LWA_REFRESH_TOKEN;
const marketplaceId = process.env.MARKETPLACE_ID || "ATVPDKIKX0DER";

const tokenRes = await fetch("https://api.amazon.com/auth/o2/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  }),
});
const { access_token: accessToken } = await tokenRes.json();

async function spGet(path) {
  const url = `https://sellingpartnerapi-na.amazon.com${path}`;
  const res = await fetch(url, {
    headers: { "x-amz-access-token": accessToken, "Content-Type": "application/json" },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: res.status, data, text: text.slice(0, 500) };
}

// Get seller ID from Sellers API
console.log("=== Get Seller ID ===");
const sellersRes = await spGet("/sellers/v1/marketplaceParticipations");
let sellerId = "";
if (sellersRes.status === 200 && sellersRes.data?.payload) {
  for (const p of sellersRes.data.payload) {
    if (p.marketplace?.id === marketplaceId) {
      sellerId = p.marketplace?.id;
    }
    // The seller ID is in the participation
    if (p.participation?.sellerId) {
      sellerId = p.participation.sellerId;
    }
  }
}
console.log("Seller ID from API:", sellerId);
console.log("Full sellers data:", JSON.stringify(sellersRes.data?.payload?.[0]).slice(0, 300));

// Try Listings with correct seller ID format
// Listings API: GET /listings/2021-08-01/items/{sellerId}/{sku}
console.log("\n=== Listings API with correct format ===");
const sku = "USA-GUMMY-7.5OZ"; // our SKU
const realSellerId = sellerId || "A16G27VYDSSEGO";

// Try with the SKU
const listRes1 = await spGet(`/listings/2021-08-01/items/${realSellerId}/${encodeURIComponent(sku)}?marketplaceIds=${marketplaceId}&includedData=summaries,fulfillmentAvailability`);
console.log(`Listing by SKU (${sku}): ${listRes1.status}`);
console.log("Response:", listRes1.text);

// Try order items for the first order
console.log("\n=== Order Items API ===");
const orderItemsRes = await spGet("/orders/v0/orders/113-2127949-8717843/orderItems");
console.log(`Order items status: ${orderItemsRes.status}`);
console.log("Response:", listRes1.status === 200 ? JSON.stringify(orderItemsRes.data).slice(0, 500) : orderItemsRes.text);

// Get all orders with pagination for full count
console.log("\n=== All Orders (paginated) ===");
let allOrders = [];
let nextToken = null;
let page = 0;
do {
  let path = `/orders/v0/orders?MarketplaceIds=${marketplaceId}&CreatedAfter=2026-01-01T00:00:00Z&MaxResultsPerPage=100`;
  if (nextToken) path += `&NextToken=${encodeURIComponent(nextToken)}`;
  const res = await spGet(path);
  if (res.status === 200) {
    const orders = res.data?.payload?.Orders || [];
    allOrders = allOrders.concat(orders);
    nextToken = res.data?.payload?.NextToken;
    page++;
    console.log(`Page ${page}: ${orders.length} orders (total: ${allOrders.length})`);
  } else {
    console.log(`Page ${page + 1} error: ${res.status}`);
    break;
  }
} while (nextToken && page < 10);

// Full summary
const fba = allOrders.filter(o => o.FulfillmentChannel === "AFN").length;
const fbm = allOrders.filter(o => o.FulfillmentChannel === "MFN").length;
const revenue = allOrders.reduce((sum, o) => sum + parseFloat(o.OrderTotal?.Amount || "0"), 0);
const units = allOrders.reduce((sum, o) => sum + (o.NumberOfItemsShipped || 0) + (o.NumberOfItemsUnshipped || 0), 0);

console.log(`\nFull summary since Jan 1, 2026:`);
console.log(`  Total orders: ${allOrders.length}`);
console.log(`  FBA: ${fba}, FBM: ${fbm}`);
console.log(`  Total revenue: $${revenue.toFixed(2)}`);
console.log(`  Total units: ${units}`);

// Monthly breakdown
const byMonth = {};
for (const o of allOrders) {
  const month = o.PurchaseDate?.substring(0, 7);
  if (!byMonth[month]) byMonth[month] = { orders: 0, revenue: 0, units: 0 };
  byMonth[month].orders++;
  byMonth[month].revenue += parseFloat(o.OrderTotal?.Amount || "0");
  byMonth[month].units += (o.NumberOfItemsShipped || 0) + (o.NumberOfItemsUnshipped || 0);
}
console.log("\nMonthly breakdown:");
for (const [month, data] of Object.entries(byMonth).sort()) {
  console.log(`  ${month}: ${data.orders} orders, ${data.units} units, $${data.revenue.toFixed(2)}`);
}
