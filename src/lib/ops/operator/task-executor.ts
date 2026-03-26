import {
  createQBOAccount,
  createQBOCustomer,
  createQBOInvoice,
  createQBOJournalEntry,
  createQBOVendor,
  getQBOAccounts,
  getQBOCustomers,
  getQBOVendors,
} from "@/lib/ops/qbo-client";
import { readEmail, searchEmails } from "@/lib/ops/gmail-reader";
import { runInvestorUpdatePackage } from "@/lib/ops/operator/reports/investor-update";
import { loadLearnedQboRules, resolveQboCategory } from "@/lib/ops/operator/qbo-resolution";
import { proposeAndMaybeExecute } from "@/lib/ops/abra-actions";

export type OperatorTaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "blocked"
  | "needs_approval";

export type OperatorTaskRow = {
  id: string;
  task_type: string;
  title: string;
  description: string | null;
  priority: "critical" | "high" | "medium" | "low";
  status: OperatorTaskStatus;
  source: string | null;
  assigned_to: string | null;
  requires_approval: boolean;
  approval_id: string | null;
  execution_params: Record<string, unknown> | null;
  execution_result: Record<string, unknown> | null;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  due_by: string | null;
  depends_on: string[] | null;
  tags: string[] | null;
};

export type OperatorExecutionSummary = {
  scanned: number;
  completed: number;
  failed: number;
  blocked: number;
  needsApproval: number;
  results: Array<{
    taskId: string;
    taskType: string;
    status: OperatorTaskStatus;
    message: string;
  }>;
};

type QBOAccount = {
  Id?: string;
  Name?: string;
  AccountType?: string;
  AcctNum?: string;
  AccountSubType?: string;
};

type QBOVendor = {
  Id?: string;
  DisplayName?: string;
  CompanyName?: string;
};

type QBOPurchase = {
  Id?: string;
  SyncToken?: string;
  PaymentType?: string;
  AccountRef?: { value?: string; name?: string };
  CreditCardAccountRef?: { value?: string; name?: string };
  PrivateNote?: string;
  TxnDate?: string;
  TotalAmt?: number;
  Line?: Array<{
    Id?: string;
    Amount?: number;
    Description?: string;
    DetailType?: string;
    AccountBasedExpenseLineDetail?: {
      AccountRef?: { value?: string; name?: string };
      BillableStatus?: string;
      CustomerRef?: { value?: string; name?: string };
      ClassRef?: { value?: string; name?: string };
      TaxCodeRef?: { value?: string; name?: string };
    };
  }>;
  EntityRef?: { name?: string; value?: string };
};

type AbraChatResponse = {
  reply?: string;
};

type ExecuteTaskResult = {
  status: "completed" | "needs_approval";
  message: string;
  data?: Record<string, unknown>;
};

const REVENUE_ACCOUNT_METRIC_MAP: Record<string, { metricNames: string[]; qboAccountId: number; label: string }> = {
  "4100": { metricNames: ["daily_revenue_amazon"], qboAccountId: 171, label: "Amazon revenue" },
  "4200": { metricNames: ["daily_revenue_shopify"], qboAccountId: 172, label: "Shopify DTC revenue" },
  "4300": { metricNames: ["daily_revenue_wholesale"], qboAccountId: 173, label: "Wholesale revenue" },
  "4400": { metricNames: ["daily_revenue_faire", "daily_revenue_wholesale"], qboAccountId: 174, label: "Faire revenue" },
};

const POWERS_EMAIL = "gregk@powers-inc.com";
const WHOLESALE_UNIT_PRICE = 2.1;
const CONTROL_CHANNEL_ID = "C0ALS6W7VB4";
const CATEGORIZATION_ACCOUNT_FALLBACKS: Record<string, { name: string; accountType: string; acctNum?: string; accountSubType?: string }> = {
  "179": { name: "COGS Packaging", accountType: "Cost of Goods Sold", acctNum: "5300" },
  "175": { name: "COGS general", accountType: "Cost of Goods Sold", acctNum: "5100" },
  "167": { name: "Investor Loan - Rene", accountType: "Long Term Liability", acctNum: "2300" },
};

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
    throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${text.slice(0, 500)}`);
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

function getQBOBaseUrl(realmId: string): string {
  const host = process.env.QBO_SANDBOX === "true"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
  return `${host}/v3/company/${realmId}`;
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

async function qboQuery<T>(query: string): Promise<T | null> {
  const [{ getValidAccessToken, getRealmId }] = await Promise.all([
    import("@/lib/ops/qbo-auth"),
  ]);
  const accessToken = await getValidAccessToken();
  const realmId = await getRealmId();
  if (!accessToken || !realmId) return null;

  const res = await fetch(
    `${getQBOBaseUrl(realmId)}/query?query=${encodeURIComponent(query)}&minorversion=73`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function qboUpdatePurchase(
  purchaseId: string,
  syncToken: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: string }> {
  const [{ getValidAccessToken, getRealmId }] = await Promise.all([
    import("@/lib/ops/qbo-auth"),
  ]);
  const accessToken = await getValidAccessToken();
  const realmId = await getRealmId();
  if (!accessToken || !realmId) return { ok: false, status: 401, body: "QBO auth unavailable" };

  const res = await fetch(`${getQBOBaseUrl(realmId)}/purchase?minorversion=73`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      sparse: true,
      Id: purchaseId,
      SyncToken: syncToken,
      ...body,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  return {
    ok: res.ok,
    status: res.status,
    body: await res.text().catch(() => ""),
  };
}

async function fetchPurchaseById(purchaseId: string): Promise<QBOPurchase | null> {
  const result = await qboQuery<{ QueryResponse?: { Purchase?: QBOPurchase[] } }>(
    `SELECT * FROM Purchase WHERE Id = '${purchaseId}' MAXRESULTS 1`,
  );
  return result?.QueryResponse?.Purchase?.[0] || null;
}

function buildPurchaseLinesWithAccount(
  purchase: QBOPurchase,
  accountId: string,
  accountName?: string,
): Array<Record<string, unknown>> {
  const lines = Array.isArray(purchase.Line) ? purchase.Line : [];
  if (!lines.length) {
    const amount = Number(purchase.TotalAmt || 0);
    return amount
      ? [{
          Amount: amount,
          DetailType: "AccountBasedExpenseLineDetail",
          Description: purchase.PrivateNote || `Purchase ${purchase.Id || ""}`.trim(),
          AccountBasedExpenseLineDetail: {
            AccountRef: {
              value: accountId,
              ...(accountName ? { name: accountName } : {}),
            },
          },
        }]
      : [];
  }

  return lines.map((line) => ({
    ...(line.Id ? { Id: line.Id } : {}),
    Amount: Number(line.Amount || 0),
    Description: line.Description || undefined,
    DetailType: line.DetailType || "AccountBasedExpenseLineDetail",
    AccountBasedExpenseLineDetail: {
      ...(line.AccountBasedExpenseLineDetail?.BillableStatus
        ? { BillableStatus: line.AccountBasedExpenseLineDetail.BillableStatus }
        : {}),
      ...(line.AccountBasedExpenseLineDetail?.CustomerRef
        ? { CustomerRef: line.AccountBasedExpenseLineDetail.CustomerRef }
        : {}),
      ...(line.AccountBasedExpenseLineDetail?.ClassRef
        ? { ClassRef: line.AccountBasedExpenseLineDetail.ClassRef }
        : {}),
      ...(line.AccountBasedExpenseLineDetail?.TaxCodeRef
        ? { TaxCodeRef: line.AccountBasedExpenseLineDetail.TaxCodeRef }
        : {}),
      AccountRef: {
        value: accountId,
        ...(accountName ? { name: accountName } : {}),
      },
    },
  }));
}

function buildPurchaseUpdateWithVendor(
  purchase: QBOPurchase,
  vendorId: string,
  vendorName: string,
): Record<string, unknown> {
  return {
    sparse: false,
    Id: purchase.Id,
    SyncToken: purchase.SyncToken,
    ...(purchase.AccountRef ? { AccountRef: purchase.AccountRef } : {}),
    ...(purchase.CreditCardAccountRef ? { CreditCardAccountRef: purchase.CreditCardAccountRef } : {}),
    ...(purchase.PaymentType ? { PaymentType: purchase.PaymentType } : {}),
    ...(purchase.PrivateNote ? { PrivateNote: purchase.PrivateNote } : {}),
    ...(purchase.TxnDate ? { TxnDate: purchase.TxnDate } : {}),
    EntityRef: {
      value: vendorId,
      name: vendorName,
      type: "Vendor",
    },
    ...(Array.isArray(purchase.Line) ? { Line: purchase.Line } : {}),
  };
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeVendorKey(value: string | null | undefined): string {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(inc|llc|co|company|corp|corporation|subscription|payments?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function vendorMatches(candidate: QBOVendor, targetName: string): boolean {
  const target = normalizeVendorKey(targetName);
  if (!target) return false;
  const names = [candidate.DisplayName, candidate.CompanyName]
    .map(normalizeVendorKey)
    .filter(Boolean);
  return names.some((name) => name === target || name.includes(target) || target.includes(name));
}

function extractAccountCode(value: unknown): string | null {
  const match = String(value || "").match(/^(\d{4})/);
  return match ? match[1] : null;
}

function priorityWeight(priority: OperatorTaskRow["priority"]): number {
  switch (priority) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    default:
      return 3;
  }
}

function canPrepareApprovalTask(task: OperatorTaskRow): boolean {
  return task.task_type === "email_draft_response" ||
    task.task_type === "generate_wholesale_invoice" ||
    task.task_type === "inventory_reorder_po" ||
    task.task_type === "vendor_followup" ||
    task.task_type === "distributor_followup";
}

function canExecuteTask(task: OperatorTaskRow): boolean {
  if (
    (task.task_type === "email_draft_response" ||
      task.task_type === "vendor_followup" ||
      task.task_type === "distributor_followup") &&
    String(task.execution_result?.approval_id || "").trim()
  ) {
    return false;
  }
  if (canPrepareApprovalTask(task)) return true;
  if (task.task_type === "qbo_record_from_email") return !task.requires_approval;
  return !task.requires_approval;
}

async function fetchAccountsViaApi(): Promise<QBOAccount[]> {
  const res = await fetch(`${getInternalBaseUrl()}/api/ops/qbo/query?type=accounts`, {
    headers: {
      ...getInternalHeaders(),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { accounts?: QBOAccount[] };
  return Array.isArray(data.accounts) ? data.accounts : [];
}

async function ensureCategorizationAccount(targetId: string, targetName: string): Promise<{ accountId: string; accountName: string }> {
  const allAccounts = [
    ...((((await getQBOAccounts())?.QueryResponse?.Account as QBOAccount[]) || [])),
    ...(await fetchAccountsViaApi()),
  ].filter((account, index, arr) => {
    const id = String(account.Id || "");
    return id ? arr.findIndex((item) => String(item.Id || "") === id) === index : true;
  });

  const direct = allAccounts.find((account) => String(account.Id || "") === targetId);
  if (direct?.Id) {
    return { accountId: String(direct.Id), accountName: String(direct.Name || targetName || targetId) };
  }

  const byName = allAccounts.find((account) => normalizeText(String(account.Name || "")) === normalizeText(targetName));
  if (byName?.Id) {
    return { accountId: String(byName.Id), accountName: String(byName.Name || targetName || targetId) };
  }

  const fallback = CATEGORIZATION_ACCOUNT_FALLBACKS[targetId];
  if (!fallback) {
    return { accountId: targetId, accountName: targetName || targetId };
  }

  const created = await createQBOAccount({
    Name: fallback.name,
    AccountType: fallback.accountType,
    ...(fallback.accountSubType ? { AccountSubType: fallback.accountSubType } : {}),
    ...(fallback.acctNum ? { AcctNum: fallback.acctNum } : {}),
    Description: `Created automatically by Abra operator to support transaction categorization.`,
  }).catch(() => null);

  const createdEntity = ((created as Record<string, unknown>)?.Account || created || null) as Record<string, unknown> | null;
  const createdId = String(createdEntity?.Id || "");
  if (createdId) {
    return { accountId: createdId, accountName: String(createdEntity?.Name || fallback.name) };
  }

  const refreshed = [
    ...((((await getQBOAccounts())?.QueryResponse?.Account as QBOAccount[]) || [])),
    ...(await fetchAccountsViaApi()),
  ];
  const refreshedMatch = refreshed.find((account) => normalizeText(String(account.Name || "")) === normalizeText(fallback.name));
  if (refreshedMatch?.Id) {
    return { accountId: String(refreshedMatch.Id), accountName: String(refreshedMatch.Name || fallback.name) };
  }

  throw new Error(`Unable to resolve QBO account ${targetId} ${targetName}`.trim());
}

async function markNeedsApproval(task: OperatorTaskRow, message: string, result?: Record<string, unknown>) {
  await sbFetch(`/rest/v1/abra_operator_tasks?id=eq.${task.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "needs_approval",
      requires_approval: true,
      execution_result: result || null,
      error_message: message.slice(0, 1000),
      completed_at: null,
    }),
  });
}

export async function createOperatorTasks(
  tasks: Array<{
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
  }>,
): Promise<number> {
  if (!tasks.length) return 0;

  const recent = await sbFetch<OperatorTaskRow[]>(
    `/rest/v1/abra_operator_tasks?select=id,task_type,status,execution_params,created_at,completed_at,retry_count,max_retries&created_at=gte.${encodeURIComponent(
      new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    )}&limit=1000`,
  ).catch(() => []);

  const inserts = tasks.filter((task) => {
    const naturalKey = normalizeText(String(task.execution_params?.natural_key || ""));
    if (!naturalKey) return true;

    const existing = (Array.isArray(recent) ? recent : []).filter((row) =>
      normalizeText(String(row.execution_params?.natural_key || "")) === naturalKey,
    );
    if (!existing.length) return true;

    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    for (const row of existing) {
      if (row.status === "pending" || row.status === "in_progress" || row.status === "needs_approval") {
        return false;
      }
      if (row.status === "completed") {
        const completedAt = row.completed_at || row.created_at;
        if (!completedAt || now - new Date(completedAt).getTime() < sevenDaysMs) {
          return false;
        }
      }
      if ((row.status === "failed" || row.status === "blocked") && row.retry_count < row.max_retries) {
        return false;
      }
    }

    return true;
  });
  if (!inserts.length) return 0;

  await sbFetch<OperatorTaskRow[]>("/rest/v1/abra_operator_tasks", {
    method: "POST",
    body: JSON.stringify(
      inserts.map((task) => ({
        task_type: task.task_type,
        title: task.title,
        description: task.description || null,
        priority: task.priority || "medium",
        status:
          task.requires_approval && !(
            task.task_type === "email_draft_response" ||
            task.task_type === "generate_wholesale_invoice" ||
            task.task_type === "inventory_reorder_po" ||
            task.task_type === "vendor_followup" ||
            task.task_type === "distributor_followup"
          )
            ? "needs_approval"
            : "pending",
        source: task.source || "scheduler",
        assigned_to: task.assigned_to || "abra",
        requires_approval: task.requires_approval ?? false,
        execution_params: task.execution_params || {},
        due_by: task.due_by || null,
        tags: task.tags || [],
      })),
    ),
  });

  return inserts.length;
}

async function listReadyTasks(limit: number): Promise<OperatorTaskRow[]> {
  const rows = await sbFetch<OperatorTaskRow[]>(
    `/rest/v1/abra_operator_tasks?select=*&status=in.(pending,failed)&order=created_at.asc&limit=${Math.max(limit * 4, 40)}`,
  ).catch(() => []);

  const executable = (Array.isArray(rows) ? rows : [])
    .filter((row) => canExecuteTask(row))
    .filter((row) => row.retry_count < row.max_retries)
    .filter((row) =>
      row.task_type === "qbo_categorize" ||
      row.task_type === "qbo_assign_vendor" ||
      row.task_type === "qbo_record_transaction" ||
      row.task_type === "qbo_revenue_gap" ||
      row.task_type === "email_draft_response" ||
      row.task_type === "qbo_record_from_email" ||
      row.task_type === "generate_wholesale_invoice" ||
      row.task_type === "po_received" ||
      row.task_type === "generate_investor_update" ||
      row.task_type === "inventory_reorder_po" ||
      row.task_type === "vendor_followup" ||
      row.task_type === "distributor_followup",
    )
    .sort((a, b) => {
      const byPriority = priorityWeight(a.priority) - priorityWeight(b.priority);
      if (byPriority !== 0) return byPriority;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

  return executable.slice(0, limit);
}

async function claimTask(task: OperatorTaskRow): Promise<OperatorTaskRow | null> {
  const rows = await sbFetch<OperatorTaskRow[]>(
    `/rest/v1/abra_operator_tasks?id=eq.${task.id}&status=in.(pending,failed)`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status: "in_progress",
        started_at: new Date().toISOString(),
        error_message: null,
      }),
    },
  ).catch(() => []);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function completeTask(taskId: string, result: Record<string, unknown>) {
  await sbFetch(`/rest/v1/abra_operator_tasks?id=eq.${taskId}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "completed",
      execution_result: result,
      completed_at: new Date().toISOString(),
      error_message: null,
    }),
  });
}

async function failTask(task: OperatorTaskRow, message: string, status: OperatorTaskStatus = "failed") {
  await sbFetch(`/rest/v1/abra_operator_tasks?id=eq.${task.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status,
      error_message: message.slice(0, 1000),
      retry_count: task.retry_count + (status === "failed" ? 1 : 0),
      completed_at: status === "failed" ? null : new Date().toISOString(),
    }),
  });
}

async function executeCategorizeTask(task: OperatorTaskRow): Promise<ExecuteTaskResult> {
  const transactionId = String(task.execution_params?.transactionId || "");
  const requestedAccountId = String(task.execution_params?.suggestedAccountId || "");
  const requestedAccountName = String(task.execution_params?.suggestedAccountName || "");
  if (!transactionId) throw new Error("Missing transactionId");
  if (!requestedAccountId) throw new Error("Missing suggestedAccountId");

  const { accountId: suggestedAccountId, accountName: suggestedAccountName } = await ensureCategorizationAccount(
    requestedAccountId,
    requestedAccountName,
  );

  const purchase = await fetchPurchaseById(transactionId);
  if (!purchase?.Id || !purchase.SyncToken) {
    throw new Error(`Purchase ${transactionId} not found`);
  }

  const updated = await qboUpdatePurchase(purchase.Id, purchase.SyncToken, {
    sparse: false,
    ...(purchase.AccountRef ? { AccountRef: purchase.AccountRef } : {}),
    ...(purchase.CreditCardAccountRef ? { CreditCardAccountRef: purchase.CreditCardAccountRef } : {}),
    ...(purchase.PaymentType ? { PaymentType: purchase.PaymentType } : {}),
    ...(purchase.PrivateNote ? { PrivateNote: purchase.PrivateNote } : {}),
    ...(purchase.TxnDate ? { TxnDate: purchase.TxnDate } : {}),
    ...(purchase.EntityRef ? { EntityRef: purchase.EntityRef } : {}),
    Line: buildPurchaseLinesWithAccount(purchase, suggestedAccountId, suggestedAccountName || undefined),
  });
  if (updated.ok) {
    return {
      status: "completed",
      message: `Categorized transaction ${transactionId} to ${suggestedAccountName || suggestedAccountId}`,
      data: {
        transactionId,
        beforeAccountId: String(task.execution_params?.currentAccountId || ""),
        beforeAccountName: String(task.execution_params?.currentAccountName || ""),
        afterAccountId: suggestedAccountId,
        afterAccountName: suggestedAccountName,
        confidence: Number(task.execution_params?.confidence || 0),
        reasoning: String(task.execution_params?.reasoning || ""),
        matchedPattern: String(task.execution_params?.matchedPattern || ""),
      },
    };
  }

  const res = await fetch(`${getInternalBaseUrl()}/api/ops/qbo/categorize-batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getInternalHeaders(),
    },
    body: JSON.stringify({
      mode: "execute",
      transactionIds: [transactionId],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(45000),
  });

  const text = await res.text();
  const data = text ? (JSON.parse(text) as { categorized?: number; errors?: number; error?: string }) : {};
  if (!res.ok) {
    throw new Error(String(data.error || `Categorization failed (${res.status})`).slice(0, 300));
  }
  if (Number(data.categorized || 0) < 1) {
    throw new Error(
      `No transaction categorized for ${transactionId}${updated.body ? ` (${updated.body.slice(0, 180)})` : ""}`,
    );
  }
  return {
    status: "completed",
    message: `Categorized transaction ${transactionId}`,
    data: {
      transactionId,
      beforeAccountId: String(task.execution_params?.currentAccountId || ""),
      beforeAccountName: String(task.execution_params?.currentAccountName || ""),
      afterAccountId: suggestedAccountId,
      afterAccountName: suggestedAccountName,
      confidence: Number(task.execution_params?.confidence || 0),
      reasoning: String(task.execution_params?.reasoning || ""),
      matchedPattern: String(task.execution_params?.matchedPattern || ""),
    },
  };
}

async function executeAssignVendorTask(task: OperatorTaskRow): Promise<string> {
  const purchaseId = String(task.execution_params?.purchaseId || "");
  const inferredVendorName = String(task.execution_params?.inferredVendorName || "");
  if (!purchaseId || !inferredVendorName) {
    throw new Error("Missing purchaseId or inferredVendorName");
  }

  const [vendorsResult, purchaseResult] = await Promise.all([
    getQBOVendors(),
    qboQuery<{ QueryResponse?: { Purchase?: QBOPurchase[] } }>(
      `SELECT * FROM Purchase WHERE Id = '${purchaseId}' MAXRESULTS 1`,
    ),
  ]);

  const vendors = ((vendorsResult?.QueryResponse?.Vendor as QBOVendor[]) || []);
  const matchedVendor = vendors.find((vendor) => vendorMatches(vendor, inferredVendorName));
  let vendorId = matchedVendor?.Id;

  if (!vendorId) {
    const created = await createQBOVendor({
      DisplayName: inferredVendorName,
      CompanyName: inferredVendorName,
      PrintOnCheckName: inferredVendorName,
    });
    const createdVendor = ((created as Record<string, unknown>)?.Vendor || created || {}) as Record<string, unknown>;
    vendorId = String(createdVendor.Id || "");
    if (!vendorId) throw new Error(`Failed to create vendor ${inferredVendorName}`);
  }

  const purchase = purchaseResult?.QueryResponse?.Purchase?.[0];
  if (!purchase?.Id || !purchase.SyncToken) {
    throw new Error(`Purchase ${purchaseId} not found`);
  }
  if (normalizeVendorKey(purchase.EntityRef?.name) === normalizeVendorKey(inferredVendorName)) {
    return `Vendor ${inferredVendorName} already assigned to purchase ${purchaseId}`;
  }

  const attempts = [
    { EntityRef: { value: vendorId, name: inferredVendorName, type: "Vendor" } },
    buildPurchaseUpdateWithVendor(purchase, vendorId, inferredVendorName),
    { VendorRef: { value: vendorId, name: inferredVendorName } },
  ];

  for (const payload of attempts) {
    const updated = await qboUpdatePurchase(purchase.Id, purchase.SyncToken, payload);
    if (updated.ok) {
      return `Assigned vendor ${inferredVendorName} to purchase ${purchaseId}`;
    }
  }
  throw new Error(`Failed to assign vendor ${inferredVendorName}`);
}

async function resolveJournalAccounts(task: OperatorTaskRow): Promise<{
  bankAccountId: string;
  targetAccountId: string;
  targetAccountName: string;
}> {
  const accounts = ((await getQBOAccounts())?.QueryResponse?.Account as QBOAccount[]) || [];
  if (!accounts.length) throw new Error("No QBO accounts available");

  const accountCode = extractAccountCode(task.execution_params?.accountCode);
  const description = normalizeText(String(task.execution_params?.description || ""));
  const isInvestorLoan =
    description.includes("rene") ||
    description.includes("gonzalez") ||
    description.includes("investor") ||
    description.includes("funding") ||
    normalizeText(String(task.execution_params?.kind || "")) === "transfer";

  const bankAccount =
    accounts.find((account) => account.AccountType === "Bank" && /checking/i.test(String(account.Name || ""))) ||
    accounts.find((account) => account.AccountType === "Bank");
  if (!bankAccount?.Id) throw new Error("No QBO bank account found");

  const targetAccount =
    (isInvestorLoan
      ? accounts.find((account) => String(account.AcctNum || "") === "2300")
      : null) ||
    accounts.find((account) => String(account.AcctNum || "") === String(accountCode || "")) ||
    null;

  if (!targetAccount?.Id) {
    throw new Error(`Unable to resolve target account ${accountCode || "unknown"}`);
  }

  return {
    bankAccountId: String(bankAccount.Id),
    targetAccountId: String(targetAccount.Id),
    targetAccountName: String(targetAccount.Name || targetAccount.AcctNum || "QBO Account"),
  };
}

async function executeRecordTransactionTask(task: OperatorTaskRow): Promise<string> {
  const amount = Math.abs(Number(task.execution_params?.amount || 0));
  const description = String(task.execution_params?.description || task.title || "Operator transaction");
  const date = String(task.execution_params?.date || new Date().toISOString().slice(0, 10));
  const kind = normalizeText(String(task.execution_params?.kind || "expense"));
  if (!amount) throw new Error("Missing amount");

  const { bankAccountId, targetAccountId, targetAccountName } = await resolveJournalAccounts(task);

  if (kind === "expense") {
    const imported = await fetch(`${getInternalBaseUrl()}/api/ops/qbo/import-batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalHeaders(),
      },
      body: JSON.stringify({
        transactions: [{
          date,
          description,
          amount,
          accountId: Number(targetAccountId),
          isIncome: false,
          bankAccountId: Number(bankAccountId),
        }],
      }),
      signal: AbortSignal.timeout(45000),
    });
    const data = (await imported.json().catch(() => ({}))) as { created?: number; error?: string };
    if (!imported.ok || Number(data.created || 0) < 1) {
      throw new Error(String(data.error || `Failed to create expense transaction (${imported.status})`).slice(0, 300));
    }
    return `Recorded expense ${description} to ${targetAccountName}`;
  }

  if (kind === "income") {
    const imported = await fetch(`${getInternalBaseUrl()}/api/ops/qbo/import-batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalHeaders(),
      },
      body: JSON.stringify({
        transactions: [{
          date,
          description,
          amount,
          accountId: Number(targetAccountId),
          isIncome: true,
          bankAccountId: Number(bankAccountId),
        }],
      }),
      signal: AbortSignal.timeout(45000),
    });
    const data = (await imported.json().catch(() => ({}))) as { created?: number; error?: string };
    if (!imported.ok || Number(data.created || 0) < 1) {
      throw new Error(String(data.error || `Failed to create income transaction (${imported.status})`).slice(0, 300));
    }
    return `Recorded income ${description} to ${targetAccountName}`;
  }

  const entry = await createQBOJournalEntry({
    TxnDate: date,
    PrivateNote: `Abra operator recorded known transaction: ${description}`,
    Line: [
      {
        DetailType: "JournalEntryLineDetail",
        Amount: amount,
        Description: description,
        JournalEntryLineDetail: {
          PostingType: "Debit",
          AccountRef: { value: bankAccountId },
        },
      },
      {
        DetailType: "JournalEntryLineDetail",
        Amount: amount,
        Description: description,
        JournalEntryLineDetail: {
          PostingType: "Credit",
          AccountRef: { value: targetAccountId },
        },
      },
    ],
  });
  if (!entry) {
    throw new Error(`Failed to create journal entry for ${description}`);
  }
  return `Recorded transfer ${description} to ${targetAccountName}`;
}

type KPIRevenueRow = {
  metric_name?: string | null;
  value?: number | null;
  captured_for_date?: string | null;
};

async function fetchRevenueGapAmount(accountCode: string): Promise<{
  amount: number;
  metricNames: string[];
  qboAccountId: number;
  label: string;
}> {
  const mapping = REVENUE_ACCOUNT_METRIC_MAP[accountCode];
  if (!mapping) {
    throw new Error(`No KPI mapping configured for revenue account ${accountCode}`);
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const startDate = monthStart.toISOString().slice(0, 10);
  const metricFilter = `(${mapping.metricNames.map((name) => encodeURIComponent(name)).join(",")})`;
  const rows = await sbFetch<KPIRevenueRow[]>(
    `/rest/v1/kpi_timeseries?window_type=eq.daily&metric_name=in.${metricFilter}&captured_for_date=gte.${startDate}&select=metric_name,value,captured_for_date&limit=5000`,
  ).catch(() => []);

  const amount = (Array.isArray(rows) ? rows : [])
    .filter((row) => mapping.metricNames.includes(String(row.metric_name || "")))
    .reduce((sum, row) => sum + (Number(row.value || 0) || 0), 0);

  return {
    amount,
    metricNames: mapping.metricNames,
    qboAccountId: mapping.qboAccountId,
    label: mapping.label,
  };
}

async function executeRevenueGapTask(task: OperatorTaskRow): Promise<ExecuteTaskResult> {
  const accountCode = String(task.execution_params?.accountCode || "");
  const accountName = String(task.execution_params?.accountName || "");
  if (!accountCode) throw new Error("Missing accountCode");

  const { amount, qboAccountId, label, metricNames } = await fetchRevenueGapAmount(accountCode);
  if (amount <= 0) {
    return {
      status: "completed",
      message: `No KPI revenue found to post for ${accountCode} ${accountName}`.trim(),
      data: { amount, metricNames, qboAccountId, skipped: true, accountCode, accountName },
    };
  }

  if (amount > 500) {
    return {
      status: "needs_approval",
      message: `Revenue gap for ${label} requires approval before posting $${amount.toFixed(2)} to QBO`,
      data: { amount, metricNames, qboAccountId, accountCode, accountName },
    };
  }

  const accounts = [
    ...(((await getQBOAccounts())?.QueryResponse?.Account as QBOAccount[]) || []),
    ...(await fetchAccountsViaApi()),
  ].filter((account, index, arr) => {
    const id = String(account.Id || "");
    return id ? arr.findIndex((item) => String(item.Id || "") === id) === index : true;
  });
  const bankAccount =
    accounts.find((account) => account.AccountType === "Bank" && /checking/i.test(String(account.Name || ""))) ||
    accounts.find((account) => account.AccountType === "Bank");
  if (!bankAccount?.Id) throw new Error("No QBO bank account found");

  const imported = await fetch(`${getInternalBaseUrl()}/api/ops/qbo/import-batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getInternalHeaders(),
    },
    body: JSON.stringify({
      transactions: [{
        date: new Date().toISOString().slice(0, 10),
        description: `Abra operator revenue sync — ${label} (${accountCode}${accountName ? ` ${accountName}` : ""})`,
        amount,
        accountId: qboAccountId,
        isIncome: true,
        bankAccountId: Number(bankAccount.Id),
      }],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(45000),
  });
  const data = (await imported.json().catch(() => ({}))) as { created?: number; error?: string };
  if (!imported.ok || Number(data.created || 0) < 1) {
    throw new Error(String(data.error || `Failed to record revenue gap deposit (${imported.status})`).slice(0, 300));
  }

  return {
    status: "completed",
    message: `Recorded $${amount.toFixed(2)} ${label} deposit to QBO`,
    data: { amount, metricNames, qboAccountId, accountCode, accountName },
  };
}

async function generateDraftViaChat(prompt: string, fallbackDraft?: string): Promise<string> {
  const res = await fetch(`${getInternalBaseUrl()}/api/ops/abra/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getInternalHeaders(),
    },
    body: JSON.stringify({
      message: prompt,
      history: [],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(55000),
  });
  if (!res.ok) {
    if (fallbackDraft) return fallbackDraft;
    throw new Error(`Abra chat draft generation failed (${res.status})`);
  }
  const data = (await res.json()) as AbraChatResponse;
  const reply = String(data.reply || "").trim();
  if (!reply) {
    if (fallbackDraft) return fallbackDraft;
    throw new Error("Abra chat returned an empty draft");
  }
  return reply;
}

async function queueApprovalDraftEmail(params: {
  to: string;
  subject: string;
  body: string;
  taskLabel: string;
}): Promise<string> {
  let draftBody = params.body.trim();
  if (!/best,\s*ben/i.test(draftBody)) {
    draftBody = `${draftBody}\n\nBest,\nBen`;
  }

  const outcome = await proposeAndMaybeExecute({
    action_type: "send_email",
    title: params.taskLabel,
    description: params.taskLabel,
    department: "finance",
    risk_level: "medium",
    requires_approval: true,
    params: {
      to: params.to,
      subject: params.subject,
      body: draftBody,
    },
  });
  return outcome.approval_id;
}

function normalizeSubjectForThread(subject: string): string {
  return subject.replace(/^(re|fwd?):\s*/gi, "").replace(/\s+/g, " ").trim();
}

async function buildEmailThreadContext(messageId: string, senderEmail: string, subject: string): Promise<string> {
  const primary = await readEmail(messageId);
  const normalizedSubject = normalizeSubjectForThread(subject).replace(/"/g, "");
  const queryParts = [
    normalizedSubject ? `subject:"${normalizedSubject}"` : "",
    senderEmail ? `(from:${senderEmail} OR to:${senderEmail})` : "",
    "newer_than:60d",
  ].filter(Boolean);
  const threadMessages = await searchEmails(queryParts.join(" "), 20).catch(() => []);

  const allMessages = [
    ...(primary ? [primary] : []),
    ...threadMessages,
  ];

  const seen = new Set<string>();
  const uniqueMessages = allMessages
    .filter((item) => item?.id && !seen.has(item.id) && (seen.add(item.id), true))
    .sort((a, b) => new Date(a.date || "").getTime() - new Date(b.date || "").getTime());

  return uniqueMessages
    .map((entry) =>
      [
        `From: ${entry.from}`,
        `To: ${entry.to}`,
        `Date: ${entry.date}`,
        `Subject: ${entry.subject}`,
        "",
        String(entry.body || "").trim(),
      ].join("\n"),
    )
    .join("\n\n---\n\n")
    .slice(0, 12000);
}

async function executeEmailDraftResponseTask(task: OperatorTaskRow): Promise<ExecuteTaskResult> {
  const messageId = String(task.execution_params?.message_id || "");
  const sender = String(task.execution_params?.sender || "");
  const senderEmail = String(task.execution_params?.sender_email || "");
  const subject = String(task.execution_params?.subject || "Re: (no subject)");
  if (!messageId || !senderEmail) throw new Error("Missing message_id or sender_email");

  const threadText = await buildEmailThreadContext(messageId, senderEmail, subject);
  if (!threadText) throw new Error(`Email thread ${messageId} could not be read`);

  const draft = await generateDraftViaChat(
    [
      "Draft a professional reply to this email thread. Return only the email body, no commentary.",
      "",
      "Use this 6-step framework internally before writing:",
      "1. Full context of the thread",
      "2. Questions that need answering",
      "3. Answers we already know",
      "4. Information that must NOT leave the company (COGS, margins, costs)",
      "5. Best-interest framing for USA Gummies",
      "6. Draft the response",
      "",
      "Hard rule: Do NOT include any cost, margin, or COGS information.",
      "Reply as Ben Stutman, Founder, USA Gummies.",
      "",
      `Sender: ${sender}`,
      `Subject: ${subject}`,
      "",
      `Thread:\n${threadText}`,
    ].join("\n"),
    `Hi ${sender.split("<")[0].trim() || senderEmail.split("@")[0]},\n\nThanks for the note. I reviewed the thread regarding "${subject}". I’m on it and will follow up with the specific details requested shortly.\n\nBest,\nBen`,
  );

  const approvalId = await queueApprovalDraftEmail({
    to: senderEmail,
    subject: subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`,
    body: draft,
    taskLabel: `Draft reply to ${sender || senderEmail}`,
  });

  return {
    status: "completed",
    message: `Queued draft reply approval ${approvalId} for ${sender || senderEmail}`,
    data: {
      approval_id: approvalId,
      sender,
      sender_email: senderEmail,
      subject,
      body_preview: String(draft).replace(/\s+/g, " ").trim().slice(0, 400),
    },
  };
}

async function executeQBORecordFromEmailTask(task: OperatorTaskRow): Promise<string> {
  const amount = Math.abs(Number(task.execution_params?.amount || 0));
  const description = String(task.execution_params?.description || task.title || "Email financial record");
  const date = String(task.execution_params?.date || new Date().toISOString().slice(0, 10));
  const vendor = String(task.execution_params?.vendor || "");
  const senderEmail = String(task.execution_params?.sender_email || "");
  if (!amount) throw new Error("Missing amount");

  const [accountsResult, vendorsResult, apiAccounts] = await Promise.all([
    getQBOAccounts(),
    getQBOVendors(),
    fetchAccountsViaApi(),
  ]);
  const accounts = [
    ...(((accountsResult?.QueryResponse?.Account as QBOAccount[]) || [])),
    ...apiAccounts,
  ].filter((account, index, arr) => {
    const id = String(account.Id || "");
    return id ? arr.findIndex((item) => String(item.Id || "") === id) === index : true;
  });
  const bankAccount =
    accounts.find((account) => account.AccountType === "Bank" && /checking/i.test(String(account.Name || ""))) ||
    accounts.find((account) => account.AccountType === "Bank");
  if (!bankAccount?.Id) throw new Error("No QBO bank account found");

  const learnedRules = await loadLearnedQboRules();
  const matchedRule = resolveQboCategory(`${vendor} ${description}`, amount, learnedRules);
  const mappedAccount =
    (matchedRule.accountId
      ? (
        accounts.find((account) => String(account.Id || "") === matchedRule.accountId) ||
        accounts.find((account) => normalizeText(String(account.Name || "")) === normalizeText(matchedRule.accountName))
      )
      : null) ||
    accounts.find((account) => String(account.Id || "") === "2") ||
    accounts.find((account) => /uncategorized/i.test(String(account.Name || "")));
  if (!mappedAccount?.Id) throw new Error("No fallback QBO expense account found");

  const imported = await fetch(`${getInternalBaseUrl()}/api/ops/qbo/import-batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getInternalHeaders(),
    },
    body: JSON.stringify({
      transactions: [{
        date,
        description: `${description}${vendor ? ` (${vendor})` : ""}`,
        amount,
        accountId: Number(mappedAccount.Id),
        isIncome: false,
        bankAccountId: Number(bankAccount.Id),
      }],
    }),
    signal: AbortSignal.timeout(45000),
  });

  const data = (await imported.json().catch(() => ({}))) as { created?: number; error?: string };
  if (!imported.ok || Number(data.created || 0) < 1) {
    throw new Error(String(data.error || `Failed to record email transaction (${imported.status})`).slice(0, 300));
  }

  const vendorRows = ((vendorsResult?.QueryResponse?.Vendor as QBOVendor[]) || []);
  const vendorFound = vendorRows.some((row) => vendorMatches(row, vendor || senderEmail));
  return `Recorded email-linked transaction ${description} to ${String(mappedAccount.Name || matchedRule.accountName || "Uncategorized Expense")}${vendorFound ? "" : " (vendor not yet in QBO vendor list)"}`;
}

async function executeVendorFollowupTask(task: OperatorTaskRow): Promise<ExecuteTaskResult> {
  const email = String(task.execution_params?.contact_email || "");
  const vendor = String(task.execution_params?.vendor || "vendor");
  const lastSubject = String(task.execution_params?.last_subject || "Quick follow-up");
  const bodyPreview = String(task.execution_params?.body_preview || "");
  if (!email) throw new Error("Missing contact_email");

  const draft = await generateDraftViaChat(
    `Draft a short follow-up email to ${vendor}. Return only the email body.\n\n` +
    `Last subject: ${lastSubject}\n` +
    `Previous context:\n${bodyPreview}`,
    `Hi ${vendor},\n\nFollowing up on "${lastSubject}" and checking whether anything further is needed from our side. Happy to keep things moving.\n\nBest,\nBen`,
  );

  const approvalId = await queueApprovalDraftEmail({
    to: email,
    subject: lastSubject.toLowerCase().startsWith("re:") ? lastSubject : `Re: ${lastSubject}`,
    body: draft,
    taskLabel: `Vendor follow-up: ${vendor}`,
  });

  return {
    status: "completed",
    message: `Queued vendor follow-up approval ${approvalId} for ${vendor}`,
    data: {
      approval_id: approvalId,
      sender: vendor,
      sender_email: email,
      subject: lastSubject,
      body_preview: String(draft).replace(/\s+/g, " ").trim().slice(0, 400),
    },
  };
}

async function executeDistributorFollowupTask(task: OperatorTaskRow): Promise<ExecuteTaskResult> {
  const email = String(task.execution_params?.email || "");
  const distributorName = String(task.execution_params?.distributor_name || "distributor");
  const shipDate = String(task.execution_params?.ship_date || "");
  const sampleDetails = String(task.execution_params?.sample_details || "");
  if (!email) throw new Error("Missing distributor email");

  const draft = await generateDraftViaChat(
    `Draft a follow-up email to ${distributorName} about a sample shipment. Return only the email body.\n\n` +
    `Ship date: ${shipDate}\n` +
    `Context:\n${sampleDetails}`,
    `Hi ${distributorName},\n\nFollowing up on the USA Gummies sample we sent around ${shipDate}. I wanted to see if you had a chance to review it and whether it makes sense to discuss next steps.\n\nBest,\nBen`,
  );

  const approvalId = await queueApprovalDraftEmail({
    to: email,
    subject: `Follow-up on USA Gummies sample`,
    body: draft,
    taskLabel: `Distributor follow-up: ${distributorName}`,
  });

  return {
    status: "completed",
    message: `Queued distributor follow-up approval ${approvalId} for ${distributorName}`,
    data: {
      approval_id: approvalId,
      sender: distributorName,
      sender_email: email,
      subject: "Follow-up on USA Gummies sample",
      body_preview: String(draft).replace(/\s+/g, " ").trim().slice(0, 400),
    },
  };
}

async function executeInventoryReorderPoTask(task: OperatorTaskRow): Promise<string> {
  const sku = String(task.execution_params?.sku || "");
  const productName = String(task.execution_params?.product_name || "inventory item");
  const currentStock = Number(task.execution_params?.current_stock || 0);
  const daysUntilStockout = Number(task.execution_params?.days_until_stockout || 0);
  const suggestedQty = Math.ceil(Number(task.execution_params?.suggested_reorder_qty || 0));
  const body = [
    "Hi Greg,",
    "",
    `We need to initiate a production run for ${productName}${sku ? ` (${sku})` : ""}.`,
    `Current stock is ${currentStock} units with roughly ${Number.isFinite(daysUntilStockout) ? daysUntilStockout.toFixed(1) : "unknown"} days of runway remaining.`,
    "",
    `Requested order: ${suggestedQty.toLocaleString()} units`,
    "Please confirm availability, lead time, and next steps.",
    "",
    "Best,",
    "Ben Stutman",
    "USA Gummies",
  ].join("\n");

  const approvalId = await queueApprovalDraftEmail({
    to: String(task.execution_params?.vendor_email || POWERS_EMAIL),
    subject: `Draft PO request — ${productName}${sku ? ` (${sku})` : ""}`,
    body,
    taskLabel: `Draft PO to Powers for ${productName}`,
  });

  return `Queued PO draft approval ${approvalId} for ${productName}`;
}

async function executeGenerateWholesaleInvoiceTask(task: OperatorTaskRow): Promise<string> {
  const quantity = Math.max(0, Number(task.execution_params?.quantity || task.execution_params?.units || 0));
  if (!quantity) throw new Error("Missing wholesale shipment quantity");
  const customerName = String(task.execution_params?.customer_name || "Inderbitzin");
  const sourceRef = String(task.execution_params?.source_ref || "");
  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const total = Number((quantity * WHOLESALE_UNIT_PRICE).toFixed(2));

  const invoiceRes = await fetch(`${getInternalBaseUrl()}/api/ops/qbo/invoice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getInternalHeaders(),
    },
    body: JSON.stringify({
      customerName,
      lineItems: [
        {
          description: `${quantity} wholesale units at $${WHOLESALE_UNIT_PRICE.toFixed(2)}/unit`,
          quantity,
          unitPrice: WHOLESALE_UNIT_PRICE,
        },
      ],
      dueDate,
      memo: `Wholesale shipment invoice. Terms: Net 30.${sourceRef ? ` Source: ${sourceRef}` : ""}`,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(45000),
  });
  const invoiceData = (await invoiceRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!invoiceRes.ok) {
    throw new Error(String(invoiceData.error || `QBO invoice draft creation failed (${invoiceRes.status})`).slice(0, 300));
  }

  const invoiceId = String(invoiceData.invoiceId || "");
  const docNumber = String(invoiceData.docNumber || invoiceId || "");
  if (!invoiceId && !docNumber) {
    throw new Error("QBO invoice draft creation failed");
  }

  await postFinancialsMessage(
    `🧾 Invoice ${docNumber || invoiceId} created for ${customerName} — $${total.toFixed(2)} for ${quantity} units. Awaiting approval before sending.`,
  );

  return `Created draft wholesale invoice ${docNumber || invoiceId} for ${customerName} totaling $${total.toFixed(2)}`;
}

async function findOrCreateCustomer(params: {
  customerName: string;
  customerEmail?: string;
}): Promise<string> {
  const customers = ((await getQBOCustomers())?.QueryResponse?.Customer as Array<Record<string, unknown>>) || [];
  const normalizedTarget = normalizeVendorKey(params.customerName);
  const existing = customers.find((customer) => {
    const displayName = normalizeVendorKey(String(customer.DisplayName || ""));
    const companyName = normalizeVendorKey(String(customer.CompanyName || ""));
    return displayName === normalizedTarget || companyName === normalizedTarget || displayName.includes(normalizedTarget);
  });
  const existingId = String(existing?.Id || "");
  if (existingId) return existingId;

  const created = await createQBOCustomer({
    DisplayName: params.customerName,
    CompanyName: params.customerName,
    ...(params.customerEmail ? { PrimaryEmailAddr: { Address: params.customerEmail } } : {}),
  }).catch(() => null);
  const createdEntity = ((created as Record<string, unknown>)?.Customer || created || null) as Record<string, unknown> | null;
  const createdId = String(createdEntity?.Id || "");
  if (!createdId) throw new Error(`Failed to create QBO customer ${params.customerName}`);
  return createdId;
}

async function writeOpenPoEntry(params: {
  poNumber: string;
  customerName: string;
  quantity: number;
  total: number;
  deliveryDate: string | null;
}): Promise<void> {
  const sourceRef = `open-po:${params.poNumber}`;
  const title = `Open PO: ${params.customerName} PO #${params.poNumber}`;
  const rawText =
    `Open PO: ${params.customerName} PO #${params.poNumber}, ${params.quantity} units, $${params.total.toFixed(2)}, ` +
    `due ${params.deliveryDate || "TBD"}`;
  const summary = rawText.slice(0, 500);
  const existing = await sbFetch<Array<{ id: string }>>(
    `/rest/v1/open_brain_entries?source_ref=eq.${encodeURIComponent(sourceRef)}&select=id&limit=1`,
  ).catch(() => []);

  if (existing[0]?.id) {
    await sbFetch(`/rest/v1/open_brain_entries?id=eq.${existing[0].id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title,
        raw_text: rawText,
        summary_text: summary,
      }),
    }).catch(() => {});
    return;
  }

  await sbFetch("/rest/v1/open_brain_entries", {
    method: "POST",
    body: JSON.stringify({
      source_type: "manual",
      source_ref: sourceRef,
      entry_type: "observation",
      title,
      raw_text: rawText,
      summary_text: summary,
      category: "sales",
      department: "sales",
      tags: [`po:${params.poNumber.toLowerCase()}`, "open-po"],
      processed: true,
    }),
  }).catch(() => {});
}

async function postSlackChannelMessage(channelId: string, text: string): Promise<void> {
  const token = (process.env.SLACK_BOT_TOKEN || "").trim();
  if (!token || !channelId) return;
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: channelId,
      text,
      mrkdwn: true,
      unfurl_links: false,
    }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => {});
}

async function executePoReceivedTask(task: OperatorTaskRow): Promise<string> {
  const poNumber = String(task.execution_params?.po_number || "").trim();
  const customerName = String(task.execution_params?.customer_name || "Customer").trim();
  const quantity = Math.max(0, Number(task.execution_params?.quantity || 0));
  const unitPrice = Math.max(0, Number(task.execution_params?.unit_price || 0));
  const deliveryDate = String(task.execution_params?.delivery_date || "").trim() || null;
  const shippingAddress = String(task.execution_params?.shipping_address || "").trim() || null;
  const needsShipping = Boolean(task.execution_params?.needs_shipping);
  const customerEmail = String(task.execution_params?.customer_email || "").trim();
  if (!poNumber || !quantity || !unitPrice) {
    throw new Error("Missing PO number, quantity, or unit price");
  }

  const customerId = customerName.toLowerCase() === "inderbitzin"
    ? "20"
    : await findOrCreateCustomer({ customerName, customerEmail });
  const total = Number((quantity * unitPrice).toFixed(2));
  const invoice = await createQBOInvoice({
    CustomerRef: { value: customerId },
    Line: [
      {
        Amount: total,
        DetailType: "SalesItemLineDetail",
        Description: "All American Gummy Bears 7.5oz",
        SalesItemLineDetail: {
          Qty: quantity,
          UnitPrice: unitPrice,
        },
      },
      ...(needsShipping
        ? [{
            Amount: 0,
            DetailType: "SalesItemLineDetail" as const,
            Description: `Shipping (TBD)${shippingAddress ? ` — ${shippingAddress}` : ""}`,
            SalesItemLineDetail: {
              Qty: 1,
              UnitPrice: 0,
            },
          }]
        : []),
    ],
    DueDate: deliveryDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    DocNumber: poNumber,
    ...(customerEmail ? { BillEmail: { Address: customerEmail } } : {}),
    CustomerMemo: {
      value: `PO ${poNumber}. Shipping cost to be determined when product ships.`,
    },
  }).catch(() => null);
  const invoiceEntity = ((invoice as Record<string, unknown>)?.Invoice || invoice || null) as Record<string, unknown> | null;
  const invoiceId = String(invoiceEntity?.Id || invoiceEntity?.DocNumber || "");
  if (!invoiceId) {
    throw new Error(`Failed to create QBO invoice draft for PO ${poNumber}`);
  }

  await writeOpenPoEntry({
    poNumber,
    customerName,
    quantity,
    total,
    deliveryDate,
  });

  await postSlackChannelMessage(CONTROL_CHANNEL_ID, `✅ PO #${poNumber} from ${customerName} logged. Invoice draft #${invoiceId} created in QBO. ${quantity} units, $${total.toFixed(2)}.`);
  await postSlackChannelMessage("C0AKG9FSC2J", `<@U0ALL27JM38> New PO #${poNumber} — Invoice draft created for $${total.toFixed(2)}. Needs shipping cost before sending.`);

  return `Logged PO #${poNumber} from ${customerName}. Created QBO invoice draft ${invoiceId} for $${total.toFixed(2)}.`;
}

async function executeGenerateInvestorUpdateTask(): Promise<string> {
  const result = await runInvestorUpdatePackage(true);
  if (!result.ran) {
    return "Investor update package skipped";
  }
  return `Generated investor update package for ${result.monthLabel}`;
}

async function executeTask(task: OperatorTaskRow): Promise<string | ExecuteTaskResult> {
  switch (task.task_type) {
    case "qbo_categorize":
      return executeCategorizeTask(task);
    case "qbo_assign_vendor":
      return executeAssignVendorTask(task);
    case "qbo_record_transaction":
      return executeRecordTransactionTask(task);
    case "email_draft_response":
      return executeEmailDraftResponseTask(task);
    case "qbo_record_from_email":
      return executeQBORecordFromEmailTask(task);
    case "qbo_revenue_gap":
      return executeRevenueGapTask(task);
    case "generate_wholesale_invoice":
      return executeGenerateWholesaleInvoiceTask(task);
    case "po_received":
      return executePoReceivedTask(task);
    case "generate_investor_update":
      return executeGenerateInvestorUpdateTask();
    case "inventory_reorder_po":
      return executeInventoryReorderPoTask(task);
    case "vendor_followup":
      return executeVendorFollowupTask(task);
    case "distributor_followup":
      return executeDistributorFollowupTask(task);
    default:
      throw new Error(`Unsupported operator task type: ${task.task_type}`);
  }
}

export async function executeOperatorTasks(limit = 10): Promise<OperatorExecutionSummary> {
  const ready = await listReadyTasks(limit);
  const summary: OperatorExecutionSummary = {
    scanned: ready.length,
    completed: 0,
    failed: 0,
    blocked: 0,
    needsApproval: 0,
    results: [],
  };

  for (const pending of ready) {
    const task = await claimTask(pending);
    if (!task) continue;

    try {
      if (task.requires_approval && !canPrepareApprovalTask(task)) {
        await failTask(task, "Task requires approval", "needs_approval");
        summary.needsApproval += 1;
        summary.results.push({
          taskId: task.id,
          taskType: task.task_type,
          status: "needs_approval",
          message: "Task requires approval",
        });
        continue;
      }

      const result = await executeTask(task);
      const finalResult = typeof result === "string"
        ? { status: "completed" as const, message: result, data: undefined }
        : result;

      if (finalResult.status === "needs_approval") {
        await markNeedsApproval(task, finalResult.message, {
          ok: false,
          requires_approval: true,
          ...(finalResult.data || {}),
        });
        summary.needsApproval += 1;
        summary.results.push({
          taskId: task.id,
          taskType: task.task_type,
          status: "needs_approval",
          message: finalResult.message,
        });
        continue;
      }

      await completeTask(task.id, {
        ok: true,
        message: finalResult.message,
        completed_at: new Date().toISOString(),
        ...(finalResult.data || {}),
      });
      summary.completed += 1;
      summary.results.push({
        taskId: task.id,
        taskType: task.task_type,
        status: "completed",
        message: finalResult.message,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Task execution failed";
      const exhausted = task.retry_count + 1 >= task.max_retries;
      await failTask(task, message, exhausted ? "blocked" : "failed");
      if (exhausted) {
        summary.blocked += 1;
        summary.results.push({
          taskId: task.id,
          taskType: task.task_type,
          status: "blocked",
          message,
        });
      } else {
        summary.failed += 1;
        summary.results.push({
          taskId: task.id,
          taskType: task.task_type,
          status: "failed",
          message,
        });
      }
    }
  }

  return summary;
}
