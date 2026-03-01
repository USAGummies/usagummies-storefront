#!/usr/bin/env node
/**
 * Comprehensive SP-API test — all endpoints
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
} catch { /* .env.local may not exist */ }

const clientId = process.env.LWA_CLIENT_ID;
const clientSecret = process.env.LWA_CLIENT_SECRET;
const refreshToken = process.env.LWA_REFRESH_TOKEN;
const marketplaceId = process.env.MARKETPLACE_ID || "ATVPDKIKX0DER";

// Step 1: Get access token
console.log("=== SP-API Comprehensive Test ===\n");
console.log("--- Step 1: LWA Token Exchange ---");
console.log("Refresh token starts with:", refreshToken?.substring(0, 20));
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
const tokenData = await tokenRes.json();
const accessToken = tokenData.access_token;
console.log("Access token:", accessToken ? "✅ OK" : "❌ FAILED");
if (!accessToken) {
  console.error("Token error:", JSON.stringify(tokenData));
  process.exit(1);
}

async function spGet(path) {
  const url = `https://sellingpartnerapi-na.amazon.com${path}`;
  const res = await fetch(url, {
    headers: {
      "x-amz-access-token": accessToken,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function spPost(path, body) {
  const url = `https://sellingpartnerapi-na.amazon.com${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-amz-access-token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

function logResult(label, result) {
  const icon = result.status === 200 || result.status === 202 ? "✅" : "❌";
  console.log(`${icon} ${label}: ${result.status}`);
  if (result.status !== 200 && result.status !== 202) {
    console.log("   Error:", result.text.slice(0, 200));
  } else {
    console.log("   Response:", result.text.slice(0, 200));
  }
}

// ===== PREVIOUSLY WORKING =====
console.log("\n--- Previously Working APIs ---");

const sellersResult = await spGet("/sellers/v1/marketplaceParticipations");
logResult("Sellers API", sellersResult);

const ordersResult = await spGet(`/orders/v0/orders?MarketplaceIds=${marketplaceId}&CreatedAfter=2026-02-01T00:00:00Z&MaxResultsPerPage=3`);
logResult("Orders API", ordersResult);

const feesResult = await spPost(`/products/fees/v0/items/B0G1JK92TJ/feesEstimate`, {
  FeesEstimateRequest: {
    MarketplaceId: marketplaceId,
    IsAmazonFulfilled: true,
    PriceToEstimateFees: {
      ListingPrice: { CurrencyCode: "USD", Amount: 24.99 },
    },
    Identifier: `fee-test-${Date.now()}`,
  },
});
logResult("Product Fees API", feesResult);

// ===== PREVIOUSLY FAILING (403) =====
console.log("\n--- Previously Failing APIs (403) ---");

const fbaResult = await spGet(`/fba/inventory/v1/summaries?details=true&granularityType=Marketplace&granularityId=${marketplaceId}&marketplaceIds=${marketplaceId}`);
logResult("FBA Inventory API", fbaResult);

const catalogResult = await spGet(`/catalog/2022-04-01/items?marketplaceIds=${marketplaceId}&identifiers=B0G1JK92TJ&identifiersType=ASIN`);
logResult("Catalog Items API", catalogResult);

const reportCreateResult = await spPost("/reports/2021-06-30/reports", {
  reportType: "GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA",
  marketplaceIds: [marketplaceId],
});
logResult("Reports API (create)", reportCreateResult);

const reportListResult = await spGet(`/reports/2021-06-30/reports?reportTypes=GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA&pageSize=5`);
logResult("Reports API (list)", reportListResult);

const finResult = await spGet("/finances/v0/financialEventGroups?MaxResultsPerPage=5");
logResult("Finances API", finResult);

console.log("\n=== Done ===");
