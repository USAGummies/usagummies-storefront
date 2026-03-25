import { getQBOAccounts, getQBOTransactions, getQBOVendors } from "@/lib/ops/qbo-client";
import { queryLedgerSummary } from "@/lib/ops/abra-notion-write";
import { loadLearnedQboRules, resolveQboCategory } from "@/lib/ops/operator/qbo-resolution";

export type OperatorTaskPriority = "critical" | "high" | "medium" | "low";

export type OperatorTaskInsert = {
  task_type: string;
  title: string;
  description?: string;
  priority?: OperatorTaskPriority;
  source?: string;
  assigned_to?: string;
  requires_approval?: boolean;
  execution_params?: Record<string, unknown>;
  due_by?: string;
  tags?: string[];
};

export type QBOGapDetectorResult = {
  tasks: OperatorTaskInsert[];
  summary: {
    uncategorized: number;
    missingVendors: number;
    zeroRevenueAccounts: number;
    unrecordedKnownTransactions: number;
    categorizedTransactions: number;
    totalTransactions: number;
  };
};

type CategorizePreviewRow = {
  transactionId: string;
  entityType: "Purchase" | "Deposit";
  description: string;
  date: string;
  amount: number;
  currentAccountId: string;
  currentAccountName: string;
  suggestedAccountId: number | null;
  suggestedAccountName: string | null;
  confidence: number;
  needsReview: boolean;
  isReneTransfer: boolean;
  syncToken: string;
};

type QBOAccount = {
  Id?: string;
  Name?: string;
  AccountType?: string;
  AcctNum?: string;
  CurrentBalance?: number;
};

type QBOVendor = {
  Id?: string;
  DisplayName?: string;
  CompanyName?: string;
};

type QBOPurchase = {
  Id?: string;
  TxnDate?: string;
  TotalAmt?: number;
  PrivateNote?: string;
  EntityRef?: { value?: string; name?: string };
  Line?: Array<{ Description?: string; Amount?: number }>;
};

type LedgerTransaction = {
  name: string;
  amount: number;
  category: string | null;
  accountCode: string | null;
  vendor: string | null;
  date: string | null;
  status: string | null;
};

type ExistingReviewTaskRow = {
  id: string;
  title: string;
  status: string;
  execution_params: Record<string, unknown> | null;
};

const REVENUE_ACCOUNT_CODES = new Set(["4100", "4200", "4300", "4400"]);

const VENDOR_NAME_OVERRIDES: Array<{ test: RegExp; vendorName: string }> = [
  { test: /pirate ship/i, vendorName: "Pirate Ship" },
  { test: /anthropic|claude/i, vendorName: "Anthropic" },
  { test: /openai|chatgpt/i, vendorName: "OpenAI" },
  { test: /notion/i, vendorName: "Notion" },
  { test: /supabase/i, vendorName: "Supabase" },
  { test: /vercel/i, vendorName: "Vercel" },
  { test: /slack/i, vendorName: "Slack" },
  { test: /google ads|google\s\*svcs|google workspace/i, vendorName: "Google" },
  { test: /facebook|facebk|meta ads/i, vendorName: "Meta" },
  { test: /upwork/i, vendorName: "Upwork" },
  { test: /usps|u\.s\. post office/i, vendorName: "USPS" },
  { test: /fedex/i, vendorName: "FedEx" },
  { test: /shopify/i, vendorName: "Shopify" },
];

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

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials");
  }
  return { baseUrl, serviceKey };
}

async function sbFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const env = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(20000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status})`);
  }
  return json as T;
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function inferVendorName(description: string): string | null {
  for (const rule of VENDOR_NAME_OVERRIDES) {
    if (rule.test.test(description)) return rule.vendorName;
  }
  return null;
}

function taskNaturalKey(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => String(part || "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
}

function parseAccountCode(value: string | null | undefined): string | null {
  const match = String(value || "").match(/^(\d{4})/);
  return match ? match[1] : null;
}

function inferTransactionKind(tx: LedgerTransaction): "expense" | "income" | "transfer" {
  const code = parseAccountCode(tx.accountCode);
  if (code && REVENUE_ACCOUNT_CODES.has(code)) return "income";
  if ((tx.category || "").toLowerCase() === "transfer") return "transfer";
  return "expense";
}

function datesClose(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = new Date(`${a.slice(0, 10)}T00:00:00Z`).getTime();
  const right = new Date(`${b.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.abs(left - right) <= 3 * 24 * 60 * 60 * 1000;
}

function descriptionsOverlap(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

async function fetchCategorizePreview(): Promise<CategorizePreviewRow[]> {
  const res = await fetch(`${getInternalBaseUrl()}/api/ops/qbo/categorize-batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getInternalHeaders(),
    },
    body: JSON.stringify({ mode: "preview" }),
    cache: "no-store",
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { preview?: CategorizePreviewRow[] };
  return Array.isArray(data.preview) ? data.preview : [];
}

async function buildCategorizeTasks(preview: CategorizePreviewRow[]): Promise<OperatorTaskInsert[]> {
  const learnedRules = await loadLearnedQboRules();
  const tasks: OperatorTaskInsert[] = [];

  for (const row of preview) {
    if (row.entityType !== "Purchase") continue;

    const resolution = resolveQboCategory(row.description, row.amount, learnedRules);
    if (resolution.skip) continue;

    const baseParams = {
      transactionId: row.transactionId,
      entityType: row.entityType,
      description: row.description,
      amount: row.amount,
      date: row.date,
      currentAccountId: row.currentAccountId,
      currentAccountName: row.currentAccountName,
      confidence: resolution.confidence,
      reasoning: resolution.reasoning,
      matchedPattern: resolution.pattern,
      resolutionSource: resolution.source,
    };

    if (resolution.matched && resolution.accountId && resolution.confidence >= 80) {
      tasks.push({
        task_type: "qbo_categorize",
        title: `Categorize ${row.description} to ${resolution.accountName}`,
        description:
          `Update QBO purchase ${row.transactionId} dated ${row.date} from ${row.currentAccountName || "uncategorized"} to ${resolution.accountName}. ` +
          `Reason: ${resolution.reasoning}`,
        priority: resolution.confidence >= 95 || row.isReneTransfer ? "high" : "medium",
        source: "gap_detector:qbo",
        assigned_to: "abra",
        execution_params: {
          natural_key: taskNaturalKey(["qbo_categorize", row.transactionId, resolution.accountId]),
          suggestedAccountId: resolution.accountId,
          suggestedAccountName: resolution.accountName,
          ...baseParams,
        },
        tags: ["qbo", "finance", "categorization", "auto-resolved"],
      });
      continue;
    }

    tasks.push({
      task_type: "qbo_review_transaction",
      title: `Review uncategorized transaction ${row.description}`,
      description:
        resolution.confidence >= 50 && resolution.accountName
          ? `Potential match: ${resolution.accountName} (${resolution.confidence}% confidence). ${resolution.reasoning}`
          : `No confident categorization match found. ${resolution.reasoning}`,
      priority: "high",
      source: "gap_detector:qbo",
      assigned_to: "rene",
      requires_approval: true,
      execution_params: {
        natural_key: taskNaturalKey(["qbo_review_transaction", row.transactionId]),
        suggestedAccountId: resolution.accountId,
        suggestedAccountName: resolution.accountName,
        ...baseParams,
      },
      tags: ["qbo", "finance", "review"],
    });
  }

  return tasks;
}

function buildMissingVendorTasks(
  purchases: QBOPurchase[],
  vendorNames: Set<string>,
): OperatorTaskInsert[] {
  const tasks: OperatorTaskInsert[] = [];

  for (const purchase of purchases) {
    if (purchase.EntityRef?.value) continue;

    const description = String(
      purchase.PrivateNote ||
        purchase.Line?.find((line) => line.Description)?.Description ||
        `Purchase ${purchase.Id || ""}`,
    );
    const vendorName = inferVendorName(description);
    if (!vendorName) continue;

    const shouldCreateVendor = !vendorNames.has(normalizeText(vendorName));
    tasks.push({
      task_type: "qbo_assign_vendor",
      title: `${shouldCreateVendor ? "Create and assign" : "Assign"} vendor ${vendorName} to ${description}`,
      description: `Purchase ${purchase.Id || "unknown"} has no vendor assigned. Match it to ${vendorName}.`,
      priority: "medium",
      source: "gap_detector:qbo",
      assigned_to: "abra",
      execution_params: {
        natural_key: taskNaturalKey(["qbo_assign_vendor", purchase.Id, vendorName]),
        purchaseId: purchase.Id,
        purchaseDate: purchase.TxnDate || null,
        amount: Number(purchase.TotalAmt || 0),
        description,
        inferredVendorName: vendorName,
        createVendorIfMissing: shouldCreateVendor,
      },
      tags: ["qbo", "finance", "vendor"],
    });
  }

  return tasks;
}

function buildRevenueGapTasks(accounts: QBOAccount[]): OperatorTaskInsert[] {
  return accounts
    .filter((account) => REVENUE_ACCOUNT_CODES.has(String(account.AcctNum || "")))
    .filter((account) => Math.abs(Number(account.CurrentBalance || 0)) < 0.0001)
    .map((account) => ({
      task_type: "qbo_revenue_gap",
      title: `Review zero-balance revenue account ${account.AcctNum} ${account.Name || ""}`.trim(),
      description: `Revenue account ${account.Name || account.AcctNum || "unknown"} has a $0 balance. Confirm whether channel revenue has been posted into QBO.`,
      priority: "high" as const,
      source: "gap_detector:qbo",
      assigned_to: "abra",
      execution_params: {
        natural_key: taskNaturalKey(["qbo_revenue_gap", account.Id, account.AcctNum]),
        accountId: account.Id || null,
        accountCode: account.AcctNum || null,
        accountName: account.Name || null,
        currentBalance: Number(account.CurrentBalance || 0),
      },
      tags: ["qbo", "finance", "revenue"],
    }));
}

function buildKnownTransactionTasks(
  ledgerTransactions: LedgerTransaction[],
  purchases: QBOPurchase[],
): OperatorTaskInsert[] {
  const recentPurchases = purchases.map((purchase) => ({
    amount: Number(purchase.TotalAmt || 0),
    date: purchase.TxnDate || null,
    vendor: purchase.EntityRef?.name || null,
    description:
      purchase.PrivateNote ||
      purchase.Line?.find((line) => line.Description)?.Description ||
      null,
  }));

  const tasks: OperatorTaskInsert[] = [];

  for (const tx of ledgerTransactions) {
    if (!tx.date || !tx.accountCode) continue;
    const amount = Math.abs(Number(tx.amount || 0));
    if (!amount) continue;

    const status = normalizeText(tx.status);
    if (status && !status.includes("approved") && !status.includes("paid") && !status.includes("completed")) {
      continue;
    }

    const existsInQBO = recentPurchases.some((purchase) =>
      Math.abs(Math.abs(purchase.amount) - amount) < 0.01 &&
      datesClose(tx.date, purchase.date) &&
      (
        descriptionsOverlap(tx.name, purchase.description) ||
        descriptionsOverlap(tx.vendor, purchase.vendor)
      ),
    );
    if (existsInQBO) continue;

    const kind = inferTransactionKind(tx);
    const accountCode = parseAccountCode(tx.accountCode);
    if (!accountCode) continue;

    tasks.push({
      task_type: "qbo_record_transaction",
      title: `Record ${tx.name} in QBO`,
      description: `Ledger transaction for ${tx.name} on ${tx.date} does not appear in recent QBO activity.`,
      priority: amount > 500 ? "high" : "medium",
      source: "gap_detector:qbo",
      assigned_to: "abra",
      requires_approval: amount > 500,
      execution_params: {
        natural_key: taskNaturalKey(["qbo_record_transaction", tx.date, amount.toFixed(2), tx.name, accountCode]),
        amount,
        date: tx.date,
        description: tx.name,
        vendor: tx.vendor || null,
        accountCode,
        kind,
        category: tx.category,
      },
      tags: ["qbo", "finance", "ledger"],
    });
  }

  return tasks;
}

export async function detectQBOOperatorGaps(): Promise<QBOGapDetectorResult> {
  const [preview, accountsResult, vendorsResult, purchasesResult, ledgerResult] = await Promise.all([
    fetchCategorizePreview(),
    getQBOAccounts(),
    getQBOVendors(),
    getQBOTransactions(undefined, undefined, 200),
    queryLedgerSummary({ fiscalYear: String(new Date().getUTCFullYear()) }),
  ]);

  const accounts = ((accountsResult?.QueryResponse?.Account as QBOAccount[]) || []);
  const vendors = ((vendorsResult?.QueryResponse?.Vendor as QBOVendor[]) || []);
  const purchases = ((purchasesResult?.QueryResponse?.Purchase as QBOPurchase[]) || []);
  const vendorNames = new Set(
    vendors.flatMap((vendor) => [vendor.DisplayName, vendor.CompanyName].map(normalizeText)).filter(Boolean),
  );
  const recentLedger = (ledgerResult.transactions || []).filter((tx) => {
    if (!tx.date) return false;
    const ageMs = Date.now() - new Date(`${tx.date}T00:00:00Z`).getTime();
    return ageMs <= 30 * 24 * 60 * 60 * 1000;
  });

  const categorizeTasks = await buildCategorizeTasks(preview);
  const vendorTasks = buildMissingVendorTasks(purchases, vendorNames);
  const zeroRevenueTasks = buildRevenueGapTasks(accounts);
  const knownTransactionTasks = buildKnownTransactionTasks(recentLedger, purchases);

  return {
    tasks: [
      ...categorizeTasks,
      ...vendorTasks,
      ...zeroRevenueTasks,
      ...knownTransactionTasks,
    ],
    summary: {
      uncategorized: categorizeTasks.length,
      missingVendors: vendorTasks.length,
      zeroRevenueAccounts: zeroRevenueTasks.length,
      unrecordedKnownTransactions: knownTransactionTasks.length,
      categorizedTransactions: Math.max(0, purchases.length - categorizeTasks.length),
      totalTransactions: purchases.length,
    },
  };
}

export async function upgradeExistingQboReviewTasks(): Promise<number> {
  const learnedRules = await loadLearnedQboRules().catch(() => []);
  const rows = await sbFetch<ExistingReviewTaskRow[]>(
    "/rest/v1/abra_operator_tasks?select=id,title,status,execution_params&task_type=eq.qbo_review_transaction&status=in.(pending,needs_approval)&limit=200",
  ).catch(() => []);

  let upgraded = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const params = row.execution_params || {};
    const description = String(params.description || row.title || "");
    const amount = Number(params.amount || 0);
    const resolution = resolveQboCategory(description, amount, learnedRules);
    if (resolution.skip) {
      await sbFetch(`/rest/v1/abra_operator_tasks?id=eq.${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "completed",
          execution_result: {
            ok: true,
            skipped: true,
            reason: resolution.reasoning,
          },
          error_message: null,
          completed_at: new Date().toISOString(),
        }),
      }).catch(() => {});
      continue;
    }
    if (!(resolution.matched && resolution.accountId && resolution.confidence >= 80)) continue;

    await sbFetch(`/rest/v1/abra_operator_tasks?id=eq.${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        task_type: "qbo_categorize",
        title: `Categorize ${description} to ${resolution.accountName}`,
        description:
          resolution.confidence >= 95
            ? `Upgraded from review queue. Exact match to ${resolution.accountName}. ${resolution.reasoning}`
            : `Upgraded from review queue. ${resolution.reasoning}`,
        status: "pending",
        assigned_to: "abra",
        requires_approval: false,
        approval_id: null,
        execution_result: null,
        error_message: null,
        execution_params: {
          ...params,
          natural_key: taskNaturalKey(["qbo_categorize", String(params.transactionId || ""), resolution.accountId]),
          suggestedAccountId: resolution.accountId,
          suggestedAccountName: resolution.accountName,
          confidence: resolution.confidence,
          reasoning: resolution.reasoning,
          matchedPattern: resolution.pattern,
          resolutionSource: resolution.source,
        },
      }),
    }).catch(() => {});
    upgraded += 1;
  }

  return upgraded;
}
