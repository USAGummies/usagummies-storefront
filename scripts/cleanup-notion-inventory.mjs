#!/usr/bin/env node
/**
 * Cleanup Notion Inventory DB — archive test/sample entries
 *
 * Queries the Notion Inventory DB and archives any entries that look like
 * test data (no real SKU, placeholder quantities, etc.)
 *
 * Usage: node scripts/cleanup-notion-inventory.mjs [--dry-run]
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env.local manually (no dotenv dep needed)
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env.local");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* .env.local may not exist */ }

const NOTION_API_KEY =
  process.env.NOTION_API_KEY || process.env.NOTION_TOKEN || "";
const NOTION_VERSION = "2022-06-28";
const INVENTORY_DB_ID =
  process.env.NOTION_INVENTORY_DB_ID || "d598e72e09974194bfe3624ee6e0117e";

const DRY_RUN = process.argv.includes("--dry-run");

function toNotionId(raw) {
  const clean = raw.replace(/-/g, "");
  if (clean.length !== 32) return raw;
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
}

function headers() {
  return {
    Authorization: `Bearer ${NOTION_API_KEY}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

function extractText(prop) {
  if (!prop) return "";
  if (prop.type === "title" && Array.isArray(prop.title))
    return prop.title.map((t) => t.plain_text || "").join("");
  if (prop.type === "rich_text" && Array.isArray(prop.rich_text))
    return prop.rich_text.map((t) => t.plain_text || "").join("");
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "number") return String(prop.number ?? "");
  return "";
}

function extractNumber(prop) {
  if (!prop || prop.type !== "number") return 0;
  return prop.number ?? 0;
}

async function queryInventory() {
  const res = await fetch(
    `https://api.notion.com/v1/databases/${toNotionId(INVENTORY_DB_ID)}/query`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ page_size: 100 }),
    },
  );
  if (!res.ok) {
    console.error(`Query failed: ${res.status} ${res.statusText}`);
    const text = await res.text();
    console.error(text);
    process.exit(1);
  }
  const data = await res.json();
  return data.results || [];
}

async function archivePage(pageId) {
  const res = await fetch(
    `https://api.notion.com/v1/pages/${toNotionId(pageId)}`,
    {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ archived: true }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    console.error(`  ❌ Archive failed for ${pageId}: ${res.status} — ${text}`);
    return false;
  }
  return true;
}

function isTestEntry(page) {
  const props = page.properties || {};
  const item = extractText(props["Item"]) || extractText(props["Name"]) || "";
  const sku = extractText(props["SKU"]) || "";
  const location = extractText(props["Location"]) || item || "";
  const stock = extractNumber(props["Units on Hand"]) || extractNumber(props["Current Stock"]) || extractNumber(props["Quantity"]) || 0;
  const notes = extractText(props["Notes"]) || "";
  const velocity = extractNumber(props["Daily Velocity"]) || extractNumber(props["Units Per Day"]) || 0;

  // Flag as test data if:
  // 1. No SKU set AND no real location
  // 2. Location is "Home Stock" generic (not PA or WA specific)
  // 3. Round number stock quantities that look like samples (200, 250, 300, etc.)

  const isRoundHundred = stock > 0 && stock % 25 === 0 && stock >= 100;
  const hasNoSku = !sku;
  const hasNoVelocity = velocity === 0;
  const locationLower = location.toLowerCase();
  const isHomeStockGeneric =
    locationLower.includes("home stock") &&
    !locationLower.includes("pa") &&
    !locationLower.includes("wa");

  // Conservative: only flag entries with ALL of these:
  // - no velocity data
  // - no SKU
  // - round number quantities OR zero stock OR generic location names
  const isGenericLocation =
    locationLower === "home stock" ||
    locationLower === "amazon fba" ||
    locationLower === "other" ||
    locationLower.startsWith("shipbob") ||
    locationLower.startsWith("repacker");

  if (hasNoSku && hasNoVelocity && (isRoundHundred || stock === 0 || isGenericLocation)) {
    return true;
  }

  return false;
}

async function main() {
  if (!NOTION_API_KEY) {
    console.error("❌ NOTION_API_KEY not found in environment");
    process.exit(1);
  }

  console.log(
    DRY_RUN ? "🔍 DRY RUN — no changes will be made\n" : "🧹 CLEANUP MODE — will archive test entries\n",
  );

  const pages = await queryInventory();
  console.log(`Found ${pages.length} entries in Inventory DB\n`);

  let archived = 0;
  let kept = 0;

  for (const page of pages) {
    const props = page.properties || {};
    const item = extractText(props["Item"]) || extractText(props["Name"]) || "(no title)";
    const sku = extractText(props["SKU"]) || "(no SKU)";
    const stock =
      extractNumber(props["Units on Hand"]) ||
      extractNumber(props["Current Stock"]) ||
      extractNumber(props["Quantity"]) ||
      0;
    const location = extractText(props["Location"]) || item || "?";

    if (isTestEntry(page)) {
      console.log(`  🗑  ARCHIVE: "${item}" | SKU: ${sku} | Stock: ${stock} | Loc: ${location}`);
      if (!DRY_RUN) {
        const ok = await archivePage(page.id);
        if (ok) console.log(`     ✅ Archived`);
      }
      archived++;
    } else {
      console.log(`  ✅ KEEP:    "${item}" | SKU: ${sku} | Stock: ${stock} | Loc: ${location}`);
      kept++;
    }
  }

  console.log(`\n📊 Summary: ${archived} archived, ${kept} kept`);
  if (DRY_RUN) console.log("   (dry run — no changes made, run without --dry-run to execute)");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
