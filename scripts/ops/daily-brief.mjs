#!/usr/bin/env node
/**
 * Trigger the canonical ops daily brief endpoint.
 *
 * This replaces local one-off morning-brief scripts that call Gmail,
 * HubSpot, and Slack directly. All composition, audit, degradation,
 * and Slack posting stays inside `/api/ops/daily-brief`.
 *
 * Usage:
 *   CRON_SECRET=... node scripts/ops/daily-brief.mjs --kind morning --dry
 *   CRON_SECRET=... node scripts/ops/daily-brief.mjs --kind morning --post
 *   CRON_SECRET=... node scripts/ops/daily-brief.mjs --kind eod --post
 */

import { callJson, fail, parseArgs, printResult } from "./control-plane.mjs";

const args = parseArgs(process.argv.slice(2));
const kind = args.kind === "eod" ? "eod" : "morning";
const shouldPost = args.post === true || args.post === "true";
const dry = args.dry === true || args.dry === "true";

if (shouldPost && dry) {
  fail("Choose either --post or --dry, not both.", 2);
}

const postParam = shouldPost ? "true" : "false";
const result = await callJson(
  `/api/ops/daily-brief?kind=${encodeURIComponent(kind)}&post=${postParam}`,
  { method: "POST" },
);

printResult(
  result,
  `${dry || !shouldPost ? "composed" : "posted"} ${kind} daily brief`,
);

