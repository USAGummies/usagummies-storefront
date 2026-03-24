/**
 * GET /api/ops/inventory — Unified inventory across locations
 *
 * Data sources:
 *  1) Notion Inventory DB (manual / non-Amazon locations)
 *  2) Amazon SP-API FBA inventory (live, with surfaced error details)
 *  3) Home-stock baseline + Shopify fulfilled orders since baseline date
 *
 * POST supports one-time SKU registry seeding from Shopify.
 */

import { NextResponse } from "next/server";
import {
  queryDatabase,
  extractText,
  extractNumber,
  extractDate,
  createPage,
  NotionProp,
  DB,
} from "@/lib/notion/client";
import { readState, writeState } from "@/lib/ops/state";
import {
  isAmazonConfigured,
  fetchFBAInventory,
  fetchAmazonOrderStats,
  getCachedKPIs,
} from "@/lib/amazon/sp-api";
import type { AmazonOrderStats } from "@/lib/amazon/sp-api";
import type { CacheEnvelope, AmazonKPIs } from "@/lib/amazon/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const DEFAULT_HOME_BASELINE = {
  pa: 88,
  wa: 42,
  asOf: "2026-02-09",
  note: "Initial physical count",
} as const;

const shopifyToken = () => process.env.SHOPIFY_ADMIN_TOKEN || "";
const shopifyDomain = () =>
  process.env.SHOPIFY_STORE_DOMAIN ||
  process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
  "";

export type InventoryItem = {
  id: string;
  sku: string;
  productName: string;
  currentStock: number;
  reorderPoint: number;
  reorderQty: number;
  daysOfSupply: number;
  dailyVelocity: number;
  status: "healthy" | "low" | "critical" | "out-of-stock";
  location: string;
  lastUpdated: string;
  costPerUnit: number;
  totalValue: number;
  source: "notion" | "amazon-api" | "home-baseline";
  purchaseBudget: number | null;
};

type HomeStockBaseline = {
  pa: number;
  wa: number;
  asOf: string;
  note?: string;
  updatedAt?: string;
};

type HomeStockRollup = {
  baseline: HomeStockBaseline;
  fulfilledSinceBaseline: {
    pa: number;
    wa: number;
    unassigned: number;
    total: number;
  };
  current: {
    pa: number;
    wa: number;
    total: number;
  };
  derivedAt: string;
  source: "shopify-orders" | "baseline-only";
  error?: string;
};

type AmazonFbaStatus = {
  error: string | null;
  errorAt: string | null;
  lastSuccessfulFetch: string | null;
  orderStats?: AmazonOrderStats | null;
};

type InventoryResponse = {
  items: InventoryItem[];
  summary: {
    totalSKUs: number;
    totalUnits: number;
    totalValue: number;
    healthyCounts: number;
    lowCounts: number;
    criticalCounts: number;
    outOfStockCounts: number;
    avgDaysOfSupply: number;
  };
  homeStock: HomeStockRollup;
  amazonFba: AmazonFbaStatus;
  generatedAt: string;
  budget: null;
  error?: string;
};

type ShopifyFulfillmentTotals = {
  pa: number;
  wa: number;
  unassigned: number;
  total: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function calcStatus(
  currentStock: number,
  reorderPoint: number,
  daysOfSupply: number,
): InventoryItem["status"] {
  if (currentStock <= 0) return "out-of-stock";
  if (reorderPoint > 0 && currentStock <= reorderPoint * 0.5) return "critical";
  if (reorderPoint > 0 && currentStock <= reorderPoint) return "low";
  if (daysOfSupply > 0 && daysOfSupply < 7) return "critical";
  if (daysOfSupply > 0 && daysOfSupply < 14) return "low";
  return "healthy";
}

function parseNotionItem(page: Record<string, unknown>): InventoryItem {
  const props = page.properties as Record<string, unknown>;
  const itemTitle = extractText(props["Item"]) || extractText(props["Name"]) || "";
  const location = extractText(props["Location"]) || itemTitle || "Unknown";
  const currentStock =
    extractNumber(props["Units on Hand"]) ||
    extractNumber(props["Current Stock"]) ||
    extractNumber(props["Quantity"]) ||
    0;
  const reorderPoint =
    extractNumber(props["Reorder Point"]) ||
    extractNumber(props["Min Stock"]) ||
    0;
  const reorderQty =
    extractNumber(props["Reorder Quantity"]) ||
    extractNumber(props["Reorder Qty"]) ||
    0;
  const costPerUnit =
    extractNumber(props["Cost Per Unit"]) ||
    extractNumber(props["Unit Cost"]) ||
    0;
  const dailyVelocity =
    extractNumber(props["Daily Velocity"]) ||
    extractNumber(props["Units Per Day"]) ||
    0;
  const lastUpdated =
    extractDate(props["Last Updated"]) ||
    (page.last_edited_time as string) ||
    new Date().toISOString();
  const notes = extractText(props["Notes"]) || "";

  const daysOfSupply =
    dailyVelocity > 0
      ? round2(currentStock / dailyVelocity)
      : currentStock > 0
        ? 999
        : 0;

  return {
    id: page.id as string,
    sku: extractText(props["SKU"]) || "(no SKU)",
    productName: notes || extractText(props["Item"]) || extractText(props["Name"]) || "Unknown Item",
    currentStock,
    reorderPoint,
    reorderQty,
    daysOfSupply,
    dailyVelocity,
    status: calcStatus(currentStock, reorderPoint, daysOfSupply),
    location,
    lastUpdated,
    costPerUnit,
    totalValue: round2(currentStock * costPerUnit),
    source: "notion",
    purchaseBudget: null,
  };
}

function looksLikeHomeStockRow(location: string): boolean {
  const normalized = location.toLowerCase();
  return (
    normalized.includes("home stock") ||
    normalized === "pa" ||
    normalized === "wa" ||
    normalized.includes("pennsylvania") ||
    normalized.includes("washington")
  );
}

function classifyLocation(name: string): "pa" | "wa" | "unknown" {
  const lower = name.toLowerCase();
  if (lower.includes(" pa") || lower.includes("pennsylvania") || lower.includes("east coast")) {
    return "pa";
  }
  if (lower.includes(" wa") || lower.includes("washington") || lower.includes("west coast")) {
    return "wa";
  }
  return "unknown";
}

function isGummyTwelvePack(title: string, sku: string): boolean {
  const text = `${title} ${sku}`.toLowerCase();
  const isGummy = /gummy|all american|usa.*gumm/i.test(text);
  const isTwelve = /12|twelve|12-pack|12 pack|12pk/.test(text);
  return isGummy && (isTwelve || !/sample|sticker|display|gift card/.test(text));
}

async function fetchShopifyFulfilledTotals(asOf: string): Promise<{
  totals: ShopifyFulfillmentTotals;
  error: string | null;
}> {
  if (!shopifyToken() || !shopifyDomain()) {
    return {
      totals: { pa: 0, wa: 0, unassigned: 0, total: 0 },
      error: "Shopify Admin API not configured",
    };
  }

  try {
    const domain = shopifyDomain().replace(/^https?:\/\//, "").replace(/\/$/, "");
    const endpoint = `https://${domain}/admin/api/2024-10/graphql.json`;
    const queryFilter = `created_at:>=${asOf} fulfillment_status:fulfilled`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": shopifyToken(),
      },
      body: JSON.stringify({
        query: `
          query($query: String!) {
            orders(first: 250, query: $query, sortKey: CREATED_AT, reverse: true) {
              edges {
                node {
                  name
                  displayFulfillmentStatus
                  lineItems(first: 50) {
                    edges {
                      node {
                        quantity
                        title
                        sku
                      }
                    }
                  }
                  fulfillments(first: 20) {
                    nodes {
                      createdAt
                      status
                      location { name }
                      fulfillmentLineItems(first: 50) {
                        edges {
                          node {
                            quantity
                            lineItem {
                              title
                              sku
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        variables: { query: queryFilter },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        totals: { pa: 0, wa: 0, unassigned: 0, total: 0 },
        error: `Shopify query failed (${res.status}): ${text.slice(0, 180)}`,
      };
    }

    const json = await res.json();
    const edges = json.data?.orders?.edges || [];
    const totals: ShopifyFulfillmentTotals = {
      pa: 0,
      wa: 0,
      unassigned: 0,
      total: 0,
    };

    for (const edge of edges) {
      const node = edge.node || {};
      const fulfillments = node.fulfillments?.nodes || [];

      if (Array.isArray(fulfillments) && fulfillments.length > 0) {
        for (const fulfillment of fulfillments) {
          const fulfillmentItems = fulfillment.fulfillmentLineItems?.edges || [];
          let qty = 0;
          for (const itemEdge of fulfillmentItems) {
            const fli = itemEdge.node || {};
            const lineItem = fli.lineItem || {};
            const title = String(lineItem.title || "");
            const sku = String(lineItem.sku || "");
            const quantity = Number(fli.quantity || 0);
            if (quantity > 0 && isGummyTwelvePack(title, sku)) {
              qty += quantity;
            }
          }
          if (qty <= 0) continue;

          const locationName = String(fulfillment.location?.name || "");
          const location = classifyLocation(locationName);
          if (location === "pa") totals.pa += qty;
          else if (location === "wa") totals.wa += qty;
          else totals.unassigned += qty;
        }
        continue;
      }

      const status = String(node.displayFulfillmentStatus || "").toLowerCase();
      if (!status.includes("fulfilled")) continue;
      const lineItems = node.lineItems?.edges || [];
      let qty = 0;
      for (const liEdge of lineItems) {
        const li = liEdge.node || {};
        const title = String(li.title || "");
        const sku = String(li.sku || "");
        const quantity = Number(li.quantity || 0);
        if (quantity > 0 && isGummyTwelvePack(title, sku)) {
          qty += quantity;
        }
      }
      if (qty > 0) totals.unassigned += qty;
    }

    totals.total = totals.pa + totals.wa + totals.unassigned;
    return { totals, error: null };
  } catch (err) {
    return {
      totals: { pa: 0, wa: 0, unassigned: 0, total: 0 },
      error: "Internal server error",
    };
  }
}

function allocateUnassignedToLocations(
  baseline: HomeStockBaseline,
  totals: ShopifyFulfillmentTotals,
): { paUsed: number; waUsed: number } {
  let paUsed = totals.pa;
  let waUsed = totals.wa;
  let unassigned = totals.unassigned;

  while (unassigned > 0) {
    const paRemaining = baseline.pa - paUsed;
    const waRemaining = baseline.wa - waUsed;
    if (paRemaining <= 0 && waRemaining <= 0) break;

    if (paRemaining >= waRemaining) paUsed += 1;
    else waUsed += 1;
    unassigned -= 1;
  }

  return { paUsed, waUsed };
}

function daysSince(dateStr: string): number {
  const ts = Date.parse(dateStr);
  if (!Number.isFinite(ts)) return 1;
  const days = Math.floor((Date.now() - ts) / 86400000);
  return Math.max(1, days);
}

function buildHomeStockItems(
  baseline: HomeStockBaseline,
  totals: ShopifyFulfillmentTotals,
): { rows: InventoryItem[]; rollup: HomeStockRollup } {
  const { paUsed, waUsed } = allocateUnassignedToLocations(baseline, totals);
  const paCurrent = Math.max(0, baseline.pa - paUsed);
  const waCurrent = Math.max(0, baseline.wa - waUsed);
  const sinceDays = daysSince(baseline.asOf);
  const paVelocity = round2(paUsed / sinceDays);
  const waVelocity = round2(waUsed / sinceDays);

  const paDaysOfSupply = paVelocity > 0 ? round2(paCurrent / paVelocity) : 999;
  const waDaysOfSupply = waVelocity > 0 ? round2(waCurrent / waVelocity) : 999;

  const paRow: InventoryItem = {
    id: "home-stock-pa",
    sku: "USA-GUMMY-12PK",
    productName: "All American Gummy Bears (12-pack)",
    currentStock: paCurrent,
    reorderPoint: 24,
    reorderQty: 48,
    daysOfSupply: paDaysOfSupply,
    dailyVelocity: paVelocity,
    status: calcStatus(paCurrent, 24, paDaysOfSupply),
    location: "PA Home Stock",
    lastUpdated: new Date().toISOString(),
    costPerUnit: 0,
    totalValue: 0,
    source: "home-baseline",
    purchaseBudget: null,
  };

  const waRow: InventoryItem = {
    id: "home-stock-wa",
    sku: "USA-GUMMY-12PK",
    productName: "All American Gummy Bears (12-pack)",
    currentStock: waCurrent,
    reorderPoint: 18,
    reorderQty: 36,
    daysOfSupply: waDaysOfSupply,
    dailyVelocity: waVelocity,
    status: calcStatus(waCurrent, 18, waDaysOfSupply),
    location: "WA Home Stock",
    lastUpdated: new Date().toISOString(),
    costPerUnit: 0,
    totalValue: 0,
    source: "home-baseline",
    purchaseBudget: null,
  };

  return {
    rows: [paRow, waRow],
    rollup: {
      baseline,
      fulfilledSinceBaseline: {
        pa: paUsed,
        wa: waUsed,
        unassigned: totals.unassigned,
        total: totals.total,
      },
      current: {
        pa: paCurrent,
        wa: waCurrent,
        total: paCurrent + waCurrent,
      },
      derivedAt: new Date().toISOString(),
      source: totals.total > 0 ? "shopify-orders" : "baseline-only",
    },
  };
}

async function fetchAmazonFBAItem(): Promise<{
  item: InventoryItem | null;
  status: AmazonFbaStatus;
}> {
  if (!isAmazonConfigured()) {
    return {
      item: null,
      status: {
        error: "Amazon SP-API not configured",
        errorAt: new Date().toISOString(),
        lastSuccessfulFetch: null,
      },
    };
  }

  const fba = await fetchFBAInventory();
  const summaries = fba.items || [];

  // --- FBA Inventory API succeeded ---
  if (summaries.length > 0) {
    let fulfillable = 0;
    let totalQuantity = 0;
    let lastUpdatedTime = "";
    let productName = "All American Gummy Bears";

    for (const inv of summaries) {
      const d = inv.inventoryDetails;
      fulfillable += d?.fulfillableQuantity || 0;
      totalQuantity += inv.totalQuantity || 0;
      if (inv.lastUpdatedTime) lastUpdatedTime = inv.lastUpdatedTime;
      if (inv.productName) productName = inv.productName;
    }

    const kpis = await getCachedKPIs<AmazonKPIs>();
    const unitsOrdered30d =
      (kpis?.dailyBreakdown || []).reduce((sum, row) => sum + (row.orders || 0), 0) || 0;
    const velocity = unitsOrdered30d > 0 ? round2(unitsOrdered30d / 30) : 2.5;
    const daysOfSupply = velocity > 0 ? round2(fulfillable / velocity) : 999;

    return {
      item: {
        id: "amazon-fba-live",
        sku: "USA-GUMMY-7.5OZ",
        productName,
        currentStock: totalQuantity,
        reorderPoint: 50,
        reorderQty: 100,
        daysOfSupply,
        dailyVelocity: velocity,
        status: calcStatus(totalQuantity, 50, daysOfSupply),
        location: "Amazon FBA",
        lastUpdated: lastUpdatedTime || new Date().toISOString(),
        costPerUnit: 0,
        totalValue: 0,
        source: "amazon-api",
        purchaseBudget: null,
      },
      status: {
        error: fba.error,
        errorAt: fba.errorAt,
        lastSuccessfulFetch: fba.lastSuccessfulFetch,
      },
    };
  }

  // --- FBA Inventory API failed — fall back to Orders API ---
  // The Orders API works even with a Draft SP-API app and gives us
  // real velocity, units, and revenue data.
  try {
    console.log("[inventory] FBA Inventory API failed, falling back to Orders API");
    const orderStats = await fetchAmazonOrderStats(60);
    const velocity = orderStats.dailyVelocity;

    // We don't know exact current FBA stock from Orders API,
    // but we can show the order-derived item with velocity data
    // so the dashboard isn't empty.
    return {
      item: {
        id: "amazon-fba-orders",
        sku: "USA-GUMMY-7.5OZ",
        productName: "All American Gummy Bears (Amazon FBA)",
        currentStock: 0, // Unknown — FBA inventory API blocked
        reorderPoint: 50,
        reorderQty: 100,
        daysOfSupply: 0,
        dailyVelocity: velocity,
        status: "healthy", // We're selling, just can't read stock level
        location: "Amazon FBA",
        lastUpdated: new Date().toISOString(),
        costPerUnit: 0,
        totalValue: 0,
        source: "amazon-api",
        purchaseBudget: null,
      },
      status: {
        error: fba.error,
        errorAt: fba.errorAt,
        lastSuccessfulFetch: fba.lastSuccessfulFetch,
        orderStats,
      },
    };
  } catch (orderErr) {
    console.error("[inventory] Orders API fallback also failed:", orderErr);
    return {
      item: null,
      status: {
        error: fba.error || "No FBA inventory rows returned",
        errorAt: fba.errorAt || new Date().toISOString(),
        lastSuccessfulFetch: fba.lastSuccessfulFetch,
      },
    };
  }
}

function emptyResponse(error?: string): InventoryResponse {
  const baseline = {
    ...DEFAULT_HOME_BASELINE,
    updatedAt: new Date().toISOString(),
  };
  return {
    items: [],
    summary: {
      totalSKUs: 0,
      totalUnits: 0,
      totalValue: 0,
      healthyCounts: 0,
      lowCounts: 0,
      criticalCounts: 0,
      outOfStockCounts: 0,
      avgDaysOfSupply: 0,
    },
    homeStock: {
      baseline,
      fulfilledSinceBaseline: { pa: 0, wa: 0, unassigned: 0, total: 0 },
      current: { pa: baseline.pa, wa: baseline.wa, total: baseline.pa + baseline.wa },
      derivedAt: new Date().toISOString(),
      source: "baseline-only",
      ...(error ? { error } : {}),
    },
    amazonFba: {
      error: null,
      errorAt: null,
      lastSuccessfulFetch: null,
    },
    generatedAt: new Date().toISOString(),
    budget: null,
    ...(error ? { error } : {}),
  };
}

type ShopifyVariantSeed = {
  variantId: string;
  sku: string;
  productTitle: string;
  variantTitle: string;
  price: number;
  barcode: string;
};

async function fetchShopifyVariants(): Promise<ShopifyVariantSeed[]> {
  if (!shopifyToken() || !shopifyDomain()) return [];
  const domain = shopifyDomain().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const endpoint = `https://${domain}/admin/api/2024-10/graphql.json`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": shopifyToken(),
    },
    body: JSON.stringify({
      query: `
        query {
          products(first: 100, sortKey: UPDATED_AT, reverse: true) {
            edges {
              node {
                title
                variants(first: 100) {
                  edges {
                    node {
                      id
                      title
                      sku
                      barcode
                      price
                    }
                  }
                }
              }
            }
          }
        }
      `,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) return [];
  const json = await res.json();
  const products = json.data?.products?.edges || [];
  const output: ShopifyVariantSeed[] = [];

  for (const pEdge of products) {
    const product = pEdge.node || {};
    const productTitle = String(product.title || "Product");
    const variants = product.variants?.edges || [];
    for (const vEdge of variants) {
      const v = vEdge.node || {};
      output.push({
        variantId: String(v.id || ""),
        sku: String(v.sku || ""),
        productTitle,
        variantTitle: String(v.title || ""),
        price: Number(v.price || 0),
        barcode: String(v.barcode || ""),
      });
    }
  }

  return output.filter((row) => row.variantId);
}

async function seedSkuRegistryFromShopify() {
  const [existingRows, variants] = await Promise.all([
    queryDatabase(DB.SKU_REGISTRY),
    fetchShopifyVariants(),
  ]);

  const existingVariantIds = new Set<string>();
  for (const row of existingRows || []) {
    const props = (row.properties || {}) as Record<string, unknown>;
    const candidate =
      extractText(props["Shopify Variant ID"]) ||
      extractText(props["Variant ID"]) ||
      extractText(props["variant_id"]);
    if (candidate) existingVariantIds.add(candidate);
  }

  let created = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const variant of variants) {
    if (existingVariantIds.has(variant.variantId)) {
      skipped += 1;
      continue;
    }

    const title =
      variant.variantTitle && variant.variantTitle !== "Default Title"
        ? `${variant.productTitle} — ${variant.variantTitle}`
        : variant.productTitle;

    const page =
      (await createPage(DB.SKU_REGISTRY, {
        Name: NotionProp.title(title),
        SKU: NotionProp.richText(variant.sku || "UNKNOWN"),
        "Shopify Variant ID": NotionProp.richText(variant.variantId),
        "Current Price": NotionProp.number(variant.price || 0),
        Barcode: NotionProp.richText(variant.barcode || ""),
        "Cost Per Unit": NotionProp.number(0),
      })) ||
      (await createPage(DB.SKU_REGISTRY, {
        Name: NotionProp.title(title),
      }));

    if (page) {
      created += 1;
    } else {
      failures.push(title);
    }
  }

  return {
    created,
    skipped,
    failed: failures.length,
    failures: failures.slice(0, 25),
    scannedVariants: variants.length,
    generatedAt: new Date().toISOString(),
  };
}

export async function GET(req: Request) {
  const forceRefresh = new URL(req.url).searchParams.get("force") === "1";
  const cached = await readState<CacheEnvelope<InventoryResponse> | null>(
    "inventory-cache",
    null,
  );
  if (!forceRefresh && cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    const baseline = await readState<HomeStockBaseline>(
      "home-stock-baseline",
      {
        ...DEFAULT_HOME_BASELINE,
        updatedAt: new Date().toISOString(),
      },
    );

    const [notionPages, amazonFba, shopifyFulfilled] = await Promise.all([
      queryDatabase(DB.INVENTORY).catch(() => [] as Record<string, unknown>[]),
      fetchAmazonFBAItem(),
      fetchShopifyFulfilledTotals(baseline.asOf),
    ]);

    const notionItems = (notionPages || [])
      .filter((page) => {
        const props = page.properties as Record<string, unknown>;
        const loc = (
          extractText(props["Location"]) ||
          extractText(props["Item"]) ||
          extractText(props["Name"]) ||
          ""
        ).toLowerCase();
        // Exclude Amazon rows (handled by SP-API)
        if (loc.includes("amazon")) return false;
        // Exclude home-stock rows (handled by baseline system)
        if (looksLikeHomeStockRow(loc)) return false;
        return true;
      })
      .map(parseNotionItem);

    const { rows: homeRows, rollup } = buildHomeStockItems(
      baseline,
      shopifyFulfilled.totals,
    );
    if (shopifyFulfilled.error) {
      rollup.error = shopifyFulfilled.error;
    }

    const items: InventoryItem[] = [
      ...homeRows,
      ...notionItems,
      ...(amazonFba.item ? [amazonFba.item] : []),
    ];

    const statusOrder: Record<string, number> = {
      critical: 0,
      low: 1,
      "out-of-stock": 2,
      healthy: 3,
    };
    items.sort((a, b) => (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4));

    const totalUnits = items.reduce((sum, i) => sum + i.currentStock, 0);
    const totalValue = items.reduce((sum, i) => sum + i.totalValue, 0);
    const itemsWithSupply = items.filter((i) => i.daysOfSupply > 0 && i.daysOfSupply < 999);
    const avgDaysOfSupply =
      itemsWithSupply.length > 0
        ? round2(itemsWithSupply.reduce((sum, i) => sum + i.daysOfSupply, 0) / itemsWithSupply.length)
        : 0;

    const result: InventoryResponse = {
      items,
      summary: {
        totalSKUs: items.length,
        totalUnits,
        totalValue: round2(totalValue),
        healthyCounts: items.filter((i) => i.status === "healthy").length,
        lowCounts: items.filter((i) => i.status === "low").length,
        criticalCounts: items.filter((i) => i.status === "critical").length,
        outOfStockCounts: items.filter((i) => i.status === "out-of-stock").length,
        avgDaysOfSupply,
      },
      homeStock: rollup,
      amazonFba: amazonFba.status,
      generatedAt: new Date().toISOString(),
      budget: null,
    };

    await writeState("inventory-cache", {
      data: result,
      cachedAt: Date.now(),
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[inventory] Failed:", err);
    return NextResponse.json(
      emptyResponse("Internal server error"),
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    if (body.action !== "seed-sku-registry") {
      return NextResponse.json(
        { error: "Unsupported action. Use { action: \"seed-sku-registry\" }" },
        { status: 400 },
      );
    }

    const result = await seedSkuRegistryFromShopify();
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
