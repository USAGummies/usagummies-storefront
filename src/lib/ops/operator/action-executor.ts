import { listEmails, searchEmails } from "@/lib/ops/gmail-reader";
import { sendMorningBrief } from "@/lib/ops/abra-morning-brief";
import { uploadFileToSlack, type SpreadsheetData } from "@/lib/ops/slack-file-upload";
import { upsertLearnedQboRule } from "@/lib/ops/operator/qbo-resolution";
import { type RoutedAction } from "@/lib/ops/operator/deterministic-router";

const DEFAULT_SLACK_CHANNEL = "C0AKG9FSC2J";

type RenderedResult = {
  reply: string;
  blocks?: Array<Record<string, unknown>>;
};

type SupabaseTaskRow = {
  id: string;
  title?: string | null;
  task_type?: string | null;
  status?: string | null;
};

type ApprovalRow = {
  id: string;
  summary?: string | null;
};

type QboPurchase = {
  Id?: string;
  Date?: string;
  Amount?: number;
  Vendor?: string | null;
  Note?: string | null;
  Lines?: Array<{
    Description?: string | null;
    Account?: string | null;
    Amount?: number | null;
  }>;
};

type QboVendor = {
  Name?: string | null;
};

type PurchaseOrderRow = {
  po_number?: string | null;
  customer_name?: string | null;
  units?: number | null;
  total?: number | null;
  status?: string | null;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Supabase credentials unavailable");
  }
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
    throw new Error(`Supabase ${path} failed (${res.status})`);
  }
  return json as T;
}

function getInternalBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "https://www.usagummies.com"
  );
}

function getInternalHeaders(): HeadersInit {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  return cronSecret
    ? {
        Authorization: `Bearer ${cronSecret}`,
        "Content-Type": "application/json",
      }
    : { "Content-Type": "application/json" };
}

async function fetchInternalJson(path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${getInternalBaseUrl()}${path}`, {
    headers: getInternalHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

async function postInternalJson(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${getInternalBaseUrl()}${path}`, {
    method: "POST",
    headers: getInternalHeaders(),
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(25000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.error) {
    throw new Error(String(json.error || `${path} failed (${res.status})`));
  }
  return json;
}

function compactCurrency(value: number): string {
  return `$${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function formatUnits(value: number | null | undefined): string {
  return Number.isFinite(Number(value)) && Number(value) > 0
    ? `${Number(value).toLocaleString("en-US")} units`
    : "qty TBD";
}

function extractAccountName(purchase: QboPurchase): string {
  const firstLine = Array.isArray(purchase.Lines) ? purchase.Lines[0] : null;
  return String(firstLine?.Account || "Uncategorized").trim() || "Uncategorized";
}

function isUncategorized(purchase: QboPurchase): boolean {
  const account = normalizeText(extractAccountName(purchase));
  return !account || account.includes("uncategorized");
}

function buildApprovalBlocks(approvals: ApprovalRow[]): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  for (const approval of approvals.slice(0, 5)) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${String(approval.summary || "Approval pending")}*`,
      },
    });
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Approve" },
          style: "primary",
          action_id: "approve_action",
          value: approval.id,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Reject" },
          style: "danger",
          action_id: "reject_action",
          value: approval.id,
        },
      ],
    });
  }
  return blocks;
}

function buildDraftReplyBlocks(draft: string): Array<Record<string, unknown>> {
  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: draft.slice(0, 2900) },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Send" },
          style: "primary",
          action_id: "send_draft_reply",
          value: "send_draft_reply",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Edit" },
          action_id: "edit_draft_reply",
          value: "edit_draft_reply",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Cancel" },
          style: "danger",
          action_id: "cancel_draft_reply",
          value: "cancel_draft_reply",
        },
      ],
    },
  ];
}

function renderRowsAsSheet(headers: string[], rows: Array<Array<string | number | boolean | null>>, sheetName: string): SpreadsheetData {
  return { headers, rows, sheetName };
}

function parseCorrectInstruction(text: string): { original: string; correction: string } | null {
  const trimmed = text.trim();
  const separators = ["->", "=>"];
  for (const separator of separators) {
    const parts = trimmed.split(separator);
    if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
      return { original: parts[0].trim(), correction: parts[1].trim() };
    }
  }
  return null;
}

function accountAliasMap(): Record<string, string> {
  return {
    software: "software",
    shipping: "shipping",
    advertising: "advertising",
    utilities: "utilities",
    insurance: "insurance",
    "cogs-albanese": "COGS-albanese",
    "cogs-belmark": "COGS-belmark",
    "cogs-powers": "COGS-powers",
    "cogs-freight": "COGS-freight",
    "investor-loan": "investor-loan",
  };
}

const CATEGORIZATION_ACCOUNTS: Record<string, { id: string; name: string }> = {
  software: { id: "126", name: "Software" },
  shipping: { id: "127", name: "Shipping" },
  advertising: { id: "16", name: "Advertising" },
  utilities: { id: "78", name: "Utilities" },
  insurance: { id: "42", name: "Insurance" },
  "cogs-albanese": { id: "176", name: "COGS Albanese" },
  "cogs-belmark": { id: "177", name: "COGS Belmark" },
  "cogs-powers": { id: "178", name: "COGS Powers" },
  "cogs-freight": { id: "175", name: "COGS Freight" },
  "investor-loan": { id: "167", name: "Investor Loan - Rene" },
};

function availableAccountList(): string {
  return Object.values(accountAliasMap()).join(", ");
}

function extractCategorizeTarget(instruction: string): string {
  const lowered = instruction.toLowerCase();
  const splitToken = lowered.includes(" to ") ? " to " : " as ";
  const index = lowered.indexOf(splitToken);
  return index >= 0 ? instruction.slice(index + splitToken.length).trim() : "";
}

function extractCategorizePattern(instruction: string): string {
  const lowered = instruction.toLowerCase();
  const splitToken = lowered.includes(" to ") ? " to " : " as ";
  const start = lowered.startsWith("categorize ") ? "categorize ".length : 0;
  const end = lowered.indexOf(splitToken);
  return end > start ? instruction.slice(start, end).trim() : "";
}

async function qboQuery<T>(query: string): Promise<T | null> {
  const [{ getValidAccessToken, getRealmId }] = await Promise.all([
    import("@/lib/ops/qbo-auth"),
  ]);
  const accessToken = await getValidAccessToken();
  const realmId = await getRealmId();
  if (!accessToken || !realmId) return null;
  const res = await fetch(
    `https://${process.env.QBO_SANDBOX === "true" ? "sandbox-" : ""}quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=73`,
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
): Promise<boolean> {
  const [{ getValidAccessToken, getRealmId }] = await Promise.all([
    import("@/lib/ops/qbo-auth"),
  ]);
  const accessToken = await getValidAccessToken();
  const realmId = await getRealmId();
  if (!accessToken || !realmId) return false;
  const host = process.env.QBO_SANDBOX === "true"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
  const res = await fetch(`${host}/v3/company/${realmId}/purchase?minorversion=73`, {
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
  return res.ok;
}

type QBOPurchaseFull = {
  Id?: string;
  SyncToken?: string;
  TotalAmt?: number;
  PrivateNote?: string;
  Line?: Array<{
    Id?: string;
    Amount?: number;
    Description?: string;
    DetailType?: string;
    AccountBasedExpenseLineDetail?: {
      BillableStatus?: string;
      CustomerRef?: Record<string, unknown>;
      ClassRef?: Record<string, unknown>;
      TaxCodeRef?: Record<string, unknown>;
      AccountRef?: { value?: string; name?: string };
    };
  }>;
};

async function fetchPurchaseById(purchaseId: string): Promise<QBOPurchaseFull | null> {
  const result = await qboQuery<{ QueryResponse?: { Purchase?: QBOPurchaseFull[] } }>(
    `SELECT * FROM Purchase WHERE Id = '${purchaseId}' MAXRESULTS 1`,
  );
  return result?.QueryResponse?.Purchase?.[0] || null;
}

function buildPurchaseLinesWithAccount(
  purchase: QBOPurchaseFull,
  accountId: string,
  accountName: string,
): Array<Record<string, unknown>> {
  const lines = Array.isArray(purchase.Line) ? purchase.Line : [];
  if (!lines.length) {
    return [{
      Amount: Number(purchase.TotalAmt || 0),
      Description: purchase.PrivateNote || `Purchase ${purchase.Id || ""}`.trim(),
      DetailType: "AccountBasedExpenseLineDetail",
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: accountId, name: accountName },
      },
    }];
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
      AccountRef: { value: accountId, name: accountName },
    },
  }));
}

function isActionableEmail(email: { from: string; subject: string }): boolean {
  const haystack = `${email.from} ${email.subject}`.toLowerCase();
  if (!haystack.trim()) return false;
  const ignorePatterns = [
    "receipt",
    "newsletter",
    "github",
    "digest",
    "statement",
    "password",
    "security alert",
    "no-reply",
    "noreply",
  ];
  return !ignorePatterns.some((pattern) => haystack.includes(pattern));
}

async function generateDraftReply(threadText: string, person: string): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new Error("Anthropic API unavailable");
  }
  const system = [
    "You are drafting an email reply for Ben at USA Gummies.",
    "Use this framework internally: context, questions, known answers, what not to share, best interest, draft.",
    "Do not reveal internal costs, margins, or sensitive internal notes.",
    "Return only the email draft body. No subject line, no analysis.",
  ].join(" ");
  const prompt = [
    `Draft a reply to ${person}.`,
    "Read the full thread context below and write a concise professional reply.",
    "",
    threadText,
  ].join("\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 800,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    throw new Error(`Anthropic draft failed (${res.status})`);
  }
  const payload = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const reply = (payload.content || [])
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text || "")
    .join("\n")
    .trim();
  if (!reply) throw new Error("Draft reply unavailable");
  return reply;
}

function extractDraftPerson(instruction: string): string {
  return instruction.replace(/^draft reply to\s+/i, "").trim();
}

async function buildExportData(instruction: string): Promise<{ filename: string; sheets: SpreadsheetData[] } | null> {
  const lowered = instruction.toLowerCase();

  if (lowered.includes("vendor")) {
    const data = await fetchInternalJson("/api/ops/qbo/query?type=vendors");
    const vendors = Array.isArray(data?.vendors) ? (data.vendors as Array<Record<string, unknown>>) : [];
    return {
      filename: "vendors.xlsx",
      sheets: [
        renderRowsAsSheet(
          ["Vendor", "Email", "Phone", "Balance"],
          vendors.map((vendor) => [
            String(vendor.Name || ""),
            String(vendor.Email || ""),
            String(vendor.Phone || ""),
            Number(vendor.Balance || 0),
          ]),
          "Vendors",
        ),
      ],
    };
  }

  if (lowered.includes("transaction")) {
    const data = await fetchInternalJson("/api/ops/qbo/query?type=purchases&limit=200");
    const purchases = Array.isArray(data?.purchases) ? (data.purchases as QboPurchase[]) : [];
    return {
      filename: "transactions.xlsx",
      sheets: [
        renderRowsAsSheet(
          ["Date", "Amount", "Vendor", "Account", "Description", "Note"],
          purchases.map((purchase) => [
            String(purchase.Date || ""),
            Number(purchase.Amount || 0),
            String(purchase.Vendor || ""),
            extractAccountName(purchase),
            String((purchase.Lines || []).map((line) => line.Description || "").filter(Boolean).join(" | ")),
            String(purchase.Note || ""),
          ]),
          "Transactions",
        ),
      ],
    };
  }

  if (lowered.includes("po") || lowered.includes("order")) {
    const rows = await sbFetch<PurchaseOrderRow[]>(
      "/rest/v1/abra_purchase_orders?status=neq.closed&select=po_number,customer_name,units,total,status&order=created_at.asc",
    ).catch(() => []);
    return {
      filename: "open-pos.xlsx",
      sheets: [
        renderRowsAsSheet(
          ["PO", "Customer", "Units", "Total", "Status"],
          rows.map((row) => [
            String(row.po_number || ""),
            String(row.customer_name || ""),
            row.units ?? "",
            row.total ?? "",
            String(row.status || ""),
          ]),
          "Open POs",
        ),
      ],
    };
  }

  if (lowered.includes("pnl") || lowered.includes("p&l")) {
    const data = await fetchInternalJson("/api/ops/qbo/query?type=pnl");
    const summary = ((data?.summary || {}) as Record<string, unknown>) || {};
    return {
      filename: "pnl.xlsx",
      sheets: [
        renderRowsAsSheet(
          ["Metric", "Amount"],
          Object.entries(summary).map(([key, value]) => [key, Number(value || 0)]),
          "P&L",
        ),
      ],
    };
  }

  return null;
}

async function buildRecentEmailThread(person: string): Promise<string | null> {
  const messages = await searchEmails(`newer_than:30d ${person}`, 10).catch(() => []);
  if (!messages.length) return null;
  const threadId = messages[0]?.threadId;
  const thread = threadId ? messages.filter((message) => message.threadId === threadId) : [messages[0]];
  return thread
    .slice(-6)
    .map((message) => {
      return [
        `From: ${message.from}`,
        `To: ${message.to}`,
        `Date: ${message.date}`,
        `Subject: ${message.subject}`,
        message.body,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

export async function executeRoutedAction(
  action: RoutedAction,
  context: {
    actor: string;
    slackChannelId?: string;
    slackThreadTs?: string;
    slackUserId?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  },
): Promise<RoutedAction> {
  try {
    switch (action.action) {
      case "query_qbo_pnl": {
        const data = await fetchInternalJson("/api/ops/qbo/query?type=pnl");
        if (!data?.summary) {
          action.result = { reply: "QBO is currently unavailable" } satisfies RenderedResult;
          break;
        }
        const summary = data.summary as Record<string, unknown>;
        const revenue = Number(summary["Total Income"] || summary.TotalIncome || 0);
        const cogs = Number(summary["Total Cost of Goods Sold"] || summary.TotalCostOfGoodsSold || 0);
        const expenses = Math.abs(Number(summary["Total Expenses"] || summary.TotalExpenses || 0));
        const net = Number(summary["Net Income"] || revenue - cogs - expenses);
        action.result = {
          reply: `P&L MTD: Revenue ${compactCurrency(revenue)} | COGS ${compactCurrency(cogs)} | Expenses ${compactCurrency(expenses)} | Net ${compactCurrency(net)}`,
        } satisfies RenderedResult;
        break;
      }
      case "query_plaid_balance": {
        const data = await fetchInternalJson("/api/ops/plaid/balance");
        const accounts = Array.isArray(data?.accounts) ? (data.accounts as Array<Record<string, unknown>>) : [];
        if (!accounts.length) {
          action.result = { reply: "Plaid balance currently unavailable" } satisfies RenderedResult;
          break;
        }
        const balance = accounts.reduce((sum, account) => {
          const balances = account.balances && typeof account.balances === "object"
            ? (account.balances as Record<string, unknown>)
            : {};
          return sum + Number(balances.current ?? balances.available ?? 0);
        }, 0);
        action.result = {
          reply: `Cash: ${compactCurrency(balance)} (Plaid live)`,
        } satisfies RenderedResult;
        break;
      }
      case "query_kpi_revenue": {
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
        const monthStart = `${today.slice(0, 7)}-01`;
        const rows = await sbFetch<Array<{ metric_name?: string | null; captured_for_date?: string | null; value?: number | null }>>(
          `/rest/v1/kpi_timeseries?window_type=eq.daily&metric_name=in.(daily_revenue_amazon,daily_revenue_shopify,daily_revenue_total_unified)&captured_for_date=gte.${monthStart}&select=metric_name,captured_for_date,value&limit=120`,
        ).catch(() => []);
        if (!Array.isArray(rows) || rows.length === 0) {
          action.result = { reply: "Revenue data currently unavailable" } satisfies RenderedResult;
          break;
        }
        let amazonToday = 0;
        let shopifyToday = 0;
        let amazonMtd = 0;
        let shopifyMtd = 0;
        let sawAmazonToday = false;
        let sawShopifyToday = false;
        for (const row of rows) {
          const metric = String(row.metric_name || "");
          const date = String(row.captured_for_date || "");
          const value = Number(row.value || 0);
          if (metric === "daily_revenue_amazon") amazonMtd += value;
          if (metric === "daily_revenue_shopify") shopifyMtd += value;
          if (date === today && metric === "daily_revenue_amazon") {
            sawAmazonToday = true;
            amazonToday += value;
          }
          if (date === today && metric === "daily_revenue_shopify") {
            sawShopifyToday = true;
            shopifyToday += value;
          }
        }
        const sawAnyToday = sawAmazonToday || sawShopifyToday;
        const todayText = sawAnyToday ? compactCurrency(amazonToday + shopifyToday) : "no data yet";
        const amazonText = sawAmazonToday ? compactCurrency(amazonToday) : "today unavailable";
        const shopifyText = sawShopifyToday ? compactCurrency(shopifyToday) : "today unavailable";
        action.result = {
          reply: `Today: ${todayText} | MTD: ${compactCurrency(amazonMtd + shopifyMtd)} | Amazon ${amazonText} / Shopify ${shopifyText}`,
        } satisfies RenderedResult;
        break;
      }
      case "query_qbo_vendors": {
        const data = await fetchInternalJson("/api/ops/qbo/query?type=vendors");
        const vendors = Array.isArray(data?.vendors) ? (data.vendors as QboVendor[]) : [];
        if (!vendors.length) {
          action.result = { reply: "QBO vendor list is currently unavailable" } satisfies RenderedResult;
          break;
        }
        const names = vendors.map((vendor) => String(vendor.Name || "")).filter(Boolean);
        const visible = names.slice(0, 20).map((name) => `• ${name}`);
        const suffix = names.length > 20 ? `\n• and ${names.length - 20} more` : "";
        action.result = {
          reply: [`Vendors (${names.length})`, ...visible].join("\n") + suffix,
        } satisfies RenderedResult;
        break;
      }
      case "query_qbo_purchases": {
        const data = await fetchInternalJson("/api/ops/qbo/query?type=purchases&limit=10");
        const purchases = Array.isArray(data?.purchases) ? (data.purchases as QboPurchase[]) : [];
        if (!purchases.length) {
          action.result = { reply: "QBO purchases are currently unavailable" } satisfies RenderedResult;
          break;
        }
        action.result = {
          reply: purchases
            .slice(0, 10)
            .map((purchase) =>
              `• ${String(purchase.Date || "—")} | ${compactCurrency(Number(purchase.Amount || 0))} | ${String(purchase.Vendor || "Unknown")} | ${extractAccountName(purchase)}`,
            )
            .join("\n"),
        } satisfies RenderedResult;
        break;
      }
      case "show_review_transactions": {
        const data = await fetchInternalJson("/api/ops/qbo/query?type=purchases&limit=200");
        const purchases = Array.isArray(data?.purchases) ? (data.purchases as QboPurchase[]) : [];
        if (!purchases.length) {
          action.result = { reply: "QBO is currently unavailable" } satisfies RenderedResult;
          break;
        }
        const review = purchases.filter(isUncategorized);
        if (review.length === 0) {
          action.result = { reply: "No transactions need categorization right now." } satisfies RenderedResult;
          break;
        }
        if (review.length > 5) {
          const upload = await uploadFileToSlack({
            channelId: context.slackChannelId || DEFAULT_SLACK_CHANNEL,
            threadTs: context.slackThreadTs,
            filename: "uncategorized-transactions.xlsx",
            comment: undefined,
            format: "xlsx",
            data: renderRowsAsSheet(
              ["Date", "Amount", "Vendor", "Account", "Description", "Note"],
              review.map((purchase) => [
                String(purchase.Date || ""),
                Number(purchase.Amount || 0),
                String(purchase.Vendor || ""),
                extractAccountName(purchase),
                String((purchase.Lines || []).map((line) => line.Description || "").filter(Boolean).join(" | ")),
                String(purchase.Note || ""),
              ]),
              "Needs Review",
            ),
          });
          const uploadText = upload.ok
            ? upload.skipped
              ? "Already uploaded — see above."
              : "I uploaded the Excel to this channel."
            : "I could not upload the Excel right now.";
          action.result = {
            reply: `${review.length} transactions need categorization. ${uploadText} Reply 'categorize [description] to [account]' to fix.`,
          } satisfies RenderedResult;
          break;
        }
        action.result = {
          reply: [
            ...review.map((purchase) =>
              `• ${String(purchase.Date || "—")} | ${compactCurrency(Number(purchase.Amount || 0))} | ${String(purchase.Vendor || "Unknown")} | ${extractAccountName(purchase)}`,
            ),
            "",
            `${review.length} transactions need categorization. Reply 'categorize [description] to [account]' to fix.`,
          ].join("\n"),
        } satisfies RenderedResult;
        break;
      }
      case "query_open_pos": {
        const orders = await sbFetch<PurchaseOrderRow[]>(
          "/rest/v1/abra_purchase_orders?status=neq.closed&select=po_number,customer_name,units,total,status&order=created_at.asc",
        ).catch(() => []);
        if (!Array.isArray(orders)) {
          action.result = { reply: "PO pipeline is currently unavailable" } satisfies RenderedResult;
          break;
        }
        const total = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
        action.result = {
          reply: [
            `${orders.length} open POs, ${compactCurrency(total)} total pipeline`,
            ...orders.map((order) =>
              `• #${String(order.po_number || "—")} — ${String(order.customer_name || "Unknown")} — ${formatUnits(order.units)} — ${order.total != null ? compactCurrency(Number(order.total || 0)) : "$TBD"} — status: ${String(order.status || "unknown")}`,
            ),
          ].join("\n"),
        } satisfies RenderedResult;
        break;
      }
      case "search_recent_email": {
        const emails = await listEmails({ query: "newer_than:1d", count: 20 }).catch(() => []);
        const actionable = emails.filter(isActionableEmail);
        if (!actionable.length) {
          action.result = { reply: "Email is currently unavailable" } satisfies RenderedResult;
          break;
        }
        const visible = actionable.slice(0, 5);
        const more = actionable.length > visible.length ? `\n• and ${actionable.length - visible.length} more` : "";
        action.result = {
          reply: [
            `Actionable email (${actionable.length})`,
            ...visible.map((email) => `• ${email.from} | ${email.subject} | ${email.date}`),
          ].join("\n") + more,
        } satisfies RenderedResult;
        break;
      }
      case "show_help": {
        action.result = {
          reply: [
            "Available commands:",
            "• pnl — live QBO P&L",
            "• cash — live Plaid balance",
            "• rev — live revenue snapshot",
            "• vendors — QBO vendor list",
            "• transactions — recent QBO purchases",
            "• review — uncategorized transactions",
            "• pos / orders — open purchase orders",
            "• emails — actionable email in the last 24h",
            "• tasks — pending operator tasks",
            "• approve — pending approvals",
            "• teach: [fact] — log knowledge",
            "• correct: [original] -> [correction] — record a correction",
            "• categorize [description] to [account] — categorize and learn",
            "• export [data] — upload an Excel file",
            "• draft reply to [person] — draft an email reply",
          ].join("\n"),
        } satisfies RenderedResult;
        break;
      }
      case "query_operator_tasks": {
        const tasks = await sbFetch<SupabaseTaskRow[]>(
          "/rest/v1/abra_operator_tasks?status=eq.pending&select=id,title,task_type,status&order=created_at.asc&limit=5",
        ).catch(() => []);
        if (!Array.isArray(tasks)) {
          action.result = { reply: "Operator tasks are currently unavailable" } satisfies RenderedResult;
          break;
        }
        action.result = {
          reply: tasks.length
            ? [`${tasks.length} pending tasks`, ...tasks.map((task) => `• ${String(task.title || task.task_type || task.id)}`)].join("\n")
            : "0 pending tasks",
        } satisfies RenderedResult;
        break;
      }
      case "query_pending_approvals": {
        const approvals = await sbFetch<ApprovalRow[]>(
          "/rest/v1/approvals?status=eq.pending&select=id,summary&order=requested_at.asc&limit=5",
        ).catch(() => []);
        if (!Array.isArray(approvals)) {
          action.result = { reply: "Approvals are currently unavailable" } satisfies RenderedResult;
          break;
        }
        action.result = {
          reply: approvals.length
            ? [`${approvals.length} pending approvals`, ...approvals.map((approval) => `• ${String(approval.summary || approval.id)}`)].join("\n")
            : "No pending approvals.",
          blocks: approvals.length ? buildApprovalBlocks(approvals) : undefined,
        } satisfies RenderedResult;
        break;
      }
      case "create_brain_entry": {
        const text = String(action.params.text || "").trim();
        if (!text) {
          action.result = { reply: "Nothing to log." } satisfies RenderedResult;
          break;
        }
        await postInternalJson("/api/ops/abra/teach", {
          department: "operations",
          content: text,
          title: text.slice(0, 120),
        });
        action.result = { reply: "Logged." } satisfies RenderedResult;
        break;
      }
      case "correct_brain_entry": {
        const text = String(action.params.text || "").trim();
        const parsed = parseCorrectInstruction(text);
        if (!parsed) {
          action.result = { reply: "Use: correct: [original] -> [correction]" } satisfies RenderedResult;
          break;
        }
        await postInternalJson("/api/ops/abra/correct", {
          original_claim: parsed.original,
          correction: parsed.correction,
          department: "operations",
        });
        action.result = { reply: "Correction recorded." } satisfies RenderedResult;
        break;
      }
      case "categorize_qbo_transaction": {
        const instruction = String(action.params.instruction || "").trim();
        const pattern = extractCategorizePattern(instruction);
        const target = normalizeText(extractCategorizeTarget(instruction));
        if (!target || !(target in accountAliasMap())) {
          action.result = {
            reply: `I don't know that account. Available: ${availableAccountList()}`,
          } satisfies RenderedResult;
          break;
        }
        if (!pattern) {
          action.result = { reply: "Use: categorize [description] to [account]" } satisfies RenderedResult;
          break;
        }
        const account = CATEGORIZATION_ACCOUNTS[target];
        const data = await fetchInternalJson("/api/ops/qbo/query?type=purchases&limit=200");
        const purchases = Array.isArray(data?.purchases) ? (data.purchases as QboPurchase[]) : [];
        const matches = purchases.filter((purchase) => {
          if (!isUncategorized(purchase)) return false;
          const haystack = normalizeText([
            purchase.Vendor,
            purchase.Note,
            ...(purchase.Lines || []).map((line) => line.Description || ""),
          ].join(" "));
          return haystack.includes(normalizeText(pattern));
        });
        if (!matches.length) {
          action.result = { reply: "I couldn't find a matching uncategorized transaction." } satisfies RenderedResult;
          break;
        }
        let applied = 0;
        for (const match of matches) {
          const purchase = match.Id ? await fetchPurchaseById(String(match.Id)) : null;
          if (!purchase?.Id || !purchase.SyncToken) continue;
          const ok = await qboUpdatePurchase(purchase.Id, purchase.SyncToken, {
            Line: buildPurchaseLinesWithAccount(purchase, account.id, account.name),
          });
          if (ok) applied += 1;
        }
        await upsertLearnedQboRule({
          pattern,
          accountId: account.id,
          accountName: account.name,
          createdBy: context.actor,
          notes: `Learned from deterministic Slack categorization: ${instruction}`,
        }).catch(() => null);
        action.result = {
          reply: applied > 0
            ? `Categorized ${applied} transaction${applied === 1 ? "" : "s"} to ${account.name}.`
            : "I found a match, but QBO rejected the update.",
        } satisfies RenderedResult;
        break;
      }
      case "generate_file": {
        const exportData = await buildExportData(String(action.params.instruction || ""));
        if (!exportData) {
          action.result = { reply: "I couldn't tell what to export. Try `export vendors` or `send me an excel of transactions`." } satisfies RenderedResult;
          break;
        }
        const upload = await uploadFileToSlack({
          channelId: context.slackChannelId || DEFAULT_SLACK_CHANNEL,
          threadTs: context.slackThreadTs,
          filename: exportData.filename,
          format: "xlsx",
          data: exportData.sheets,
        });
        action.result = {
          reply: upload.ok
            ? upload.skipped
              ? `Already uploaded — see above (${exportData.filename}).`
              : `${exportData.filename} uploaded.`
            : `I couldn't upload ${exportData.filename} right now.`,
        } satisfies RenderedResult;
        break;
      }
      case "draft_email_reply": {
        const person = extractDraftPerson(String(action.params.instruction || ""));
        if (!person) {
          action.result = { reply: "Use: draft reply to [person]" } satisfies RenderedResult;
          break;
        }
        const threadText = await buildRecentEmailThread(person);
        if (!threadText) {
          action.result = { reply: `I couldn't find a recent email thread for ${person}.` } satisfies RenderedResult;
          break;
        }
        const draft = await generateDraftReply(threadText, person);
        action.result = {
          reply: `Draft reply to ${person}:`,
          blocks: buildDraftReplyBlocks(draft),
        } satisfies RenderedResult;
        break;
      }
      case "release_morning_brief": {
        await sendMorningBrief();
        action.result = { reply: "Morning brief sent." } satisfies RenderedResult;
        break;
      }
      default: {
        action.result = { reply: "That command is currently unavailable." } satisfies RenderedResult;
        break;
      }
    }
    action.executed = true;
  } catch (error) {
    action.error = error instanceof Error ? error.message : String(error);
    action.executed = false;
  }
  return action;
}

export function renderRoutedActionResponse(action: RoutedAction): RenderedResult {
  if (action.executed && action.result && typeof action.result === "object" && "reply" in (action.result as Record<string, unknown>)) {
    return action.result as RenderedResult;
  }
  return {
    reply: action.error || "That command is currently unavailable.",
  };
}
