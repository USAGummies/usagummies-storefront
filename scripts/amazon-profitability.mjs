#!/usr/bin/env node
/**
 * Amazon Profitability Deep Dive — Last 30 days
 * Pulls: Orders, Order Items (unit prices, qty, promos), Fees estimate
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

// Get access token
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
if (!accessToken) { console.error("Token failed"); process.exit(1); }

async function spGet(path) {
  const url = `https://sellingpartnerapi-na.amazon.com${path}`;
  const res = await fetch(url, {
    headers: { "x-amz-access-token": accessToken, "Content-Type": "application/json" },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: res.status, data };
}

async function spPost(path, body) {
  const url = `https://sellingpartnerapi-na.amazon.com${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-amz-access-token": accessToken, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: res.status, data };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════
// 1. GET ALL ORDERS — last 30 days with pagination
// ═══════════════════════════════════════════════════════════
console.log("═══════════════════════════════════════════════════");
console.log("  AMAZON PROFITABILITY ANALYSIS — Last 30 Days");
console.log("═══════════════════════════════════════════════════\n");

const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
let allOrders = [];
let nextToken = null;
let page = 0;

console.log("Fetching orders...");
do {
  let path = `/orders/v0/orders?MarketplaceIds=${marketplaceId}&CreatedAfter=${thirtyDaysAgo}&MaxResultsPerPage=100`;
  if (nextToken) path += `&NextToken=${encodeURIComponent(nextToken)}`;
  const res = await spGet(path);
  if (res.status === 200) {
    const orders = res.data?.payload?.Orders || [];
    allOrders = allOrders.concat(orders);
    nextToken = res.data?.payload?.NextToken;
    page++;
    process.stdout.write(`  Page ${page}: ${orders.length} orders (total: ${allOrders.length})\n`);
  } else {
    console.log(`  Error on page ${page + 1}: ${res.status}`);
    break;
  }
  if (nextToken) await sleep(5500); // rate limit
} while (nextToken && page < 20);

console.log(`\nTotal orders found: ${allOrders.length}\n`);

// ═══════════════════════════════════════════════════════════
// 2. GET ORDER ITEMS for each order (unit prices, qty, promos)
// ═══════════════════════════════════════════════════════════
console.log("Fetching order items for each order...");
const orderDetails = [];

for (let i = 0; i < allOrders.length; i++) {
  const order = allOrders[i];
  const orderId = order.AmazonOrderId;

  await sleep(2000); // rate limit for order items
  const itemsRes = await spGet(`/orders/v0/orders/${orderId}/orderItems`);

  let items = [];
  if (itemsRes.status === 200) {
    items = itemsRes.data?.payload?.OrderItems || [];
  } else {
    console.log(`  ⚠ Order ${orderId}: items fetch failed (${itemsRes.status})`);
  }

  orderDetails.push({
    orderId,
    status: order.OrderStatus,
    channel: order.FulfillmentChannel,
    purchaseDate: order.PurchaseDate,
    orderTotal: parseFloat(order.OrderTotal?.Amount || "0"),
    currency: order.OrderTotal?.CurrencyCode || "USD",
    itemsShipped: order.NumberOfItemsShipped || 0,
    itemsUnshipped: order.NumberOfItemsUnshipped || 0,
    items: items.map(item => ({
      asin: item.ASIN,
      sku: item.SellerSKU,
      title: item.Title,
      quantity: item.QuantityOrdered || 0,
      unitPrice: parseFloat(item.ItemPrice?.Amount || "0") / (item.QuantityOrdered || 1),
      itemPrice: parseFloat(item.ItemPrice?.Amount || "0"),
      itemTax: parseFloat(item.ItemTax?.Amount || "0"),
      shippingPrice: parseFloat(item.ShippingPrice?.Amount || "0"),
      shippingTax: parseFloat(item.ShippingTax?.Amount || "0"),
      promotionDiscount: parseFloat(item.PromotionDiscount?.Amount || "0"),
      promotionIds: item.PromotionIds || [],
    })),
  });

  process.stdout.write(`  [${i + 1}/${allOrders.length}] ${orderId} — ${items.length} items\n`);
}

// ═══════════════════════════════════════════════════════════
// 3. GET FEE ESTIMATE from Fees API
// ═══════════════════════════════════════════════════════════
console.log("\nFetching fee estimates...");

// Find the most common selling price
const allItemPrices = orderDetails.flatMap(o => o.items.map(i => i.unitPrice)).filter(p => p > 0);
const avgSellingPrice = allItemPrices.length > 0
  ? allItemPrices.reduce((a, b) => a + b, 0) / allItemPrices.length
  : 24.99;

// Get fees at common price points
const asin = "B0G1JK92TJ";
const pricePoints = [
  ...new Set([
    Math.round(avgSellingPrice * 100) / 100,
    24.99,
  ])
];

const feesByPrice = {};
for (const price of pricePoints) {
  const feesRes = await spPost(`/products/fees/v0/items/${asin}/feesEstimate`, {
    FeesEstimateRequest: {
      MarketplaceId: marketplaceId,
      IsAmazonFulfilled: true,
      PriceToEstimateFees: {
        ListingPrice: { CurrencyCode: "USD", Amount: price },
      },
      Identifier: `profit-analysis-${Date.now()}`,
    },
  });

  if (feesRes.status === 200) {
    const result = feesRes.data?.payload?.FeesEstimateResult;
    const feeList = result?.FeesEstimate?.FeeDetailList || [];
    let referralFee = 0, fbaFee = 0, closingFee = 0;
    for (const fee of feeList) {
      const amt = fee.FinalFee?.Amount || 0;
      if (fee.FeeType === "ReferralFee") referralFee = amt;
      else if (fee.FeeType === "FBAFees") fbaFee = amt;
      else if (fee.FeeType === "VariableClosingFee") closingFee = amt;
    }
    const totalFee = result?.FeesEstimate?.TotalFeesEstimate?.Amount || (referralFee + fbaFee + closingFee);
    feesByPrice[price] = { referralFee, fbaFee, closingFee, totalFee };
    console.log(`  Fees at $${price}: referral=$${referralFee.toFixed(2)}, FBA=$${fbaFee.toFixed(2)}, total=$${totalFee.toFixed(2)}`);
  }
  await sleep(1000);
}

// Use the fee estimate closest to actual selling price
const feeEstimate = feesByPrice[Math.round(avgSellingPrice * 100) / 100] || feesByPrice[24.99] || { referralFee: avgSellingPrice * 0.15, fbaFee: 5.00, closingFee: 0, totalFee: avgSellingPrice * 0.15 + 5.00 };

// ═══════════════════════════════════════════════════════════
// 4. FULL P&L ANALYSIS
// ═══════════════════════════════════════════════════════════

// Filter to completed/shipped orders only
const completedOrders = orderDetails.filter(o =>
  o.status === "Shipped" || o.status === "Unshipped" || o.status === "PartiallyShipped"
);
const cancelledOrders = orderDetails.filter(o => o.status === "Canceled");

// Aggregate
let totalUnits = 0;
let totalGrossRevenue = 0;
let totalPromotions = 0;
let totalTax = 0;
let totalShipping = 0;

for (const order of completedOrders) {
  for (const item of order.items) {
    totalUnits += item.quantity;
    totalGrossRevenue += item.itemPrice;
    totalPromotions += item.promotionDiscount;
    totalTax += item.itemTax;
    totalShipping += item.shippingPrice;
  }
}

const totalNetRevenue = totalGrossRevenue - totalPromotions;
const totalReferralFees = totalUnits * feeEstimate.referralFee;
const totalFBAFees = totalUnits * feeEstimate.fbaFee;
const totalAmazonFees = totalUnits * feeEstimate.totalFee;

// COGS — you need to fill this in with actual numbers
const cogsPerUnit = 3.50; // Estimated COGS per bag (manufacturing + ingredients)
const shippingToFBAPerUnit = 0.75; // Estimated inbound shipping to FBA per unit
const totalCOGS = totalUnits * cogsPerUnit;
const totalInboundShipping = totalUnits * shippingToFBAPerUnit;

const grossProfit = totalNetRevenue - totalAmazonFees;
const netProfit = grossProfit - totalCOGS - totalInboundShipping;
const netMargin = totalNetRevenue > 0 ? (netProfit / totalNetRevenue * 100) : 0;
const grossMargin = totalNetRevenue > 0 ? (grossProfit / totalNetRevenue * 100) : 0;

console.log("\n═══════════════════════════════════════════════════");
console.log("  AMAZON P&L — LAST 30 DAYS");
console.log("═══════════════════════════════════════════════════\n");

console.log("ORDERS SUMMARY");
console.log("─────────────────────────────────────────");
console.log(`  Total orders:          ${completedOrders.length}`);
console.log(`  Cancelled orders:      ${cancelledOrders.length}`);
console.log(`  Total units sold:      ${totalUnits}`);
console.log(`  Avg selling price:     $${avgSellingPrice.toFixed(2)}/unit`);
console.log(`  Fulfillment:           ${completedOrders.filter(o => o.channel === "AFN").length} FBA / ${completedOrders.filter(o => o.channel === "MFN").length} FBM`);

console.log("\nREVENUE");
console.log("─────────────────────────────────────────");
console.log(`  Gross revenue:         $${totalGrossRevenue.toFixed(2)}`);
console.log(`  Promotions/discounts:  -$${totalPromotions.toFixed(2)}`);
console.log(`  Net revenue:           $${totalNetRevenue.toFixed(2)}`);
console.log(`  Sales tax collected:   $${totalTax.toFixed(2)} (remitted by Amazon)`);

console.log("\nAMAZON FEES (per unit)");
console.log("─────────────────────────────────────────");
console.log(`  Referral fee:          $${feeEstimate.referralFee.toFixed(2)}/unit (${(feeEstimate.referralFee / avgSellingPrice * 100).toFixed(1)}%)`);
console.log(`  FBA fulfillment fee:   $${feeEstimate.fbaFee.toFixed(2)}/unit`);
console.log(`  Closing fee:           $${feeEstimate.closingFee.toFixed(2)}/unit`);
console.log(`  TOTAL AMAZON FEES:     $${feeEstimate.totalFee.toFixed(2)}/unit`);

console.log("\nAMAZON FEES (total)");
console.log("─────────────────────────────────────────");
console.log(`  Total referral fees:   $${totalReferralFees.toFixed(2)}`);
console.log(`  Total FBA fees:        $${totalFBAFees.toFixed(2)}`);
console.log(`  TOTAL AMAZON FEES:     $${totalAmazonFees.toFixed(2)}`);

console.log("\nCOST OF GOODS (estimated)");
console.log("─────────────────────────────────────────");
console.log(`  COGS per unit:         $${cogsPerUnit.toFixed(2)}`);
console.log(`  Inbound shipping:      $${shippingToFBAPerUnit.toFixed(2)}/unit`);
console.log(`  Total COGS:            $${totalCOGS.toFixed(2)}`);
console.log(`  Total inbound ship:    $${totalInboundShipping.toFixed(2)}`);

console.log("\n═══════════════════════════════════════════════════");
console.log("  PROFITABILITY SUMMARY");
console.log("═══════════════════════════════════════════════════");
console.log(`  Net Revenue:           $${totalNetRevenue.toFixed(2)}`);
console.log(`  - Amazon Fees:         $${totalAmazonFees.toFixed(2)}`);
console.log(`  = Gross Profit:        $${grossProfit.toFixed(2)}  (${grossMargin.toFixed(1)}% margin)`);
console.log(`  - COGS:                $${totalCOGS.toFixed(2)}`);
console.log(`  - Inbound Shipping:    $${totalInboundShipping.toFixed(2)}`);
console.log(`  ─────────────────────────────────────`);
console.log(`  = NET PROFIT:          $${netProfit.toFixed(2)}  (${netMargin.toFixed(1)}% net margin)`);
console.log(`  = Per Unit Profit:     $${totalUnits > 0 ? (netProfit / totalUnits).toFixed(2) : "0.00"}/unit`);

console.log("\n═══════════════════════════════════════════════════");
console.log("  UNIT ECONOMICS WATERFALL");
console.log("═══════════════════════════════════════════════════");
const perUnit = {
  selling: avgSellingPrice,
  promoDisc: totalUnits > 0 ? totalPromotions / totalUnits : 0,
  netSelling: totalUnits > 0 ? totalNetRevenue / totalUnits : avgSellingPrice,
  referral: feeEstimate.referralFee,
  fba: feeEstimate.fbaFee,
  closing: feeEstimate.closingFee,
  cogs: cogsPerUnit,
  inbound: shippingToFBAPerUnit,
};
perUnit.netProfit = perUnit.netSelling - perUnit.referral - perUnit.fba - perUnit.closing - perUnit.cogs - perUnit.inbound;

console.log(`  Avg selling price:     $${perUnit.selling.toFixed(2)}`);
console.log(`  - Promo/discount:      -$${perUnit.promoDisc.toFixed(2)}`);
console.log(`  = Net selling price:   $${perUnit.netSelling.toFixed(2)}`);
console.log(`  - Referral fee:        -$${perUnit.referral.toFixed(2)}`);
console.log(`  - FBA fee:             -$${perUnit.fba.toFixed(2)}`);
console.log(`  - Closing fee:         -$${perUnit.closing.toFixed(2)}`);
console.log(`  - COGS:                -$${perUnit.cogs.toFixed(2)}`);
console.log(`  - Inbound shipping:    -$${perUnit.inbound.toFixed(2)}`);
console.log(`  ─────────────────────────────────────`);
console.log(`  = NET PROFIT/UNIT:     $${perUnit.netProfit.toFixed(2)}`);

// ═══════════════════════════════════════════════════════════
// 5. ORDER-BY-ORDER DETAIL
// ═══════════════════════════════════════════════════════════
console.log("\n═══════════════════════════════════════════════════");
console.log("  ORDER-BY-ORDER DETAIL");
console.log("═══════════════════════════════════════════════════\n");

for (const order of completedOrders) {
  const date = new Date(order.purchaseDate).toLocaleDateString("en-US");
  const units = order.items.reduce((s, i) => s + i.quantity, 0);
  const revenue = order.items.reduce((s, i) => s + i.itemPrice, 0);
  const promos = order.items.reduce((s, i) => s + i.promotionDiscount, 0);
  const netRev = revenue - promos;
  const fees = units * feeEstimate.totalFee;
  const cogs = units * cogsPerUnit;
  const inbound = units * shippingToFBAPerUnit;
  const profit = netRev - fees - cogs - inbound;
  const margin = netRev > 0 ? (profit / netRev * 100) : 0;

  console.log(`${order.orderId} | ${date} | ${units} units | $${revenue.toFixed(2)} rev | -$${promos.toFixed(2)} promo | -$${fees.toFixed(2)} fees | -$${cogs.toFixed(2)} COGS | = $${profit.toFixed(2)} profit (${margin.toFixed(0)}%)`);
}

console.log("\n⚠️  NOTE: COGS ($3.50/unit) and inbound shipping ($0.75/unit) are ESTIMATES.");
console.log("    Update these values in the script with your actual costs for accurate P&L.");
console.log("    Amazon fees are from the live Fees API at your actual selling price.\n");
