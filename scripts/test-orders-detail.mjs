#!/usr/bin/env node
/**
 * Test Orders API + Listings API for inventory data
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
const sellerId = process.env.AMAZON_SELLER_ID || "A16G27VYDSSEGO";

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
console.log("Token:", accessToken ? "OK" : "FAILED");

async function spGet(path) {
  const url = `https://sellingpartnerapi-na.amazon.com${path}`;
  const res = await fetch(url, {
    headers: {
      "x-amz-access-token": accessToken,
      "Content-Type": "application/json",
    },
  });
  return { status: res.status, data: await res.json().catch(() => null), text: "" };
}

// 1. Orders since Jan 1
console.log("\n=== Orders API (since Jan 1 2026) ===");
const ordersRes = await spGet(`/orders/v0/orders?MarketplaceIds=${marketplaceId}&CreatedAfter=2026-01-01T00:00:00Z&MaxResultsPerPage=10`);
if (ordersRes.status === 200) {
  const orders = ordersRes.data?.payload?.Orders || [];
  console.log(`Found ${orders.length} orders\n`);

  for (const o of orders.slice(0, 5)) {
    console.log(`Order: ${o.AmazonOrderId}`);
    console.log(`  Status: ${o.OrderStatus} | Channel: ${o.FulfillmentChannel} | Date: ${o.PurchaseDate}`);
    console.log(`  Total: ${o.OrderTotal?.Amount || "?"} ${o.OrderTotal?.CurrencyCode || ""}`);
    console.log(`  Items shipped: ${o.NumberOfItemsShipped}, unshipped: ${o.NumberOfItemsUnshipped}`);
    console.log();
  }

  const total = orders.length;
  const fba = orders.filter(o => o.FulfillmentChannel === "AFN").length;
  const fbm = orders.filter(o => o.FulfillmentChannel === "MFN").length;
  const revenue = orders.reduce((sum, o) => sum + parseFloat(o.OrderTotal?.Amount || "0"), 0);
  console.log(`Summary: ${total} orders, ${fba} FBA, ${fbm} FBM, $${revenue.toFixed(2)} revenue`);
} else {
  console.log(`Error: ${ordersRes.status}`, JSON.stringify(ordersRes.data).slice(0, 200));
}

// 2. Listings Items API — get inventory for our ASIN
console.log("\n=== Listings Items API ===");
const asin = process.env.AMAZON_PRIMARY_ASIN || "B0G1JK92TJ";
const listingsRes = await spGet(`/listings/2021-08-01/items/${sellerId}?marketplaceIds=${marketplaceId}&includedData=summaries,fulfillmentAvailability`);
console.log(`Listings status: ${listingsRes.status}`);
if (listingsRes.status === 200) {
  console.log("Response:", JSON.stringify(listingsRes.data).slice(0, 500));
} else {
  console.log("Error:", JSON.stringify(listingsRes.data).slice(0, 300));
}

// 3. Try specific listing by SKU
console.log("\n=== Listing by SKU ===");
const skuRes = await spGet(`/listings/2021-08-01/items/${sellerId}/USA-GUMMY-7.5OZ?marketplaceIds=${marketplaceId}&includedData=summaries,fulfillmentAvailability`);
console.log(`SKU listing status: ${skuRes.status}`);
if (skuRes.status === 200) {
  console.log("Response:", JSON.stringify(skuRes.data).slice(0, 500));
} else {
  console.log("Error:", JSON.stringify(skuRes.data).slice(0, 300));
}

// 4. Try Product Pricing API
console.log("\n=== Product Pricing API ===");
const pricingRes = await spGet(`/products/pricing/v0/price?MarketplaceId=${marketplaceId}&Asins=${asin}&ItemType=Asin`);
console.log(`Pricing status: ${pricingRes.status}`);
if (pricingRes.status === 200) {
  console.log("Response:", JSON.stringify(pricingRes.data).slice(0, 500));
} else {
  console.log("Error:", JSON.stringify(pricingRes.data).slice(0, 300));
}
