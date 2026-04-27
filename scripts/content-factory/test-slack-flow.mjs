#!/usr/bin/env node
/**
 * Tests the Slack approval flow without using OpenAI.
 * Posts an existing image to Slack with Approve/Reject buttons.
 *
 * Usage: node scripts/content-factory/test-slack-flow.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { postForApproval } from "./lib/slack-approval.mjs";

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

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN?.trim();
const SLACK_WEBHOOK = process.env.SLACK_SUPPORT_WEBHOOK_URL?.trim();
const KV_REST_API_URL = process.env.KV_REST_API_URL?.trim();
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN?.trim();

const profilesData = JSON.parse(readFileSync(path.join(REPO_ROOT, "data/content-factory/style-profiles.json"), "utf-8"));
const profile = profilesData["comic-americana"];

const imageId = `e2e-test-${randomUUID().slice(0, 8)}`;
const conceptText = "[E2E test of approval flow] Existing comic-bombing-run hero illustration used as a test fixture — clicking Approve registers it in the KV pending registry, demonstrating the full pipeline works without OpenAI.";
const imageUrl = "https://www.usagummies.com/brand/ad-assets-round2/comic-bombing-run.png";

// Register pending entry in KV first
const kvKey = `content-factory:pending:${imageId}`;
const kvVal = {
  id: imageId,
  profile: "comic-americana",
  concept: conceptText,
  prompt_excerpt: "[test fixture, no actual prompt]",
  image_path: "public/brand/ad-assets-round2/comic-bombing-run.png",
  image_url: imageUrl,
  generated_at: new Date().toISOString(),
  cost_estimate_usd: 0,
};
console.log(`Registering test entry in KV: ${imageId}`);
try {
  await fetch(`${KV_REST_API_URL}/set/${kvKey}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(kvVal),
  });
  console.log("✓ KV registered");
} catch (e) {
  console.error("✗ KV register failed:", e.message);
  process.exit(1);
}

console.log(`Posting test creative to Slack #ops-approvals...`);
// Force webhook path (bot token is account_inactive)
const result = await postForApproval({
  slackBotToken: undefined,
  slackWebhookUrl: SLACK_WEBHOOK,
  imageUrl,
  imageId,
  styleProfile: profile,
  conceptText,
  prompt: "[test fixture]",
  metadata: { imagePath: "public/brand/ad-assets-round2/comic-bombing-run.png" },
});
console.log(`✓ Posted: ${result.message_link}`);
console.log("");
console.log(`Click Approve or Reject in Slack to verify the webhook routes work.`);
console.log(`Expected: browser pops a confirmation page + KV entry moves from pending → approved/rejected.`);
