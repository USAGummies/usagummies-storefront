/**
 * P&L (Profit & Loss) Report Builder — USA Gummies
 *
 * Aggregates revenue, COGS, and operating expenses from:
 *   - Amazon KPIs (existing)
 *   - Shopify finance (existing)
 *   - B2B pipeline (closed-won deals)
 *   - Cash transactions (Notion CASH_TRANSACTIONS DB)
 *   - Amazon fee structure
 *
 * Produces a standard income statement: Revenue → COGS → Gross Profit → OpEx → Net Income
 */

import { readState, writeState } from "@/lib/ops/state";
import { queryDatabase, DB, extractNumber, extractText } from "@/lib/notion/client";
import type { CacheEnvelope, AmazonKPIs } from "@/lib/amazon/types";
import type { PnLReport } from "./types";
import { getCachedKPIs } from "@/lib/amazon/cache";

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startOfMonth(d: Date = new Date()): string {
  return d.toISOString().slice(0, 8) + "01";
}

function daysElapsedInMonth(): number {
  const now = new Date();
  return now.getDate();
}

type InventoryCostSnapshot = {
  costPerUnit: number;
  source: "inventory" | "fallback";
};

function parseInventoryUnits(props: Record<string, unknown>): number {
  return (
    extractNumber(props["Current Stock"]) ||
    extractNumber(props["Quantity"]) ||
    extractNumber(props["Units"]) ||
    0
  );
}

function parseInventoryCost(props: Record<string, unknown>): number {
  return (
    extractNumber(props["Cost Per Unit"]) ||
    extractNumber(props["Unit Cost"]) ||
    extractNumber(props["COGS"]) ||
    0
  );
}

async function getInventoryCostSnapshot(): Promise<InventoryCostSnapshot> {
  try {
    const rows = await queryDatabase(DB.INVENTORY);
    if (!rows || rows.length === 0) {
      return { costPerUnit: 3.5, source: "fallback" };
    }

    let weightedCostTotal = 0;
    let weightedUnitsTotal = 0;
    let simpleCostTotal = 0;
    let simpleCostCount = 0;

    for (const row of rows) {
      const props = (row.properties || {}) as Record<string, unknown>;
      const costPerUnit = parseInventoryCost(props);
      if (costPerUnit <= 0) continue;

      const unitsOnHand = parseInventoryUnits(props);
      simpleCostTotal += costPerUnit;
      simpleCostCount += 1;

      if (unitsOnHand > 0) {
        weightedCostTotal += costPerUnit * unitsOnHand;
        weightedUnitsTotal += unitsOnHand;
      }
    }

    if (weightedUnitsTotal > 0) {
      return {
        costPerUnit: Math.round((weightedCostTotal / weightedUnitsTotal) * 100) / 100,
        source: "inventory",
      };
    }

    if (simpleCostCount > 0) {
      return {
        costPerUnit: Math.round((simpleCostTotal / simpleCostCount) * 100) / 100,
        source: "inventory",
      };
    }
  } catch (err) {
    console.error("[pnl] Inventory cost lookup failed:", err);
  }

  return { costPerUnit: 3.5, source: "fallback" };
}

// ---------------------------------------------------------------------------
// Revenue aggregation
// ---------------------------------------------------------------------------

async function getAmazonRevenue(start: string, end: string): Promise<number> {
  // Try cached KPIs first for current month
  const kpis = await getCachedKPIs<AmazonKPIs>();
  if (kpis) {
    return kpis.revenue.monthToDate || 0;
  }

  // Fallback: query Notion daily performance for historical
  const rows = await queryDatabase(
    DB.DAILY_PERFORMANCE,
    {
      and: [
        { property: "Date", date: { on_or_after: start } },
        { property: "Date", date: { on_or_before: end } },
      ],
    },
    [{ property: "Date", direction: "ascending" }],
  );

  if (!rows) return 0;
  return rows.reduce((sum, row) => {
    const p = (row.properties || {}) as Record<string, unknown>;
    return sum + extractNumber(p["Amazon Revenue"]);
  }, 0);
}

async function getShopifyRevenue(start: string, end: string): Promise<number> {
  // Try Notion daily performance first (historical data)
  const rows = await queryDatabase(
    DB.DAILY_PERFORMANCE,
    {
      and: [
        { property: "Date", date: { on_or_after: start } },
        { property: "Date", date: { on_or_before: end } },
      ],
    },
    [{ property: "Date", direction: "ascending" }],
  );

  if (rows && rows.length > 0) {
    const total = rows.reduce((sum, row) => {
      const p = (row.properties || {}) as Record<string, unknown>;
      return sum + extractNumber(p["Shopify Revenue"]);
    }, 0);
    if (total > 0) return total;
  }

  // Fallback: query Shopify Admin API directly
  return fetchShopifyRevenueDirectly(start, end);
}

/** Direct Shopify Admin API fallback when Notion has no data */
async function fetchShopifyRevenueDirectly(start: string, end: string): Promise<number> {
  const token = process.env.SHOPIFY_ADMIN_TOKEN || "";
  const domain = (
    process.env.SHOPIFY_STORE_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
    ""
  )
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

  if (!token || !domain) {
    console.error("[pnl] Shopify Admin API fallback: no token or domain", { hasToken: !!token, domain });
    return 0;
  }

  try {
    // Use same API version as finance route (2024-10 works, 2025-01 may not)
    const dateFilter = `created_at:>=${start} created_at:<=${end}`;
    const res = await fetch(
      `https://${domain}/admin/api/2024-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({
          query: `query($q:String!){orders(first:250,query:$q){edges{node{totalPriceSet{shopMoney{amount}}}}}}`,
          variables: { q: dateFilter },
        }),
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!res.ok) {
      console.error("[pnl] Shopify Admin API fallback failed:", res.status, await res.text().catch(() => ""));
      return 0;
    }
    const json = await res.json();
    if (json.errors) {
      console.error("[pnl] Shopify GraphQL errors:", JSON.stringify(json.errors));
      return 0;
    }
    const edges = json.data?.orders?.edges || [];
    const total = edges.reduce(
      (sum: number, e: { node: { totalPriceSet: { shopMoney: { amount: string } } } }) =>
        sum + parseFloat(e.node.totalPriceSet?.shopMoney?.amount || "0"),
      0,
    );
    console.log("[pnl] Shopify Admin API fallback:", { orderCount: edges.length, total, dateFilter });
    return total;
  } catch (err) {
    console.error("[pnl] Shopify Admin API fallback exception:", err);
    return 0;
  }
}

async function getWholesaleRevenue(start: string, _end: string): Promise<number> {
  // Query pipeline cache for closed-won deals in this period
  const pipelineCache = await readState<CacheEnvelope<{
    stages: Record<string, { dealValue: number; createdAt: string }[]>;
  }> | null>("pipeline-cache", null);

  if (!pipelineCache?.data?.stages) return 0;

  const closedWon = pipelineCache.data.stages["Closed Won"] || [];
  return closedWon
    .filter((lead) => lead.createdAt >= start)
    .reduce((sum, lead) => sum + (lead.dealValue || 0), 0);
}

// ---------------------------------------------------------------------------
// COGS aggregation
// ---------------------------------------------------------------------------

async function getCOGS(): Promise<{
  productCost: number;
  shipping: number;
  amazonFees: number;
  shopifyFees: number;
}> {
  const kpis = await getCachedKPIs<AmazonKPIs>();
  const inventoryCost = await getInventoryCostSnapshot();

  // Amazon fees from KPI data
  const amazonFees = kpis
    ? (kpis.fees?.totalFee || 0) * daysElapsedInMonth()
    : 0;

  // Product cost estimate: units sold × weighted inventory COGS per unit.
  const unitsSoldMTD = kpis?.unitsSold?.monthToDate || 0;
  const productCost = unitsSoldMTD * inventoryCost.costPerUnit;
  if (inventoryCost.source === "fallback") {
    console.warn("[pnl] Falling back to default COGS ($3.50) — inventory costs unavailable");
  }

  // Shopify transaction fees (~2.9% + $0.30 per transaction)
  const shopifyRevenue = await getShopifyRevenue(
    startOfMonth(),
    new Date().toISOString().slice(0, 10),
  );
  const shopifyFees = shopifyRevenue * 0.029;

  // Shipping (non-FBA) — estimate from cash transactions if available
  const shipping = 0; // Will be populated from cash transactions below

  return {
    productCost: Math.round(productCost * 100) / 100,
    shipping: Math.round(shipping * 100) / 100,
    amazonFees: Math.round(amazonFees * 100) / 100,
    shopifyFees: Math.round(shopifyFees * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// OpEx from Cash Transactions (Notion)
// ---------------------------------------------------------------------------

async function getOpEx(start: string, end: string): Promise<{
  software: number;
  marketing: number;
  payroll: number;
  other: number;
}> {
  const result = { software: 0, marketing: 0, payroll: 0, other: 0 };

  try {
    const rows = await queryDatabase(
      DB.CASH_TRANSACTIONS,
      {
        and: [
          { property: "Date", date: { on_or_after: start } },
          { property: "Date", date: { on_or_before: end } },
          { property: "Category", select: { equals: "Expense" } },
        ],
      },
      [{ property: "Date", direction: "ascending" }],
    );

    if (!rows) return result;

    for (const row of rows) {
      const p = (row.properties || {}) as Record<string, unknown>;
      const amount = Math.abs(extractNumber(p["Amount"]));
      const desc = (extractText(p["Description"]) || "").toLowerCase();

      // Categorize by description keywords
      if (
        desc.includes("shopify") ||
        desc.includes("notion") ||
        desc.includes("vercel") ||
        desc.includes("software") ||
        desc.includes("subscription")
      ) {
        result.software += amount;
      } else if (
        desc.includes("ad") ||
        desc.includes("marketing") ||
        desc.includes("facebook") ||
        desc.includes("google ads") ||
        desc.includes("tiktok")
      ) {
        result.marketing += amount;
      } else if (
        desc.includes("payroll") ||
        desc.includes("salary") ||
        desc.includes("contractor")
      ) {
        result.payroll += amount;
      } else {
        result.other += amount;
      }
    }
  } catch {
    // Cash transactions DB might not exist yet
  }

  return {
    software: Math.round(result.software * 100) / 100,
    marketing: Math.round(result.marketing * 100) / 100,
    payroll: Math.round(result.payroll * 100) / 100,
    other: Math.round(result.other * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// P&L Builder
// ---------------------------------------------------------------------------

export async function buildPnL(
  startDate?: string,
  endDate?: string,
): Promise<PnLReport> {
  const start = startDate || startOfMonth();
  const end = endDate || new Date().toISOString().slice(0, 10);

  // Check cache (only for default MTD period)
  if (!startDate && !endDate) {
    const cached = await readState<CacheEnvelope<PnLReport> | null>(
      "pnl-cache",
      null,
    );
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
      return cached.data;
    }
  }

  // Fetch all data in parallel
  const [amazonRevenue, shopifyRevenue, wholesaleRevenue, cogs, opex] =
    await Promise.all([
      getAmazonRevenue(start, end),
      getShopifyRevenue(start, end),
      getWholesaleRevenue(start, end),
      getCOGS(),
      getOpEx(start, end),
    ]);

  const totalRevenue = amazonRevenue + shopifyRevenue + wholesaleRevenue;
  const totalCOGS =
    cogs.productCost + cogs.shipping + cogs.amazonFees + cogs.shopifyFees;
  const grossProfit = totalRevenue - totalCOGS;
  const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

  const totalOpex = opex.software + opex.marketing + opex.payroll + opex.other;
  const netIncome = grossProfit - totalOpex;
  const netMargin = totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : 0;

  // Label
  const startD = new Date(start);
  const endD = new Date(end);
  const label =
    startD.getMonth() === endD.getMonth() && startD.getFullYear() === endD.getFullYear()
      ? startD.toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : `${startD.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${endD.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  const report: PnLReport = {
    period: { start, end, label },
    revenue: {
      amazon: Math.round(amazonRevenue * 100) / 100,
      shopify: Math.round(shopifyRevenue * 100) / 100,
      wholesale: Math.round(wholesaleRevenue * 100) / 100,
      total: Math.round(totalRevenue * 100) / 100,
    },
    cogs: {
      productCost: cogs.productCost,
      shipping: cogs.shipping,
      amazonFees: cogs.amazonFees,
      shopifyFees: cogs.shopifyFees,
      total: Math.round(totalCOGS * 100) / 100,
    },
    grossProfit: Math.round(grossProfit * 100) / 100,
    grossMargin: Math.round(grossMargin * 10) / 10,
    opex: {
      ...opex,
      total: Math.round(totalOpex * 100) / 100,
    },
    netIncome: Math.round(netIncome * 100) / 100,
    netMargin: Math.round(netMargin * 10) / 10,
    generatedAt: new Date().toISOString(),
  };

  // Cache MTD result
  if (!startDate && !endDate) {
    await writeState("pnl-cache", { data: report, cachedAt: Date.now() });
  }

  return report;
}

export async function buildMonthlyPnL(): Promise<PnLReport> {
  return buildPnL();
}
