#!/usr/bin/env node

const args = process.argv.slice(2);
let baseUrl = "http://localhost:3000";
for (const arg of args) {
  if (arg.startsWith("--url=")) {
    baseUrl = arg.slice("--url=".length);
  }
}
baseUrl = baseUrl.replace(/\/$/, "");

const KNOWN_ERROR_PATTERNS = [
  /not configured/i,
  /not set/i,
  /missing/i,
  /unavailable/i,
  /reconnect/i,
  /notion users unavailable/i,
];

const ROUTES = [
  { path: "/api/ops/dashboard", timeFields: ["generatedAt"] },
  { path: "/api/ops/channels", timeFields: ["generatedAt"] },
  { path: "/api/ops/pnl", timeFields: ["generatedAt"] },
  { path: "/api/ops/balances", timeFields: ["lastUpdated"] },
  { path: "/api/ops/pipeline", timeFields: ["generatedAt"] },
  { path: "/api/ops/alerts", timeFields: ["generatedAt", "lastFetched"] },
  { path: "/api/ops/audit", timeFields: ["generatedAt", "lastFetched"] },
  { path: "/api/ops/inventory", timeFields: ["generatedAt"] },
  { path: "/api/ops/supply-chain", timeFields: ["generatedAt"] },
  { path: "/api/ops/transactions", timeFields: ["generatedAt"] },
  { path: "/api/ops/marketing", timeFields: ["generatedAt"] },
  { path: "/api/ops/deal-emails", timeFields: ["generatedAt"] },
  { path: "/api/ops/forecast", timeFields: ["generatedAt"] },
  { path: "/api/ops/budgets", timeFields: ["generatedAt"] },
  { path: "/api/ops/settings", timeFields: ["generatedAt"] },
  { path: "/api/ops/inbox", timeFields: ["lastUpdated"] },
  { path: "/api/ops/logs", timeFields: ["generatedAt"] },
];

function hasKnownError(payload) {
  const message = String(payload?.error || "");
  return KNOWN_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function hasValidTimestamp(payload, fields) {
  return fields.some((field) => {
    const value = payload?.[field];
    return typeof value === "string" && Number.isFinite(Date.parse(value));
  });
}

let failures = 0;
let warnings = 0;

console.log(`[smoke] Base URL: ${baseUrl}`);

for (const route of ROUTES) {
  const url = `${baseUrl}${route.path}`;
  try {
    const res = await fetch(url, {
      headers: { "cache-control": "no-store" },
    });

    if (res.status !== 200) {
      failures += 1;
      console.log(`❌ ${route.path} -> HTTP ${res.status}`);
      continue;
    }

    let payload;
    try {
      payload = await res.json();
    } catch {
      failures += 1;
      console.log(`❌ ${route.path} -> invalid JSON`);
      continue;
    }

    if (!hasValidTimestamp(payload, route.timeFields)) {
      failures += 1;
      console.log(`❌ ${route.path} -> missing timestamp field (${route.timeFields.join(" or ")})`);
      continue;
    }

    if (payload && typeof payload === "object" && "error" in payload && payload.error) {
      if (hasKnownError(payload)) {
        warnings += 1;
        console.log(`⚠️  ${route.path} -> known config warning: ${String(payload.error).slice(0, 120)}`);
      } else {
        failures += 1;
        console.log(`❌ ${route.path} -> unexpected error field: ${String(payload.error).slice(0, 120)}`);
      }
      continue;
    }

    console.log(`✅ ${route.path}`);
  } catch (err) {
    failures += 1;
    console.log(`❌ ${route.path} -> request failed: ${String(err).slice(0, 140)}`);
  }
}

console.log(`\n[smoke] Completed with ${failures} failure(s), ${warnings} warning(s).`);
if (failures > 0) {
  process.exit(1);
}
