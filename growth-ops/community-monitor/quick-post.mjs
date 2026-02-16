#!/usr/bin/env node
/**
 * quick-post.mjs — One-click Reddit response posting helper
 *
 * Opens Reddit posts in your browser with the response text copied to clipboard.
 * You just paste and hit reply. ~5 seconds per post.
 *
 * Usage:
 *   node growth-ops/community-monitor/quick-post.mjs
 *   node growth-ops/community-monitor/quick-post.mjs --file data/manual-responses-feb16.json
 *   node growth-ops/community-monitor/quick-post.mjs --delay 30
 *
 * Flags:
 *   --file <path>   Response JSON file (default: latest in data/)
 *   --delay <sec>    Seconds between opening posts (default: 15)
 *   --dry-run        Show what would happen without opening browser
 *   --skip <n>       Skip first n posts
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "data");

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { file: null, delay: 15, dryRun: false, skip: 0 };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file" && args[i + 1]) {
      opts.file = args[++i];
    } else if (args[i] === "--delay" && args[i + 1]) {
      opts.delay = parseInt(args[++i], 10) || 15;
    } else if (args[i] === "--dry-run") {
      opts.dryRun = true;
    } else if (args[i] === "--skip" && args[i + 1]) {
      opts.skip = parseInt(args[++i], 10) || 0;
    }
  }

  return opts;
}

function findLatestResponseFile() {
  if (!fs.existsSync(DATA_DIR)) {
    console.error("No data directory found at", DATA_DIR);
    process.exit(1);
  }

  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.startsWith("manual-responses") && f.endsWith(".json"))
    .sort()
    .reverse();

  if (!files.length) {
    console.error("No manual-responses-*.json files found in", DATA_DIR);
    process.exit(1);
  }

  return path.join(DATA_DIR, files[0]);
}

function copyToClipboard(text) {
  try {
    execSync("pbcopy", { input: text, encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

function openUrl(url) {
  try {
    execSync(`open "${url}"`);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const opts = parseArgs();
  const filePath = opts.file
    ? path.resolve(opts.file)
    : findLatestResponseFile();

  if (!fs.existsSync(filePath)) {
    console.error("File not found:", filePath);
    process.exit(1);
  }

  const responses = JSON.parse(fs.readFileSync(filePath, "utf8"));

  if (!Array.isArray(responses) || !responses.length) {
    console.error("No responses found in", filePath);
    process.exit(1);
  }

  const posts = responses.slice(opts.skip);

  console.log(`\n🎯 USA Gummies — Reddit Quick Post`);
  console.log(`   File: ${path.basename(filePath)}`);
  console.log(`   Posts: ${posts.length} (${opts.skip} skipped)`);
  console.log(`   Delay: ${opts.delay}s between posts`);
  console.log(`   Mode: ${opts.dryRun ? "DRY RUN" : "LIVE"}\n`);

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const num = i + 1 + opts.skip;
    const url = post.url;
    const response = post.response_template;

    console.log(`━━━ Post ${num}/${responses.length} ━━━`);
    console.log(`📌 r/${post.subreddit}: ${post.post_title}`);
    console.log(`🎭 Persona: ${post.persona}`);
    console.log(`📊 Relevance: ${post.relevance}`);
    console.log(`🔗 ${url}`);

    if (post.ftc_reminder) {
      console.log(`\n⚠️  ${post.ftc_reminder}`);
    }

    console.log(`\n📝 Response preview (first 120 chars):`);
    console.log(`   "${response.slice(0, 120)}..."\n`);

    if (!opts.dryRun) {
      // Copy response to clipboard
      const copied = copyToClipboard(response);
      if (copied) {
        console.log(`✅ Response copied to clipboard`);
      } else {
        console.log(`❌ Failed to copy — paste manually`);
      }

      // Open the Reddit post
      const opened = openUrl(url);
      if (opened) {
        console.log(`🌐 Opened in browser — paste (Cmd+V) and submit\n`);
      } else {
        console.log(`❌ Failed to open URL — open manually\n`);
      }

      if (i < posts.length - 1) {
        console.log(`⏳ Next post in ${opts.delay} seconds... (Ctrl+C to stop)\n`);
        await sleep(opts.delay * 1000);
      }
    } else {
      console.log(`   [DRY RUN — would copy + open]\n`);
    }
  }

  console.log(`\n✅ Done! ${posts.length} posts processed.`);
  console.log(`   Remember: Space your Reddit comments 5-10 min apart to look natural.`);
  console.log(`   FTC: Disclose brand affiliation if applicable.\n`);
}

main().catch(console.error);
