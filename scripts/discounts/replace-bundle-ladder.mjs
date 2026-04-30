#!/usr/bin/env node
/**
 * replace-bundle-ladder.mjs
 *
 * Migrates Shopify discounts from the Function-backed "USA Gummies Bundle
 * Ladder" sliding-scale to 3 native BXGY automatic discounts:
 *   - Buy 4, Get 1 FREE  (5-Pack)
 *   - Buy 5, Get 2 FREE  (7-Pack)
 *   - Buy 7, Get 3 FREE  (10-Pack)
 *
 * Steps:
 *   1. List active automatic discounts
 *   2. Delete the Function-backed "Bundle Ladder" (sliding scale)
 *   3. Delete the legacy "Free Shipping 5+" (now ALL orders ship free)
 *   4. Create 3 BXGY automatic discounts (highest gets applied)
 *   5. Create 1 simple "Free Shipping on All Orders" automatic discount
 *
 * Run:
 *   node scripts/discounts/replace-bundle-ladder.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ENV_PATH = path.join(process.cwd(), ".env.local");
if (existsSync(ENV_PATH)) {
  const text = readFileSync(ENV_PATH, "utf-8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}

const STORE_DOMAIN = (process.env.SHOPIFY_STORE_DOMAIN || "").replace(/^"|"$/g, "");
const ADMIN_TOKEN = (process.env.SHOPIFY_ADMIN_TOKEN || "").replace(/^"|"$/g, "");
const PRODUCT_GID = "gid://shopify/Product/15227899511155"; // single-bag product

if (!STORE_DOMAIN || !ADMIN_TOKEN) {
  console.error("❌ Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN");
  process.exit(1);
}

const ENDPOINT = `https://${STORE_DOMAIN}/admin/api/2024-10/graphql.json`;

async function gql(query, variables = {}) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": ADMIN_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(`GQL: ${JSON.stringify(json.errors)}`);
  return json.data;
}

console.log("USA Gummies — Bundle Ladder migration");
console.log("─".repeat(60));

// 1. List existing discounts
const list = await gql(`
  query {
    discountNodes(first: 30) {
      edges {
        node {
          id
          discount {
            __typename
            ... on DiscountAutomaticBasic   { title status }
            ... on DiscountAutomaticBxgy    { title status }
            ... on DiscountAutomaticApp     { title status }
            ... on DiscountAutomaticFreeShipping { title status }
          }
        }
      }
    }
  }
`);

console.log("\nExisting discount nodes:");
for (const e of list.discountNodes.edges) {
  const n = e.node;
  console.log(`  ${n.id} | ${n.discount.__typename} | ${n.discount.title || "(code)"} | ${n.discount.status || "?"}`);
}

// 2. Delete Function-backed Bundle Ladder + Free Shipping 5+
const toDelete = list.discountNodes.edges
  .filter((e) => {
    const t = e.node.discount.title || "";
    return /Bundle Ladder|Free Shipping 5\+/.test(t);
  })
  .map((e) => e.node.id);

console.log(`\nDeleting ${toDelete.length} legacy discount(s)...`);
for (const id of toDelete) {
  const del = await gql(`
    mutation($id: ID!) {
      discountAutomaticDelete(id: $id) {
        deletedAutomaticDiscountId
        userErrors { field message }
      }
    }
  `, { id });
  const errs = del.discountAutomaticDelete.userErrors;
  if (errs.length) console.log(`  ⚠️  ${id}: ${JSON.stringify(errs)}`);
  else console.log(`  ✓ deleted ${id}`);
}

// 3. Create 3 BXGY discounts
const tiers = [
  { title: "USA Gummies — Buy 4 Get 1 Free", buy: 4, free: 1 },
  { title: "USA Gummies — Buy 5 Get 2 Free", buy: 5, free: 2 },
  { title: "USA Gummies — Buy 7 Get 3 Free", buy: 7, free: 3 },
];

console.log("\nCreating 3 BXGY automatic discounts...");
for (const t of tiers) {
  const created = await gql(`
    mutation discountAutomaticBxgyCreate($automaticBxgyDiscount: DiscountAutomaticBxgyInput!) {
      discountAutomaticBxgyCreate(automaticBxgyDiscount: $automaticBxgyDiscount) {
        automaticDiscountNode { id }
        userErrors { field message code }
      }
    }
  `, {
    automaticBxgyDiscount: {
      title: t.title,
      startsAt: new Date().toISOString(),
      customerBuys: {
        items: { products: { productsToAdd: [PRODUCT_GID] } },
        value: { quantity: String(t.buy) },
      },
      customerGets: {
        items: { products: { productsToAdd: [PRODUCT_GID] } },
        value: {
          discountOnQuantity: {
            quantity: String(t.free),
            effect: { percentage: 1.0 }, // 100% off the free bags
          },
        },
      },
      usesPerOrderLimit: "1",
    },
  });
  const errs = created.discountAutomaticBxgyCreate.userErrors;
  if (errs.length) console.log(`  ⚠️  ${t.title}: ${JSON.stringify(errs)}`);
  else console.log(`  ✓ ${t.title} → ${created.discountAutomaticBxgyCreate.automaticDiscountNode.id}`);
}

// 4. Create universal Free Shipping discount
console.log("\nCreating universal Free Shipping automatic discount...");
const fs = await gql(`
  mutation discountAutomaticFreeShippingCreate($freeShippingAutomaticDiscount: DiscountAutomaticFreeShippingInput!) {
    discountAutomaticFreeShippingCreate(freeShippingAutomaticDiscount: $freeShippingAutomaticDiscount) {
      automaticDiscountNode { id }
      userErrors { field message code }
    }
  }
`, {
  freeShippingAutomaticDiscount: {
    title: "USA Gummies — Free Shipping (All Orders)",
    startsAt: new Date().toISOString(),
    minimumRequirement: { quantity: { greaterThanOrEqualToQuantity: "1" } },
    destination: { all: true },
  },
});
const fsErrs = fs.discountAutomaticFreeShippingCreate.userErrors;
if (fsErrs.length) console.log(`  ⚠️  ${JSON.stringify(fsErrs)}`);
else console.log(`  ✓ ${fs.discountAutomaticFreeShippingCreate.automaticDiscountNode.id}`);

// 5. Verify
console.log("\nFinal discount state:");
const after = await gql(`
  query {
    discountNodes(first: 20) {
      edges {
        node {
          id
          discount {
            __typename
            ... on DiscountAutomaticBxgy   { title status }
            ... on DiscountAutomaticBasic  { title status }
            ... on DiscountAutomaticApp    { title status }
            ... on DiscountAutomaticFreeShipping { title status }
          }
        }
      }
    }
  }
`);
for (const e of after.discountNodes.edges) {
  const n = e.node;
  console.log(`  ${n.discount.__typename.padEnd(34)} | ${(n.discount.title || "(code)").padEnd(45)} | ${n.discount.status || "?"}`);
}

console.log("\n✓ Migration complete.");
