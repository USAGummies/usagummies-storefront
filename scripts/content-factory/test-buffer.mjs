#!/usr/bin/env node
/**
 * Tests Buffer publishing with the existing comic-bombing-run image
 * staged as a DRAFT (so no auto-publish — Ben can review in Buffer UI
 * before scheduling).
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { publishToBuffer, listChannels } from "./lib/buffer-publish.mjs";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

function loadEnv(p) {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
    if (m && !process.env[m[1]]) {
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
}
loadEnv(path.join(REPO_ROOT, ".env.local"));

const apiToken = process.env.BUFFER_API_TOKEN.trim();
const orgId = process.env.BUFFER_ORGANIZATION_ID.trim();

console.log("=== List channels ===");
const channels = await listChannels({ apiToken, organizationId: orgId });
for (const c of channels) {
  console.log(`  ${c.service.padEnd(15)} ${c.name.padEnd(20)} (${c.id})  locked=${c.isLocked}`);
}

console.log("\n=== Stage DRAFT to Facebook only ===");
const result = await publishToBuffer({
  apiToken,
  organizationId: orgId,
  channels: ["fb"],
  imageUrl: "https://www.usagummies.com/brand/ad-assets-round2/comic-bombing-run.png",
  caption: "🇺🇸 [DRAFT — Content Factory test post] All American Gummy Bears. Made in the USA, no artificial dyes. From American skies to your hand. 🛩️🐻 #USAGummies #MadeInUSA",
  mode: "draft",
});

console.log(`Post IDs: ${result.postIds.join(", ") || "(none)"}`);
console.log(`Errors:   ${result.errors.length ? result.errors.join("\n          ") : "(none)"}`);
console.log(`\nIf success, check Buffer dashboard → Drafts to see the staged post.`);
