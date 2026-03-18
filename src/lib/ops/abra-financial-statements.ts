import "server-only";

import {
  fetchAmazonOrderStats,
  fetchFinancialEventGroups,
  fetchOrders,
  isAmazonConfigured,
} from "@/lib/amazon/sp-api";
import { DB, extractDate, extractNumber, extractText } from "@/lib/notion/client";
import { createNotionPage, queryNotionDatabase } from "@/lib/ops/abra-notion-write";

export type StatementPeriod = {
  startDate: string;
  endDate: string;
  label: string;
};

export type PnLLineItem = {
  accountCode: string;
  accountName: string;
  amount: number;
  transactionCount: number;
};

export type PnLStatement = {
  period: StatementPeriod;
  generatedAt: string;
  revenue: {
    items: PnLLineItem[];
    total: number;
  };
  cogs: {
    items: PnLLineItem[];
    total: number;
  };
  grossProfit: number;
  grossMarginPct: number;
  operatingExpenses: {
    items: PnLLineItem[];
    total: number;
  };
  netOperatingIncome: number;
  netMarginPct: number;
  dataSourceCounts: {
    notionTransactions: number;
    shopifyOrders: number;
    amazonSettlements: number;
  };
  warnings: string[];
};

type NotionPage = Record<string, unknown>;

type TransactionRow = {
  id: string;
  name: string;
  vendor: string | null;
  category: string | null;
  accountCode: string | null;
  date: string | null;
  amount: number;
};

type ExternalRevenueSnapshot = {
  revenue: number;
  orderCount: number;
  settlementCount: number;
  warning?: string;
};

const CHART_OF_ACCOUNTS_DB = "e00f886dc4864a5b8c61248837226ac3";
const MONTHLY_CLOSE_CHECKLIST_DB = "72dd43a214434a57b25fba87b51b00c0";

const ACCOUNT_NAME_FALLBACKS: Record<string, string> = {
  "1000": "Found Checking",
  "1100": "Inventory",
  "2000": "Accounts Payable",
  "2100": "Credit Cards",
  "2200": "Accrued Liabilities",
  "3000": "Owner Investment",
  "3100": "Retained Earnings",
  "4100": "Shopify DTC Revenue",
  "4200": "Amazon Revenue",
  "4300": "Wholesale Revenue",
  "4400": "Faire Revenue",
  "5100": "Ingredients",
  "5200": "Co-Packing",
  "5300": "Packaging",
  "5400": "Freight-In",
  "5500": "Amazon Fees",
  "6100": "Marketing",
  "6200": "Software",
  "6300": "Legal",
  "6400": "Insurance",
  "6500": "Bank Fees",
  "6600": "Shipping",
  "6700": "Meals",
  "6800": "Miscellaneous",
};

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

function safeDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function diffDays(startDate: string, endDate: string): number {
  const start = safeDate(startDate).getTime();
  const end = safeDate(endDate).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
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

function periodLabel(startDate: string, endDate: string): string {
  const start = safeDate(startDate);
  const end = safeDate(endDate);
  if (
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCDate() === 1
  ) {
    return start.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  return `${startDate} to ${endDate}`;
}

function accountNameFor(code: string, accounts: Map<string, string>): string {
  return accounts.get(code) || ACCOUNT_NAME_FALLBACKS[code] || `Account ${code}`;
}

async function fetchChartOfAccounts(): Promise<Map<string, string>> {
  const pages = await queryNotionDatabase({
    database_id: CHART_OF_ACCOUNTS_DB,
    page_size: 100,
  });
  const accountMap = new Map<string, string>();
  for (const page of pages) {
    const props = getProps(page);
    const code = readText(props, ["Account Code", "Code", "Account", "GL Code"]);
    const name = readText(props, ["Name", "Account Name", "Title"]);
    if (code) accountMap.set(code, name || ACCOUNT_NAME_FALLBACKS[code] || `Account ${code}`);
  }
  for (const [code, name] of Object.entries(ACCOUNT_NAME_FALLBACKS)) {
    if (!accountMap.has(code)) accountMap.set(code, name);
  }
  return accountMap;
}

async function fetchTransactions(period: StatementPeriod): Promise<TransactionRow[]> {
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

  return pages.map((page) => {
    const props = getProps(page);
    return {
      id: typeof page.id === "string" ? page.id : "",
      name: readText(props, ["Name", "Description", "Transaction", "Memo"]) || "Untitled transaction",
      vendor: readText(props, ["Vendor", "Payee", "Merchant"]) || null,
      category: readText(props, ["Category"]) || null,
      accountCode: readText(props, ["Account Code", "GL Code", "Account"]) || null,
      date: readDateValue(props, ["Date", "Transaction Date"]) || null,
      amount: readNumber(props, ["Amount", "Net Amount", "Total", "Value"]),
    };
  });
}

function sortItems(items: Iterable<PnLLineItem>): PnLLineItem[] {
  return [...items].sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

function addLineItem(
  bucket: Map<string, PnLLineItem>,
  code: string,
  name: string,
  amount: number,
): void {
  const current = bucket.get(code) || {
    accountCode: code,
    accountName: name,
    amount: 0,
    transactionCount: 0,
  };
  current.amount = round2(current.amount + amount);
  current.transactionCount += 1;
  bucket.set(code, current);
}

async function fetchShopifyRevenue(period: StatementPeriod): Promise<ExternalRevenueSnapshot> {
  const store = process.env.SHOPIFY_STORE || process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION || "2024-10";
  if (!store || !token) {
    return { revenue: 0, orderCount: 0, settlementCount: 0 };
  }

  const query = `created_at:>=${period.startDate} created_at:<=${period.endDate} status:any`;
  let hasNextPage = true;
  let cursor: string | null = null;
  let revenue = 0;
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
        query: `query OrdersForPnL($query: String!, $cursor: String) {
          orders(first: 100, after: $cursor, query: $query, sortKey: CREATED_AT) {
            edges {
              cursor
              node {
                totalPriceSet {
                  shopMoney {
                    amount
                  }
                }
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
      throw new Error(`Shopify GraphQL ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      data?: {
        orders?: {
          edges?: Array<{
            cursor?: string;
            node?: { totalPriceSet?: { shopMoney?: { amount?: string } } };
          }>;
          pageInfo?: { hasNextPage?: boolean };
        };
      };
      errors?: Array<{ message?: string }>;
    };

    if (Array.isArray(json.errors) && json.errors.length > 0) {
      throw new Error(json.errors.map((error) => error.message || "unknown").join("; "));
    }

    const edges = Array.isArray(json.data?.orders?.edges) ? json.data?.orders?.edges || [] : [];
    for (const edge of edges) {
      revenue += Number(edge.node?.totalPriceSet?.shopMoney?.amount || 0);
      orderCount += 1;
    }
    hasNextPage = json.data?.orders?.pageInfo?.hasNextPage === true;
    cursor = edges.length > 0 ? edges[edges.length - 1]?.cursor || null : null;
    pages += 1;
    if (!cursor) break;
  }

  return { revenue: round2(revenue), orderCount, settlementCount: 0 };
}

async function fetchAmazonRevenue(period: StatementPeriod): Promise<ExternalRevenueSnapshot> {
  if (!isAmazonConfigured()) {
    return { revenue: 0, orderCount: 0, settlementCount: 0 };
  }

  const after = `${period.startDate}T00:00:00Z`;
  const before = `${period.endDate}T23:59:59Z`;

  try {
    const [orders, groups] = await Promise.all([
      fetchOrders(after, before),
      fetchFinancialEventGroups(after, before),
    ]);

    const revenue = orders.reduce((sum, order) => {
      return sum + Number(order.OrderTotal?.Amount || 0);
    }, 0);

    return {
      revenue: round2(revenue),
      orderCount: orders.length,
      settlementCount: groups.length,
    };
  } catch (error) {
    const days = diffDays(period.startDate, period.endDate);
    const stats = await fetchAmazonOrderStats(days);
    return {
      revenue: round2(stats.totalRevenue),
      orderCount: stats.totalOrders,
      settlementCount: 0,
      warning: error instanceof Error ? error.message : "Amazon cross-reference fallback used",
    };
  }
}

export async function generatePnL(period: StatementPeriod): Promise<PnLStatement> {
  const [transactions, chartOfAccounts, shopifySnapshot, amazonSnapshot] = await Promise.all([
    fetchTransactions(period),
    fetchChartOfAccounts(),
    fetchShopifyRevenue(period),
    fetchAmazonRevenue(period),
  ]);

  const revenueItems = new Map<string, PnLLineItem>();
  const cogsItems = new Map<string, PnLLineItem>();
  const operatingExpenseItems = new Map<string, PnLLineItem>();
  const warnings: string[] = [];

  let uncategorizedCount = 0;
  let uncategorizedAmount = 0;
  let ignoredCount = 0;
  let ignoredAmount = 0;

  for (const transaction of transactions) {
    const code = (transaction.accountCode || "").trim();
    if (!code) {
      uncategorizedCount += 1;
      uncategorizedAmount += Math.abs(transaction.amount);
      continue;
    }

    const accountName = accountNameFor(code, chartOfAccounts);
    if (/^4\d{3}$/.test(code)) {
      addLineItem(revenueItems, code, accountName, round2(transaction.amount));
      continue;
    }
    if (/^5\d{3}$/.test(code)) {
      addLineItem(cogsItems, code, accountName, round2(Math.abs(transaction.amount)));
      continue;
    }
    if (/^6\d{3}$/.test(code)) {
      addLineItem(
        operatingExpenseItems,
        code,
        accountName,
        round2(Math.abs(transaction.amount)),
      );
      continue;
    }

    ignoredCount += 1;
    ignoredAmount += Math.abs(transaction.amount);
  }

  if (uncategorizedCount > 0) {
    warnings.push(
      `${uncategorizedCount} uncategorized transactions totaling ${formatCurrency(uncategorizedAmount)} are missing account codes.`,
    );
  }
  if (ignoredCount > 0) {
    warnings.push(
      `${ignoredCount} non-P&L transactions totaling ${formatCurrency(ignoredAmount)} were excluded because their account codes are outside 4xxx-6xxx.`,
    );
  }
  if (shopifySnapshot.warning) warnings.push(`Shopify cross-check note: ${shopifySnapshot.warning}`);
  if (amazonSnapshot.warning) warnings.push(`Amazon cross-check note: ${amazonSnapshot.warning}`);

  const revenue = sortItems(revenueItems.values());
  const cogs = sortItems(cogsItems.values());
  const operatingExpenses = sortItems(operatingExpenseItems.values());

  const revenueTotal = round2(revenue.reduce((sum, item) => sum + item.amount, 0));
  const cogsTotal = round2(cogs.reduce((sum, item) => sum + item.amount, 0));
  const operatingExpenseTotal = round2(
    operatingExpenses.reduce((sum, item) => sum + item.amount, 0),
  );

  const grossProfit = round2(revenueTotal - cogsTotal);
  const grossMarginPct = revenueTotal > 0 ? round2((grossProfit / revenueTotal) * 100) : 0;
  const netOperatingIncome = round2(grossProfit - operatingExpenseTotal);
  const netMarginPct = revenueTotal > 0 ? round2((netOperatingIncome / revenueTotal) * 100) : 0;

  const notionShopifyRevenue = round2(
    revenue.filter((item) => item.accountCode === "4100").reduce((sum, item) => sum + item.amount, 0),
  );
  const notionAmazonRevenue = round2(
    revenue.filter((item) => item.accountCode === "4200").reduce((sum, item) => sum + item.amount, 0),
  );

  if (
    shopifySnapshot.orderCount > 0 &&
    Math.abs(notionShopifyRevenue - shopifySnapshot.revenue) > 50
  ) {
    warnings.push(
      `Shopify discrepancy exceeds threshold: ledger ${formatCurrency(notionShopifyRevenue)} vs Shopify ${formatCurrency(shopifySnapshot.revenue)}.`,
    );
  }

  if (
    amazonSnapshot.orderCount > 0 &&
    Math.abs(notionAmazonRevenue - amazonSnapshot.revenue) > 50
  ) {
    warnings.push(
      `Amazon discrepancy exceeds threshold: ledger ${formatCurrency(notionAmazonRevenue)} vs Amazon ${formatCurrency(amazonSnapshot.revenue)}.`,
    );
  }

  return {
    period,
    generatedAt: new Date().toISOString(),
    revenue: {
      items: revenue,
      total: revenueTotal,
    },
    cogs: {
      items: cogs,
      total: cogsTotal,
    },
    grossProfit,
    grossMarginPct,
    operatingExpenses: {
      items: operatingExpenses,
      total: operatingExpenseTotal,
    },
    netOperatingIncome,
    netMarginPct,
    dataSourceCounts: {
      notionTransactions: transactions.length,
      shopifyOrders: shopifySnapshot.orderCount,
      amazonSettlements: amazonSnapshot.settlementCount,
    },
    warnings,
  };
}

function formatLineSection(title: string, items: PnLLineItem[], total: number): string[] {
  const lines = [title];
  if (items.length === 0) {
    lines.push("  (no items)");
  } else {
    for (const item of items) {
      lines.push(
        `  ${item.accountCode} ${item.accountName}: ${formatCurrency(item.amount)} (${item.transactionCount} transactions)`,
      );
    }
  }
  lines.push(`  Total: ${formatCurrency(total)}`);
  return lines;
}

export function formatPnLAsText(statement: PnLStatement): string {
  const lines = [
    `USA Gummies P&L — ${statement.period.label}`,
    `Period: ${statement.period.startDate} to ${statement.period.endDate}`,
    `Generated: ${statement.generatedAt}`,
    "",
    ...formatLineSection("Revenue", statement.revenue.items, statement.revenue.total),
    "",
    ...formatLineSection("COGS", statement.cogs.items, statement.cogs.total),
    `Gross Profit: ${formatCurrency(statement.grossProfit)} (${formatPct(statement.grossMarginPct)})`,
    "",
    ...formatLineSection(
      "Operating Expenses",
      statement.operatingExpenses.items,
      statement.operatingExpenses.total,
    ),
    `Net Operating Income: ${formatCurrency(statement.netOperatingIncome)} (${formatPct(statement.netMarginPct)})`,
    "",
    `Data Sources: Notion ${statement.dataSourceCounts.notionTransactions} tx | Shopify ${statement.dataSourceCounts.shopifyOrders} orders | Amazon ${statement.dataSourceCounts.amazonSettlements} settlements`,
  ];

  if (statement.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of statement.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join("\n");
}

export function formatPnLAsMarkdown(statement: PnLStatement): string {
  const lines = [
    `# USA Gummies P&L — ${statement.period.label}`,
    `Period: ${statement.period.startDate} to ${statement.period.endDate}`,
    `Generated: ${statement.generatedAt}`,
    "",
    "## Revenue",
    ...statement.revenue.items.map(
      (item) => `- ${item.accountCode} ${item.accountName}: ${formatCurrency(item.amount)} (${item.transactionCount} transactions)`,
    ),
    `- Total Revenue: ${formatCurrency(statement.revenue.total)}`,
    "",
    "## COGS",
    ...statement.cogs.items.map(
      (item) => `- ${item.accountCode} ${item.accountName}: ${formatCurrency(item.amount)} (${item.transactionCount} transactions)`,
    ),
    `- Total COGS: ${formatCurrency(statement.cogs.total)}`,
    `- Gross Profit: ${formatCurrency(statement.grossProfit)} (${formatPct(statement.grossMarginPct)})`,
    "",
    "## Operating Expenses",
    ...statement.operatingExpenses.items.map(
      (item) => `- ${item.accountCode} ${item.accountName}: ${formatCurrency(item.amount)} (${item.transactionCount} transactions)`,
    ),
    `- Total Operating Expenses: ${formatCurrency(statement.operatingExpenses.total)}`,
    `- Net Operating Income: ${formatCurrency(statement.netOperatingIncome)} (${formatPct(statement.netMarginPct)})`,
    "",
    "## Data Sources",
    `- Notion transactions: ${statement.dataSourceCounts.notionTransactions}`,
    `- Shopify orders cross-checked: ${statement.dataSourceCounts.shopifyOrders}`,
    `- Amazon settlements cross-checked: ${statement.dataSourceCounts.amazonSettlements}`,
  ];

  if (statement.warnings.length > 0) {
    lines.push("", "## Warnings");
    for (const warning of statement.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join("\n");
}

export async function generateAndPostPnL(
  period: StatementPeriod,
  notionParentId?: string,
): Promise<{ statement: PnLStatement; notionPageId?: string }> {
  const statement = await generatePnL(period);
  const notionPageId = await createNotionPage({
    parent_id: notionParentId || MONTHLY_CLOSE_CHECKLIST_DB,
    title: `P&L — ${period.label}`,
    content: formatPnLAsMarkdown(statement),
  });

  return {
    statement,
    ...(notionPageId ? { notionPageId } : {}),
  };
}

export function buildMonthlyStatementPeriod(month?: number, year?: number): StatementPeriod {
  const now = new Date();
  const y = year || now.getUTCFullYear();
  const m = month || now.getUTCMonth() + 1;
  const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { startDate, endDate, label: periodLabel(startDate, endDate) };
}

export function buildQuarterlyStatementPeriod(month?: number, year?: number): StatementPeriod {
  const now = new Date();
  const y = year || now.getUTCFullYear();
  const referenceMonth = month || now.getUTCMonth() + 1;
  const quarter = Math.ceil(referenceMonth / 3);
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const startDate = `${y}-${String(startMonth).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(y, endMonth, 0)).toISOString().slice(0, 10);
  return { startDate, endDate, label: `Q${quarter} ${y}` };
}

export function buildYtdStatementPeriod(year?: number): StatementPeriod {
  const now = new Date();
  const y = year || now.getUTCFullYear();
  const startDate = `${y}-01-01`;
  const endDate = y === now.getUTCFullYear() ? now.toISOString().slice(0, 10) : `${y}-12-31`;
  return { startDate, endDate, label: `YTD ${y}` };
}
