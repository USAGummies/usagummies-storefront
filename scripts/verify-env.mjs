import fs from "node:fs";
import path from "node:path";

const SKIP = process.env.SKIP_SHOPIFY_FETCH === "1";
const envPath = path.join(process.cwd(), ".env.local");

// Load .env.local if present (non-fatal if missing)
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    if (!line || line.trim().startsWith("#")) continue;
    const m = line.match(/^\s*([^=]+?)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, v] = m;
    const cleaned = v.replace(/^\"|\"$/g, "").replace(/^'|'$/g, "");
    process.env[k.trim()] = cleaned;
  }
}

const domain =
  process.env.SHOPIFY_STORE_DOMAIN ||
  process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
  process.env.SHOPIFY_DOMAIN ||
  process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN;

const endpoint = process.env.SHOPIFY_STOREFRONT_API_ENDPOINT;

const version =
  process.env.SHOPIFY_STOREFRONT_API_VERSION ||
  process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_VERSION ||
  "2024-07";

const token =
  process.env.SHOPIFY_STOREFRONT_API_TOKEN ||
  process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_API_TOKEN ||
  process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN ||
  process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN;

const missing = [];
if (!endpoint && !domain) missing.push("SHOPIFY_STORE_DOMAIN (or NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN) or SHOPIFY_STOREFRONT_API_ENDPOINT");
if (!token) missing.push("SHOPIFY_STOREFRONT_API_TOKEN (or SHOPIFY_STOREFRONT_ACCESS_TOKEN)");

console.log("Shopify env check:");
console.log(`- endpoint: ${endpoint ? "[set]" : "[not set]"}`);
console.log(`- domain: ${domain || "[not set]"}`);
console.log(`- version: ${version || "[not set]"}`);
console.log(`- token: ${token ? "[set]" : "[not set]"}`);

if (missing.length && !SKIP) {
  console.error("Missing required Shopify env vars:");
  for (const m of missing) console.error(`  - ${m}`);
  process.exit(1);
}

if (missing.length && SKIP) {
  console.warn("Skipping Shopify env validation because SKIP_SHOPIFY_FETCH=1");
}
