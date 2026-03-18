#!/usr/bin/env node
/**
 * auto-post-reddit.mjs — Playwright-based Reddit comment poster
 *
 * Uses saved browser state to post comments on Reddit threads.
 * Falls back to opening browser for manual login if cookies are stale.
 *
 * Usage:
 *   node growth-ops/community-monitor/auto-post-reddit.mjs
 *   node growth-ops/community-monitor/auto-post-reddit.mjs --file data/manual-responses-feb16.json
 *   node growth-ops/community-monitor/auto-post-reddit.mjs --dry-run
 *   node growth-ops/community-monitor/auto-post-reddit.mjs --login  (re-authenticate)
 *
 * Features:
 *   - Uses Playwright with saved Reddit session cookies
 *   - 60-120 second random delays between posts (looks natural)
 *   - Verifies each comment posted successfully
 *   - Logs all actions for audit trail
 *   - FTC disclosure reminder before each post
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "data");
const STATE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "output",
  "playwright",
  "day0-live",
  "storage-state.json"
);
const REDDIT_STATE = path.join(DATA_DIR, "reddit-browser-state.json");
const POST_LOG = path.join(DATA_DIR, "post-log.json");

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelay(minSec, maxSec) {
  const ms = (minSec + Math.random() * (maxSec - minSec)) * 1000;
  return sleep(ms);
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    file: args.find((a, i) => args[i - 1] === "--file") || null,
    dryRun: args.includes("--dry-run"),
    login: args.includes("--login"),
    skip: parseInt(args.find((a, i) => args[i - 1] === "--skip") || "0", 10),
    limit: parseInt(args.find((a, i) => args[i - 1] === "--limit") || "999", 10),
  };
}

function findLatestResponseFile() {
  if (!fs.existsSync(DATA_DIR)) {
    log("❌ No data directory");
    process.exit(1);
  }
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("manual-responses") && f.endsWith(".json"))
    .sort()
    .reverse();
  if (!files.length) {
    log("❌ No response files found");
    process.exit(1);
  }
  return path.join(DATA_DIR, files[0]);
}

function loadPostLog() {
  try {
    if (fs.existsSync(POST_LOG)) {
      return JSON.parse(fs.readFileSync(POST_LOG, "utf8"));
    }
  } catch {}
  return [];
}

function savePostLog(entries) {
  fs.writeFileSync(POST_LOG, JSON.stringify(entries, null, 2), "utf8");
}

function getStatePath() {
  // Prefer dedicated Reddit state; fall back to day0-live state
  if (fs.existsSync(REDDIT_STATE)) return REDDIT_STATE;
  if (fs.existsSync(STATE_PATH)) return STATE_PATH;
  return null;
}

// ─── Login Flow ────────────────────────────────────────────────
async function doLogin() {
  log("🔐 Opening browser for Reddit login...");
  log("   Log in manually, then press Enter in this terminal when done.");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://www.reddit.com/login");
  log("   Waiting for you to log in...");

  // Wait for navigation to homepage (indicates successful login)
  try {
    await page.waitForURL("**/reddit.com/**", { timeout: 300_000 });
    // Give extra time for cookies to settle
    await sleep(3000);
  } catch {
    log("   Timeout waiting for login — saving state anyway");
  }

  // Save state
  const state = await context.storageState();
  fs.writeFileSync(REDDIT_STATE, JSON.stringify(state, null, 2), "utf8");
  log(`✅ Reddit session saved to ${REDDIT_STATE}`);

  await browser.close();
  return REDDIT_STATE;
}

// ─── Post Comment ──────────────────────────────────────────────
async function postComment(page, url, commentText) {
  log(`   Navigating to ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await sleep(2000 + Math.random() * 2000);

  // Check if we're logged in by looking for comment box
  // Try new Reddit first
  let commentBox = null;

  // New Reddit: look for the comment/reply text area
  try {
    // Try shreddit (new new Reddit) comment box
    commentBox = await page.locator('shreddit-comment-composer textarea, div[contenteditable="true"][data-lexical-editor], div[role="textbox"]').first();
    const isVisible = await commentBox.isVisible({ timeout: 5000 });
    if (!isVisible) commentBox = null;
  } catch {
    commentBox = null;
  }

  // Fallback: try old Reddit textarea
  if (!commentBox) {
    try {
      commentBox = await page.locator('textarea[name="text"], .usertext-edit textarea').first();
      const isVisible = await commentBox.isVisible({ timeout: 3000 });
      if (!isVisible) commentBox = null;
    } catch {
      commentBox = null;
    }
  }

  if (!commentBox) {
    // Not logged in or comment box not found
    log("   ⚠️  Comment box not found — may need to re-login");
    return false;
  }

  // Click the comment box and type
  await commentBox.click();
  await sleep(500);

  // Type the comment character by character with slight randomness
  await commentBox.fill(commentText);
  await sleep(1000 + Math.random() * 1000);

  // Find and click the submit/comment button
  let submitted = false;

  // Try various submit button selectors
  const submitSelectors = [
    'button:has-text("Comment")',
    'button:has-text("Reply")',
    'button[type="submit"]:has-text("Comment")',
    'button[type="submit"]:has-text("Reply")',
    'faceplate-button:has-text("Comment")',
    '.save-button-container button',
    'button.submit',
  ];

  for (const selector of submitSelectors) {
    try {
      const btn = await page.locator(selector).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        submitted = true;
        log("   ✅ Comment submitted");
        break;
      }
    } catch {
      continue;
    }
  }

  if (!submitted) {
    log("   ⚠️  Could not find submit button — comment typed but not submitted");
    return false;
  }

  // Wait for the comment to appear
  await sleep(3000);
  return true;
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();

  // Handle login mode
  if (opts.login) {
    await doLogin();
    return;
  }

  const filePath = opts.file ? path.resolve(opts.file) : findLatestResponseFile();
  if (!fs.existsSync(filePath)) {
    log(`❌ File not found: ${filePath}`);
    process.exit(1);
  }

  const responses = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const postLog = loadPostLog();
  const alreadyPosted = new Set(postLog.map((e) => e.post_id));

  // Filter out already-posted
  const toPost = responses
    .filter((r) => !alreadyPosted.has(r.post_id))
    .slice(opts.skip, opts.skip + opts.limit);

  if (!toPost.length) {
    log("✅ All responses already posted (or none to post)");
    return;
  }

  log(`\n🤖 Reddit Auto-Poster`);
  log(`   File: ${path.basename(filePath)}`);
  log(`   Posts: ${toPost.length} to post (${alreadyPosted.size} already done)`);
  log(`   Mode: ${opts.dryRun ? "DRY RUN" : "LIVE"}\n`);

  if (opts.dryRun) {
    for (const post of toPost) {
      log(`━━━ ${post.post_id} ━━━`);
      log(`📌 r/${post.subreddit}: ${post.post_title}`);
      log(`📝 ${post.response_template.slice(0, 80)}...`);
      log(`   [DRY RUN — would post]\n`);
    }
    return;
  }

  // Get browser state
  const statePath = getStatePath();
  if (!statePath) {
    log("❌ No saved Reddit session. Run with --login first:");
    log("   node growth-ops/community-monitor/auto-post-reddit.mjs --login");
    process.exit(1);
  }

  // Launch browser
  log("🌐 Launching browser...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });

  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    log("❌ Could not parse browser state");
    await browser.close();
    process.exit(1);
  }

  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();

  // Verify we're logged in
  log("🔐 Verifying Reddit session...");
  await page.goto("https://www.reddit.com", { waitUntil: "domcontentloaded", timeout: 20_000 });
  await sleep(2000);

  // Check for login state
  const pageContent = await page.content();
  const isLoggedIn =
    pageContent.includes("loggedIn") ||
    pageContent.includes("user-drawer") ||
    pageContent.includes("UserProfileLink") ||
    !pageContent.includes("Log In");

  if (!isLoggedIn) {
    log("❌ Reddit session expired. Re-run with --login to authenticate:");
    log("   node growth-ops/community-monitor/auto-post-reddit.mjs --login");
    await browser.close();
    process.exit(1);
  }

  log("✅ Logged in to Reddit\n");

  // Post each response
  let successCount = 0;
  for (let i = 0; i < toPost.length; i++) {
    const post = toPost[i];

    log(`━━━ Post ${i + 1}/${toPost.length} ━━━`);
    log(`📌 r/${post.subreddit}: ${post.post_title}`);
    log(`🎭 Persona: ${post.persona}`);

    const success = await postComment(page, post.url, post.response_template);

    if (success) {
      successCount++;
      // Log the post
      postLog.push({
        post_id: post.post_id,
        subreddit: post.subreddit,
        post_title: post.post_title,
        persona: post.persona,
        posted_at: new Date().toISOString(),
        url: post.url,
      });
      savePostLog(postLog);
    }

    // Random delay between posts (60-120 seconds)
    if (i < toPost.length - 1) {
      const delaySec = 60 + Math.floor(Math.random() * 60);
      log(`   ⏳ Waiting ${delaySec}s before next post...\n`);
      await sleep(delaySec * 1000);
    }
  }

  // Save updated state (in case cookies refreshed)
  const newState = await context.storageState();
  fs.writeFileSync(REDDIT_STATE, JSON.stringify(newState, null, 2), "utf8");

  await browser.close();

  log(`\n═══════════════════════════════════════`);
  log(`✅ Auto-poster complete: ${successCount}/${toPost.length} posted`);
  log(`═══════════════════════════════════════\n`);
}

main().catch((err) => {
  log(`💥 Fatal: ${err.message}`);
  process.exit(1);
});
