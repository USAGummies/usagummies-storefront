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
import type { PlaidTransaction } from "@/lib/finance/types";

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
  cashSource?: "plaid-live" | "manual" | "plaid-nonprod" | "none";
  cashSourceLabel?: string;
  manualOverride?: { balance: number; note: string; updatedAt: string } | null;
};

export type PipelineLead = {
  id: string;
  name: string;
  companyName?: string;
  status: string;
  email: string;
  lastContact: string;
  source: string;
  type: "b2b" | "distributor";
  qualification?: "Qualified Lead" | "Unqualified Lead" | "Raw Scrape";
  dealValue: number;
  createdAt: string;
  lastEdited: string;
};

export type PipelineData = {
  totalLeads: number;
  b2bCount: number;
  distributorCount: number;
  leadQuality?: {
    qualified: number;
    unqualified: number;
    rawScrape: number;
  };
  stageCounts: Record<string, number>;
  stages: Record<string, PipelineLead[]>;
  pipelineValue: { total: number; byStage: Record<string, number> };
  velocity: { avgDaysToClose: number; avgDaysByStage: Record<string, number> };
  conversionRates: Record<string, number>;
  recentActivity: { date: string; lead: string; event: string; details: string }[];
  weeklyTrend: { newLeads: number; stageAdvances: number; closedWon: number; closedLost: number };
  generatedAt: string;
};

export type ChannelData = {
  shopify: {
    total: { revenue: number; orders: number; avgOrderValue: number };
    dtc: {
      revenue: number;
      orders: number;
      avgOrderValue: number;
      items: Array<{ name: string; createdAt: string; total: number; financialStatus: string }>;
    };
    faire: {
      revenue: number;
      orders: number;
      avgOrderValue: number;
      items: Array<{ name: string; createdAt: string; total: number; financialStatus: string }>;
    };
    distributor: {
      revenue: number;
      orders: number;
      avgOrderValue: number;
      items: Array<{ name: string; createdAt: string; total: number; financialStatus: string }>;
    };
    other: {
      revenue: number;
      orders: number;
      avgOrderValue: number;
      items: Array<{ name: string; createdAt: string; total: number; financialStatus: string }>;
    };
  } | null;
  amazon: {
    revenue: number;
    orders: number;
    avgOrderValue: number;
    inventory: {
      fulfillable: number;
      inboundWorking: number;
      inboundShipped: number;
      reserved: number;
      unfulfillable: number;
      totalQuantity: number;
      daysOfSupply: number;
      restockAlert: boolean;
    } | null;
    fees: {
      referralFee: number;
      fbaFee: number;
      totalFee: number;
      estimatedNetMargin: number;
    } | null;
  } | null;
  dailyByChannel: Array<{
    date: string;
    label: string;
    dtcRevenue?: number;
    faireRevenue?: number;
    distributorRevenue?: number;
    otherRevenue?: number;
    totalRevenue?: number;
    dtc?: number;
    faire?: number;
    distributor?: number;
    other?: number;
    combined?: number;
  }>;
  channelMetrics?: {
    dtc: { revenue: number; fees: number; netRevenue: number; marginPct: number; orderCount: number };
    faire: { revenue: number; fees: number; netRevenue: number; marginPct: number; orderCount: number };
    distributor: { revenue: number; fees: number; netRevenue: number; marginPct: number; orderCount: number };
    other: { revenue: number; fees: number; netRevenue: number; marginPct: number; orderCount: number };
    amazon: { revenue: number; fees: number; netRevenue: number; marginPct: number; orderCount: number } | null;
    all: { revenue: number; fees: number; netRevenue: number; marginPct: number; orderCount: number };
  } | null;
  combined: { totalRevenue: number; totalOrders: number };
  generatedAt: string;
};

export type DealEmailsData = {
  threads: Array<{
    contactEmail: string;
    latestEmail: {
      id: string;
      threadId: string;
      from: string;
      to: string;
      subject: string;
      date: string;
      snippet: string;
    } | null;
    threadCount: number;
    lastActivity: string | null;
  }>;
  generatedAt: string;
  budget: null;
};

export type InventoryData = {
  items: Array<{
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
    purchaseBudget: number | null;
  }>;
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
  homeStock?: {
    baseline: { pa: number; wa: number; asOf: string };
    fulfilledSinceBaseline: { pa: number; wa: number; unassigned: number; total: number };
    current: { pa: number; wa: number; total: number };
    derivedAt: string;
    source: "shopify-orders" | "baseline-only";
    error?: string;
  };
  amazonFba?: {
    error: string | null;
    errorAt: string | null;
    lastSuccessfulFetch: string | null;
  };
  generatedAt: string;
  budget: null;
};

export type SupplyChainData = {
  suppliers: Array<{ name: string; status: "active" | "pending" | "inactive" }>;
  productionOrders: Array<{
    id: string;
    product: string;
    supplier: string;
    status: string;
    expectedDate: string;
  }>;
  costTrends: Array<{ sku: string; currentCost: number; previousCost: number; changePct: number }>;
  alerts: Array<{
    type: "reorder" | "payment-due" | "delivery-expected" | "low-stock";
    severity: "critical" | "warning" | "info";
    message: string;
    dueDate: string | null;
    relatedItem: string;
  }>;
  summary: {
    activeSuppliers: number;
    openOrders: number;
    totalOpenOrderValue: number;
    avgLeadTimeDays: number;
  };
  generatedAt: string;
  budget: null;
};

export type AlertsData = {
  alerts: Array<{
    id: string;
    priority: "critical" | "warning" | "info";
    source: string;
    title: string;
    message: string;
    createdAt: string;
    actionLabel: string | null;
    actionHref: string | null;
    status: "open" | "resolved";
  }>;
  actionLog?: Array<{
    id: string;
    title: string;
    action: string;
    at: string;
    source?: string;
    resolvedBy?: string | null;
  }>;
  summary: {
    critical: number;
    warning: number;
    info: number;
    total: number;
  };
  generatedAt: string;
  lastFetched: string;
  budget: null;
};

export type MarketingData = {
  overview: {
    sessions: number;
    users: number;
    pageviews: number;
    bounceRate: number;
    avgSessionDuration: number;
    newUserPct: number;
  };
  sources: Array<{ source: string; medium: string; sessions: number; users: number; pctOfTotal: number }>;
  topPages: Array<{ path: string; title: string; pageviews: number; avgEngagementTime: number }>;
  dailyTraffic: Array<{ date: string; label: string; sessions: number; users: number; pageviews: number }>;
  funnel: {
    sessions: number;
    addToCart: number;
    purchases: number;
    conversionRate: number;
    cartToCheckoutRate: number;
  };
  adChannels: Array<{
    channel: string;
    spend: number;
    revenue: number;
    roas: number;
    impressions: number;
    clicks: number;
    ctr: number;
    cpc: number;
    budget: number | null;
    utilizationPct: number | null;
  }>;
  generatedAt: string;
  budget: null;
};

export type CustomersData = {
  summary: {
    totalCustomers: number;
    repeatRate: number;
    avgLtv: number;
    aov: number;
    orders90d: number;
  };
  ltvDistribution: Array<{ bucket: string; count: number; pct: number }>;
  orderFrequency: Array<{ bucket: string; count: number; pct: number }>;
  cohortRetention: {
    months: string[];
    rows: Array<{
      cohort: string;
      cohortLabel: string;
      size: number;
      retention: number[];
    }>;
  };
  topCustomers: Array<{
    id: string;
    name: string;
    email: string;
    totalSpent: number;
    ordersCount: number;
    avgOrderValue: number;
    lastOrderAt: string | null;
    state: string;
  }>;
  geography: Array<{ state: string; count: number; pct: number }>;
  generatedAt: string;
  error?: string;
};

export type ContentData = {
  summary: {
    publishedPosts: number;
    totalBlogPageviews: number;
    avgEngagementTime: number;
    blogToPurchaseConversions: number;
  };
  topPosts: Array<{
    path: string;
    title: string;
    pageviews: number;
    avgEngagementTime: number;
    bounceRate: number;
  }>;
  draftQueue: Array<{
    id: string;
    title: string;
    targetKeyword: string;
    slug: string;
    status: string;
    seoScore: number;
    wordCount: number;
    generatedAt: string;
    publishedAt: string;
    body: string;
  }>;
  engineStatus: {
    s1LastRun: string | null;
    s3LastRun: string | null;
    s5LastRun: string | null;
  };
  generatedAt: string;
  error?: string;
};

export type SocialData = {
  platforms: {
    x: {
      configured: boolean;
      followers: number | null;
      recentPosts: Array<{
        id: string;
        text: string;
        createdAt: string | null;
        likes: number;
        replies: number;
        reposts: number;
        impressions: number;
      }>;
      unrespondedMentions: Array<{
        id: string;
        text: string;
        authorId: string;
        createdAt: string | null;
      }>;
    };
    truth: {
      configured: boolean;
      followers: number | null;
      recentPosts: Array<{
        id: string;
        text: string;
        createdAt: string | null;
        likes: number;
        replies: number;
        reposts: number;
      }>;
      unrespondedMentions: Array<{
        id: string;
        text: string;
        account: string;
        createdAt: string | null;
      }>;
    };
  };
  autoResponder: {
    enabled: boolean;
    responseCountToday: number;
  };
  generatedAt: string;
  error?: string;
};

export type ImageLibraryData = {
  images: Array<{
    id: string;
    title: string;
    url: string;
    tags: string[];
    category: string;
    source: "upload" | "ai-dalle";
    prompt: string;
    created: string;
    usedIn: string;
  }>;
  summary: {
    total: number;
    uploadCount: number;
    aiCount: number;
  };
  generatedAt: string;
  error?: string;
};

export type IntelligenceData = {
  tests: Array<{
    id: string;
    name: string;
    channel: string;
    hypothesis: string;
    startDate: string;
    endDate: string | null;
    status: "active" | "completed" | "paused";
    spend: number;
    revenue: number;
    roas: number;
    impressions: number;
    clicks: number;
    creative: string;
    audience: string;
    result: "winner" | "loser" | "inconclusive" | null;
  }>;
  opportunities: Array<{
    id: string;
    name: string;
    channel: string;
    roas: number;
    spend: number;
    impressions: number;
    suggestedScaleBudget: number;
    status: "active" | "completed" | "paused";
  }>;
  channelRoas: Array<{ channel: string; spend: number; revenue: number; roas: number }>;
  summary: {
    activeTests: number;
    avgRoas: number;
    bestPerformer: string;
    totalTestSpend: number;
  };
  generatedAt: string;
};

export type AdsData = {
  campaigns: Array<{
    id: string;
    platform: "rumble" | "meta" | "google" | "tiktok";
    name: string;
    status: "active" | "paused" | "completed";
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;
    startDate: string;
    endDate: string | null;
  }>;
  byPlatform: Array<{
    platform: string;
    spend: number;
    revenue: number;
    roas: number;
    impressions: number;
    clicks: number;
    ctr: number;
    cpc: number;
  }>;
  platformStatus: Array<{
    platform: string;
    configured: boolean;
    lastSynced: string | null;
    error: string | null;
    campaignCount: number;
  }>;
  generatedAt: string;
};

export type TransactionsData = {
  transactions: PlaidTransaction[];
  categories: Array<{ category: string; totalSpent: number; count: number; pctOfTotal: number }>;
  dailySpending: Array<{ date: string; label: string; expenses: number; income: number; net: number }>;
  summary: {
    totalExpenses: number;
    totalIncome: number;
    netCashFlow: number;
    avgDailySpend: number;
    largestExpense: { name: string; amount: number; date: string } | null;
    transactionCount: number;
  };
  generatedAt: string;
  budget: null;
};

export type ForecastData = {
  currentBalance: number;
  projections: {
    "30d": Array<{
      date: string;
      openingBalance: number;
      inflows: number;
      outflows: number;
      closingBalance: number;
    }>;
    "60d": Array<{
      date: string;
      openingBalance: number;
      inflows: number;
      outflows: number;
      closingBalance: number;
    }>;
    "90d": Array<{
      date: string;
      openingBalance: number;
      inflows: number;
      outflows: number;
      closingBalance: number;
    }>;
  };
  alerts: string[];
  runway: number;
  generatedAt: string;
};

export type AuditData = {
  rules: Array<{
    id: string;
    name: string;
    status: "pass" | "warn" | "fail" | "unknown";
    summary: string;
    details?: string;
    measured?: number | null;
    expected?: number | null;
    delta?: number | null;
  }>;
  freshness: Array<{
    source: string;
    stateKey: string;
    lastFetched: string | null;
    ageMinutes: number | null;
    status: "fresh" | "stale" | "critical" | "missing";
  }>;
  summary: {
    passed: number;
    warning: number;
    failed: number;
    unknown: number;
    fresh: number;
    stale: number;
    critical: number;
    missing: number;
  };
  generatedAt: string;
  lastFetched: string;
  budget: null;
};

export type BudgetsData = {
  status: "dormant" | "active";
  budgets: Record<string, number> | null;
  allocations: Array<{
    category: string;
    allocated: number;
    spent: number;
    remaining: number;
    utilizationPct: number;
  }>;
  generatedAt: string;
};

export type InboxData = {
  messages: Array<{
    id: string;
    source: "email" | "slack" | "b2b_pipeline" | "shopify_customer" | "amazon_buyer";
    from: string;
    subject: string;
    snippet: string;
    date: string;
    read: boolean;
    threadId?: string;
    priority: "high" | "normal" | "low";
    category: "support" | "sales" | "operations" | "finance" | "other";
  }>;
  unreadCount: {
    email: number;
    slack: number;
    b2b: number;
    shopify: number;
    amazon: number;
    total: number;
  };
  lastUpdated: string;
};

export type LogsData = {
  runs: Array<{
    engineId?: string;
    agentKey?: string;
    agentName?: string;
    agent?: string;
    label?: string;
    startedAt?: string;
    completedAt?: string;
    runAt?: string;
    runAtET?: string;
    durationMs?: number;
    status?: string;
    error?: string;
    triggeredBy?: string;
    source?: string;
  }>;
  engineLog: string[];
  stats: { total: number; last24h: number; successes24h: number; failures24h: number };
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
  return useEndpointData<PipelineData>("/api/ops/pipeline");
}

// ---------------------------------------------------------------------------
// New Phase 1 hooks
// ---------------------------------------------------------------------------

function useEndpointData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchAPI<T>(path);
    if (result) {
      setData(result);
    } else {
      setError(`Unable to load ${path}`);
    }
    setLoading(false);
  }, [path]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}

export function useChannelData() {
  return useEndpointData<ChannelData>("/api/ops/channels");
}

export function useDealEmails(contactEmail?: string) {
  const path = contactEmail
    ? `/api/ops/deal-emails?email=${encodeURIComponent(contactEmail)}`
    : "/api/ops/deal-emails";
  return useEndpointData<DealEmailsData>(path);
}

export function useInventoryData() {
  return useEndpointData<InventoryData>("/api/ops/inventory");
}

export function useSupplyChain() {
  return useEndpointData<SupplyChainData>("/api/ops/supply-chain");
}

export function useAlerts(limit = 50) {
  return useEndpointData<AlertsData>(`/api/ops/alerts?limit=${limit}`);
}

export function useMarketingData() {
  return useEndpointData<MarketingData>("/api/ops/marketing");
}

export function useCustomersData() {
  return useEndpointData<CustomersData>("/api/ops/marketing/customers");
}

export function useContentData() {
  return useEndpointData<ContentData>("/api/ops/marketing/content");
}

export function useSocialData() {
  return useEndpointData<SocialData>("/api/ops/marketing/social");
}

export function useImageLibrary() {
  return useEndpointData<ImageLibraryData>("/api/ops/marketing/images");
}

export function useIntelligenceData() {
  return useEndpointData<IntelligenceData>("/api/ops/marketing/intelligence");
}

export function useAdsData() {
  return useEndpointData<AdsData>("/api/ops/marketing/ads");
}

export function useTransactions(days = 30) {
  return useEndpointData<TransactionsData>(`/api/ops/transactions?days=${days}`);
}

export function useForecastData() {
  return useEndpointData<ForecastData>("/api/ops/forecast");
}

export function useAuditStatus(force = false) {
  return useEndpointData<AuditData>(
    `/api/ops/audit${force ? "?force=1" : ""}`,
  );
}

export function useInboxData(source = "all", limit = 50, unreadOnly = false) {
  const params = new URLSearchParams();
  params.set("source", source);
  params.set("limit", String(limit));
  if (unreadOnly) params.set("unread", "true");
  return useEndpointData<InboxData>(`/api/ops/inbox?${params.toString()}`);
}

export function useLogsData(engine = "", limit = 200) {
  const params = new URLSearchParams();
  if (engine) params.set("engine", engine);
  params.set("limit", String(limit));
  return useEndpointData<LogsData>(`/api/ops/logs?${params.toString()}`);
}

export function useBudgets() {
  return useEndpointData<BudgetsData>("/api/ops/budgets");
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
