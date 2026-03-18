import "server-only";

import {
  fetchAmazonOrderStats,
  fetchFinancialEventGroups,
  fetchOrders,
  isAmazonConfigured,
} from "@/lib/amazon/sp-api";
import { DB, extractDate, extractNumber, extractText } from "@/lib/notion/client";
import { queryNotionDatabase } from "@/lib/ops/abra-notion-write";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReconciliationPeriod = {
  startDate: string; // YYYY-MM-DD
  endDate: string;
  label: string;
};

export type ChannelReconciliation = {
  channel: "shopify" | "amazon" | "faire" | "other";
  grossRevenue: number;
  fees: number;
  refunds: number;
  netPayout: number;
  bankDeposits: number;
  variance: number; // netPayout - bankDeposits
  variancePct: number;
  status: "matched" | "minor_variance" | "major_variance" | "missing_data";
  details: string[];
};

export type ReconciliationReport = {
  period: ReconciliationPeriod;
  channels: ChannelReconciliation[];
  totalGross: number;
  totalNet: number;
  totalBankDeposits: number;
  totalVariance: number;
  status: "clean" | "needs_review" | "discrepancies_found";
  generatedAt: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type NotionPage = Record<string, unknown>;

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(round2(value));
}

function formatPct(value: number): string {
  return `${round2(value).toFixed(1)}%`;
}

function getProps(page: NotionPage): Record<string, unknown> {
  const props = page.properties;
  return props && typeof props === "object" ? (props as Record<string, unknown>) : {};
}

function readText(props: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const value = props[name];
    const text = extractText(value).trim();
    if (text) return text;
  }
  return "";
}

function readNumber(props: Record<string, unknown>, names: string[]): number {
  for (const name of names) {
    const value = props[name];
    const numeric = extractNumber(value);
    if (numeric) return numeric;
    const text = extractText(value).replace(/[$,]/g, "").trim();
    if (!text) continue;
    const parsed = Number(text);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function readDateValue(props: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const value = props[name];
    const date = extractDate(value).trim();
    if (date) return date.slice(0, 10);
    const text = extractText(value).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  }
  return "";
}

function diffDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function varianceStatus(
  variancePct: number,
  hasBankData: boolean,
  hasSourceData: boolean,
): ChannelReconciliation["status"] {
  if (!hasBankData || !hasSourceData) return "missing_data";
  const absPct = Math.abs(variancePct);
  if (absPct <= 2) return "matched";
  if (absPct <= 5) return "minor_variance";
  return "major_variance";
}

// ---------------------------------------------------------------------------
// Bank deposit queries (Notion cash_transactions)
// ---------------------------------------------------------------------------

type BankDepositResult = {
  total: number;
  count: number;
  transactions: Array<{ name: string; amount: number; date: string }>;
};

async function fetchBankDeposits(
  period: ReconciliationPeriod,
  channelKeywords: string[],
): Promise<BankDepositResult> {
  const pages = await queryNotionDatabase({
    database_id: DB.CASH_TRANSACTIONS,
    filter: {
      and: [
        { property: "Date", date: { on_or_after: period.startDate } },
        { property: "Date", date: { on_or_before: period.endDate } },
      ],
    },
    sorts: [{ property: "Date", direction: "ascending" }],
    page_size: 100,
  });

  const result: BankDepositResult = { total: 0, count: 0, transactions: [] };

  for (const page of pages) {
    const props = getProps(page);
    const name = readText(props, ["Name", "Description", "Transaction", "Memo"]);
    const vendor = readText(props, ["Vendor", "Payee", "Merchant"]);
    const amount = readNumber(props, ["Amount", "Net Amount", "Total", "Value"]);
    const date = readDateValue(props, ["Date", "Transaction Date"]);
    const accountCode = readText(props, ["Account Code", "GL Code", "Account"]);

    // Match deposits by name/vendor containing channel keywords, or by account code
    const searchable = `${name} ${vendor} ${accountCode}`.toLowerCase();
    const matches = channelKeywords.some((kw) => searchable.includes(kw.toLowerCase()));

    if (matches && amount > 0) {
      result.total = round2(result.total + amount);
      result.count += 1;
      result.transactions.push({ name, amount, date });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Period builder
// ---------------------------------------------------------------------------

export function buildReconciliationPeriod(
  month?: number,
  year?: number,
): ReconciliationPeriod {
  const now = new Date();
  // Default to previous month
  let y = year ?? now.getUTCFullYear();
  let m = month ?? now.getUTCMonth(); // getUTCMonth() is 0-indexed, so this gives prev month

  if (!month && !year) {
    // No args: previous month
    if (m === 0) {
      m = 12;
      y = y - 1;
    }
  } else {
    // If month provided, use it directly (1-indexed)
    m = month ?? now.getUTCMonth() + 1;
  }

  const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const label = new Date(`${startDate}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return { startDate, endDate, label };
}

// ---------------------------------------------------------------------------
// Shopify reconciliation
// ---------------------------------------------------------------------------

export async function reconcileShopify(
  period: ReconciliationPeriod,
): Promise<ChannelReconciliation> {
  const details: string[] = [];
  const store = process.env.SHOPIFY_STORE || process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION || "2024-10";

  if (!store || !token) {
    return {
      channel: "shopify",
      grossRevenue: 0,
      fees: 0,
      refunds: 0,
      netPayout: 0,
      bankDeposits: 0,
      variance: 0,
      variancePct: 0,
      status: "missing_data",
      details: ["Shopify Admin API credentials not configured"],
    };
  }

  // Fetch orders from Shopify Admin GraphQL
  const query = `created_at:>=${period.startDate} created_at:<=${period.endDate} status:any`;
  let hasNextPage = true;
  let cursor: string | null = null;
  let grossRevenue = 0;
  let refunds = 0;
  let orderCount = 0;
  let pages = 0;

  while (hasNextPage && pages < 10) {
    const res = await fetch(`https://${store}/admin/api/${version}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        query: `query OrdersForReconciliation($query: String!, $cursor: String) {
          orders(first: 100, after: $cursor, query: $query, sortKey: CREATED_AT) {
            edges {
              cursor
              node {
                totalPriceSet {
                  shopMoney {
                    amount
                  }
                }
                totalRefundedSet {
                  shopMoney {
                    amount
                  }
                }
                cancelledAt
              }
            }
            pageInfo {
              hasNextPage
            }
          }
        }`,
        variables: { query, cursor },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      details.push(`Shopify API error: ${res.status} ${text.slice(0, 200)}`);
      break;
    }

    const json = (await res.json()) as {
      data?: {
        orders?: {
          edges?: Array<{
            cursor?: string;
            node?: {
              totalPriceSet?: { shopMoney?: { amount?: string } };
              totalRefundedSet?: { shopMoney?: { amount?: string } };
              cancelledAt?: string | null;
            };
          }>;
          pageInfo?: { hasNextPage?: boolean };
        };
      };
      errors?: Array<{ message?: string }>;
    };

    if (Array.isArray(json.errors) && json.errors.length > 0) {
      details.push(`Shopify GraphQL errors: ${json.errors.map((e) => e.message || "unknown").join("; ")}`);
      break;
    }

    const edges = Array.isArray(json.data?.orders?.edges) ? json.data?.orders?.edges || [] : [];
    for (const edge of edges) {
      const total = Number(edge.node?.totalPriceSet?.shopMoney?.amount || 0);
      const refunded = Number(edge.node?.totalRefundedSet?.shopMoney?.amount || 0);
      grossRevenue += total;
      refunds += refunded;
      orderCount += 1;
    }
    hasNextPage = json.data?.orders?.pageInfo?.hasNextPage === true;
    cursor = edges.length > 0 ? edges[edges.length - 1]?.cursor || null : null;
    pages += 1;
    if (!cursor) break;
  }

  grossRevenue = round2(grossRevenue);
  refunds = round2(refunds);

  // Estimate Shopify Payments fees: 2.9% + $0.30 per transaction
  const fees = round2(grossRevenue * 0.029 + orderCount * 0.3);
  const netPayout = round2(grossRevenue - fees - refunds);

  details.push(`${orderCount} orders, gross ${formatCurrency(grossRevenue)}`);
  details.push(`Estimated fees: ${formatCurrency(fees)} (2.9% + $0.30/txn)`);
  if (refunds > 0) details.push(`Refunds: ${formatCurrency(refunds)}`);

  // Fetch bank deposits matching Shopify
  const bankData = await fetchBankDeposits(period, ["shopify", "4100"]);
  const bankDeposits = bankData.total;
  details.push(`Bank deposits matched: ${bankData.count} totaling ${formatCurrency(bankDeposits)}`);

  const variance = round2(netPayout - bankDeposits);
  const variancePct = netPayout !== 0 ? round2((variance / netPayout) * 100) : 0;
  const status = varianceStatus(variancePct, bankData.count > 0, orderCount > 0);

  if (status === "major_variance") {
    details.push(`VARIANCE: ${formatCurrency(variance)} (${formatPct(variancePct)}) — needs investigation`);
  }

  return {
    channel: "shopify",
    grossRevenue,
    fees,
    refunds,
    netPayout,
    bankDeposits,
    variance,
    variancePct,
    status,
    details,
  };
}

// ---------------------------------------------------------------------------
// Amazon reconciliation
// ---------------------------------------------------------------------------

export async function reconcileAmazon(
  period: ReconciliationPeriod,
): Promise<ChannelReconciliation> {
  const details: string[] = [];

  if (!isAmazonConfigured()) {
    return {
      channel: "amazon",
      grossRevenue: 0,
      fees: 0,
      refunds: 0,
      netPayout: 0,
      bankDeposits: 0,
      variance: 0,
      variancePct: 0,
      status: "missing_data",
      details: ["Amazon SP-API credentials not configured"],
    };
  }

  const after = `${period.startDate}T00:00:00Z`;
  const before = `${period.endDate}T23:59:59Z`;

  let grossRevenue = 0;
  let orderCount = 0;
  let fees = 0;
  let refunds = 0;
  let usedFallback = false;

  try {
    const [orders, groups] = await Promise.all([
      fetchOrders(after, before),
      fetchFinancialEventGroups(after, before),
    ]);

    grossRevenue = round2(
      orders.reduce((sum, order) => sum + Number(order.OrderTotal?.Amount || 0), 0),
    );
    orderCount = orders.length;

    // Estimate Amazon fees from financial event groups
    // Settlement amounts in groups represent net payouts after Amazon fees
    let settlementTotal = 0;
    for (const group of groups) {
      settlementTotal += Number(group.OriginalTotal?.CurrencyAmount || 0);
    }

    if (groups.length > 0 && grossRevenue > 0) {
      // fees = gross - settlement (settlement includes refunds deducted)
      fees = round2(Math.max(0, grossRevenue - settlementTotal));
      details.push(`${groups.length} settlement groups, settlement total ${formatCurrency(settlementTotal)}`);
    } else {
      // Estimate Amazon fees at ~15% referral + FBA fees (~30% total)
      fees = round2(grossRevenue * 0.3);
      details.push("Fees estimated at 30% (referral + FBA)");
    }
  } catch (error) {
    // Fallback to order stats
    usedFallback = true;
    const days = diffDays(period.startDate, period.endDate);
    const stats = await fetchAmazonOrderStats(days);
    grossRevenue = round2(stats.totalRevenue);
    orderCount = stats.totalOrders;
    fees = round2(grossRevenue * 0.3); // Estimate
    details.push(
      `Used fallback order stats: ${error instanceof Error ? error.message : "SP-API error"}`,
    );
    details.push("Fees estimated at 30% (referral + FBA)");
  }

  const netPayout = round2(grossRevenue - fees - refunds);
  details.push(`${orderCount} orders, gross ${formatCurrency(grossRevenue)}`);
  if (usedFallback) details.push("Note: using fallback data — reconciliation may be less accurate");

  // Fetch bank deposits matching Amazon
  const bankData = await fetchBankDeposits(period, ["amazon", "4200"]);
  const bankDeposits = bankData.total;
  details.push(`Bank deposits matched: ${bankData.count} totaling ${formatCurrency(bankDeposits)}`);

  const variance = round2(netPayout - bankDeposits);
  const variancePct = netPayout !== 0 ? round2((variance / netPayout) * 100) : 0;
  const status = varianceStatus(variancePct, bankData.count > 0, orderCount > 0);

  if (status === "major_variance") {
    details.push(`VARIANCE: ${formatCurrency(variance)} (${formatPct(variancePct)}) — needs investigation`);
  }

  return {
    channel: "amazon",
    grossRevenue,
    fees,
    refunds,
    netPayout,
    bankDeposits,
    variance,
    variancePct,
    status,
    details,
  };
}

// ---------------------------------------------------------------------------
// Faire reconciliation (basic — bank deposit matching only)
// ---------------------------------------------------------------------------

async function reconcileFaire(
  period: ReconciliationPeriod,
): Promise<ChannelReconciliation> {
  const details: string[] = [];

  // Faire doesn't have an API integration yet — match bank deposits only
  const bankData = await fetchBankDeposits(period, ["faire", "4400"]);
  const bankDeposits = bankData.total;

  if (bankData.count === 0) {
    return {
      channel: "faire",
      grossRevenue: 0,
      fees: 0,
      refunds: 0,
      netPayout: 0,
      bankDeposits: 0,
      variance: 0,
      variancePct: 0,
      status: "missing_data",
      details: ["No Faire bank deposits found for period"],
    };
  }

  // Estimate gross from bank deposits (Faire takes ~25% commission)
  const estimatedGross = round2(bankDeposits / 0.75);
  const estimatedFees = round2(estimatedGross - bankDeposits);

  details.push(`${bankData.count} Faire deposits totaling ${formatCurrency(bankDeposits)}`);
  details.push(`Estimated gross ${formatCurrency(estimatedGross)} (assuming 25% Faire commission)`);
  details.push("Note: no direct Faire API — estimates based on bank deposits");

  return {
    channel: "faire",
    grossRevenue: estimatedGross,
    fees: estimatedFees,
    refunds: 0,
    netPayout: bankDeposits,
    bankDeposits,
    variance: 0,
    variancePct: 0,
    status: "matched",
    details,
  };
}

// ---------------------------------------------------------------------------
// Full reconciliation report
// ---------------------------------------------------------------------------

export async function generateReconciliationReport(
  period?: ReconciliationPeriod,
): Promise<ReconciliationReport> {
  const reconciliationPeriod = period ?? buildReconciliationPeriod();

  const [shopify, amazon, faire] = await Promise.all([
    reconcileShopify(reconciliationPeriod),
    reconcileAmazon(reconciliationPeriod),
    reconcileFaire(reconciliationPeriod),
  ]);

  const channels = [shopify, amazon, faire];

  const totalGross = round2(channels.reduce((sum, ch) => sum + ch.grossRevenue, 0));
  const totalNet = round2(channels.reduce((sum, ch) => sum + ch.netPayout, 0));
  const totalBankDeposits = round2(channels.reduce((sum, ch) => sum + ch.bankDeposits, 0));
  const totalVariance = round2(totalNet - totalBankDeposits);

  // Determine overall status based on total variance and channel statuses
  const totalVariancePct = totalNet !== 0 ? Math.abs((totalVariance / totalNet) * 100) : 0;
  const hasMajor = channels.some((ch) => ch.status === "major_variance");
  const hasMinor = channels.some((ch) => ch.status === "minor_variance");

  let status: ReconciliationReport["status"];
  if (hasMajor || totalVariancePct > 5) {
    status = "discrepancies_found";
  } else if (hasMinor || totalVariancePct > 2) {
    status = "needs_review";
  } else {
    status = "clean";
  }

  return {
    period: reconciliationPeriod,
    channels,
    totalGross,
    totalNet,
    totalBankDeposits,
    totalVariance,
    status,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Text formatter
// ---------------------------------------------------------------------------

function statusEmoji(status: ChannelReconciliation["status"]): string {
  switch (status) {
    case "matched":
      return "[OK]";
    case "minor_variance":
      return "[REVIEW]";
    case "major_variance":
      return "[ALERT]";
    case "missing_data":
      return "[NO DATA]";
  }
}

function reportStatusEmoji(status: ReconciliationReport["status"]): string {
  switch (status) {
    case "clean":
      return "[CLEAN]";
    case "needs_review":
      return "[NEEDS REVIEW]";
    case "discrepancies_found":
      return "[DISCREPANCIES]";
  }
}

export function formatReconciliationAsText(report: ReconciliationReport): string {
  const lines: string[] = [
    `USA Gummies Revenue Reconciliation — ${report.period.label}`,
    `Period: ${report.period.startDate} to ${report.period.endDate}`,
    `Generated: ${report.generatedAt}`,
    `Overall Status: ${reportStatusEmoji(report.status)}`,
    "",
  ];

  for (const ch of report.channels) {
    lines.push(`--- ${ch.channel.toUpperCase()} ${statusEmoji(ch.status)} ---`);
    lines.push(`  Gross Revenue:  ${formatCurrency(ch.grossRevenue)}`);
    lines.push(`  Fees:           ${formatCurrency(ch.fees)}`);
    if (ch.refunds > 0) {
      lines.push(`  Refunds:        ${formatCurrency(ch.refunds)}`);
    }
    lines.push(`  Net Payout:     ${formatCurrency(ch.netPayout)}`);
    lines.push(`  Bank Deposits:  ${formatCurrency(ch.bankDeposits)}`);
    lines.push(`  Variance:       ${formatCurrency(ch.variance)} (${formatPct(ch.variancePct)})`);
    if (ch.details.length > 0) {
      for (const detail of ch.details) {
        lines.push(`  - ${detail}`);
      }
    }
    lines.push("");
  }

  lines.push("--- TOTALS ---");
  lines.push(`  Gross Revenue:  ${formatCurrency(report.totalGross)}`);
  lines.push(`  Net Payout:     ${formatCurrency(report.totalNet)}`);
  lines.push(`  Bank Deposits:  ${formatCurrency(report.totalBankDeposits)}`);
  lines.push(`  Total Variance: ${formatCurrency(report.totalVariance)}`);

  return lines.join("\n");
}
