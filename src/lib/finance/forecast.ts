/**
 * AP/AR Forecasting Engine — USA Gummies
 *
 * Projects cash flow 30/60/90 days out by combining:
 *   - Known receivables (Amazon settlements, Shopify payouts, B2B invoices)
 *   - Known payables (recurring expenses from historical data)
 *   - Estimated COGS and restock costs
 *
 * Uses balances from Phase 1 (Plaid + Shopify Payments + Amazon).
 */

import { readState, writeState } from "@/lib/ops/state";
import type { CacheEnvelope, AmazonKPIs } from "@/lib/amazon/types";
import type {
  UnifiedBalances,
  Receivable,
  Payable,
  CashFlowProjection,
  ForecastReport,
} from "./types";
import { getCachedKPIs } from "@/lib/amazon/cache";
import {
  DB,
  queryDatabase,
  extractNumber,
  extractText,
} from "@/lib/notion/client";

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

type PlaidBalanceCache = {
  accounts?: Array<{
    balances?: { current?: number | null; available?: number | null };
  }>;
};

type InventoryCostSnapshot = {
  costPerUnit: number;
  source: "inventory" | "fallback";
};

type MonthlyExpenseEstimate = {
  category: Payable["category"];
  amount: number;
  description: string;
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
    console.error("[forecast] Inventory cost lookup failed:", err);
  }

  return { costPerUnit: 3.5, source: "fallback" };
}

function classifyExpenseCategory(description: string): Payable["category"] {
  const lower = description.toLowerCase();
  if (
    lower.includes("shopify") ||
    lower.includes("notion") ||
    lower.includes("vercel") ||
    lower.includes("software") ||
    lower.includes("subscription")
  ) {
    return "software";
  }
  if (
    lower.includes("ad") ||
    lower.includes("marketing") ||
    lower.includes("facebook") ||
    lower.includes("google ads") ||
    lower.includes("tiktok")
  ) {
    return "marketing";
  }
  if (
    lower.includes("ship") ||
    lower.includes("usps") ||
    lower.includes("ups") ||
    lower.includes("fedex") ||
    lower.includes("fulfillment")
  ) {
    return "shipping";
  }
  if (
    lower.includes("payroll") ||
    lower.includes("salary") ||
    lower.includes("contractor")
  ) {
    return "payroll";
  }
  return "other";
}

async function buildRecurringMonthlyFromCashTransactions(): Promise<MonthlyExpenseEstimate[]> {
  try {
    const start = new Date();
    start.setDate(start.getDate() - 90);

    const rows = await queryDatabase(
      DB.CASH_TRANSACTIONS,
      {
        and: [
          { property: "Date", date: { on_or_after: start.toISOString().slice(0, 10) } },
          { property: "Category", select: { equals: "Expense" } },
        ],
      },
      [{ property: "Date", direction: "descending" }],
      200,
    );

    if (!rows || rows.length === 0) {
      return [
        { category: "software", amount: 350, description: "Software subscriptions (fallback estimate)" },
        { category: "marketing", amount: 500, description: "Marketing spend (fallback estimate)" },
        { category: "shipping", amount: 200, description: "Shipping costs (fallback estimate)" },
      ];
    }

    const totals: Record<Payable["category"], number> = {
      cogs: 0,
      shipping: 0,
      software: 0,
      marketing: 0,
      payroll: 0,
      other: 0,
    };

    for (const row of rows) {
      const props = (row.properties || {}) as Record<string, unknown>;
      const amount = Math.abs(extractNumber(props["Amount"]));
      if (amount <= 0) continue;
      const description = extractText(props["Description"]) || "";
      const category = classifyExpenseCategory(description);
      totals[category] += amount;
    }

    const monthly: MonthlyExpenseEstimate[] = [];
    for (const [category, total] of Object.entries(totals)) {
      if (category === "cogs") continue;
      if (total <= 0) continue;
      const monthlyAmount = Math.round(((total / 90) * 30) * 100) / 100;
      if (monthlyAmount <= 0) continue;
      monthly.push({
        category: category as Payable["category"],
        amount: monthlyAmount,
        description: `Recurring ${category} (rolling 90-day average)`,
      });
    }

    if (monthly.length > 0) {
      return monthly;
    }
  } catch (err) {
    console.error("[forecast] CASH_TRANSACTIONS recurring expense lookup failed:", err);
  }

  return [
    { category: "software", amount: 350, description: "Software subscriptions (fallback estimate)" },
    { category: "marketing", amount: 500, description: "Marketing spend (fallback estimate)" },
    { category: "shipping", amount: 200, description: "Shipping costs (fallback estimate)" },
  ];
}

function resolveCurrentBalance(
  cache: CacheEnvelope<UnifiedBalances | PlaidBalanceCache> | null,
): number {
  const unified = cache?.data as UnifiedBalances | undefined;
  if (typeof unified?.totalCash === "number") {
    return unified.totalCash;
  }

  const plaidOnly = cache?.data as PlaidBalanceCache | undefined;
  if (Array.isArray(plaidOnly?.accounts)) {
    return plaidOnly.accounts.reduce((sum, account) => {
      const current = account.balances?.current ?? account.balances?.available ?? 0;
      return sum + (current || 0);
    }, 0);
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Receivables — money coming in
// ---------------------------------------------------------------------------

async function buildReceivables(): Promise<Receivable[]> {
  const receivables: Receivable[] = [];

  // 1. Amazon pending settlement
  const amazonKPIs = await getCachedKPIs<AmazonKPIs>();
  const amazonFinance = await readState<CacheEnvelope<{
    pendingBalance: number;
    nextSettlementEstimate: { estimatedAmount: number; estimatedDate: string } | null;
  }> | null>("amazon-finance-cache", null);

  if (amazonFinance?.data?.pendingBalance) {
    const est = amazonFinance.data.nextSettlementEstimate;
    receivables.push({
      source: "amazon_settlement",
      amount: amazonFinance.data.pendingBalance,
      expectedDate: est?.estimatedDate || futureDate(14),
      confidence: "high",
      description: "Amazon pending settlement balance",
    });
  }

  // 2. Shopify pending payouts
  const shopifyPayments = await readState<CacheEnvelope<{
    pendingPayouts: { amount: number; expectedDate: string | null }[];
  }> | null>("shopify-payments-cache", null);

  if (shopifyPayments?.data?.pendingPayouts) {
    for (const payout of shopifyPayments.data.pendingPayouts) {
      receivables.push({
        source: "shopify_payout",
        amount: payout.amount,
        expectedDate: payout.expectedDate || futureDate(2),
        confidence: "high",
        description: "Shopify pending payout",
      });
    }
  }

  // 3. Estimated recurring revenue (based on recent performance)
  // Project weekly Amazon revenue based on velocity
  if (amazonKPIs) {
    const weeklyRevenue = amazonKPIs.revenue.weekToDate || 0;
    const daysIntoWeek = new Date().getDay() || 7; // 1=Mon..7=Sun
    const dailyAvg = daysIntoWeek > 0 ? weeklyRevenue / daysIntoWeek : 0;

    // Project next 4 bi-weekly settlements
    for (let i = 1; i <= 4; i++) {
      const amount = dailyAvg * 14; // 14-day settlement cycle
      if (amount > 0) {
        receivables.push({
          source: "amazon_settlement",
          amount: Math.round(amount * 100) / 100,
          expectedDate: futureDate(14 * i),
          confidence: i <= 2 ? "medium" : "low",
          description: `Projected Amazon settlement #${i} (based on current velocity)`,
        });
      }
    }

    // Project Shopify payouts (typically ~3-day cycle)
    const shopifyDailyEstimate = dailyAvg * 0.3; // Shopify is ~30% of Amazon for this business
    for (let i = 1; i <= 12; i++) {
      if (shopifyDailyEstimate > 0) {
        receivables.push({
          source: "shopify_payout",
          amount: Math.round(shopifyDailyEstimate * 3 * 100) / 100,
          expectedDate: futureDate(3 * i),
          confidence: i <= 4 ? "medium" : "low",
          description: `Projected Shopify payout (3-day cycle)`,
        });
      }
    }
  }

  return receivables;
}

// ---------------------------------------------------------------------------
// Payables — money going out
// ---------------------------------------------------------------------------

async function buildPayables(): Promise<Payable[]> {
  const payables: Payable[] = [];

  const recurringMonthly = await buildRecurringMonthlyFromCashTransactions();

  // Spread monthly recurring across the next 90 days
  for (const expense of recurringMonthly) {
    for (let month = 0; month < 3; month++) {
      payables.push({
        category: expense.category,
        amount: expense.amount,
        dueDate: futureDate(30 * month + 15), // mid-month estimate
        recurring: true,
        description: expense.description,
      });
    }
  }

  // COGS estimate — based on Amazon velocity
  const amazonKPIs = await getCachedKPIs<AmazonKPIs>();
  const inventoryCost = await getInventoryCostSnapshot();
  if (amazonKPIs) {
    const unitsPerDay = amazonKPIs.velocity?.unitsPerDay7d || 0;
    const costPerUnit = inventoryCost.costPerUnit;

    // Monthly COGS projection
    for (let month = 0; month < 3; month++) {
      const monthlyCOGS = unitsPerDay * 30 * costPerUnit;
      if (monthlyCOGS > 0) {
        payables.push({
          category: "cogs",
          amount: Math.round(monthlyCOGS * 100) / 100,
          dueDate: futureDate(30 * month + 1),
          recurring: true,
          description: `Product COGS (~${Math.round(unitsPerDay)} units/day × $${costPerUnit.toFixed(2)})`,
        });
      }
    }

    // Restock alert: if inventory is low, add a restock payable
    if (amazonKPIs.inventory?.daysOfSupply < 21 && amazonKPIs.inventory?.fulfillable > 0) {
      const reorderUnits = Math.max(500, unitsPerDay * 60); // 60-day supply
      const reorderCost = reorderUnits * costPerUnit;
      payables.push({
        category: "cogs",
        amount: Math.round(reorderCost * 100) / 100,
        dueDate: futureDate(7), // Need to reorder soon
        recurring: false,
        description: `FBA restock order (~${reorderUnits} units, ${amazonKPIs.inventory.daysOfSupply} days of supply remaining)`,
      });
    }
  }

  if (inventoryCost.source === "fallback") {
    console.warn("[forecast] Falling back to default COGS ($3.50) — inventory costs unavailable");
  }

  // Amazon fees (estimated from current fee structure)
  if (amazonKPIs?.fees) {
    const monthlyFees = amazonKPIs.fees.totalFee * 30; // Daily fee × 30
    for (let month = 0; month < 3; month++) {
      payables.push({
        category: "cogs",
        amount: Math.round(monthlyFees * 100) / 100,
        dueDate: futureDate(30 * month + 1),
        recurring: true,
        description: "Amazon seller fees (referral + FBA)",
      });
    }
  }

  return payables;
}

// ---------------------------------------------------------------------------
// Core projection engine
// ---------------------------------------------------------------------------

function projectCashFlow(
  startingBalance: number,
  receivables: Receivable[],
  payables: Payable[],
  days: number,
): CashFlowProjection[] {
  const projections: CashFlowProjection[] = [];
  let runningBalance = startingBalance;
  const today = new Date();

  for (let d = 0; d < days; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() + d);
    const dateStr = date.toISOString().slice(0, 10);

    // Find receivables for this day
    const dayReceivables = receivables.filter((r) => r.expectedDate === dateStr);
    const dayInflows = dayReceivables.reduce((sum, r) => sum + r.amount, 0);

    // Find payables for this day
    const dayPayables = payables.filter((p) => p.dueDate === dateStr);
    const dayOutflows = dayPayables.reduce((sum, p) => sum + p.amount, 0);

    const openingBalance = runningBalance;
    runningBalance = runningBalance + dayInflows - dayOutflows;

    projections.push({
      date: dateStr,
      openingBalance: Math.round(openingBalance * 100) / 100,
      inflows: Math.round(dayInflows * 100) / 100,
      outflows: Math.round(dayOutflows * 100) / 100,
      closingBalance: Math.round(runningBalance * 100) / 100,
      receivables: dayReceivables,
      payables: dayPayables,
    });
  }

  return projections;
}

// ---------------------------------------------------------------------------
// Top-level orchestrator
// ---------------------------------------------------------------------------

export async function buildForecastReport(): Promise<ForecastReport> {
  // Check cache
  const cached = await readState<CacheEnvelope<ForecastReport> | null>(
    "forecast-cache",
    null,
  );
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.data;
  }

  // Get current balance from unified balances cache
  const balancesCache = await readState<CacheEnvelope<UnifiedBalances | PlaidBalanceCache> | null>(
    "plaid-balance-cache",
    null,
  );
  const currentBalance = resolveCurrentBalance(balancesCache);

  // Build receivables and payables
  const [receivables, payables] = await Promise.all([
    buildReceivables(),
    buildPayables(),
  ]);

  // Project 30, 60, 90 days
  const proj30 = projectCashFlow(currentBalance, receivables, payables, 30);
  const proj60 = projectCashFlow(currentBalance, receivables, payables, 60);
  const proj90 = projectCashFlow(currentBalance, receivables, payables, 90);

  // Generate alerts
  const alerts: string[] = [];
  const LOW_CASH_THRESHOLD = 5000;

  for (const day of proj90) {
    if (day.closingBalance < LOW_CASH_THRESHOLD) {
      alerts.push(
        `Cash projected below $${LOW_CASH_THRESHOLD.toLocaleString()} on ${day.date} (closing: $${day.closingBalance.toLocaleString()})`,
      );
      break; // Only first alert
    }
  }

  if (proj90.length > 0) {
    const finalBalance = proj90[proj90.length - 1].closingBalance;
    if (finalBalance < 0) {
      alerts.push(`WARNING: Cash projected negative by ${proj90[proj90.length - 1].date}`);
    }
  }

  // Calculate runway (days until cash hits $0)
  let runway = 90; // default to 90 if never hits 0
  for (let i = 0; i < proj90.length; i++) {
    if (proj90[i].closingBalance <= 0) {
      runway = i;
      break;
    }
  }

  // Also calculate based on burn rate
  const totalOutflows30 = proj30.reduce((sum, d) => sum + d.outflows, 0);
  const totalInflows30 = proj30.reduce((sum, d) => sum + d.inflows, 0);
  const monthlyBurn = totalOutflows30 - totalInflows30;
  if (monthlyBurn > 0 && currentBalance > 0) {
    const burnRunway = Math.floor((currentBalance / monthlyBurn) * 30);
    if (burnRunway < runway) runway = burnRunway;
  }

  if (runway < 30) {
    alerts.push(`Runway alert: Only ${runway} days of cash remaining at current burn rate`);
  }

  const report: ForecastReport = {
    currentBalance,
    projections: {
      "30d": proj30,
      "60d": proj60,
      "90d": proj90,
    },
    alerts,
    runway,
    generatedAt: new Date().toISOString(),
  };

  // Cache result
  await writeState("forecast-cache", { data: report, cachedAt: Date.now() });

  return report;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}
