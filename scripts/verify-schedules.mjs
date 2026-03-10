#!/usr/bin/env node

/**
 * Verify expected Abra schedules exist in QStash.
 *
 * Usage:
 *   source .env.local && node scripts/verify-schedules.mjs
 */

const QSTASH_TOKEN = process.env.QSTASH_TOKEN || "";
if (!QSTASH_TOKEN) {
  console.error("Missing QSTASH_TOKEN");
  process.exit(1);
}

const EXPECTED = [
  "abra-morning-brief",
  "abra-feed-shopify-orders",
  "abra-feed-amazon-orders",
  "abra-feed-shopify-products",
  "abra-feed-shopify-inventory",
  "abra-feed-amazon-inventory",
  "abra-feed-ga4-traffic",
  "abra-feed-email-fetch",
  "abra-feed-faire-orders",
  "abra-health-check",
  "abra-weekly-digest",
];

function parseJsonSafe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function qstash(path) {
  const res = await fetch(`https://qstash.upstash.io/v2${path}`, {
    headers: {
      Authorization: `Bearer ${QSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  const data = parseJsonSafe(text);
  if (!res.ok) {
    throw new Error(`QStash ${path} failed (${res.status}): ${text}`);
  }
  return data;
}

function getName(item) {
  if (!item || typeof item !== "object") return "";
  const headers = item.headers || item.destinationHeaders || {};
  const fromHeader =
    headers["x-abra-schedule-name"] ||
    headers["X-Abra-Schedule-Name"] ||
    headers["x-abra-schedule"] ||
    headers["X-Abra-Schedule"];
  if (typeof fromHeader === "string" && fromHeader.trim()) return fromHeader.trim();

  if (typeof item.body === "string" && item.body.trim()) {
    try {
      const parsed = JSON.parse(item.body);
      if (typeof parsed?.schedule === "string") return parsed.schedule;
    } catch {
      // ignore body parse errors
    }
  }
  return "";
}

function getCron(item) {
  if (!item || typeof item !== "object") return "";
  return item.cron || item.schedule || "";
}

function getDestination(item) {
  if (!item || typeof item !== "object") return "";
  return item.destination || item.url || "";
}

function getLast(item) {
  if (!item || typeof item !== "object") return "";
  return item.lastTriggerAt || item.last_execution || item.lastExecution || "";
}

function printRows(rows) {
  const header =
    "Name".padEnd(30) +
    "Cron".padEnd(16) +
    "Last Run".padEnd(28) +
    "Destination";
  console.log(header);
  console.log("-".repeat(header.length + 20));
  for (const row of rows) {
    console.log(
      String(row.name || "").padEnd(30) +
        String(row.cron || "").padEnd(16) +
        String(row.last || "").padEnd(28) +
        String(row.destination || ""),
    );
  }
}

async function main() {
  const raw = await qstash("/schedules");
  const schedules = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];

  const rows = schedules
    .map((item) => ({
      name: getName(item),
      cron: getCron(item),
      destination: getDestination(item),
      last: getLast(item),
    }))
    .filter((row) => row.name.startsWith("abra-"))
    .sort((a, b) => a.name.localeCompare(b.name));

  printRows(rows);

  const missing = EXPECTED.filter((name) => !rows.some((row) => row.name === name));
  if (missing.length > 0) {
    console.error(`\nMissing schedules: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log(`\nAll expected schedules are present (${EXPECTED.length}/${EXPECTED.length}).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
