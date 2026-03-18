#!/usr/bin/env node
/**
 * Abra Auto-Teach — Runs automated knowledge feeds.
 *
 * Called by abra-brain-sync.mjs dispatcher as ABRA9.
 * Can also be run manually: node scripts/abra-auto-teach.mjs
 *
 * Calls the /api/ops/abra/auto-teach endpoint.
 */

const HOST =
  process.env.NEXTAUTH_URL ||
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000");

const CRON_SECRET = process.env.CRON_SECRET;

async function main() {
  console.log("[abra-auto-teach] Starting auto-teach run...");

  try {
    const res = await fetch(`${HOST}/api/ops/abra/auto-teach`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CRON_SECRET ? { Authorization: `Bearer ${CRON_SECRET}` } : {}),
      },
      signal: AbortSignal.timeout(55000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[abra-auto-teach] Failed (${res.status}): ${text}`);
      process.exit(1);
    }

    const data = await res.json();
    console.log("[abra-auto-teach] Results:", JSON.stringify(data, null, 2));

    if (data.summary) {
      console.log(
        `[abra-auto-teach] Summary: ${data.summary.success}/${data.summary.total} feeds succeeded, ${data.summary.entriesCreated} entries created`,
      );
    }
  } catch (err) {
    console.error("[abra-auto-teach] Error:", err.message);
    process.exit(1);
  }
}

main();
