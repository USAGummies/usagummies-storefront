import { getQBOAccounts, getQBOTransactions, getQBOVendors } from "@/lib/ops/qbo-client";
import { queryLedgerSummary } from "@/lib/ops/abra-notion-write";

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
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://www.usagummies.com";
}

function getInternalHeaders(): HeadersInit {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  return cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {};
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

function buildCategorizeTasks(preview: CategorizePreviewRow[]): OperatorTaskInsert[] {
  return preview
    .filter((row) => row.suggestedAccountId && !row.needsReview)
    .map((row) => ({
      task_type: "qbo_categorize",
      title: `Categorize ${row.description} to ${row.suggestedAccountName}`,
      description: `Update QBO ${row.entityType.toLowerCase()} ${row.transactionId} dated ${row.date} from ${row.currentAccountName || "uncategorized"} to ${row.suggestedAccountName}.`,
      priority: row.isReneTransfer ? "high" : "medium",
      source: "gap_detector:qbo",
      assigned_to: "abra",
      execution_params: {
        natural_key: taskNaturalKey(["qbo_categorize", row.transactionId, row.suggestedAccountId]),
        transactionId: row.transactionId,
        entityType: row.entityType,
        description: row.description,
        amount: row.amount,
        date: row.date,
        suggestedAccountId: row.suggestedAccountId,
        suggestedAccountName: row.suggestedAccountName,
      },
      tags: ["qbo", "finance", "categorization"],
    }));
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

  const categorizeTasks = buildCategorizeTasks(preview);
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
