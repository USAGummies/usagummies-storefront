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
import { isCronAuthorized } from "@/lib/ops/abra-auth";
import type { CacheEnvelope } from "@/lib/amazon/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

type InventorySignal = {
  sku: string;
  productName: string;
  unitsOnHand: number;
  reorderPoint: number;
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
// Known suppliers — ensures dashboard never shows 0 even if Notion is sparse
// ---------------------------------------------------------------------------

const KNOWN_SUPPLIERS: Supplier[] = [
  {
    name: "Powers Confections",
    product: "All American Gummy Bears (co-packer)",
    leadTimeDays: 21,
    minOrderQty: 10000,
    costPerUnit: 3.25,
    paymentTerms: "50% deposit, 50% on delivery",
    lastOrderDate: "2025-09-01",
    nextOrderDue: null,
    status: "active",
  },
  {
    name: "Albanese Confectionery",
    product: "Gummy bear base (ingredient supplier)",
    leadTimeDays: 14,
    minOrderQty: 500,
    costPerUnit: 1.80,
    paymentTerms: "Net 30",
    lastOrderDate: "2025-08-15",
    nextOrderDue: null,
    status: "active",
  },
];

// Default production orders — seeded with real planned runs
const DEFAULT_PRODUCTION_ORDERS: ProductionOrder[] = [
  {
    id: "PO-2025-001",
    product: "All American Gummy Bears (12-pack)",
    quantity: 1800,
    supplier: "Powers Confections",
    status: "complete",
    orderDate: "2025-07-15",
    expectedDate: "2025-09-01",
    actualDate: "2025-09-05",
    cost: 5850,
    notes: "First production run — 1,800 units received",
  },
  {
    id: "PO-2026-001",
    product: "All American Gummy Bears (12-pack)",
    quantity: 50000,
    supplier: "Powers Confections",
    status: "ordered",
    orderDate: "2026-03-10",
    expectedDate: "2026-05-15",
    actualDate: null,
    cost: 162500,
    notes: "Scale-up production run — 50K units. Quote confirmed with Powers.",
  },
];

// ---------------------------------------------------------------------------
// Production orders from state storage
// ---------------------------------------------------------------------------

async function getProductionOrders(): Promise<ProductionOrder[]> {
  const orders = await readState<ProductionOrder[]>(
    "supply-chain-orders",
    DEFAULT_PRODUCTION_ORDERS,
  );
  return orders.length > 0 ? orders : DEFAULT_PRODUCTION_ORDERS;
}

// ---------------------------------------------------------------------------
// Cost trends from SKU Registry
// ---------------------------------------------------------------------------

function buildCostTrend(page: Record<string, unknown>): CostTrend | null {
  const props = page.properties as Record<string, unknown>;

  const sku =
    extractText(props["SKU"]) ||
    extractText(props["ASIN"]) ||
    extractText(props["Shopify Handle"]) ||
    extractText(props["Name"]) ||
    "";
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

function parseInventorySignal(page: Record<string, unknown>): InventorySignal | null {
  const props = page.properties as Record<string, unknown>;
  const sku = extractText(props["SKU"]) || extractText(props["Item"]) || "";
  const productName =
    extractText(props["Item"]) ||
    extractText(props["Product Name"]) ||
    sku;
  const unitsOnHand =
    extractNumber(props["Units on Hand"]) ||
    extractNumber(props["Current Stock"]) ||
    0;
  const reorderPoint =
    extractNumber(props["Reorder Point"]) ||
    extractNumber(props["Min Stock"]) ||
    0;

  if (!productName) return null;

  return {
    sku,
    productName,
    unitsOnHand,
    reorderPoint,
  };
}

function generateAlerts(
  suppliers: Supplier[],
  productionOrders: ProductionOrder[],
  inventorySignals: InventorySignal[],
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

  // Inventory low-stock / out-of-stock alerts
  for (const inv of inventorySignals) {
    if (inv.unitsOnHand <= 0) {
      alerts.push({
        type: "low-stock",
        severity: "critical",
        message: `${inv.productName} is out of stock`,
        dueDate: null,
        relatedItem: inv.sku || inv.productName,
      });
      continue;
    }
    if (inv.reorderPoint > 0 && inv.unitsOnHand <= inv.reorderPoint) {
      const severity = inv.unitsOnHand <= inv.reorderPoint * 0.5
        ? "critical"
        : "warning";
      alerts.push({
        type: "low-stock",
        severity,
        message: `${inv.productName} is below reorder point (${inv.unitsOnHand} on hand)`,
        dueDate: null,
        relatedItem: inv.sku || inv.productName,
      });
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
    const [skuPages, inventoryPages, productionOrders] = await Promise.all([
      queryDatabase(DB.SKU_REGISTRY),
      queryDatabase(DB.INVENTORY),
      getProductionOrders(),
    ]);

    // Parse suppliers from SKU registry + merge with known suppliers
    const suppliers: Supplier[] = [];
    const costTrends: CostTrend[] = [];
    const seenSuppliers = new Set<string>();

    // Seed with known suppliers first
    for (const known of KNOWN_SUPPLIERS) {
      suppliers.push(known);
      seenSuppliers.add(known.name);
    }

    if (skuPages) {
      for (const page of skuPages) {
        // Supplier (skip if already seeded)
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

    const inventorySignals: InventorySignal[] = [];
    if (inventoryPages) {
      for (const page of inventoryPages) {
        const signal = parseInventorySignal(page);
        if (signal) inventorySignals.push(signal);
      }
    }

    // Generate alerts
    const alerts = generateAlerts(suppliers, productionOrders, inventorySignals);

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
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST — manage production orders (add, update status)
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: "add" | "update" | "seed";
    order?: Partial<ProductionOrder>;
    orderId?: string;
    status?: ProductionOrder["status"];
  };

  const orders = await readState<ProductionOrder[]>(
    "supply-chain-orders",
    DEFAULT_PRODUCTION_ORDERS,
  );

  if (body.action === "seed") {
    await writeState("supply-chain-orders", DEFAULT_PRODUCTION_ORDERS);
    // Bust cache
    await writeState("supply-chain-cache", null);
    return NextResponse.json({
      ok: true,
      message: "Supply chain orders seeded with defaults",
      count: DEFAULT_PRODUCTION_ORDERS.length,
    });
  }

  if (body.action === "add" && body.order) {
    const newOrder: ProductionOrder = {
      id: body.order.id || `PO-${Date.now()}`,
      product: body.order.product || "All American Gummy Bears (12-pack)",
      quantity: body.order.quantity || 0,
      supplier: body.order.supplier || "Unknown",
      status: body.order.status || "ordered",
      orderDate: body.order.orderDate || new Date().toISOString().slice(0, 10),
      expectedDate: body.order.expectedDate || "",
      actualDate: body.order.actualDate || null,
      cost: body.order.cost || 0,
      notes: body.order.notes || "",
    };
    orders.push(newOrder);
    await writeState("supply-chain-orders", orders);
    await writeState("supply-chain-cache", null);
    return NextResponse.json({ ok: true, order: newOrder });
  }

  if (body.action === "update" && body.orderId) {
    const idx = orders.findIndex((o) => o.id === body.orderId);
    if (idx === -1) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (body.status) orders[idx].status = body.status;
    if (body.order) {
      Object.assign(orders[idx], body.order);
    }
    await writeState("supply-chain-orders", orders);
    await writeState("supply-chain-cache", null);
    return NextResponse.json({ ok: true, order: orders[idx] });
  }

  return NextResponse.json(
    { error: "Invalid action. Use: seed, add, update" },
    { status: 400 },
  );
}
