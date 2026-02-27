"use client";
/**
 * War Room Data Hooks
 *
 * Fetches REAL data from existing API routes and provides
 * plan-vs-actual comparison utilities.
 *
 * API Routes (all already exist and work on Vercel):
 *   /api/ops/dashboard  → Combined Shopify + Amazon revenue/orders
 *   /api/ops/pnl        → Full P&L breakdown
 *   /api/ops/balances   → Cash positions across all accounts
 *   /api/ops/pipeline   → B2B + Distributor leads from Notion
 *   /api/ops/amazon     → Detailed Amazon KPIs
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types (mirrored from existing API response shapes)
// ---------------------------------------------------------------------------

export type DailyDataPoint = {
  date: string;
  label: string;
  revenue: number;
  orders: number;
};

export type ShopifyKPIs = {
  totalOrders: number;
  totalRevenue: number;
  avgOrderValue: number;
  recentOrders: {
    name: string;
    createdAt: string;
    financialStatus: string;
    total: string;
  }[];
  dailyBreakdown: DailyDataPoint[];
};

export type AmazonKPIs = {
  orders: Record<string, number>;
  revenue: Record<string, number>;
  aov: Record<string, number>;
  unitsSold: Record<string, number>;
  orderStatus: Record<string, number>;
  inventory: {
    fulfillable: number;
    inboundWorking: number;
    inboundShipped: number;
    reserved: number;
    unfulfillable: number;
    totalQuantity: number;
    daysOfSupply: number;
    restockAlert: boolean;
  };
  fees: {
    referralFee: number;
    fbaFee: number;
    totalFee: number;
    estimatedNetMargin: number;
  };
  velocity: { unitsPerDay7d: number; trend: "up" | "down" | "flat" };
  comparison: {
    todayVsYesterday: { revenueDelta: number; revenuePct: number; ordersDelta: number; ordersPct: number };
    weekOverWeek: { revenueDelta: number; revenuePct: number; ordersDelta: number; ordersPct: number };
  };
  dailyBreakdown: DailyDataPoint[];
  lastUpdated: string;
};

export type UnifiedDashboard = {
  combined: { totalRevenue: number; totalOrders: number; avgOrderValue: number };
  shopify: ShopifyKPIs | null;
  amazon: AmazonKPIs | null;
  chartData: {
    date: string;
    label: string;
    amazon: number;
    shopify: number;
    combined: number;
    amazonOrders: number;
    shopifyOrders: number;
    combinedOrders: number;
  }[];
  generatedAt: string;
};

export type PnLReport = {
  period: { start: string; end: string; label: string };
  revenue: { amazon: number; shopify: number; wholesale: number; total: number };
  cogs: { productCost: number; shipping: number; amazonFees: number; shopifyFees: number; total: number };
  grossProfit: number;
  grossMargin: number;
  opex: { software: number; marketing: number; payroll: number; other: number; total: number };
  netIncome: number;
  netMargin: number;
  generatedAt: string;
};

export type UnifiedBalances = {
  found: { balance: number; available: number; lastUpdated: string } | null;
  shopify: { balance: number; currency: string; pendingPayouts: { amount: number; expectedDate: string | null }[] } | null;
  amazon: { pendingBalance: number; lastSettlement: { amount: number; date: string } | null } | null;
  totalCash: number;
  lastUpdated: string;
};

export type PipelineLead = {
  id: string;
  name: string;
  status: string;
  email: string;
  lastContact: string;
  source: string;
  type: "b2b" | "distributor";
  dealValue: number;
  createdAt: string;
  lastEdited: string;
};

export type PipelineData = {
  totalLeads: number;
  b2bCount: number;
  distributorCount: number;
  stageCounts: Record<string, number>;
  stages: Record<string, PipelineLead[]>;
  pipelineValue: { total: number; byStage: Record<string, number> };
  velocity: { avgDaysToClose: number; avgDaysByStage: Record<string, number> };
  conversionRates: Record<string, number>;
  recentActivity: { date: string; lead: string; event: string; details: string }[];
  weeklyTrend: { newLeads: number; stageAdvances: number; closedWon: number; closedLost: number };
  generatedAt: string;
};

// ---------------------------------------------------------------------------
// Generic fetch helper
// ---------------------------------------------------------------------------

async function fetchAPI<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) {
      console.warn(`[War Room] ${path} returned ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[War Room] ${path} failed:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hook: useDashboardData — Combined Shopify + Amazon overview
// ---------------------------------------------------------------------------

export function useDashboardData() {
  const [data, setData] = useState<UnifiedDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchAPI<UnifiedDashboard>("/api/ops/dashboard");
    if (result) {
      setData(result);
    } else {
      setError("Unable to load dashboard data");
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, loading, error, refresh };
}

// ---------------------------------------------------------------------------
// Hook: usePnLData — P&L Report
// ---------------------------------------------------------------------------

export function usePnLData() {
  const [data, setData] = useState<PnLReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAPI<PnLReport>("/api/ops/pnl").then((result) => {
      setData(result);
      if (!result) setError("Unable to load P&L data");
      setLoading(false);
    });
  }, []);

  return { data, loading, error };
}

// ---------------------------------------------------------------------------
// Hook: useBalancesData — Cash positions
// ---------------------------------------------------------------------------

export function useBalancesData() {
  const [data, setData] = useState<UnifiedBalances | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAPI<UnifiedBalances>("/api/ops/balances").then((result) => {
      setData(result);
      if (!result) setError("Unable to load balance data");
      setLoading(false);
    });
  }, []);

  return { data, loading, error };
}

// ---------------------------------------------------------------------------
// Hook: usePipelineData — B2B + Distributor pipeline
// ---------------------------------------------------------------------------

export function usePipelineData() {
  const [data, setData] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAPI<PipelineData>("/api/ops/pipeline").then((result) => {
      setData(result);
      if (!result) setError("Unable to load pipeline data");
      setLoading(false);
    });
  }, []);

  return { data, loading, error };
}

// ---------------------------------------------------------------------------
// Plan vs Actual comparison utilities
// ---------------------------------------------------------------------------

export type PlanVsActual = {
  plan: number;
  actual: number;
  variance: number;
  variancePct: number;
  status: "ahead" | "on-track" | "behind" | "critical" | "no-data";
};

export function comparePlanVsActual(plan: number, actual: number | null | undefined): PlanVsActual {
  if (actual == null || actual === 0) {
    return { plan, actual: 0, variance: -plan, variancePct: -1, status: "no-data" };
  }
  const variance = actual - plan;
  const variancePct = plan !== 0 ? variance / plan : 0;
  const status: PlanVsActual["status"] =
    variancePct >= 0.05 ? "ahead" :
    variancePct >= -0.1 ? "on-track" :
    variancePct >= -0.3 ? "behind" : "critical";
  return { plan, actual, variance, variancePct, status };
}

export const STATUS_COLORS: Record<PlanVsActual["status"], string> = {
  ahead: "#16a34a",     // green
  "on-track": "#16a34a", // green
  behind: "#c7a062",    // gold (warning)
  critical: "#c7362c",  // red
  "no-data": "#94a3b8", // slate gray
};

// Format helpers
export const fmt = (n: number) => n.toLocaleString("en-US");
export const fmtDollar = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
export const fmtDollarExact = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtPercent = (n: number) => (n * 100).toFixed(1) + "%";
export const fmtVariance = (pva: PlanVsActual) => {
  const sign = pva.variance >= 0 ? "+" : "";
  return `${sign}${fmtDollar(pva.variance)} (${sign}${(pva.variancePct * 100).toFixed(1)}%)`;
};
