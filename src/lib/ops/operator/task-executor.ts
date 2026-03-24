import {
  createQBOJournalEntry,
  createQBOVendor,
  getQBOAccounts,
  getQBOVendors,
} from "@/lib/ops/qbo-client";
import { readEmail, searchEmails } from "@/lib/ops/gmail-reader";
import { notify } from "@/lib/ops/notify";

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
};

type QBOVendor = {
  Id?: string;
  DisplayName?: string;
  CompanyName?: string;
};

type QBOPurchase = {
  Id?: string;
  SyncToken?: string;
  EntityRef?: { name?: string; value?: string };
};

type AbraChatResponse = {
  reply?: string;
};

const EMAIL_VENDOR_ACCOUNT_MAP: Array<{ test: RegExp; accountCode: string; label: string }> = [
  { test: /anthropic|claude/i, accountCode: "126", label: "Software & apps" },
  { test: /pirate ship/i, accountCode: "127", label: "Shipping & postage" },
  { test: /albanese/i, accountCode: "176", label: "COGS: Albanese" },
  { test: /belmark/i, accountCode: "177", label: "COGS: Belmark" },
  { test: /powers/i, accountCode: "178", label: "COGS: Powers" },
  { test: /shopify/i, accountCode: "126", label: "Software & apps" },
  { test: /amazon/i, accountCode: "122", label: "Merchant account fees" },
  { test: /geico/i, accountCode: "42", label: "Insurance" },
  { test: /google|facebook|meta/i, accountCode: "16", label: "Advertising" },
  { test: /office depot|uline/i, accountCode: "83", label: "Supplies" },
];

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
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://www.usagummies.com";
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
    task.task_type === "vendor_followup" ||
    task.task_type === "distributor_followup";
}

function canExecuteTask(task: OperatorTaskRow): boolean {
  if (canPrepareApprovalTask(task)) return true;
  if (task.task_type === "qbo_record_from_email") return !task.requires_approval;
  return !task.requires_approval;
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
      row.task_type === "email_draft_response" ||
      row.task_type === "qbo_record_from_email" ||
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

async function executeCategorizeTask(task: OperatorTaskRow): Promise<string> {
  const transactionId = String(task.execution_params?.transactionId || "");
  if (!transactionId) throw new Error("Missing transactionId");

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
    throw new Error(`No transaction categorized for ${transactionId}`);
  }
  return `Categorized transaction ${transactionId}`;
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

async function generateDraftViaChat(prompt: string): Promise<string> {
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
    throw new Error(`Abra chat draft generation failed (${res.status})`);
  }
  const data = (await res.json()) as AbraChatResponse;
  const reply = String(data.reply || "").trim();
  if (!reply) throw new Error("Abra chat returned an empty draft");
  return reply;
}

async function queueDraftReply(params: {
  to: string;
  senderName: string;
  subject: string;
  body: string;
  sourceEmailId?: string | null;
  taskLabel: string;
}): Promise<string> {
  const commandId = `cmd-${crypto.randomUUID().slice(0, 8)}`;
  let draftBody = params.body.trim();
  if (!/best,\s*ben/i.test(draftBody)) {
    draftBody = `${draftBody}\n\nBest,\nBen`;
  }

  await sbFetch("/rest/v1/abra_email_commands", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      id: commandId,
      status: "draft_reply_pending",
      sender_name: params.senderName,
      sender_email: params.to,
      subject: params.subject,
      task: params.taskLabel,
      draft_reply_subject: params.subject,
      draft_reply_body: draftBody,
      body_snippet: draftBody.slice(0, 500),
      ...(params.sourceEmailId ? { gmail_thread_id: params.sourceEmailId } : {}),
    }),
  });

  await notify({
    channel: "alerts",
    text:
      `📧 *Draft Reply Queued*\n` +
      `*To:* ${params.to}\n*Subject:* ${params.subject}\n\n` +
      `> ${draftBody.slice(0, 300).split("\n").join("\n> ")}\n\n` +
      `_Send with:_ \`/abra sendreply ${commandId}\` _or discard with:_ \`/abra deny ${commandId}\``,
  });

  return commandId;
}

async function executeEmailDraftResponseTask(task: OperatorTaskRow): Promise<string> {
  const messageId = String(task.execution_params?.message_id || "");
  const sender = String(task.execution_params?.sender || "");
  const senderEmail = String(task.execution_params?.sender_email || "");
  const subject = String(task.execution_params?.subject || "Re: (no subject)");
  if (!messageId || !senderEmail) throw new Error("Missing message_id or sender_email");

  const message = await readEmail(messageId);
  if (!message) throw new Error(`Email ${messageId} could not be read`);

  const threadMessages = await searchEmails(
    `subject:"${subject.replace(/^re:\s*/i, "").replace(/"/g, "")}" newer_than:30d`,
    10,
  );
  const threadText = threadMessages
    .slice(0, 6)
    .map((entry) => `From: ${entry.from}\nTo: ${entry.to}\nDate: ${entry.date}\nSubject: ${entry.subject}\n\n${entry.body}`)
    .join("\n\n---\n\n");

  const draft = await generateDraftViaChat(
    `Draft a reply to this email thread. Return only the email body, no commentary.\n\n` +
    `Sender: ${sender}\n` +
    `Subject: ${subject}\n\n` +
    `Thread:\n${threadText || message.body}`,
  );

  const commandId = await queueDraftReply({
    to: senderEmail,
    senderName: sender || senderEmail,
    subject: subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`,
    body: draft,
    sourceEmailId: messageId,
    taskLabel: `Draft reply to ${sender || senderEmail}`,
  });

  return `Queued draft reply ${commandId} for ${sender || senderEmail}`;
}

async function executeQBORecordFromEmailTask(task: OperatorTaskRow): Promise<string> {
  const amount = Math.abs(Number(task.execution_params?.amount || 0));
  const description = String(task.execution_params?.description || task.title || "Email financial record");
  const date = String(task.execution_params?.date || new Date().toISOString().slice(0, 10));
  const vendor = String(task.execution_params?.vendor || "");
  const senderEmail = String(task.execution_params?.sender_email || "");
  if (!amount) throw new Error("Missing amount");

  const [accountsResult, vendorsResult] = await Promise.all([getQBOAccounts(), getQBOVendors()]);
  const accounts = ((accountsResult?.QueryResponse?.Account as QBOAccount[]) || []);
  const bankAccount =
    accounts.find((account) => account.AccountType === "Bank" && /checking/i.test(String(account.Name || ""))) ||
    accounts.find((account) => account.AccountType === "Bank");
  if (!bankAccount?.Id) throw new Error("No QBO bank account found");

  const matchedRule = EMAIL_VENDOR_ACCOUNT_MAP.find((rule) => rule.test.test(`${vendor} ${description}`));
  const mappedAccount =
    (matchedRule
      ? accounts.find((account) => String(account.Id || "") === matchedRule.accountCode)
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
  return `Recorded email-linked transaction ${description} to ${String(mappedAccount.Name || matchedRule?.label || "Uncategorized Expense")}${vendorFound ? "" : " (vendor not yet in QBO vendor list)"}`;
}

async function executeVendorFollowupTask(task: OperatorTaskRow): Promise<string> {
  const email = String(task.execution_params?.contact_email || "");
  const vendor = String(task.execution_params?.vendor || "vendor");
  const lastSubject = String(task.execution_params?.last_subject || "Quick follow-up");
  const bodyPreview = String(task.execution_params?.body_preview || "");
  if (!email) throw new Error("Missing contact_email");

  const draft = await generateDraftViaChat(
    `Draft a short follow-up email to ${vendor}. Return only the email body.\n\n` +
    `Last subject: ${lastSubject}\n` +
    `Previous context:\n${bodyPreview}`,
  );

  const commandId = await queueDraftReply({
    to: email,
    senderName: vendor,
    subject: lastSubject.toLowerCase().startsWith("re:") ? lastSubject : `Re: ${lastSubject}`,
    body: draft,
    taskLabel: `Vendor follow-up: ${vendor}`,
  });

  return `Queued vendor follow-up draft ${commandId} for ${vendor}`;
}

async function executeDistributorFollowupTask(task: OperatorTaskRow): Promise<string> {
  const email = String(task.execution_params?.email || "");
  const distributorName = String(task.execution_params?.distributor_name || "distributor");
  const shipDate = String(task.execution_params?.ship_date || "");
  const sampleDetails = String(task.execution_params?.sample_details || "");
  if (!email) throw new Error("Missing distributor email");

  const draft = await generateDraftViaChat(
    `Draft a follow-up email to ${distributorName} about a sample shipment. Return only the email body.\n\n` +
    `Ship date: ${shipDate}\n` +
    `Context:\n${sampleDetails}`,
  );

  const commandId = await queueDraftReply({
    to: email,
    senderName: distributorName,
    subject: `Follow-up on USA Gummies sample`,
    body: draft,
    taskLabel: `Distributor follow-up: ${distributorName}`,
  });

  return `Queued distributor follow-up draft ${commandId} for ${distributorName}`;
}

async function executeTask(task: OperatorTaskRow): Promise<string> {
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

      const message = await executeTask(task);
      await completeTask(task.id, {
        ok: true,
        message,
        completed_at: new Date().toISOString(),
      });
      summary.completed += 1;
      summary.results.push({
        taskId: task.id,
        taskType: task.task_type,
        status: "completed",
        message,
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
