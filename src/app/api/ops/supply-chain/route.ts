/**
 * GET /api/ops/supply-chain — Production status, supplier timelines, cost trends
 *
 * Aggregates supply chain data from:
 *   - Notion Inventory DB (stock levels)
 *   - Notion SKU Registry (cost data, supplier info)
 *   - State storage (production orders, repack status)
 *
 * Returns structured data for the Supply Chain page.
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

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Supplier = {
  name: string;
  product: string;
  leadTimeDays: number;
  minOrderQty: number;
  costPerUnit: number;
  paymentTerms: string;
  lastOrderDate: string;
  nextOrderDue: string | null;
  status: "active" | "pending" | "inactive";
};

type ProductionOrder = {
  id: string;
  product: string;
  quantity: number;
  supplier: string;
  status: "ordered" | "in-production" | "shipped" | "received" | "complete";
  orderDate: string;
  expectedDate: string;
  actualDate: string | null;
  cost: number;
  notes: string;
};

type CostTrend = {
  sku: string;
  productName: string;
  currentCost: number;
  previousCost: number;
  changePct: number;
  trend: "up" | "down" | "flat";
};

type SupplyChainAlert = {
  type: "reorder" | "payment-due" | "delivery-expected" | "low-stock";
  severity: "critical" | "warning" | "info";
  message: string;
  dueDate: string | null;
  relatedItem: string;
};

type SupplyChainResponse = {
  suppliers: Supplier[];
  productionOrders: ProductionOrder[];
  costTrends: CostTrend[];
  alerts: SupplyChainAlert[];
  summary: {
    activeSuppliers: number;
    openOrders: number;
    totalOpenOrderValue: number;
    avgLeadTimeDays: number;
  };
  generatedAt: string;
  /** Budget-ready: null until post-funding */
  budget: null;
};

// ---------------------------------------------------------------------------
// SKU Registry → Suppliers + Cost data
// ---------------------------------------------------------------------------

function parseSupplier(page: Record<string, unknown>): Supplier | null {
  const props = page.properties as Record<string, unknown>;

  const name =
    extractText(props["Supplier"]) ||
    extractText(props["Vendor"]) ||
    extractText(props["Manufacturer"]) ||
    "";
  if (!name) return null;

  const product =
    extractText(props["Product Name"]) ||
    extractText(props["Name"]) ||
    extractText(props["SKU"]) ||
    "";
  const leadTimeDays =
    extractNumber(props["Lead Time Days"]) ||
    extractNumber(props["Lead Time"]) ||
    14;
  const minOrderQty =
    extractNumber(props["MOQ"]) ||
    extractNumber(props["Min Order Qty"]) ||
    0;
  const costPerUnit =
    extractNumber(props["Cost Per Unit"]) ||
    extractNumber(props["Unit Cost"]) ||
    0;
  const paymentTerms =
    extractText(props["Payment Terms"]) ||
    extractText(props["Terms"]) ||
    "Net 30";
  const lastOrderDate =
    extractDate(props["Last Order Date"]) ||
    extractDate(props["Last Ordered"]) ||
    "";
  const status =
    extractText(props["Status"]) ||
    extractText(props["Supplier Status"]) ||
    "active";

  // Calculate next order due based on inventory velocity
  let nextOrderDue: string | null = null;
  const daysOfSupply = extractNumber(props["Days of Supply"]);
  if (daysOfSupply > 0 && daysOfSupply < 30) {
    const reorderIn = Math.max(0, daysOfSupply - leadTimeDays);
    const date = new Date();
    date.setDate(date.getDate() + reorderIn);
    nextOrderDue = date.toISOString().slice(0, 10);
  }

  return {
    name,
    product,
    leadTimeDays,
    minOrderQty,
    costPerUnit,
    paymentTerms,
    lastOrderDate,
    nextOrderDue,
    status: status.toLowerCase().includes("active")
      ? "active"
      : status.toLowerCase().includes("pending")
        ? "pending"
        : "inactive",
  };
}

// ---------------------------------------------------------------------------
// Production orders from state storage
// ---------------------------------------------------------------------------

async function getProductionOrders(): Promise<ProductionOrder[]> {
  const orders = await readState<ProductionOrder[]>(
    "supply-chain-orders",
    [],
  );
  return orders;
}

// ---------------------------------------------------------------------------
// Cost trends from SKU Registry
// ---------------------------------------------------------------------------

function buildCostTrend(page: Record<string, unknown>): CostTrend | null {
  const props = page.properties as Record<string, unknown>;

  const sku = extractText(props["SKU"]) || extractText(props["Name"]) || "";
  const productName =
    extractText(props["Product Name"]) || extractText(props["Name"]) || sku;
  const currentCost =
    extractNumber(props["Cost Per Unit"]) ||
    extractNumber(props["Unit Cost"]) ||
    0;
  const previousCost =
    extractNumber(props["Previous Cost"]) ||
    extractNumber(props["Last Cost"]) ||
    currentCost;

  if (currentCost <= 0) return null;

  const changePct =
    previousCost > 0
      ? Math.round(((currentCost - previousCost) / previousCost) * 1000) / 10
      : 0;

  return {
    sku,
    productName,
    currentCost,
    previousCost,
    changePct,
    trend:
      changePct > 1 ? "up" : changePct < -1 ? "down" : "flat",
  };
}

// ---------------------------------------------------------------------------
// Generate alerts
// ---------------------------------------------------------------------------

function generateAlerts(
  suppliers: Supplier[],
  productionOrders: ProductionOrder[],
): SupplyChainAlert[] {
  const alerts: SupplyChainAlert[] = [];
  const now = Date.now();

  // Suppliers with upcoming reorder dates
  for (const s of suppliers) {
    if (s.nextOrderDue) {
      const dueDate = new Date(s.nextOrderDue).getTime();
      const daysUntil = Math.round((dueDate - now) / (1000 * 60 * 60 * 24));

      if (daysUntil <= 0) {
        alerts.push({
          type: "reorder",
          severity: "critical",
          message: `Reorder overdue for ${s.product} from ${s.name}`,
          dueDate: s.nextOrderDue,
          relatedItem: s.product,
        });
      } else if (daysUntil <= 7) {
        alerts.push({
          type: "reorder",
          severity: "warning",
          message: `Reorder needed in ${daysUntil} days: ${s.product} from ${s.name}`,
          dueDate: s.nextOrderDue,
          relatedItem: s.product,
        });
      }
    }
  }

  // Production orders expected soon
  for (const o of productionOrders) {
    if (
      o.status === "shipped" ||
      o.status === "in-production" ||
      o.status === "ordered"
    ) {
      const expectedDate = new Date(o.expectedDate).getTime();
      const daysUntil = Math.round(
        (expectedDate - now) / (1000 * 60 * 60 * 24),
      );

      if (daysUntil <= 0) {
        alerts.push({
          type: "delivery-expected",
          severity: "warning",
          message: `Delivery overdue: ${o.quantity} units of ${o.product} from ${o.supplier}`,
          dueDate: o.expectedDate,
          relatedItem: o.product,
        });
      } else if (daysUntil <= 3) {
        alerts.push({
          type: "delivery-expected",
          severity: "info",
          message: `Delivery expected in ${daysUntil} days: ${o.quantity} units of ${o.product}`,
          dueDate: o.expectedDate,
          relatedItem: o.product,
        });
      }
    }
  }

  // Sort: critical first
  const severityOrder: Record<string, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  alerts.sort(
    (a, b) =>
      (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3),
  );

  return alerts;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET() {
  // Check cache
  const cached = await readState<CacheEnvelope<SupplyChainResponse> | null>(
    "supply-chain-cache",
    null,
  );
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    // Parallel fetch
    const [skuPages, productionOrders] = await Promise.all([
      queryDatabase(DB.SKU_REGISTRY),
      getProductionOrders(),
    ]);

    // Parse suppliers from SKU registry
    const suppliers: Supplier[] = [];
    const costTrends: CostTrend[] = [];
    const seenSuppliers = new Set<string>();

    if (skuPages) {
      for (const page of skuPages) {
        // Supplier
        const supplier = parseSupplier(page);
        if (supplier && !seenSuppliers.has(supplier.name)) {
          suppliers.push(supplier);
          seenSuppliers.add(supplier.name);
        }

        // Cost trend
        const trend = buildCostTrend(page);
        if (trend) costTrends.push(trend);
      }
    }

    // Generate alerts
    const alerts = generateAlerts(suppliers, productionOrders);

    // Summary
    const activeSuppliers = suppliers.filter(
      (s) => s.status === "active",
    ).length;
    const openOrders = productionOrders.filter(
      (o) => o.status !== "complete" && o.status !== "received",
    );
    const totalOpenOrderValue = openOrders.reduce(
      (sum, o) => sum + o.cost,
      0,
    );
    const avgLeadTimeDays =
      suppliers.length > 0
        ? Math.round(
            (suppliers.reduce((sum, s) => sum + s.leadTimeDays, 0) /
              suppliers.length) *
              10,
          ) / 10
        : 0;

    const result: SupplyChainResponse = {
      suppliers,
      productionOrders,
      costTrends,
      alerts,
      summary: {
        activeSuppliers,
        openOrders: openOrders.length,
        totalOpenOrderValue: Math.round(totalOpenOrderValue * 100) / 100,
        avgLeadTimeDays,
      },
      generatedAt: new Date().toISOString(),
      budget: null,
    };

    // Cache
    await writeState("supply-chain-cache", {
      data: result,
      cachedAt: Date.now(),
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[supply-chain] Failed:", err);
    return NextResponse.json(
      {
        suppliers: [],
        productionOrders: [],
        costTrends: [],
        alerts: [],
        summary: {
          activeSuppliers: 0,
          openOrders: 0,
          totalOpenOrderValue: 0,
          avgLeadTimeDays: 0,
        },
        generatedAt: new Date().toISOString(),
        budget: null,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
