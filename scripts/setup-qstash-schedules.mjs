#!/usr/bin/env node

/**
 * Register full Abra schedule set in QStash.
 *
 * Usage:
 *   source .env.local && node scripts/setup-qstash-schedules.mjs
 */

const QSTASH_TOKEN = process.env.QSTASH_TOKEN || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, "")}`
  : process.env.NEXTAUTH_URL || "https://www.usagummies.com";

if (!QSTASH_TOKEN) {
  console.error("Missing QSTASH_TOKEN");
  process.exit(1);
}

if (!CRON_SECRET) {
  console.error("Missing CRON_SECRET");
  process.exit(1);
}

// QStash free tier: max 10 schedules. The master-scheduler dispatches all
// engine agents via getDueAgents(), so individual feed schedules are NOT
// needed — the master handles them. We keep only schedules for things
// that need guaranteed timing independent of the engine scheduler.
const SCHEDULES = [
  // Heartbeat: master scheduler every 5 min — dispatches ALL due agents
  { name: "master-scheduler", url: `${BASE_URL}/api/ops/scheduler/master`, cron: "*/5 * * * *", method: "GET" },
  // Inbox scan every 5 min — core Abra loop (email triage, drafts, signals)
  { name: "abra-inbox-scan", url: `${BASE_URL}/api/ops/abra/inbox-scan`, cron: "*/5 * * * *", method: "POST" },
  // Morning brief at 7:15am PT (14:15 UTC)
  { name: "abra-morning-brief", url: `${BASE_URL}/api/ops/abra/morning-brief`, cron: "15 14 * * *", method: "POST" },
  // Data feeds — staggered daily ingestion
  { name: "abra-feed-shopify", url: `${BASE_URL}/api/ops/abra/auto-teach?feed=shopify_orders`, cron: "0 13 * * *", method: "POST" },
  { name: "abra-feed-amazon", url: `${BASE_URL}/api/ops/abra/auto-teach?feed=amazon_orders`, cron: "10 13 * * *", method: "POST" },
  { name: "abra-feed-inventory", url: `${BASE_URL}/api/ops/abra/auto-teach?feed=shopify_inventory`, cron: "30 13 * * *", method: "POST" },
  { name: "abra-feed-ga4", url: `${BASE_URL}/api/ops/abra/auto-teach?feed=ga4_traffic`, cron: "0 5 * * *", method: "POST" },
  { name: "abra-feed-email", url: `${BASE_URL}/api/ops/abra/auto-teach?feed=email_fetch`, cron: "0 */4 * * *", method: "POST" },
  // Weekly digest Sunday 6pm PT (Monday 01:00 UTC)
  { name: "abra-weekly-digest", url: `${BASE_URL}/api/ops/abra/weekly-digest`, cron: "0 1 * * 1", method: "POST" },
  // Outcome tracking daily at 8pm PT (03:00 UTC next day)
  { name: "abra-outcome-check", url: `${BASE_URL}/api/ops/abra/outcome-check`, cron: "0 3 * * *", method: "POST" },
];

function parseJsonSafe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function qstash(path, init = {}) {
  const res = await fetch(`https://qstash.upstash.io/v2${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${QSTASH_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  const data = parseJsonSafe(text);
  if (!res.ok) {
    throw new Error(`QStash ${init.method || "GET"} ${path} failed (${res.status}): ${text}`);
  }
  return data;
}

function scheduleNameFromItem(item) {
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
      // no-op
    }
  }
  return "";
}

function scheduleIdFromItem(item) {
  if (!item || typeof item !== "object") return "";
  return item.scheduleId || item.id || item.schedule_id || "";
}

function destinationFromItem(item) {
  if (!item || typeof item !== "object") return "";
  return item.destination || item.url || item.callback || "";
}

function cronFromItem(item) {
  if (!item || typeof item !== "object") return "";
  return item.cron || item.schedule || "";
}

async function listSchedules() {
  const payload = await qstash("/schedules");
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

async function deleteSchedule(id) {
  if (!id) return;
  await qstash(`/schedules/${id}`, { method: "DELETE" });
}

async function createSchedule(schedule) {
  // QStash v2: raw destination URL in path (NOT encoded)
  return qstash(`/schedules/${schedule.url}`, {
    method: "POST",
    headers: {
      "Upstash-Cron": schedule.cron,
      "Upstash-Method": schedule.method || "GET",
      "Upstash-Forward-Authorization": `Bearer ${CRON_SECRET}`,
      "Upstash-Forward-Content-Type": "application/json",
      "x-abra-schedule-name": schedule.name,
    },
    body: JSON.stringify({
      schedule: schedule.name,
      source: "setup-qstash-schedules",
    }),
  });
}

function printSummaryTable(rows) {
  const header =
    "Name".padEnd(30) +
    "Cron".padEnd(16) +
    "Method".padEnd(8) +
    "Destination";
  console.log("\n" + header);
  console.log("-".repeat(header.length + 20));
  for (const row of rows) {
    console.log(
      String(row.name || "").padEnd(30) +
        String(row.cron || "").padEnd(16) +
        String(row.method || "GET").padEnd(8) +
        String(row.destination || ""),
    );
  }
}

async function main() {
  const expectedNames = new Set(SCHEDULES.map((s) => s.name));
  const existing = await listSchedules();

  const stale = existing.filter((item) => {
    const name = scheduleNameFromItem(item);
    const destination = destinationFromItem(item);
    if (name && (name.startsWith("abra-") || name === "master-scheduler")) return !expectedNames.has(name);
    if (name === "abra-daily-automation") return true;
    return destination.includes("/api/ops/abra/");
  });

  const replaceExisting = existing.filter((item) =>
    expectedNames.has(scheduleNameFromItem(item)),
  );

  const toDelete = [...stale, ...replaceExisting];
  if (toDelete.length > 0) {
    console.log(`Deleting ${toDelete.length} existing Abra schedule(s)...`);
    for (const item of toDelete) {
      const id = scheduleIdFromItem(item);
      if (!id) continue;
      await deleteSchedule(id);
    }
  } else {
    console.log("No existing Abra schedules to delete.");
  }

  console.log(`Creating ${SCHEDULES.length} schedule(s) for ${BASE_URL}...`);
  for (const schedule of SCHEDULES) {
    await createSchedule(schedule);
    console.log(`✓ ${schedule.name} (${schedule.cron})`);
  }

  const finalSchedules = await listSchedules();
  const discovered = finalSchedules
    .map((item) => ({
      name: scheduleNameFromItem(item),
      cron: cronFromItem(item),
      method: item.method || "GET",
      destination: destinationFromItem(item),
    }))
    .filter((item) => expectedNames.has(item.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  printSummaryTable(discovered);
  const missing = [...expectedNames].filter(
    (name) => !discovered.some((row) => row.name === name),
  );

  if (missing.length > 0) {
    console.error(`\nMissing schedules after creation: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log(`\nRegistered ${discovered.length}/${SCHEDULES.length} schedules.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
