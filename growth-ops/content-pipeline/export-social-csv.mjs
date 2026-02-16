#!/usr/bin/env node
/**
 * export-social-csv.mjs — Export social media posts as CSV for Buffer/Later/Hootsuite
 *
 * Generates a CSV file that can be bulk-uploaded to any social media scheduler.
 * Compatible with:
 *   - Buffer (bulk upload CSV)
 *   - Later (CSV import)
 *   - Hootsuite (bulk composer CSV)
 *   - Sprout Social (CSV import)
 *
 * Usage:
 *   node growth-ops/content-pipeline/export-social-csv.mjs
 *
 * Output:
 *   growth-ops/content-pipeline/exports/social-posts-YYYY-MM-DD.csv
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXPORT_DIR = path.join(__dirname, "exports");

const SITE = "https://www.usagummies.com";

// UTM builder
function utm(path, platform, content) {
  const base = `${SITE}${path}`;
  return `${base}?utm_source=${platform}&utm_medium=social&utm_campaign=dyefree_blitz_feb26&utm_content=${content}`;
}

// All posts organized by platform and date
const posts = [
  // ═══ TWITTER / X ═══
  {
    platform: "twitter",
    date: "2026-02-17",
    time: "08:00",
    text: `The FDA banned Red No. 3. Mars is scrambling to remove artificial dyes from M&M's and Skittles.\n\nUSA Gummies? We never used them.\n\nDye-free from day one. Colored with fruit & vegetable extracts. Made in the USA.\n\n${utm("/dye-free-movement", "twitter", "fda_ban")}`,
  },
  {
    platform: "twitter",
    date: "2026-02-17",
    time: "18:00",
    text: `Mars promised to remove artificial dyes in 2016. They walked it back.\n\nNow they're promising again for 2026.\n\nMeanwhile, these gummy bears have been dye-free since day one:\n${utm("/shop", "twitter", "mars_promise")}`,
  },
  {
    platform: "twitter",
    date: "2026-02-18",
    time: "08:00",
    text: `In Europe, candy with artificial dyes must carry a warning label:\n"May have an adverse effect on activity and attention in children."\n\nIn the US? No warning required.\n\nFull timeline of how we got here:\n${utm("/dye-free-movement", "twitter", "eu_warning")}`,
  },
  {
    platform: "twitter",
    date: "2026-02-19",
    time: "08:00",
    text: `Candies that still have Red 40:\n🔴 Haribo Goldbears\n🔴 Sour Patch Kids\n🔴 Swedish Fish\n🔴 Welch's Fruit Snacks\n🔴 Jolly Rancher\n\nCandies that don't:\n🟢 USA Gummies\n\nFull list: ${utm("/blog/what-candy-has-red-40", "twitter", "red40_list")}`,
  },
  {
    platform: "twitter",
    date: "2026-02-20",
    time: "12:00",
    text: `What's actually in our gummy bears:\n\n✓ Colors from beet juice, turmeric, spirulina, carrot\n✓ Natural flavors\n✓ Made in the USA\n✗ No Red 40\n✗ No Yellow 5\n✗ No Blue 1\n\n${utm("/ingredients", "twitter", "ingredients")}`,
  },

  // ═══ INSTAGRAM ═══
  {
    platform: "instagram",
    date: "2026-02-17",
    time: "10:00",
    text: `The FDA just banned Red No. 3 — a dye found in candy, frosting, and fruit snacks for decades.\n\nMars is scrambling to reformulate M&M's and Skittles. Kraft and General Mills are rushing to catch up.\n\nUSA Gummies? We've been dye-free from day one.\n\nOur colors come from real fruit and vegetable extracts: beet juice for red, turmeric for yellow, spirulina for green, carrot for orange.\n\nNo artificial dyes. No last-minute reformulations. Just classic gummy bears, made in the USA.\n\nLink in bio for the full dye-free movement timeline.\n\n#dyefreecandy #noartificialdyes #red40free #madeinusa #fdaban #cleancandy #dyefreegummies #usagummies #gummybears #parentingtips #cleaningredients #noredye40`,
  },
  {
    platform: "instagram",
    date: "2026-02-19",
    time: "10:00",
    text: `How to check any candy for artificial dyes in 10 seconds:\n\n1️⃣ Flip the bag over\n2️⃣ Find the ingredients list\n3️⃣ Look for any color + number (Red 40, Yellow 5, Blue 1)\n4️⃣ Also check for "artificial colors" or "FD&C"\n\nIf you see any of those = synthetic dyes.\n\nIf you see "colors from fruit and vegetable juice" = you're good.\n\nWe wrote a full guide on dye-free candy — link in bio.\n\n#dyefreecandy #readthelabel #noartificialdyes #ingredientsmatter #cleancandy #red40free #parentinghacks #healthysnacks #dyefreegummies #usagummies`,
  },

  // ═══ FACEBOOK ═══
  {
    platform: "facebook",
    date: "2026-02-17",
    time: "09:00",
    text: `Big changes happening in the candy aisle.\n\nThe FDA banned Red No. 3 in January 2025. Mars announced they're removing artificial dyes from M&M's and Skittles. Kraft and General Mills are following.\n\nUSA Gummies has been dye-free since we started. Our gummy bears get their colors from beet juice, turmeric, spirulina, and carrot extract — and they're made entirely in the USA.\n\nIf you're curious about which candies still use artificial dyes (and which don't), we put together a full breakdown:\n${utm("/blog/what-candy-has-red-40", "facebook", "red40_list")}`,
  },
  {
    platform: "facebook",
    date: "2026-02-20",
    time: "09:00",
    text: `Parents: here's a quick guide to dye-free snacks for kids.\n\nGummy bears, fruit snacks, crackers, popsicles — we covered every category with specific brand recommendations and label-reading tips.\n\nThe short version: look for "colors from fruit and vegetable juice" on the label, or just grab USDA Organic (organic rules prohibit synthetic dyes).\n\nFull guide:\n${utm("/blog/dye-free-snacks-for-kids", "facebook", "kids_guide")}`,
  },

  // ═══ PINTEREST ═══
  {
    platform: "pinterest",
    date: "2026-02-17",
    time: "11:00",
    text: `What Candy Has Red 40? Complete List + Dye-Free Alternatives | Check which popular candy brands still use Red 40 and which are already dye-free. Label-checked list updated for 2026. | ${utm("/blog/what-candy-has-red-40", "pinterest", "red40_pin")}`,
  },
  {
    platform: "pinterest",
    date: "2026-02-18",
    time: "11:00",
    text: `Dye-Free Snacks for Kids: Parent's Guide | The best dye-free snacks for kids by category — gummy bears, fruit snacks, crackers, and more. How to read labels and find snacks with no artificial dyes. | ${utm("/blog/dye-free-snacks-for-kids", "pinterest", "kids_pin")}`,
  },
  {
    platform: "pinterest",
    date: "2026-02-19",
    time: "11:00",
    text: `The Dye-Free Movement Timeline: From EU Warning Labels to the FDA Ban | A visual timeline of how candy went from artificial colors to natural — and which brands led vs. followed. | ${utm("/dye-free-movement", "pinterest", "timeline_pin")}`,
  },

  // ═══ TIKTOK (captions only — pair with video) ═══
  {
    platform: "tiktok",
    date: "2026-02-17",
    time: "18:00",
    text: `The FDA banned Red No. 3 and Mars is scrambling. Meanwhile... 👀🇺🇸\n\n#dyefreecandy #red40 #fdaban #gummybears #madeinusa #cleancandy #noartificialdyes #candytok`,
  },
  {
    platform: "tiktok",
    date: "2026-02-18",
    time: "18:00",
    text: `POV: you flip over popular candy and read what's actually in it 🔍\n\nRed 40. Yellow 5. Blue 1. "Color added."\n\nThen you check USA Gummies: beet juice, turmeric, spirulina, carrot. That's it.\n\n#ingredientcheck #dyefreecandy #red40 #readthelabel #cleancandy #gummybears #parenttok`,
  },
  {
    platform: "tiktok",
    date: "2026-02-19",
    time: "18:00",
    text: `Did you know these candies require a WARNING LABEL in Europe? 🇪🇺\n\nBut not in the US. 🇺🇸\n\nSame exact candy. Different rules.\n\n#fooddyes #red40 #europe #fdaban #dyefreecandy #healthtok #parentingtips`,
  },
  {
    platform: "tiktok",
    date: "2026-02-20",
    time: "18:00",
    text: `Parents asking "what snacks don't have artificial dyes" — here's your cheat sheet 📋\n\nGummy bears: USA Gummies, YumEarth\nFruit snacks: Annie's, That's It\nCrackers: Goldfish, Annie's Bunnies\nPopsicles: Outshine, GoodPop\n\nSave this for the grocery store 🛒\n\n#dyefreesnacks #parenthack #snacksforkids #noartificialdyes #cleanfood #momtok`,
  },
  {
    platform: "tiktok",
    date: "2026-02-21",
    time: "18:00",
    text: `Every color in our gummy bears comes from a real plant 🌿\n\n🔴 Red = beet juice\n🟡 Yellow = turmeric\n🟢 Green = spirulina\n🟠 Orange = carrot\n\nNo Red 40. No Yellow 5. No Blue 1. Made in the USA.\n\n#gummybears #madeinusa #cleaningredients #dyefreecandy #noartificialdyes #usagummies`,
  },
];

function escapeCsv(value) {
  if (!value) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(rows) {
  const header = "Platform,Date,Time,Text";
  const lines = rows.map(row =>
    [
      escapeCsv(row.platform),
      escapeCsv(row.date),
      escapeCsv(row.time),
      escapeCsv(row.text),
    ].join(",")
  );
  return [header, ...lines].join("\n");
}

// Ensure export directory exists
if (!fs.existsSync(EXPORT_DIR)) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

const today = new Date().toISOString().slice(0, 10);
const csvPath = path.join(EXPORT_DIR, `social-posts-${today}.csv`);
const jsonPath = path.join(EXPORT_DIR, `social-posts-${today}.json`);

// Write CSV (for Buffer/Later/Hootsuite upload)
fs.writeFileSync(csvPath, buildCsv(posts), "utf8");

// Write JSON (for programmatic use)
fs.writeFileSync(jsonPath, JSON.stringify(posts, null, 2), "utf8");

// Summary
const byPlatform = {};
for (const post of posts) {
  byPlatform[post.platform] = (byPlatform[post.platform] || 0) + 1;
}

console.log(`\n📱 Social Media Export — ${today}`);
console.log(`   Total posts: ${posts.length}`);
for (const [platform, count] of Object.entries(byPlatform)) {
  console.log(`   ${platform}: ${count} posts`);
}
console.log(`\n   CSV: ${csvPath}`);
console.log(`   JSON: ${jsonPath}`);
console.log(`\n   Upload the CSV to Buffer (buffer.com) or Later (later.com) for auto-scheduling.`);
console.log(`   TikTok captions need to be paired with video content.\n`);
