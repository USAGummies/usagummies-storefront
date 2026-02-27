import { readState, writeState } from "@/lib/ops/state";
import type { StateKey } from "@/lib/ops/state-keys";
import { queryDatabase, DB, extractNumber } from "@/lib/notion/client";
import { buildPnL } from "@/lib/finance/pnl";
import type { UnifiedBalances } from "@/lib/finance/types";
import type { CacheEnvelope, AmazonKPIs } from "@/lib/amazon/types";
import {
  CHANNEL_ORDER_FRAGMENT,
  buildChannelBreakdown,
  type ShopifyOrderNode,
} from "@/lib/ops/channel-splitter";

const AUDIT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const FRESH_STALE_MINUTES = 60;
const FRESH_CRITICAL_MINUTES = 6 * 60;

type AuditRuleStatus = "pass" | "warn" | "fail" | "unknown";
type FreshnessStatus = "fresh" | "stale" | "critical" | "missing";

export type AuditRuleResult = {
  id: string;
  name: string;
  status: AuditRuleStatus;
  summary: string;
  details?: string;
  measured?: number | null;
  expected?: number | null;
  delta?: number | null;
};

export type FreshnessReport = {
  source: string;
  stateKey: StateKey;
  lastFetched: string | null;
  ageMinutes: number | null;
  status: FreshnessStatus;
};

export type OpsAuditReport = {
  rules: AuditRuleResult[];
  freshness: FreshnessReport[];
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

type CashBaseline = {
  capturedAt: string;
  balance: number;
};

type InventoryBaseline = {
  capturedAt: string;
  totalUnits: number;
  shippedUnitsProxy: number;
};

type TransactionsCache = {
  days: number;
  response: {
    summary?: {
      netCashFlow?: number;
    };
  };
};

type PipelineCache = {
  pipelineValue?: {
    total?: number;
    byStage?: Record<string, number>;
  };
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function startOfMonthISO(): string {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return first.toISOString().slice(0, 10);
}

function freshnessStatusForAge(ageMinutes: number | null): FreshnessStatus {
  if (ageMinutes == null) return "missing";
  if (ageMinutes > FRESH_CRITICAL_MINUTES) return "critical";
  if (ageMinutes > FRESH_STALE_MINUTES) return "stale";
  return "fresh";
}

async function buildFreshness(
  source: string,
  stateKey: StateKey,
): Promise<FreshnessReport> {
  const cached = await readState<CacheEnvelope<unknown> | null>(stateKey, null);
  if (!cached || typeof cached.cachedAt !== "number") {
    return {
      source,
      stateKey,
      lastFetched: null,
      ageMinutes: null,
      status: "missing",
    };
  }

  const ageMinutes = Math.round((Date.now() - cached.cachedAt) / 60000);
  return {
    source,
    stateKey,
    lastFetched: new Date(cached.cachedAt).toISOString(),
    ageMinutes,
    status: freshnessStatusForAge(ageMinutes),
  };
}

function shopifyConfigured(): boolean {
  return !!(
    process.env.SHOPIFY_ADMIN_TOKEN &&
    (process.env.SHOPIFY_STORE_DOMAIN ||
      process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN)
  );
}

async function fetchShopifyOrdersForAudit(): Promise<ShopifyOrderNode[] | null> {
  if (!shopifyConfigured()) return null;

  const token = process.env.SHOPIFY_ADMIN_TOKEN || "";
  const domain = (
    process.env.SHOPIFY_STORE_DOMAIN ||
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ||
    ""
  )
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateFilter = `created_at:>=${thirtyDaysAgo.toISOString().slice(0, 10)}`;

    const res = await fetch(
      `https://${domain}/admin/api/2024-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({
          query: `
            query($query: String!) {
              orders(first: 250, query: $query, sortKey: CREATED_AT, reverse: true) {
                edges {
                  node {
                    ${CHANNEL_ORDER_FRAGMENT}
                  }
                }
              }
            }
          `,
          variables: { query: dateFilter },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!res.ok) return null;
    const json = await res.json();
    const edges = json.data?.orders?.edges || [];
    return edges.map((edge: { node: ShopifyOrderNode }) => edge.node);
  } catch {
    return null;
  }
}

function evaluateShopifySplitRule(orders: ShopifyOrderNode[] | null): AuditRuleResult {
  if (!orders) {
    return {
      id: "shopify_channel_split",
      name: "Shopify total equals DTC + Faire + Distributor + Other",
      status: "unknown",
      summary: "Shopify not configured or no orders available for audit.",
      measured: null,
      expected: null,
      delta: null,
    };
  }

  const breakdown = buildChannelBreakdown(orders);
  const splitRevenue = round2(
    breakdown.dtc.revenue +
      breakdown.faire.revenue +
      breakdown.distributor.revenue +
      breakdown.other.revenue,
  );
  const splitOrders =
    breakdown.dtc.orders +
    breakdown.faire.orders +
    breakdown.distributor.orders +
    breakdown.other.orders;
  const totalRevenue = round2(
    orders.reduce((sum, order) => {
      const amount = parseFloat(order.totalPriceSet?.shopMoney?.amount || "0");
      return sum + amount;
    }, 0),
  );

  const revenueDelta = round2(Math.abs(totalRevenue - splitRevenue));
  const orderDelta = Math.abs(orders.length - splitOrders);

  if (revenueDelta <= 0.01 && orderDelta === 0) {
    return {
      id: "shopify_channel_split",
      name: "Shopify total equals DTC + Faire + Distributor + Other",
      status: "pass",
      summary: "Channel split reconciles to Shopify totals.",
      measured: splitRevenue,
      expected: totalRevenue,
      delta: revenueDelta,
      details: `Order count reconciled (${splitOrders}/${orders.length}).`,
    };
  }

  if (revenueDelta <= 5 && orderDelta <= 2) {
    return {
      id: "shopify_channel_split",
      name: "Shopify total equals DTC + Faire + Distributor + Other",
      status: "warn",
      summary: "Channel split is close but not perfectly reconciled.",
      measured: splitRevenue,
      expected: totalRevenue,
      delta: revenueDelta,
      details: `Order delta: ${orderDelta}.`,
    };
  }

  return {
    id: "shopify_channel_split",
    name: "Shopify total equals DTC + Faire + Distributor + Other",
    status: "fail",
    summary: "Channel split does not reconcile to Shopify totals.",
    measured: splitRevenue,
    expected: totalRevenue,
    delta: revenueDelta,
    details: `Order delta: ${orderDelta}.`,
  };
}

async function evaluateCashDeltaRule(): Promise<AuditRuleResult> {
  const [balancesCache, txCache] = await Promise.all([
    readState<CacheEnvelope<UnifiedBalances> | null>("plaid-balance-cache", null),
    readState<CacheEnvelope<TransactionsCache> | null>("transactions-cache", null),
  ]);

  const netCashFlow = txCache?.data?.response?.summary?.netCashFlow;
  if (typeof netCashFlow !== "number") {
    return {
      id: "cash_delta_vs_pnl",
      name: "Cash delta roughly matches net revenue minus expenses",
      status: "unknown",
      summary: "Recent transactions cache is unavailable for reconciliation.",
      measured: null,
      expected: null,
      delta: null,
    };
  }

  const pnl = await buildPnL();
  const expected = pnl.netIncome;
  const delta = Math.abs(netCashFlow - expected);
  const tolerance = Math.max(500, Math.abs(expected) * 0.35);

  const currentBalance = balancesCache?.data?.totalCash;
  if (typeof currentBalance === "number") {
    await writeState<CashBaseline>("audit-cash-baseline", {
      capturedAt: new Date().toISOString(),
      balance: currentBalance,
    });
  }

  if (delta <= tolerance) {
    return {
      id: "cash_delta_vs_pnl",
      name: "Cash delta roughly matches net revenue minus expenses",
      status: "pass",
      summary: "Cash movement and P&L net are within tolerance.",
      measured: round2(netCashFlow),
      expected: round2(expected),
      delta: round2(delta),
    };
  }

  if (delta <= tolerance * 2) {
    return {
      id: "cash_delta_vs_pnl",
      name: "Cash delta roughly matches net revenue minus expenses",
      status: "warn",
      summary: "Cash movement and P&L net diverge moderately.",
      measured: round2(netCashFlow),
      expected: round2(expected),
      delta: round2(delta),
    };
  }

  return {
    id: "cash_delta_vs_pnl",
    name: "Cash delta roughly matches net revenue minus expenses",
    status: "fail",
    summary: "Cash movement and P&L net diverge significantly.",
    measured: round2(netCashFlow),
    expected: round2(expected),
    delta: round2(delta),
  };
}

async function evaluateInventoryConsumptionRule(
  orders: ShopifyOrderNode[] | null,
): Promise<AuditRuleResult> {
  const [inventoryCache, amazonCache, baseline] = await Promise.all([
    readState<CacheEnvelope<{ summary?: { totalUnits?: number } }> | null>(
      "inventory-cache",
      null,
    ),
    readState<CacheEnvelope<AmazonKPIs> | null>("amazon-kpi-cache", null),
    readState<InventoryBaseline | null>("audit-inventory-baseline", null),
  ]);

  const currentUnits = inventoryCache?.data?.summary?.totalUnits;
  const amazonUnitsShipped = amazonCache?.data?.unitsSold?.monthToDate;
  const shopifyOrders = orders?.length;

  if (
    typeof currentUnits !== "number" ||
    typeof amazonUnitsShipped !== "number" ||
    typeof shopifyOrders !== "number"
  ) {
    return {
      id: "inventory_vs_shipped",
      name: "Inventory consumed roughly matches units shipped",
      status: "unknown",
      summary: "Inventory or shipment data is unavailable for reconciliation.",
      measured: null,
      expected: null,
      delta: null,
    };
  }

  const shippedUnitsProxy = amazonUnitsShipped + shopifyOrders;

  if (!baseline) {
    await writeState<InventoryBaseline>("audit-inventory-baseline", {
      capturedAt: new Date().toISOString(),
      totalUnits: currentUnits,
      shippedUnitsProxy,
    });
    return {
      id: "inventory_vs_shipped",
      name: "Inventory consumed roughly matches units shipped",
      status: "unknown",
      summary: "Inventory baseline initialized; compare available on next run.",
      measured: null,
      expected: null,
      delta: null,
    };
  }

  const inventoryConsumed = baseline.totalUnits - currentUnits;
  const shippedDelta = shippedUnitsProxy - baseline.shippedUnitsProxy;
  const delta = Math.abs(inventoryConsumed - shippedDelta);
  const tolerance = Math.max(25, Math.abs(shippedDelta) * 0.3);

  await writeState<InventoryBaseline>("audit-inventory-baseline", {
    capturedAt: new Date().toISOString(),
    totalUnits: currentUnits,
    shippedUnitsProxy,
  });

  if (delta <= tolerance) {
    return {
      id: "inventory_vs_shipped",
      name: "Inventory consumed roughly matches units shipped",
      status: "pass",
      summary: "Inventory movement tracks shipment proxy within tolerance.",
      measured: round2(inventoryConsumed),
      expected: round2(shippedDelta),
      delta: round2(delta),
    };
  }

  if (delta <= tolerance * 2) {
    return {
      id: "inventory_vs_shipped",
      name: "Inventory consumed roughly matches units shipped",
      status: "warn",
      summary: "Inventory movement is directionally aligned but off tolerance.",
      measured: round2(inventoryConsumed),
      expected: round2(shippedDelta),
      delta: round2(delta),
    };
  }

  return {
    id: "inventory_vs_shipped",
    name: "Inventory consumed roughly matches units shipped",
    status: "fail",
    summary: "Inventory movement does not match shipment proxy.",
    measured: round2(inventoryConsumed),
    expected: round2(shippedDelta),
    delta: round2(delta),
  };
}

async function evaluatePipelineCommitmentRule(): Promise<AuditRuleResult> {
  const pipelineCache = await readState<CacheEnvelope<PipelineCache> | null>(
    "pipeline-cache",
    null,
  );

  const pipelineValue = pipelineCache?.data?.pipelineValue?.total;
  const byStage = pipelineCache?.data?.pipelineValue?.byStage;
  if (typeof pipelineValue !== "number" || !byStage) {
    return {
      id: "pipeline_vs_committed",
      name: "Pipeline value covers committed revenue",
      status: "unknown",
      summary: "Pipeline cache unavailable for reconciliation.",
      measured: null,
      expected: null,
      delta: null,
    };
  }

  const committedRevenue = Object.entries(byStage).reduce((sum, [stage, value]) => {
    if (
      /committed|closed won|order placed/i.test(stage) &&
      typeof value === "number"
    ) {
      return sum + value;
    }
    return sum;
  }, 0);

  if (committedRevenue <= 0) {
    return {
      id: "pipeline_vs_committed",
      name: "Pipeline value covers committed revenue",
      status: "unknown",
      summary: "No committed revenue detected in current pipeline stages.",
      measured: round2(pipelineValue),
      expected: 0,
      delta: 0,
    };
  }

  const delta = committedRevenue - pipelineValue;
  const tolerance = Math.max(500, committedRevenue * 0.1);

  if (delta <= tolerance) {
    return {
      id: "pipeline_vs_committed",
      name: "Pipeline value covers committed revenue",
      status: "pass",
      summary: "Open pipeline remains above committed revenue threshold.",
      measured: round2(pipelineValue),
      expected: round2(committedRevenue),
      delta: round2(Math.max(0, delta)),
    };
  }

  if (delta <= tolerance * 2) {
    return {
      id: "pipeline_vs_committed",
      name: "Pipeline value covers committed revenue",
      status: "warn",
      summary: "Open pipeline is close to committed revenue floor.",
      measured: round2(pipelineValue),
      expected: round2(committedRevenue),
      delta: round2(delta),
    };
  }

  return {
    id: "pipeline_vs_committed",
    name: "Pipeline value covers committed revenue",
    status: "fail",
    summary: "Committed revenue exceeds open pipeline value.",
    measured: round2(pipelineValue),
    expected: round2(committedRevenue),
    delta: round2(delta),
  };
}

async function notionAmazonOrdersMTD(): Promise<number | null> {
  const rows = await queryDatabase(
    DB.DAILY_PERFORMANCE,
    {
      and: [
        { property: "Date", date: { on_or_after: startOfMonthISO() } },
        { property: "Date", date: { on_or_before: new Date().toISOString().slice(0, 10) } },
      ],
    },
    [{ property: "Date", direction: "ascending" }],
  );

  if (!rows || rows.length === 0) return null;
  return rows.reduce((sum, row) => {
    const props = (row.properties || {}) as Record<string, unknown>;
    return sum + extractNumber(props["Amazon Orders"]);
  }, 0);
}

async function evaluateAmazonParityRule(): Promise<AuditRuleResult> {
  const [amazonCache, notionOrders] = await Promise.all([
    readState<CacheEnvelope<AmazonKPIs> | null>("amazon-kpi-cache", null),
    notionAmazonOrdersMTD(),
  ]);

  const spApiOrders = amazonCache?.data?.orders?.monthToDate;
  if (typeof spApiOrders !== "number" || notionOrders == null) {
    return {
      id: "amazon_api_vs_snapshot",
      name: "Amazon SP-API orders match internal dashboard snapshots",
      status: "unknown",
      summary: "Amazon or Notion snapshot data unavailable for parity check.",
      measured: null,
      expected: null,
      delta: null,
    };
  }

  const delta = Math.abs(spApiOrders - notionOrders);
  const tolerance = Math.max(5, spApiOrders * 0.1);

  if (delta <= tolerance) {
    return {
      id: "amazon_api_vs_snapshot",
      name: "Amazon SP-API orders match internal dashboard snapshots",
      status: "pass",
      summary: "Amazon order counts reconcile with daily snapshots.",
      measured: round2(spApiOrders),
      expected: round2(notionOrders),
      delta: round2(delta),
    };
  }

  if (delta <= tolerance * 2) {
    return {
      id: "amazon_api_vs_snapshot",
      name: "Amazon SP-API orders match internal dashboard snapshots",
      status: "warn",
      summary: "Amazon parity is close but outside tolerance.",
      measured: round2(spApiOrders),
      expected: round2(notionOrders),
      delta: round2(delta),
    };
  }

  return {
    id: "amazon_api_vs_snapshot",
    name: "Amazon SP-API orders match internal dashboard snapshots",
    status: "fail",
    summary: "Amazon order parity failed against snapshots.",
    measured: round2(spApiOrders),
    expected: round2(notionOrders),
    delta: round2(delta),
  };
}

async function buildAuditReport(): Promise<OpsAuditReport> {
  const shopifyOrders = await fetchShopifyOrdersForAudit();

  const [rule1, rule2, rule3, rule4, rule5, freshness] = await Promise.all([
    Promise.resolve(evaluateShopifySplitRule(shopifyOrders)),
    evaluateCashDeltaRule(),
    evaluateInventoryConsumptionRule(shopifyOrders),
    evaluatePipelineCommitmentRule(),
    evaluateAmazonParityRule(),
    Promise.all([
      buildFreshness("Amazon KPIs", "amazon-kpi-cache"),
      buildFreshness("Balances", "plaid-balance-cache"),
      buildFreshness("Pipeline", "pipeline-cache"),
      buildFreshness("Inventory", "inventory-cache"),
      buildFreshness("Supply Chain", "supply-chain-cache"),
      buildFreshness("Transactions", "transactions-cache"),
      buildFreshness("Marketing", "marketing-cache"),
      buildFreshness("Forecast", "forecast-cache"),
      buildFreshness("Deal Emails", "deal-emails-cache"),
    ]),
  ]);

  const rules = [rule1, rule2, rule3, rule4, rule5];
  const summary = {
    passed: rules.filter((r) => r.status === "pass").length,
    warning: rules.filter((r) => r.status === "warn").length,
    failed: rules.filter((r) => r.status === "fail").length,
    unknown: rules.filter((r) => r.status === "unknown").length,
    fresh: freshness.filter((f) => f.status === "fresh").length,
    stale: freshness.filter((f) => f.status === "stale").length,
    critical: freshness.filter((f) => f.status === "critical").length,
    missing: freshness.filter((f) => f.status === "missing").length,
  };

  const generatedAt = new Date().toISOString();
  return {
    rules,
    freshness,
    summary,
    generatedAt,
    lastFetched: generatedAt,
    budget: null,
  };
}

export async function runOpsAudit(opts?: {
  forceRefresh?: boolean;
}): Promise<OpsAuditReport> {
  if (!opts?.forceRefresh) {
    const cached = await readState<CacheEnvelope<OpsAuditReport> | null>(
      "audit-cache",
      null,
    );
    if (cached && Date.now() - cached.cachedAt < AUDIT_CACHE_TTL) {
      return cached.data;
    }
  }

  const report = await buildAuditReport();
  await writeState("audit-cache", {
    data: report,
    cachedAt: Date.now(),
  });
  return report;
}
