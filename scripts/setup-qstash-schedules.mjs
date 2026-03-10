#!/usr/bin/env node

/**
 * Register Abra scheduler cron jobs in QStash.
 *
 * Usage:
 *   source .env.local && node scripts/setup-qstash-schedules.mjs
 */

const QSTASH_TOKEN = process.env.QSTASH_TOKEN || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
const BASE_URL =
  process.env.VERCEL_URL
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

const schedules = [
  {
    name: "abra-daily-automation",
    url: `${BASE_URL}/api/ops/abra/scheduler`,
    cron: "0 15 * * *", // 8am PT
  },
];

async function createSchedule(schedule) {
  const res = await fetch("https://qstash.upstash.io/v2/schedules", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${QSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      destination: schedule.url,
      cron: schedule.cron,
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
      },
      body: JSON.stringify({
        schedule: schedule.name,
        source: "setup-qstash-schedules",
      }),
    }),
  });

  const data = await res.text();
  if (!res.ok) {
    throw new Error(`${schedule.name} failed (${res.status}): ${data}`);
  }

  return data;
}

async function main() {
  console.log(`Registering ${schedules.length} QStash schedule(s) to ${BASE_URL}`);
  for (const schedule of schedules) {
    const result = await createSchedule(schedule);
    console.log(`✓ ${schedule.name} (${schedule.cron})`);
    console.log(result);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
