/**
 * GET /api/ops/inventory — SKU-level stock & reorder points
 *
 * Queries the Notion Inventory database for current stock levels,
 * reorder points, days of supply, and status badges.
 *
 * Returns structured inventory data for the Supply Chain page.
 *
 * Protected by middleware (requires JWT session).
 */

import { NextResponse } from "next/server";
import {
  queryDatabase,
  extractText,
  extractNumber,
  extractDate,
  DB,
} from "@/lib/notion/client";
import { readState, writeState } from "@/lib/ops/state";
import type { CacheEnvelope } from "@/lib/amazon/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  /** Budget-ready: null until post-funding inventory budget is set */
  purchaseBudget: number | null;
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
  generatedAt: string;
  /** Budget-ready: null until post-funding */
  budget: null;
};

// ---------------------------------------------------------------------------
// Notion → InventoryItem mapper
// ---------------------------------------------------------------------------

function parseInventoryItem(page: Record<string, unknown>): InventoryItem {
  const props = page.properties as Record<string, unknown>;

  const sku =
    extractText(props["SKU"]) ||
    extractText(props["SKU Code"]) ||
    extractText(props["Name"]) ||
    "";
  const productName =
    extractText(props["Product Name"]) ||
    extractText(props["Product"]) ||
    extractText(props["Name"]) ||
    sku;
  const currentStock =
    extractNumber(props["Current Stock"]) ||
    extractNumber(props["Quantity"]) ||
    extractNumber(props["Units"]) ||
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
    extractNumber(props["COGS"]) ||
    0;
  const dailyVelocity =
    extractNumber(props["Daily Velocity"]) ||
    extractNumber(props["Units Per Day"]) ||
    0;
  const location =
    extractText(props["Location"]) ||
    extractText(props["Warehouse"]) ||
    "Main";
  const lastUpdated =
    extractDate(props["Last Updated"]) ||
    (page.last_edited_time as string) ||
    "";

  // Calculate days of supply
  const daysOfSupply =
    dailyVelocity > 0
      ? Math.round((currentStock / dailyVelocity) * 10) / 10
      : currentStock > 0
        ? 999
        : 0;

  // Determine status
  let status: InventoryItem["status"] = "healthy";
  if (currentStock <= 0) {
    status = "out-of-stock";
  } else if (reorderPoint > 0 && currentStock <= reorderPoint * 0.5) {
    status = "critical";
  } else if (reorderPoint > 0 && currentStock <= reorderPoint) {
    status = "low";
  } else if (daysOfSupply > 0 && daysOfSupply < 7) {
    status = "critical";
  } else if (daysOfSupply > 0 && daysOfSupply < 14) {
    status = "low";
  }

  return {
    id: page.id as string,
    sku,
    productName,
    currentStock,
    reorderPoint,
    reorderQty,
    daysOfSupply,
    dailyVelocity,
    status,
    location,
    lastUpdated,
    costPerUnit,
    totalValue: Math.round(currentStock * costPerUnit * 100) / 100,
    purchaseBudget: null, // Budget-ready: populated post-funding
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET() {
  // Check cache
  const cached = await readState<CacheEnvelope<InventoryResponse> | null>(
    "inventory-cache",
    null,
  );
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    const pages = await queryDatabase(DB.INVENTORY);

    if (!pages || pages.length === 0) {
      return NextResponse.json({
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
        generatedAt: new Date().toISOString(),
        budget: null,
      } satisfies InventoryResponse);
    }

    const items = pages.map(parseInventoryItem);

    // Sort: critical first, then low, then healthy, then out-of-stock
    const statusOrder: Record<string, number> = {
      critical: 0,
      low: 1,
      "out-of-stock": 2,
      healthy: 3,
    };
    items.sort(
      (a, b) => (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4),
    );

    // Build summary
    const totalUnits = items.reduce((sum, i) => sum + i.currentStock, 0);
    const totalValue = items.reduce((sum, i) => sum + i.totalValue, 0);
    const itemsWithSupply = items.filter(
      (i) => i.daysOfSupply > 0 && i.daysOfSupply < 999,
    );
    const avgDaysOfSupply =
      itemsWithSupply.length > 0
        ? Math.round(
            (itemsWithSupply.reduce((sum, i) => sum + i.daysOfSupply, 0) /
              itemsWithSupply.length) *
              10,
          ) / 10
        : 0;

    const result: InventoryResponse = {
      items,
      summary: {
        totalSKUs: items.length,
        totalUnits,
        totalValue: Math.round(totalValue * 100) / 100,
        healthyCounts: items.filter((i) => i.status === "healthy").length,
        lowCounts: items.filter((i) => i.status === "low").length,
        criticalCounts: items.filter((i) => i.status === "critical").length,
        outOfStockCounts: items.filter((i) => i.status === "out-of-stock")
          .length,
        avgDaysOfSupply,
      },
      generatedAt: new Date().toISOString(),
      budget: null,
    };

    // Cache
    await writeState("inventory-cache", {
      data: result,
      cachedAt: Date.now(),
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[inventory] Failed:", err);
    return NextResponse.json(
      {
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
        generatedAt: new Date().toISOString(),
        budget: null,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
