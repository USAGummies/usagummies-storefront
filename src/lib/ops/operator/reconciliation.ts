import { getVerifiedBalance } from "@/lib/ops/finance-truth";
import { readState, writeState } from "@/lib/ops/state";

type OperatorTaskInsert = {
  task_type: string;
  title: string;
  description?: string;
  priority?: "critical" | "high" | "medium" | "low";
  source?: string;
  assigned_to?: string;
  requires_approval?: boolean;
  execution_params?: Record<string, unknown>;
  due_by?: string;
  tags?: string[];
};

export type ReconciliationSummary = {
  ran: boolean;
  date: string;
  amazonRevenue: number;
  amazonDeposits: number;
  amazonFees: number;
  shopifyRevenue: number;
  shopifyDeposits: number;
  shopifyFees: number;
  plaidBalance: number;
  qboBookBalance: number;
  amazonDifference: number;
  shopifyDifference: number;
  bankDifference: number;
  discrepancies: number;
};

const STATE_KEY = "abra-operator-reconciliation-last-run" as never;
export const RECONCILIATION_SUMMARY_STATE_KEY = "abra-operator-reconciliation-summary" as never;
const RECONCILIATION_POSTED_DATES_STATE_KEY = "abra:reconciliation_posted_dates" as never;
const CONTROL_CHANNEL_ID = "C0ALS6W7VB4";

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Supabase not configured");
  return { baseUrl, serviceKey };
}

async function sbFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(15000),
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status})`);
  }
  return json as T;
}

function getInternalBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
    "https://www.usagummies.com"
  );
}

function getInternalHeaders(): HeadersInit {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  return cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {};
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayIso() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatCurrency(value: number): string {
  return `$${round2(value).toFixed(2)}`;
}

function buildNaturalKey(parts: Array<string | number>): string {
  return parts.map((part) => String(part)).join("|").toLowerCase();
}

async function fetchKpiRevenue(metricName: string, day: string): Promise<number> {
  const rows = await sbFetch<Array<{ value?: number | null }>>(
    `/rest/v1/kpi_timeseries?window_type=eq.daily&captured_for_date=eq.${day}&metric_name=eq.${metricName}&select=value&limit=10`,
  ).catch(() => []);
  return round2((rows || []).reduce((sum, row) => sum + (Number(row.value || 0) || 0), 0));
}

async function fetchPurchases(limit = 200): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(`${getInternalBaseUrl()}/api/ops/qbo/query?type=purchases&limit=${limit}`, {
    headers: getInternalHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { purchases?: Array<Record<string, unknown>> };
  return Array.isArray(data.purchases) ? data.purchases : [];
}

async function fetchPlaidBalance(): Promise<number> {
  const res = await fetch(`${getInternalBaseUrl()}/api/ops/plaid/balance`, {
    headers: getInternalHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return 0;
  const data = (await res.json().catch(() => ({}))) as {
    connected?: boolean;
    accounts?: Array<{ balances?: { current?: number; available?: number } }>;
  };
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  return round2(
    accounts.reduce(
      (sum, account) => sum + Number(account?.balances?.current ?? account?.balances?.available ?? 0),
      0,
    ),
  );
}

function depositMatchesChannel(purchase: Record<string, unknown>, keywords: string[]): boolean {
  const haystack = [
    purchase.Vendor,
    purchase.Note,
    purchase.BankAccount,
    ...(Array.isArray(purchase.Lines)
      ? purchase.Lines.flatMap((line) =>
          line && typeof line === "object"
            ? [String((line as Record<string, unknown>).Description || ""), String((line as Record<string, unknown>).Account || "")]
            : [],
        )
      : []),
  ]
    .join(" ")
    .toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

function lineAccountId(line: Record<string, unknown>): string {
  const accountRef =
    (line.AccountRef && typeof line.AccountRef === "object"
      ? (line.AccountRef as Record<string, unknown>).value
      : null) ||
    line.AccountId ||
    line.Account ||
    "";
  return String(accountRef || "").trim();
}

function purchaseMatchesAccount(purchase: Record<string, unknown>, accountIds: string[]): boolean {
  const ids = new Set(accountIds.map((id) => String(id).trim()));
  if (!ids.size) return false;
  const lines = Array.isArray(purchase.Lines) ? (purchase.Lines as Array<Record<string, unknown>>) : [];
  return lines.some((line) => ids.has(lineAccountId(line)));
}

function buildDiscrepancyTask(params: {
  source: "amazon" | "shopify" | "bank";
  expected: number;
  actual: number;
  detail: string;
  priority?: "high" | "medium";
}): OperatorTaskInsert {
  const difference = round2(Math.abs(params.expected - params.actual));
  return {
    task_type: "reconciliation_discrepancy",
    title: `Reconcile ${params.source} discrepancy — ${formatCurrency(difference)}`,
    description: params.detail,
    priority: params.priority || "high",
    source: "operator:reconciliation",
    assigned_to: "rene",
    requires_approval: true,
    execution_params: {
      natural_key: buildNaturalKey(["reconciliation_discrepancy", todayIso(), params.source, difference.toFixed(2)]),
      source: params.source,
      expected: round2(params.expected),
      actual: round2(params.actual),
      difference,
      detail: params.detail,
    },
    tags: ["finance", "reconciliation"],
  };
}

async function postFinancialsMessage(text: string): Promise<void> {
  const token = (process.env.SLACK_BOT_TOKEN || "").trim();
  if (!token) return;
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: CONTROL_CHANNEL_ID,
      text,
      mrkdwn: true,
      unfurl_links: false,
    }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => {});
}

function buildFeeTask(params: {
  source: "amazon_fee" | "shopify_fee";
  amount: number;
  detail: string;
}): OperatorTaskInsert {
  const sourceLabel = params.source === "amazon_fee" ? "Amazon fees" : "Shopify fees";
  const accountId = params.source === "amazon_fee" ? "122" : "122";
  return {
    task_type: "qbo_record_transaction",
    title: `Record ${sourceLabel} — ${formatCurrency(params.amount)}`,
    description: params.detail,
    priority: "medium",
    source: "operator:reconciliation",
    assigned_to: "rene",
    requires_approval: params.amount > 500,
    execution_params: {
      natural_key: buildNaturalKey(["reconciliation_fee", todayIso(), params.source, params.amount.toFixed(2)]),
      type: "expense",
      amount: round2(params.amount),
      account_id: accountId,
      account_name: "Merchant Fees",
      description: sourceLabel,
      reasoning: params.detail,
    },
    tags: ["finance", "reconciliation", "fees"],
  };
}

export async function runDailyFinancialReconciliation(): Promise<{
  tasks: OperatorTaskInsert[];
  summary: ReconciliationSummary;
}> {
  const lastRun = await readState<{ date?: string } | null>(STATE_KEY, null);
  const today = todayIso();
  if (lastRun?.date === today) {
    return {
      tasks: [],
      summary: {
        ran: false,
        date: today,
        amazonRevenue: 0,
        amazonDeposits: 0,
        amazonFees: 0,
        shopifyRevenue: 0,
        shopifyDeposits: 0,
        shopifyFees: 0,
        plaidBalance: 0,
        qboBookBalance: 0,
        amazonDifference: 0,
        shopifyDifference: 0,
        bankDifference: 0,
        discrepancies: 0,
      },
    };
  }

  const day = yesterdayIso();
  const [amazonRevenue, shopifyRevenue, purchases, plaidBalance, qboBook] = await Promise.all([
    fetchKpiRevenue("daily_revenue_amazon", day),
    fetchKpiRevenue("daily_revenue_shopify", day),
    fetchPurchases(200),
    fetchPlaidBalance(),
    getVerifiedBalance("Bank"),
  ]);

  const deposits = purchases.filter((purchase) => Number(purchase.Amount || 0) > 0 && String(purchase.Date || "").slice(0, 10) === day);
  const amazonDeposits = round2(
    deposits
      .filter((purchase) => depositMatchesChannel(purchase, ["amazon"]) || purchaseMatchesAccount(purchase, ["171"]))
      .reduce((sum, purchase) => sum + (Number(purchase.Amount || 0) || 0), 0),
  );
  const shopifyDeposits = round2(
    deposits
      .filter((purchase) => depositMatchesChannel(purchase, ["shopify", "stripe"]) || purchaseMatchesAccount(purchase, ["172"]))
      .reduce((sum, purchase) => sum + (Number(purchase.Amount || 0) || 0), 0),
  );
  const qboBookBalance = round2(qboBook.value || 0);

  const amazonDifference = round2(Math.abs(amazonRevenue - amazonDeposits));
  const shopifyDifference = round2(Math.abs(shopifyRevenue - shopifyDeposits));
  const bankDifference = round2(Math.abs(plaidBalance - qboBookBalance));
  const amazonFees = round2(Math.max(0, amazonRevenue - amazonDeposits));
  const shopifyFees = round2(Math.max(0, shopifyRevenue - shopifyDeposits));

  const tasks: OperatorTaskInsert[] = [];
  if (amazonDifference > 5) {
    tasks.push(
      buildDiscrepancyTask({
        source: "amazon",
        expected: amazonRevenue,
        actual: amazonDeposits,
        detail: `Amazon KPI revenue for ${day} is ${formatCurrency(amazonRevenue)} but QBO deposits total ${formatCurrency(amazonDeposits)}.`,
      }),
    );
  }
  if (shopifyDifference > 5) {
    tasks.push(
      buildDiscrepancyTask({
        source: "shopify",
        expected: shopifyRevenue,
        actual: shopifyDeposits,
        detail: `Shopify KPI revenue for ${day} is ${formatCurrency(shopifyRevenue)} but QBO deposits total ${formatCurrency(shopifyDeposits)}.`,
      }),
    );
  }
  if (amazonFees > 0) {
    tasks.push(
      buildFeeTask({
        source: "amazon_fee",
        amount: amazonFees,
        detail: `Amazon reconciliation for ${day}: KPI gross revenue ${formatCurrency(amazonRevenue)}, deposits ${formatCurrency(amazonDeposits)}, fees ${formatCurrency(amazonFees)}.`,
      }),
    );
  }
  if (shopifyFees > 0) {
    tasks.push(
      buildFeeTask({
        source: "shopify_fee",
        amount: shopifyFees,
        detail: `Shopify reconciliation for ${day}: KPI gross revenue ${formatCurrency(shopifyRevenue)}, deposits ${formatCurrency(shopifyDeposits)}, fees ${formatCurrency(shopifyFees)}.`,
      }),
    );
  }
  if (bankDifference > 5) {
    tasks.push(
      buildDiscrepancyTask({
        source: "bank",
        expected: plaidBalance,
        actual: qboBookBalance,
        detail: `Plaid live balance is ${formatCurrency(plaidBalance)} while QBO book balance is ${formatCurrency(qboBookBalance)}.`,
        priority: "medium",
      }),
    );
  }

  const summary: ReconciliationSummary = {
    ran: true,
    date: day,
    amazonRevenue,
    amazonDeposits,
    amazonFees,
    shopifyRevenue,
    shopifyDeposits,
    shopifyFees,
    plaidBalance,
    qboBookBalance,
    amazonDifference,
    shopifyDifference,
    bankDifference,
    discrepancies: tasks.length,
  };

  const amazonStatus = amazonDifference > 5 ? `⚠️ ${formatCurrency(amazonDifference)} unmatched` : "✅ matched";
  const shopifyStatus = shopifyDifference > 5 ? `⚠️ ${formatCurrency(shopifyDifference)} unmatched` : "✅ matched";
  const bankStatus =
    bankDifference > 5
      ? `Plaid ${formatCurrency(plaidBalance)} vs QBO ${formatCurrency(qboBookBalance)}`
      : "✅ matched";

  const postedDates = await readState<string[]>(RECONCILIATION_POSTED_DATES_STATE_KEY, []);
  const recentPostedDates = Array.isArray(postedDates) ? postedDates.slice(-30) : [];
  if (!recentPostedDates.includes(day)) {
    await postFinancialsMessage(
      `🔎 *Daily reconciliation* (${day})\n` +
        `• Amazon ${amazonStatus}\n` +
        `• Amazon reconciliation: ${formatCurrency(amazonRevenue)} gross, ${formatCurrency(amazonDeposits)} deposited, ${formatCurrency(amazonFees)} fees\n` +
        `• Shopify ${shopifyStatus}\n` +
        `• Shopify reconciliation: ${formatCurrency(shopifyRevenue)} gross, ${formatCurrency(shopifyDeposits)} deposited, ${formatCurrency(shopifyFees)} fees\n` +
        `• Bank balance: ${bankStatus}${bankDifference > 5 ? " (difference may be uncleared transactions)" : ""}`,
    );
    await writeState(RECONCILIATION_POSTED_DATES_STATE_KEY, [...recentPostedDates, day].slice(-30));
  }

  await writeState(STATE_KEY, { date: today });
  await writeState(RECONCILIATION_SUMMARY_STATE_KEY, summary);

  return { tasks, summary };
}
