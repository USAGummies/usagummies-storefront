#!/usr/bin/env node
/**
 * Compatibility shim for the old local Sales Morning Brief script.
 *
 * Do NOT call Gmail, HubSpot, or Slack directly from this file. The
 * canonical implementation is `/api/ops/daily-brief`, triggered by
 * `scripts/ops/daily-brief.mjs`, where degradation handling, audit,
 * and Slack posting are centralized.
 *
 * Usage remains:
 *   CRON_SECRET=... node scripts/sales-morning-brief.mjs --dry
 *   CRON_SECRET=... node scripts/sales-morning-brief.mjs --post
 */

const forwarded = process.argv.slice(2);
if (!forwarded.includes("--kind")) {
  forwarded.unshift("--kind", "morning");
}

process.argv = [
  process.argv[0] ?? "node",
  "scripts/ops/daily-brief.mjs",
  ...forwarded,
];

await import("./ops/daily-brief.mjs");

