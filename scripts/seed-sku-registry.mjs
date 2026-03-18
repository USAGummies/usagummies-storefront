/**
 * One-time SKU registry seed — fetches Shopify products, writes to Notion SKU DB.
 * Run: node scripts/seed-sku-registry.mjs
 */
import { readFileSync } from "node:fs";

// Load .env.local manually (no dotenv dependency)
const envFile = readFileSync(".env.local", "utf-8");
for (const raw of envFile.split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq < 1) continue;
  const key = line.slice(0, eq).trim();
  let val = line.slice(eq + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  process.env[key] = val.replace(/\\n/g, "\n").trim();
}

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const NOTION_KEY = process.env.NOTION_API_KEY;
const SKU_DB = "8173583d402145fb8d87ad74c0241f00";

if (!SHOPIFY_TOKEN) { console.error("❌ No SHOPIFY_ADMIN_TOKEN in .env.local"); process.exit(1); }
if (!NOTION_KEY) { console.error("❌ No NOTION_API_KEY in .env.local"); process.exit(1); }

console.log(`Shopify domain: ${SHOPIFY_DOMAIN}`);
console.log("Fetching products from Shopify Admin API...");

const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products.json?limit=50`, {
  headers: { "X-Shopify-Access-Token": SHOPIFY_TOKEN },
});
const data = await res.json();
const products = data.products || [];
const totalVariants = products.reduce((s, p) => s + p.variants.length, 0);
console.log(`Found ${products.length} products, ${totalVariants} variants\n`);

let created = 0, skipped = 0, failed = 0;

for (const p of products) {
  for (const v of p.variants) {
    const title = p.variants.length > 1 ? `${p.title} — ${v.title}` : p.title;
    const sku = v.sku || `SHOPIFY-${v.id}`;

    const notionRes = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_KEY}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify({
        parent: { database_id: SKU_DB },
        properties: {
          "Product Name": { title: [{ text: { content: title } }] },
          "Shopify Handle": { rich_text: [{ text: { content: p.handle || "" } }] },
          "Shopify Price": { number: parseFloat(v.price) || 0 },
          "UPC": { rich_text: [{ text: { content: v.barcode || "" } }] },
          "Weight oz": { number: v.weight ? parseFloat(v.weight) : 0 },
          "Status": { select: { name: p.status === "active" ? "Active" : "Draft" } },
        },
      }),
    });

    if (notionRes.ok) {
      console.log(`  ✓ ${sku} — ${title} @ $${v.price}`);
      created++;
    } else {
      const err = await notionRes.json();
      console.log(`  ✗ ${sku} — ${err.message || JSON.stringify(err)}`);
      failed++;
    }
  }
}

console.log(`\nDone! Created: ${created}, Skipped: ${skipped}, Failed: ${failed}`);
