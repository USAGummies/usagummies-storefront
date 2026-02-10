// scripts/sales-snapshot.mjs
// Local operator script: pulls a quick snapshot from GA4 + Shopify Admin.
// IMPORTANT: prints NO secrets. Requires env vars in /Users/ben/.openclaw/.env (or shell).
//
// Env:
// - GA4_PROPERTY_ID
// - GA4_SERVICE_ACCOUNT_JSON_PATH (service account JSON file)
// - SHOPIFY_STORE_DOMAIN (e.g., usa-gummies.myshopify.com)
// - SHOPIFY_ADMIN_API_VERSION (e.g., 2024-07)
// - SHOPIFY_ADMIN_ACCESS_TOKEN

import fs from "node:fs";
import crypto from "node:crypto";

const log = (...a) => process.stdout.write(a.join(" ") + "\n");
const warn = (...a) => process.stderr.write(a.join(" ") + "\n");

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function b64url(input) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return b.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getGoogleAccessToken() {
  const path = must("GA4_SERVICE_ACCOUNT_JSON_PATH");
  const raw = fs.readFileSync(path, "utf8");
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now - 5,
    exp: now + 3600,
  };

  const toSign = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(toSign);
  sign.end();
  const signature = b64url(sign.sign(sa.private_key));
  const jwt = `${toSign}.${signature}`;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Google token error: ${res.status} ${JSON.stringify(json)}`);
  return json.access_token;
}

async function ga4RunReport({ startDate, endDate }) {
  const propertyId = must("GA4_PROPERTY_ID");
  const token = await getGoogleAccessToken();
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;

  const payload = {
    dateRanges: [{ startDate, endDate }],
    metrics: [
      { name: "sessions" },
      { name: "totalUsers" },
      { name: "newUsers" },
      { name: "screenPageViews" },
      { name: "engagementRate" },
    ],
    dimensions: [{ name: "landingPagePlusQueryString" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 10,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`GA4 report error: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function shopifyAdminGraphQL(query, variables) {
  const domain = must("SHOPIFY_STORE_DOMAIN");
  const version = must("SHOPIFY_ADMIN_API_VERSION");
  const token = must("SHOPIFY_ADMIN_ACCESS_TOKEN");
  const endpoint = `https://${domain}/admin/api/${version}/graphql.json`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(`Shopify GraphQL error: ${res.status} ${JSON.stringify(json.errors || json)}`);
  }
  return json.data;
}

async function shopifyOrdersSnapshot({ sinceIso }) {
  // Minimal orders read: count + gross sales + top referrers are not available here.
  const q = `query OrdersSince($q: String!) {
    orders(first: 50, query: $q, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          createdAt
          displayFinancialStatus
          currentTotalPriceSet { shopMoney { amount currencyCode } }
        }
      }
    }
  }`;
  const data = await shopifyAdminGraphQL(q, { q: `created_at:>='${sinceIso}'` });
  const orders = (data?.orders?.edges || []).map((e) => e.node);
  let gross = 0;
  for (const o of orders) {
    const amt = Number(o?.currentTotalPriceSet?.shopMoney?.amount || 0);
    gross += amt;
  }
  return { ordersCount: orders.length, gross, currency: orders[0]?.currentTotalPriceSet?.shopMoney?.currencyCode || "USD" };
}

function fmtPct(x) {
  if (x === null || x === undefined) return "–";
  return `${(Number(x) * 100).toFixed(1)}%`;
}

function ga4Totals(report) {
  const totals = report?.totals?.[0]?.metricValues || [];
  const names = report?.metricHeaders?.map((h) => h.name) || [];
  const map = {};
  for (let i = 0; i < names.length; i++) map[names[i]] = totals[i]?.value;
  return map;
}

async function main() {
  const end = new Date();
  const start = new Date(end.getTime() - 2 * 24 * 60 * 60 * 1000);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);

  log(`SALES_SNAPSHOT (local)  range=${startDate}→${endDate}`);

  // GA4
  try {
    const report = await ga4RunReport({ startDate, endDate });
    const t = ga4Totals(report);
    log("GA4 totals:");
    log(`- sessions: ${t.sessions || "0"}`);
    log(`- totalUsers: ${t.totalUsers || "0"}`);
    log(`- newUsers: ${t.newUsers || "0"}`);
    log(`- pageviews: ${t.screenPageViews || "0"}`);
    log(`- engagementRate: ${fmtPct(t.engagementRate)}`);

    log("Top landing pages (by sessions):");
    for (const row of report.rows || []) {
      const lp = row?.dimensionValues?.[0]?.value || "";
      const sessions = row?.metricValues?.[0]?.value || "0";
      log(`- ${sessions}  ${lp}`);
    }
  } catch (e) {
    warn(`GA4: FAILED (${e?.message || e})`);
  }

  // Shopify
  try {
    const sinceIso = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    const s = await shopifyOrdersSnapshot({ sinceIso });
    log("Shopify (last ~36h, first 50 orders):");
    log(`- orders: ${s.ordersCount}`);
    log(`- gross: ${s.gross.toFixed(2)} ${s.currency}`);
  } catch (e) {
    warn(`Shopify: FAILED (${e?.message || e})`);
  }
}

main().catch((e) => {
  warn(e?.stack || String(e));
  process.exit(1);
});
