#!/usr/bin/env node

import fs from "node:fs";

function readEnv(name) {
  const line = fs.readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).replace(/^"|"$/g, "") : "";
}

const BASE_URL = process.argv[2] || "https://www.usagummies.com";
const CRON_SECRET = readEnv("CRON_SECRET");

if (!CRON_SECRET) {
  console.error("CRON_SECRET missing from .env.local");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${CRON_SECRET}`,
};

async function getJson(path) {
  const start = Date.now();
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  const ms = Date.now() - start;
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, ms, json };
}

function accountExists(accounts, matcher) {
  return accounts.some((account) => matcher(account));
}

async function run() {
  const checks = [];

  const vendors = await getJson("/api/ops/qbo/query?type=vendors");
  checks.push({
    name: "vendors",
    ok:
      vendors.ok &&
      Number(vendors.json.count || 0) >= 19 &&
      ["powers", "albanese", "belmark", "pirate ship", "anthropic", "shopify"].every((name) =>
        (vendors.json.vendors || []).some((vendor) => String(vendor.Name || "").toLowerCase().includes(name)),
      ),
    detail: `count=${vendors.json.count || 0}`,
  });

  const accounts = await getJson("/api/ops/qbo/query?type=accounts");
  const requiredAccounts = [
    (account) => String(account.Name || "").toLowerCase() === "amazon" && String(account.AcctNum || "").trim() === "400010",
    (account) => String(account.Name || "").toLowerCase().includes("shopify") && String(account.AcctNum || "").trim() === "400020",
    (account) => String(account.Name || "").toLowerCase().includes("wholesale") && String(account.AcctNum || "").trim() === "400025",
    (account) => String(account.Name || "").toLowerCase() === "faire" && String(account.AcctNum || "").trim() === "400030",
    (account) => String(account.Name || "").toLowerCase().includes("albanese") && String(account.AcctNum || "").trim() === "500010",
    (account) => String(account.Name || "").toLowerCase().includes("belmark") && String(account.AcctNum || "").trim() === "500015",
    (account) => String(account.Name || "").toLowerCase().includes("powers") && String(account.AcctNum || "").trim() === "500020",
    (account) => String(account.Name || "").toLowerCase().includes("freight") && String(account.AcctNum || "").trim() === "500025",
    (account) =>
      String(account.Name || "").toLowerCase().includes("investor loan") &&
      /liability/i.test(String(account.AccountType || "")),
  ];
  checks.push({
    name: "accounts",
    ok:
      accounts.ok &&
      requiredAccounts.every((matcher) => accountExists(accounts.json.accounts || [], matcher)),
    detail: `required=${requiredAccounts.length}`,
  });

  const pnl = await getJson("/api/ops/qbo/query?type=pnl");
  const pnlSummary = pnl.json.summary || {};
  const revenue = Number(pnlSummary["Total Income"] || pnlSummary["Income > Revenue"] || pnlSummary.Revenue || 0);
  checks.push({
    name: "pnl",
    ok: pnl.ok && revenue > 0,
    detail: `revenue=${revenue.toFixed(2)}`,
  });

  const balanceSheet = await getJson("/api/ops/qbo/query?type=balance_sheet");
  const bsSummary = balanceSheet.json.summary || {};
  const totalAssets = Number(bsSummary["TOTAL ASSETS"] || bsSummary["Total Assets"] || bsSummary.Assets || 0);
  checks.push({
    name: "balance_sheet",
    ok: balanceSheet.ok && totalAssets > 0,
    detail: `assets=${totalAssets.toFixed(2)}`,
  });

  const purchases = await getJson("/api/ops/qbo/query?type=purchases&limit=10");
  checks.push({
    name: "purchases",
    ok: purchases.ok && Number(purchases.json.count || 0) > 0,
    detail: `count=${purchases.json.count || 0}`,
  });

  const customers = await getJson("/api/ops/qbo/query?type=customers");
  checks.push({
    name: "customers",
    ok: customers.ok && (customers.json.customers || []).some((customer) =>
      String(customer.Name || "").toLowerCase().includes("inderbitzin"),
    ),
    detail: `count=${customers.json.count || 0}`,
  });

  const bills = await getJson("/api/ops/qbo/query?type=bills");
  checks.push({
    name: "bills",
    ok: bills.ok && Array.isArray(bills.json.bills || []),
    detail: `count=${bills.json.count || 0}`,
  });

  const cashFlow = await getJson("/api/ops/qbo/query?type=cash_flow");
  checks.push({
    name: "cash_flow",
    ok: cashFlow.ok && typeof cashFlow.json.summary === "object",
    detail: `period=${cashFlow.json.period?.start || "n/a"}..${cashFlow.json.period?.end || "n/a"}`,
  });

  const metrics = await getJson("/api/ops/qbo/query?type=metrics");
  checks.push({
    name: "metrics",
    ok:
      metrics.ok &&
      typeof metrics.json.cashPosition === "number" &&
      Number(metrics.json.cashPosition || 0) > 0 &&
      typeof metrics.json.burnRate === "number" &&
      typeof metrics.json.totalRevenue === "number",
    detail: `cash=${metrics.json.cashPosition || 0}`,
  });

  let passed = 0;
  for (const check of checks) {
    const ok = Boolean(check.ok);
    if (ok) passed += 1;
    console.log(`${ok ? "PASS" : "FAIL"} ${check.name} (${check.detail})`);
  }

  console.log(`QBO verification score: ${passed}/${checks.length}`);
  if (passed !== checks.length) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
