import { notify } from "@/lib/ops/notify";
import { randomUUID } from "node:crypto";
import { sendOpsEmail } from "@/lib/ops/email";
import { createNotionPage, updateNotionPage, queryLedgerSummary } from "@/lib/ops/abra-notion-write";
import { DB } from "@/lib/notion/client";
import { generateEmbedding } from "@/lib/ops/abra-embeddings";
import { emitEvent, type AbraEventType } from "@/lib/ops/abra-event-bus";
import { markSuccess as capMarkSuccess, markFailure as capMarkFailure } from "@/lib/ops/capability-registry";
import { adminRequest } from "@/lib/shopify/admin";
import {
  adjustInventory,
  createDiscountCode as createShopifyDiscountCode,
  queryRecentOrders,
} from "@/lib/ops/shopify-admin-actions";
import {
  buildReconciliationPeriod,
  generateReconciliationReport,
  type ReconciliationPeriod,
} from "@/lib/ops/revenue-reconciliation";
import { runMonthlyClose } from "@/lib/finance/monthly-close";
import { uploadFileToSlack, type SpreadsheetData } from "@/lib/ops/slack-file-upload";
import {
  canDirectExec as policyCanDirectExec,
  canAutoExec as policyCanAutoExec,
  requiresApproval as policyRequiresApproval,
  getApprovalOwner,
  clampRiskLevel,
  type RiskLevel,
} from "@/lib/ops/abra-policy";

/** Map friendly database keys → Notion database IDs for create_notion_page action */
const NOTION_DB_MAP: Record<string, string> = {
  meeting_notes: process.env.NOTION_MEETING_NOTES_DB_ID || process.env.NOTION_MEETING_DB_ID || "",
  b2b_prospects: process.env.NOTION_B2B_PROSPECTS_DB || "",
  distributor_prospects: process.env.NOTION_DISTRIBUTOR_PROSPECTS_DB || "",
  repacker_list: process.env.NOTION_DB_REPACKER_LIST || "",
  daily_performance: DB.DAILY_PERFORMANCE,
  fleet_ops: DB.FLEET_OPS_LOG,
  inventory: DB.INVENTORY,
  sku_registry: DB.SKU_REGISTRY,
  cash_transactions: DB.CASH_TRANSACTIONS,
  content_drafts: DB.CONTENT_DRAFTS,
  kpis: process.env.NOTION_KPI_DB || "",
  general: process.env.NOTION_MEETING_NOTES_DB_ID || process.env.NOTION_MEETING_DB_ID || "",
};

export type AbraAction = {
  action_type: string;
  title: string;
  description: string;
  department: string;
  risk_level: "low" | "medium" | "high" | "critical";
  params: Record<string, unknown>;
  requires_approval: boolean;
  confidence?: number;
};

export type ActionResult = {
  success: boolean;
  message: string;
  data?: unknown;
};

type ApprovalRow = {
  id: string;
  status: string;
  action_type?: string | null;
  created_at?: string | null;
  batch_group?: string | null;
  decision_reasoning?: string | null;
  resolved_payload?: unknown;
  proposed_payload: unknown;
  auto_executed?: boolean | null;
};

export type AutoExecPolicy = {
  action_type: string;
  max_risk_level: "low" | "medium";
  min_confidence: number;
  daily_limit: number;
  enabled: boolean;
  max_amount?: number; // For financial actions: auto-exec only if amount <= this cap
};

function isAutoExecutionGloballyEnabled(): boolean {
  const raw = String(process.env.ABRA_AUTO_EXEC_ENABLED || "").trim().toLowerCase();
  if (!raw) return false; // Default OFF — auto-execution must be explicitly opted into via env var
  return ["1", "true", "on", "yes"].includes(raw);
}

export const AUTO_EXEC_POLICIES: AutoExecPolicy[] = [
  {
    action_type: "create_brain_entry",
    max_risk_level: "low",
    min_confidence: 0.85,
    daily_limit: 50,
    enabled: true,
  },
  {
    action_type: "acknowledge_signal",
    max_risk_level: "low",
    min_confidence: 0.8,
    daily_limit: 20,
    enabled: true,
  },
  {
    action_type: "send_slack",
    max_risk_level: "low",
    min_confidence: 0.85,
    daily_limit: 10,
    enabled: false,
  },
  {
    action_type: "create_task",
    max_risk_level: "low",
    min_confidence: 0.8,
    daily_limit: 10,
    enabled: true,
  },
  {
    action_type: "create_notion_page",
    max_risk_level: "low",
    min_confidence: 0.8,
    daily_limit: 10,
    enabled: true,
  },
  {
    action_type: "record_transaction",
    max_risk_level: "low",
    min_confidence: 0.9,
    daily_limit: 10,
    enabled: true,
    max_amount: 500, // Safety cap: transactions > $500 require human approval
  },
  {
    action_type: "correct_claim",
    max_risk_level: "low",
    min_confidence: 0.95,
    daily_limit: 10,
    enabled: false, // DISABLED: corrections go to HOT tier and override all other data. Too dangerous to auto-execute.
  },
  {
    action_type: "log_production_run",
    max_risk_level: "low",
    min_confidence: 0.85,
    daily_limit: 5,
    enabled: true,
  },
  {
    action_type: "record_vendor_quote",
    max_risk_level: "low",
    min_confidence: 0.85,
    daily_limit: 10,
    enabled: true,
  },
  {
    action_type: "run_scenario",
    max_risk_level: "low",
    min_confidence: 0.8,
    daily_limit: 10,
    enabled: true,
  },
  {
    action_type: "read_email",
    max_risk_level: "low",
    min_confidence: 0.7,
    daily_limit: 50,
    enabled: true, // Read-only — no risk
  },
  {
    action_type: "search_email",
    max_risk_level: "low",
    min_confidence: 0.7,
    daily_limit: 30,
    enabled: true, // Read-only — no risk
  },
  {
    action_type: "query_ledger",
    max_risk_level: "low",
    min_confidence: 0.5,
    daily_limit: 50,
    enabled: true, // Read-only — queries Notion ledger for financial data
  },
  {
    action_type: "query_qbo",
    max_risk_level: "low",
    min_confidence: 0.5,
    daily_limit: 50,
    enabled: true, // Read-only — queries QuickBooks Online
  },
  {
    action_type: "qbo_setup_assessment",
    max_risk_level: "low",
    min_confidence: 0.5,
    daily_limit: 10,
    enabled: true, // Read-only — assesses QBO setup against USA Gummies supply chain and Form 1120 requirements
  },
  {
    action_type: "categorize_qbo_transaction",
    max_risk_level: "low",
    min_confidence: 0.85,
    daily_limit: 30,
    enabled: true, // Auto-categorize bank feed transactions in QBO
    max_amount: 5000, // Transactions > $5K need human review (except Rene investor loans)
  },
  {
    action_type: "query_shopify_orders",
    max_risk_level: "low",
    min_confidence: 0.6,
    daily_limit: 30,
    enabled: true,
  },
  {
    action_type: "reconcile_transactions",
    max_risk_level: "low",
    min_confidence: 0.7,
    daily_limit: 5,
    enabled: true,
  },
  {
    action_type: "update_shopify_inventory",
    max_risk_level: "medium",
    min_confidence: 0.9,
    daily_limit: 10,
    enabled: true,
    max_amount: 500, // Max absolute inventory adjustment auto-exec
  },
  {
    action_type: "generate_file",
    max_risk_level: "low",
    min_confidence: 0.5,
    daily_limit: 20,
    enabled: true, // File generation uploads to Slack — low risk
  },
];

const EXTERNAL_SUBMISSION_ACTIONS = new Set([
  "send_email",
  "send_slack",
  "update_notion",
  "draft_email_reply",
  "start_workflow",
  "resume_workflow",
]);

export function requiresExplicitPermission(actionType: string): boolean {
  return EXTERNAL_SUBMISSION_ACTIONS.has(String(actionType || "").trim().toLowerCase());
}

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Missing Supabase credentials");
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(15000),
  });

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!res.ok) {
    void capMarkFailure("supabase", `${init.method || "GET"} ${path}: HTTP ${res.status}`).catch(() => {});
    throw new Error(
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
    );
  }
  void capMarkSuccess("supabase").catch(() => {});
  return json;
}

/**
 * Fire-and-forget: generate an embedding for a brain entry and store it.
 * Called after creating entries via actions so they're findable by semantic search.
 * Failures are logged but never block the action response.
 */
function embedBrainEntry(entryId: string, text: string): void {
  (async () => {
    try {
      const embedding = await generateEmbedding(text.slice(0, 8000));
      await sbFetch(
        `/rest/v1/open_brain_entries?id=eq.${encodeURIComponent(entryId)}`,
        {
          method: "PATCH",
          headers: {
            Prefer: "return=minimal",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ embedding }),
        },
      );
    } catch (err) {
      console.error(`[abra-actions] Failed to embed brain entry ${entryId}:`, err);
    }
  })();
}

async function resolveAbraAgentId(): Promise<string> {
  const rows = (await sbFetch(
    "/rest/v1/agents?select=id,agent_name&limit=100",
  )) as Array<{ id: string; agent_name?: string }>;
  const existing = rows.find(
    (row) => (row.agent_name || "").toLowerCase() === "abra",
  );
  if (existing?.id) return existing.id;

  const created = (await sbFetch("/rest/v1/agents", {
    method: "POST",
    headers: {
      Prefer: "return=representation",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      agent_name: "abra",
      department: "executive",
      level: "orchestrator",
      status: "deployed",
    }),
  })) as Array<{ id: string }>;

  if (!created[0]?.id) {
    throw new Error("Could not resolve abra agent id");
  }
  return created[0].id;
}

async function resolveSystemUserId(): Promise<string | null> {
  const preferredEmail = process.env.ABRA_OWNER_EMAIL || "ben@usagummies.com";
  const specific = (await sbFetch(
    `/rest/v1/users?select=id&email=eq.${encodeURIComponent(preferredEmail)}&limit=1`,
  )) as Array<{ id: string }>;
  if (specific[0]?.id) return specific[0].id;

  const anyRows = (await sbFetch("/rest/v1/users?select=id&limit=1")) as Array<{
    id: string;
  }>;
  return anyRows[0]?.id || null;
}

function mapApprovalActionType(actionType: string): string {
  if (actionType === "send_email") return "send_email";
  if (actionType === "draft_email_reply") return "auto_reply";
  if (actionType === "send_slack") return "escalation";
  if (actionType === "update_notion") return "data_mutation";
  if (actionType === "create_task") return "data_mutation";
  if (actionType === "create_brain_entry") return "data_mutation";
  if (actionType === "batch_categorize_qbo") return "data_mutation";
  if (actionType === "create_qbo_invoice") return "data_mutation";
  if (actionType === "update_shopify_inventory") return "data_mutation";
  if (actionType === "create_shopify_discount") return "data_mutation";
  return "other";
}

function permissionTierForRisk(level: AbraAction["risk_level"]): number {
  if (level === "critical") return 3;
  if (level === "high") return 3;
  if (level === "medium") return 2;
  return 1;
}

async function handleSendSlack(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const channel = String(params.channel || "alerts");
  const message = sanitizeText(String(params.message || ""), 3000); // Slack block limit is ~3000 chars
  if (!message) {
    return { success: false, message: "Missing Slack message" };
  }
  const allowedChannel =
    channel === "daily" || channel === "pipeline" || channel === "alerts"
      ? channel
      : "alerts";
  await notify({ channel: allowedChannel, text: message });
  return { success: true, message: `Sent to Slack ${allowedChannel}` };
}

async function handleSendEmail(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const to = String(params.to || "").toLowerCase().trim();
  const subject = sanitizeTitle(String(params.subject || "Abra action"));
  let body = sanitizeText(String(params.body || params.html || params.message || ""), 10000);
  const allowExternal = params.allow_external === true;
  if (!to || !body) {
    return { success: false, message: "Missing email recipient or body" };
  }

  // Safety: only send to known/allowed recipients
  if (!allowExternal && !isAllowedEmailRecipient(to)) {
    return {
      success: false,
      message: `Email recipient "${to}" is not in the allowed list. Only @usagummies.com and pre-approved addresses are permitted.`,
    };
  }

  // Ensure Abra signature on all outgoing emails
  if (!body.includes("Abra — via Benjamin")) {
    body = `${body.trimEnd()}\n\n—\nAbra — via Benjamin\nUSA Gummies`;
  }

  try {
    await sendOpsEmail({ to, subject, body, from: "Abra via Benjamin <ben@usagummies.com>" });
    void capMarkSuccess("gmail").catch(() => {});
    return { success: true, message: `Email sent to ${to}` };
  } catch (err) {
    void capMarkFailure("gmail", err instanceof Error ? err.message : "send failed").catch(() => {});
    throw err;
  }
}

type DraftOrderCreateResult = {
  draftOrderCreate: {
    draftOrder: {
      id: string;
      name: string;
      invoiceUrl: string | null;
      totalPriceSet: {
        shopMoney: { amount: string; currencyCode: string };
      };
      status: string;
    } | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
};

const CREATE_WHOLESALE_DRAFT_ORDER = /* GraphQL */ `
  mutation DraftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        name
        invoiceUrl
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

async function handleCreateWholesaleDraftOrder(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const customerName = sanitizeTitle(String(params.customer_name || params.customerName || ""));
  const customerEmail = String(params.customer_email || params.customerEmail || "").trim().toLowerCase();
  const companyName = sanitizeTitle(String(params.company_name || params.companyName || customerName));
  const quantity = Number(params.quantity || 0);
  const unitPrice = Number(params.unit_price || params.unitPrice || 0);
  const note = sanitizeText(String(params.note || ""), 1000);
  const productTitle = sanitizeTitle(String(params.product_title || params.productTitle || "Wholesale Line Item"));

  if (!customerName || !customerEmail || quantity <= 0 || unitPrice < 0) {
    return {
      success: false,
      message: "customer_name, customer_email, quantity, and unit_price are required for wholesale draft orders",
    };
  }

  const result = await adminRequest<DraftOrderCreateResult>(CREATE_WHOLESALE_DRAFT_ORDER, {
    input: {
      email: customerEmail,
      note: note || `Wholesale draft order for ${companyName}`,
      tags: ["wholesale", "abra-workflow"],
      lineItems: [
        {
          title: productTitle,
          quantity,
          originalUnitPrice: unitPrice,
          requiresShipping: true,
        },
      ],
    },
  });

  if (!result.ok || !result.data) {
    return {
      success: false,
      message: result.error || "Shopify draft order creation failed",
    };
  }

  const payload = result.data.draftOrderCreate;
  if (payload.userErrors?.length) {
    return {
      success: false,
      message: payload.userErrors.map((item) => item.message).join("; "),
    };
  }

  const draftOrder = payload.draftOrder;
  if (!draftOrder) {
    return { success: false, message: "Shopify did not return a draft order" };
  }

  return {
    success: true,
    message: `Created Shopify draft order ${draftOrder.name} for ${companyName}.`,
    data: {
      id: draftOrder.id,
      name: draftOrder.name,
      invoiceUrl: draftOrder.invoiceUrl,
      total: Number(draftOrder.totalPriceSet?.shopMoney?.amount || 0),
      currency: draftOrder.totalPriceSet?.shopMoney?.currencyCode || "USD",
      status: draftOrder.status,
    },
  };
}

type ProductCreateResult = {
  productCreate: {
    product: {
      id: string;
      title: string;
      status: string;
      onlineStorePreviewUrl: string | null;
    } | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
};

const CREATE_SHOPIFY_PRODUCT_DRAFT = /* GraphQL */ `
  mutation ProductCreate($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product {
        id
        title
        status
        onlineStorePreviewUrl
      }
      userErrors {
        field
        message
      }
    }
  }
`;

async function handleCreateShopifyProductDraft(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const title = sanitizeTitle(String(params.title || ""));
  const description = sanitizeText(String(params.description || ""), 5000);
  const productType = sanitizeTitle(String(params.product_type || params.productType || "Candy"));
  const tagsRaw = String(params.tags || "").trim();
  const tags = tagsRaw
    ? tagsRaw.split(",").map((item) => item.trim()).filter(Boolean)
    : ["abra-launch"];

  if (!title) {
    return { success: false, message: "title is required to create a Shopify product draft" };
  }

  const result = await adminRequest<ProductCreateResult>(CREATE_SHOPIFY_PRODUCT_DRAFT, {
    product: {
      title,
      descriptionHtml: description || undefined,
      productType,
      status: "DRAFT",
      tags,
      vendor: "USA Gummies",
    },
  });

  if (!result.ok || !result.data) {
    return {
      success: false,
      message: result.error || "Shopify product draft creation failed",
    };
  }

  const payload = result.data.productCreate;
  if (payload.userErrors?.length) {
    return {
      success: false,
      message: payload.userErrors.map((item) => item.message).join("; "),
    };
  }

  if (!payload.product) {
    return { success: false, message: "Shopify did not return a product draft" };
  }

  return {
    success: true,
    message: `Created Shopify product draft ${payload.product.title}.`,
    data: payload.product,
  };
}

async function handleRunMonthlyClose(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const period = String(params.period || "").trim();
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return { success: false, message: "period must be YYYY-MM" };
  }

  try {
    const report = await runMonthlyClose(period, "workflow");
    return {
      success: true,
      message: `Monthly close completed for ${period}. Revenue $${report.pnl.revenue.total.toFixed(2)}, net income $${report.pnl.netIncome.toFixed(2)}.`,
      data: { report },
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Monthly close failed",
    };
  }
}

async function handleStartWorkflow(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const workflowId = String(params.workflow_id || params.workflowId || "").trim();
  const context =
    params.context && typeof params.context === "object"
      ? (params.context as Record<string, unknown>)
      : {};
  const startedBy = String(params.started_by || params.startedBy || "abra");

  if (!workflowId) {
    return { success: false, message: "workflow_id is required" };
  }

  try {
    const { startWorkflow } = await import("@/lib/ops/workflow-engine");
    const run = await startWorkflow(workflowId, context, startedBy);
    return {
      success: true,
      message: `Started workflow ${workflowId} (${run.status}).`,
      data: run,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to start workflow",
    };
  }
}

async function handleResumeWorkflow(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const runId = String(params.run_id || params.runId || "").trim();
  const decision = params.decision === "denied" ? "denied" : "approved";
  if (!runId) {
    return { success: false, message: "run_id is required" };
  }

  try {
    const { resumeWorkflow } = await import("@/lib/ops/workflow-engine");
    const run = await resumeWorkflow(runId, decision);
    return {
      success: true,
      message: `Workflow ${run.workflow_id} is now ${run.status}.`,
      data: run,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to resume workflow",
    };
  }
}

/**
 * draft_email_reply — stores a draft for human review, does NOT send immediately.
 * The draft gets posted to #abra-control and the operator must run
 * `/abra sendreply <cmd-id>` to actually dispatch it. This matches the system
 * prompt contract: "drafts never auto-send."
 */
async function handleDraftEmailReply(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const to = String(params.to || "").toLowerCase().trim();
  const subject = sanitizeTitle(String(params.subject || "Re: (no subject)"));
  let body = sanitizeText(String(params.body || ""), 10000);
  const sourceEmailId = typeof params.source_email_id === "string" ? params.source_email_id : null;
  const senderName = String(params.sender_name || params.recipient_name || to.split("@")[0] || "Unknown");

  if (!to || !body) {
    return { success: false, message: "Missing email recipient or body for draft reply" };
  }

  // Ensure Abra signature is present
  if (!body.includes("Best,\nBen") && !body.includes("Abra — via Benjamin")) {
    body = `${body.trimEnd()}\n\nBest,\nBen`;
  }

  // Store draft in abra_email_commands for human approval instead of sending
  try {
    const commandId = `cmd-${randomUUID().slice(0, 8)}`;
    await sbFetch("/rest/v1/abra_email_commands", {
      method: "POST",
      headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
      body: JSON.stringify({
        id: commandId,
        status: "draft_reply_pending",
        sender_name: senderName,
        sender_email: to,
        subject,
        task: `Draft reply to ${senderName}`,
        draft_reply_subject: subject,
        draft_reply_body: body,
        body_snippet: body.slice(0, 500),
        ...(sourceEmailId ? { gmail_thread_id: sourceEmailId } : {}),
      }),
    });

    // Notify Slack for review
    await notify({
      channel: "alerts",
      text:
        `📧 *Draft Reply Queued*\n` +
        `*To:* ${to}\n*Subject:* ${subject}\n\n` +
        `> ${body.slice(0, 300).split("\n").join("\n> ")}\n\n` +
        `_Send with:_ \`/abra sendreply ${commandId}\` _or discard with:_ \`/abra deny ${commandId}\``,
    });

    // Update source email's draft_status if we have a reference
    if (sourceEmailId) {
      try {
        await sbFetch(
          `/rest/v1/email_events?id=eq.${encodeURIComponent(sourceEmailId)}`,
          {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ draft_status: "pending" }),
          },
        );
      } catch (err) {
        console.error(`[abra-actions] Failed to update draft_status for ${sourceEmailId}:`, err);
      }
    }

    return {
      success: true,
      message: `Draft reply queued for review (${commandId}). Use /abra sendreply ${commandId} in Slack to send.`,
      data: { command_id: commandId },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, message: `Failed to queue draft reply: ${msg}` };
  }
}

async function handleCreateTask(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const title = sanitizeTitle(String(params.title || ""));
  if (!title) return { success: false, message: "Task title is required" };

  const description = sanitizeText(String(params.description || ""));
  const priorityRaw = String(params.priority || "normal").toLowerCase();
  const priority =
    priorityRaw === "critical" ||
    priorityRaw === "high" ||
    priorityRaw === "normal" ||
    priorityRaw === "low"
      ? priorityRaw
      : "normal";
  const taskType = String(params.task_type || "notification");

  const abraAgentId = await resolveAbraAgentId();
  const rows = (await sbFetch("/rest/v1/tasks", {
    method: "POST",
    headers: {
      Prefer: "return=representation",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      created_by_agent_id: abraAgentId,
      assigned_to_agent_id: abraAgentId,
      task_type: taskType,
      title,
      description,
      priority,
      status: "pending",
    }),
  })) as Array<{ id: string }>;

  return {
    success: true,
    message: "Task created",
    data: { task_id: rows[0]?.id || null },
  };
}

async function handleUpdateNotion(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const pageId = typeof params.page_id === "string" ? params.page_id.replace(/-/g, "") : "";
  const content = typeof params.content === "string" ? sanitizeText(params.content, 10000) : undefined;
  const properties =
    params.properties && typeof params.properties === "object"
      ? (params.properties as Record<string, unknown>)
      : undefined;

  if (pageId && !/^[0-9a-f]{32}$/i.test(pageId)) {
    return { success: false, message: "page_id must be a valid Notion page ID (32 hex characters)" };
  }

  if (pageId) {
    const ok = await updateNotionPage({
      page_id: pageId,
      ...(properties ? { properties } : {}),
      ...(content ? { content } : {}),
    });
    return {
      success: ok,
      message: ok ? "Updated Notion page" : "Failed to update Notion page",
    };
  }

  const parentId =
    typeof params.parent_id === "string"
      ? params.parent_id
      : process.env.NOTION_MEETING_NOTES_DB || "";
  const title = sanitizeTitle(String(params.title || "Abra Update"));
  if (!parentId) {
    return { success: false, message: "Notion parent_id is required" };
  }

  const created = await createNotionPage({
    parent_id: parentId,
    title,
    ...(content ? { content } : {}),
    ...(properties ? { properties } : {}),
  });
  return {
    success: !!created,
    message: created ? "Created Notion page" : "Failed to create Notion page",
    data: { page_id: created || null },
  };
}

const VALID_BRAIN_CATEGORIES = new Set([
  "market_intel", "financial", "operational", "regulatory",
  "customer_insight", "deal_data", "email_triage",
  "competitive", "research", "field_note", "system_log",
  "teaching", "general", "company_info", "product_info",
  "supply_chain", "sales", "founder", "culture", "correction",
  "production_run", "vendor_quote", "scenario_analysis",
]);

const VALID_BRAIN_ENTRY_TYPES = new Set([
  "finding", "research", "field_note", "summary",
  "alert", "system_log", "correction", "teaching",
  "kpi", "session_summary", "auto_teach",
]);

async function handleCreateBrainEntry(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const title = sanitizeTitle(String(params.title || "Action log"));
  const text = sanitizeText(String(params.text || params.content || ""));
  if (!text) return { success: false, message: "Brain entry text is required" };

  // Respect LLM-specified category/department/entry_type if valid, else default
  const rawCategory = typeof params.category === "string" ? params.category.toLowerCase() : "";
  const category = VALID_BRAIN_CATEGORIES.has(rawCategory) ? rawCategory : "general";
  const rawEntryType = typeof params.entry_type === "string" ? params.entry_type.toLowerCase() : "";
  const entryType = VALID_BRAIN_ENTRY_TYPES.has(rawEntryType) ? rawEntryType : "finding";
  const department = typeof params.department === "string" ? params.department.slice(0, 50) : "executive";
  const tagsParam = Array.isArray(params.tags) ? params.tags.filter((t): t is string => typeof t === "string").slice(0, 10) : undefined;

  const rows = (await sbFetch("/rest/v1/open_brain_entries", {
    method: "POST",
    headers: {
      Prefer: "return=representation",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_type: "agent",
      source_ref: "abra_action",
      entry_type: entryType,
      title,
      raw_text: text,
      summary_text: text.slice(0, 500),
      category,
      department,
      confidence: "medium",
      priority: "normal",
      processed: true,
      ...(tagsParam ? { tags: tagsParam } : {}),
    }),
  })) as Array<{ id: string }>;

  const entryId = rows[0]?.id;
  if (entryId) {
    embedBrainEntry(entryId, `${title}: ${text}`);
  }

  return {
    success: true,
    message: "Brain entry created",
    data: { entry_id: entryId || null },
  };
}

async function handleAcknowledgeSignal(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const signalId = String(params.signal_id || "");
  if (!signalId) return { success: false, message: "signal_id is required" };
  if (!isValidUUID(signalId)) return { success: false, message: "signal_id must be a valid UUID" };

  await sbFetch(`/rest/v1/abra_operational_signals?id=eq.${signalId}`, {
    method: "PATCH",
    headers: {
      Prefer: "return=minimal",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      acknowledged: true,
      acknowledged_by: "abra",
      status: "acknowledged",
    }),
  });

  return { success: true, message: `Signal ${signalId} acknowledged` };
}

async function handlePauseInitiative(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const initiativeId = String(params.initiative_id || "");
  if (!initiativeId) {
    return { success: false, message: "initiative_id is required" };
  }
  if (!isValidUUID(initiativeId)) {
    return { success: false, message: "initiative_id must be a valid UUID" };
  }

  await sbFetch(`/rest/v1/abra_initiatives?id=eq.${initiativeId}`, {
    method: "PATCH",
    headers: {
      Prefer: "return=minimal",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      status: "paused",
      updated_at: new Date().toISOString(),
    }),
  });

  return { success: true, message: `Initiative ${initiativeId} paused` };
}

function resolveNotionDb(key: string): string {
  const normalized = (key || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  // Only fall back to "general" if the caller explicitly requested it — unknown keys return empty
  // so the handler can report the error with available keys rather than silently misrouting
  return NOTION_DB_MAP[normalized] || "";
}

// ─── READ-ONLY NOTION QUERY (for tool_use) ─────────────────────────────
export async function queryNotionDatabase(
  databaseKey: string,
  filterText?: string,
): Promise<ActionResult> {
  const dbId = resolveNotionDb(databaseKey);
  if (!dbId) {
    return { success: false, message: `Unknown database: "${databaseKey}". Available: ${Object.keys(NOTION_DB_MAP).join(", ")}` };
  }

  const notionToken = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN || "";
  if (!notionToken) {
    return { success: false, message: "No Notion API key configured" };
  }

  try {
    const body: Record<string, unknown> = { page_size: 20 };
    if (filterText) {
      body.filter = {
        property: "Name",
        title: { contains: filterText },
      };
    }

    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { success: false, message: `Notion query failed (${res.status}): ${errText.slice(0, 300)}` };
    }

    const data = await res.json();
    const results = (data.results || []).slice(0, 20);

    // Also get database schema
    const schemaRes = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
      },
      signal: AbortSignal.timeout(10000),
    });

    let schema = "";
    if (schemaRes.ok) {
      const schemaData = await schemaRes.json();
      const props = Object.entries(schemaData.properties || {}).map(
        ([name, prop]: [string, unknown]) => `${name} (${(prop as { type: string }).type})`,
      );
      schema = `Database columns: ${props.join(", ")}`;
    }

    // Summarize results
    const summaries = results.map((page: Record<string, unknown>) => {
      const pageProps = (page.properties || {}) as Record<string, Record<string, unknown>>;
      const titleProp = pageProps.Name || pageProps.Title ||
        Object.values(pageProps).find((p) => p.type === "title");
      const titleArr = titleProp?.title as Array<{ plain_text: string }> | undefined;
      const title = titleArr?.[0]?.plain_text || "(untitled)";
      const id = page.id;
      return {
        id,
        title,
        properties: Object.fromEntries(
          Object.entries(pageProps).slice(0, 10).map(([k, v]) => {
            if (v.type === "title") return [k, (v.title as Array<{ plain_text: string }>)?.[0]?.plain_text || ""];
            if (v.type === "rich_text") return [k, (v.rich_text as Array<{ plain_text: string }>)?.[0]?.plain_text || ""];
            if (v.type === "number") return [k, v.number];
            if (v.type === "select") return [k, (v.select as { name: string } | null)?.name || ""];
            if (v.type === "date") return [k, (v.date as { start: string } | null)?.start || ""];
            if (v.type === "checkbox") return [k, v.checkbox];
            return [k, `(${v.type})`];
          }),
        ),
      };
    });

    return {
      success: true,
      message: `Found ${results.length} results in ${databaseKey}. ${schema}`,
      data: { schema, results: summaries, total: data.results?.length || 0 },
    };
  } catch (err) {
    return { success: false, message: `Query failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function notionUrlFromId(pageId: string): string {
  return `https://www.notion.so/${pageId.replace(/-/g, "")}`;
}

async function handleCreateNotionPage(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const dbKey = String(params.database || params.db || "general");
  const title = sanitizeTitle(String(params.title || "Abra Report"));
  const content = typeof params.content === "string" ? sanitizeText(params.content, 10000) : undefined;
  const properties =
    params.properties && typeof params.properties === "object"
      ? (params.properties as Record<string, unknown>)
      : undefined;

  const parentId = resolveNotionDb(dbKey);
  if (!parentId) {
    return { success: false, message: `No Notion database found for key "${dbKey}". Available: ${Object.keys(NOTION_DB_MAP).join(", ")}` };
  }

  try {
    const pageId = await createNotionPage({
      parent_id: parentId,
      title,
      ...(content ? { content } : {}),
      ...(properties ? { properties } : {}),
    });

    if (!pageId) {
      void capMarkFailure("notion", "createNotionPage returned null").catch(() => {});
      return { success: false, message: "Failed to create Notion page" };
    }

    void capMarkSuccess("notion").catch(() => {});
    const url = notionUrlFromId(pageId);
    return {
      success: true,
      message: `Created Notion page: [${title}](${url})`,
      data: { page_id: pageId, url },
    };
  } catch (err) {
    void capMarkFailure("notion", err instanceof Error ? err.message : "unknown").catch(() => {});
    throw err;
  }
}

// ── Input validation helpers ────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(value: string): boolean {
  return UUID_RE.test(value);
}

/** Max content length for text fields to prevent context-stuffing attacks */
const MAX_TEXT_LENGTH = 5000;
const MAX_TITLE_LENGTH = 200;

function sanitizeText(value: string, maxLen = MAX_TEXT_LENGTH): string {
  return value.slice(0, maxLen).trim();
}

function sanitizeTitle(value: string): string {
  return value.slice(0, MAX_TITLE_LENGTH).trim();
}

/** Validate ISO date string (YYYY-MM-DD) */
function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return !isNaN(d.getTime());
}

/**
 * Email allowlist — only these domains can receive automated emails from Abra.
 * This prevents Claude from being tricked into sending emails to arbitrary addresses.
 */
const ALLOWED_EMAIL_DOMAINS = new Set([
  "usagummies.com",
]);

/** Additional allowed specific addresses (for known contacts) */
const ALLOWED_EMAIL_ADDRESSES = new Set([
  "ben@usagummies.com",
  "benjamin.stutman@gmail.com",
  "gonz1rene@outlook.com",
]);

function isAllowedEmailRecipient(email: string): boolean {
  const normalized = email.toLowerCase().trim();
  if (ALLOWED_EMAIL_ADDRESSES.has(normalized)) return true;
  const domain = normalized.split("@")[1];
  return domain ? ALLOWED_EMAIL_DOMAINS.has(domain) : false;
}

function getInternalOpsBaseUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://www.usagummies.com";
}

function getInternalOpsHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (cronSecret) {
    headers.Authorization = `Bearer ${cronSecret}`;
  }
  return headers;
}

// ── Transaction validation ──────────────────────────────────────────────────

const VALID_TX_TYPES = new Set(["income", "expense", "transfer", "refund", "cogs", "tax", "shipping"]);
const MAX_TX_AMOUNT = 100_000; // Hard safety limit — anything higher is likely a hallucination

// ── Vendor-aware account code classifier ─────────────────────────────────────
// Matches vendor name and description keywords to the standard Chart of Accounts.
// Falls back to the category-based mapping if no vendor rule matches.
function classifyAccountCode(
  vendor: string,
  description: string,
  categoryKey: string,
  categoryMap: Record<string, string>,
): string {
  const v = vendor.toLowerCase();
  const d = description.toLowerCase();
  const combined = `${d} ${v}`;

  // Transfers (internal Found pocket moves, owner funding)
  if (/social media to primary|primary to social media|pocket.to.pocket/.test(combined)) return "1000 - Found Checking *6445";
  if (/mastercard debit|owner.*(invest|fund|transfer)|personal fund/.test(combined)) return "1000 - Found Checking *6445";
  if (/bank account \d+/.test(combined)) return "1000 - Found Checking *6445";

  // Revenue shortcuts
  if (categoryKey === "income" || categoryKey === "Income") {
    if (/amazon/.test(combined)) return "4200 - Product Sales (Amazon)";
    if (/wholesale|b2b|distributor/.test(combined)) return "4300 - Product Sales (Wholesale)";
    if (/balance bonus|interest|cashback|cash back|referral bonus|found plus/.test(combined)) return "4900 - Other Income";
    return "4100 - Product Sales (DTC)";
  }
  // Revenue by name pattern
  if (/usa gummies|squarespace paym|shopify.*payout/.test(combined)) return "4100 - Product Sales (DTC)";
  if (/referral bonus|cash back|found plus|balance bonus/.test(combined)) return "4900 - Other Income";

  // COGS
  if (/dutch valley|co.?pack|manufacturing|production run|ashford valley/.test(combined)) return "5300 - Co-Packing/Manufacturing";
  if (/ingredient|flavoring|coloring|gummy base|energinut/.test(combined)) return "5100 - Ingredients";
  if (/packaging|pouch|label|film|box(?:es)?|zebra\s?pack|ninjaprinthouse/.test(combined) && !/pirate/.test(combined)) return "5200 - Packaging";
  if (/resale|purchased for resale/.test(combined)) return "5400 - Items Purchased for Resale";

  // Contractors
  if (/hunter of design|treadstone|troy burkhart|hawk design|contractor/.test(combined)) return "6100 - Contractor Services";

  // Advertising
  if (/facebook|meta|google ads|rumble|blip|tiktok|zeely|billboard|advertis|marketing|promo/.test(combined)) return "6200 - Advertising & Marketing";

  // Software (expanded)
  if (/anthropic|openai|chatgpt|shopify|slack|squarespace|invideo|apollo|cratejoy|cloudflare|n8n|midjourney|ownerrez|apple sub|amazon seller|x corp|twitter|saas|subscription|software|google \*svcs|google.*workspace|workspace_|brave\.com|deevid/.test(combined)) return "6300 - Software & Subscriptions";

  // Specific OpEx
  if (/t-mobile|t.mobile|cell phone|mobile service/.test(combined)) return "6400 - Cell Phone Service";
  if (/company sage|attorney|legal|trademark|gs1|barcode|lowe graham|wyoming/.test(combined)) return "6500 - Legal Services";
  if (/pirate ship|usps|u\.s\. post office|shipping label|postage|fedex|ups\b/.test(combined)) return "6600 - Postage & Shipping";
  if (/geico|insurance/.test(combined)) return "6700 - Insurance";
  if (/fuel|shell|exxon|maverik|pilot|gas station|vehicle/.test(combined)) return "6800 - Vehicle Expenses";
  if (/hotel|lodging|hampton|quality inn|trade show|highlander/.test(combined)) return "6900 - Business Travel & Lodging";
  if (/meal|restaurant|dining|client meeting|sport clips/.test(combined)) return "7000 - Business Meals";
  if (/wire.*(fee|transfer)|processing fee|bank fee|stripe fee|payment processing/.test(combined)) return "7100 - Bank & Processing Fees";
  if (/income tax|tax payment|irs/.test(combined)) return "8100 - Income Tax Expense";

  // Fallback to category map
  return categoryMap[categoryKey] || "7200 - Other Services";
}

async function handleRecordTransaction(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const description = sanitizeTitle(String(params.description || params.title || "Transaction"));
  const amount = typeof params.amount === "number" ? params.amount : parseFloat(String(params.amount || "0"));

  if (isNaN(amount) || amount === 0) {
    return { success: false, message: "Transaction amount must be a non-zero number" };
  }
  if (Math.abs(amount) > MAX_TX_AMOUNT) {
    return { success: false, message: `Transaction amount $${Math.abs(amount).toFixed(2)} exceeds safety limit of $${MAX_TX_AMOUNT.toLocaleString()}. Record this manually.` };
  }

  const txTypeRaw = String(params.type || "expense").toLowerCase().trim();
  const txType = VALID_TX_TYPES.has(txTypeRaw) ? txTypeRaw : "expense";
  const category = String(params.category || "general");
  const vendor = typeof params.vendor === "string" ? params.vendor.slice(0, 200) : undefined;
  const dateStrRaw = typeof params.date === "string" ? params.date : new Date().toISOString().split("T")[0];
  const dateStr = isValidDateString(dateStrRaw) ? dateStrRaw : new Date().toISOString().split("T")[0];

  // Reject dates more than 1 year in the future (likely hallucinated)
  const txDate = new Date(dateStr + "T00:00:00Z");
  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
  if (txDate > oneYearFromNow) {
    return { success: false, message: `Transaction date ${dateStr} is more than 1 year in the future — likely incorrect` };
  }

  // Deduplication: check if an identical transaction was already recorded in the last 10 minutes
  // (same amount, type, and description substring — catches LLM retry/re-emit)
  try {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const dedupeRows = (await sbFetch(
      `/rest/v1/approvals?auto_executed=eq.true&created_at=gte.${encodeURIComponent(tenMinAgo)}&select=id,proposed_payload&limit=50`,
    )) as Array<{ id: string; proposed_payload?: unknown }>;

    const isDuplicate = (Array.isArray(dedupeRows) ? dedupeRows : []).some((row) => {
      if (!row.proposed_payload || typeof row.proposed_payload !== "object") return false;
      const payload = row.proposed_payload as Record<string, unknown>;
      const origType = String(payload.original_action_type || payload.action_type || "");
      if (origType !== "record_transaction") return false;
      const p = (payload.params && typeof payload.params === "object" ? payload.params : payload) as Record<string, unknown>;
      const prevAmount = typeof p.amount === "number" ? p.amount : parseFloat(String(p.amount || "0"));
      const prevDesc = String(p.description || p.title || "").toLowerCase();
      return Math.abs(prevAmount - amount) < 0.01 && prevDesc === description.toLowerCase();
    });

    if (isDuplicate) {
      return { success: false, message: `Duplicate transaction detected: $${amount.toFixed(2)} "${description}" was already recorded in the last 10 minutes. Skipping to prevent double-entry.` };
    }
  } catch {
    // Deduplication is best-effort — proceed if check fails
  }

  const parentId = NOTION_DB_MAP.cash_transactions;
  if (!parentId) {
    return { success: false, message: "Cash Transactions database not configured" };
  }

  // ── Derive enhanced accounting fields ──
  const CATEGORY_TO_ACCOUNT: Record<string, string> = {
    cogs: "5300 - Co-Packing/Manufacturing",
    ingredients: "5100 - Ingredients",
    packaging: "5200 - Packaging",
    resale: "5400 - Items Purchased for Resale",
    shipping_expense: "6600 - Postage & Shipping",
    selling_expense: "7100 - Bank & Processing Fees",
    sga: "6300 - Software & Subscriptions",
    marketing: "6200 - Advertising & Marketing",
    professional_services: "6500 - Legal Services",
    capital_expenditure: "1500 - Equipment & Assets",
    contra_revenue: "4900 - Returns & Refunds",
    income: "4100 - Product Sales (DTC)",
    transfer: "1000 - Found Checking *6445",
    general: "7200 - Other Services",
    refund: "4900 - Returns & Refunds",
    tax: "8100 - Income Tax Expense",
    shipping: "6600 - Postage & Shipping",
    contractor: "6100 - Contractor Services",
    travel: "6900 - Business Travel & Lodging",
    meals: "7000 - Business Meals",
    insurance: "6700 - Insurance",
    vehicle: "6800 - Vehicle Expenses",
    phone: "6400 - Cell Phone Service",
  };
  const accountCode = typeof params.account_code === "string"
    ? params.account_code
    : classifyAccountCode(vendor || "", description, category || txTypeRaw, CATEGORY_TO_ACCOUNT);

  const txDateObj = new Date(dateStr + "T00:00:00Z");
  const fiscalYear = String(txDateObj.getUTCFullYear());
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fiscalMonth = MONTHS[txDateObj.getUTCMonth()];

  const paymentMethod = typeof params.payment_method === "string" ? params.payment_method : undefined;
  const statusVal = typeof params.status === "string" ? params.status : "Needs Review";
  const taxDeductible = typeof params.tax_deductible === "boolean" ? params.tax_deductible : (txType !== "transfer" && txType !== "income");
  const notes = typeof params.notes === "string" ? params.notes.slice(0, 500) : undefined;
  const source = typeof params.source === "string" ? params.source : "Abra Auto-Extract";

  const properties: Record<string, unknown> = {
    Amount: { number: amount },
    Type: { select: { name: txType } },
    Category: { select: { name: category } },
    Date: { date: { start: dateStr } },
    "Account Code": { select: { name: accountCode } },
    "Fiscal Year": { select: { name: fiscalYear } },
    "Fiscal Month": { select: { name: fiscalMonth } },
    Status: { select: { name: statusVal } },
    "Tax Deductible": { checkbox: taxDeductible },
    Source: { select: { name: source.slice(0, 100) } },
  };
  if (vendor) {
    properties.Vendor = { rich_text: [{ text: { content: vendor.slice(0, 200) } }] };
  }
  if (paymentMethod) {
    properties["Payment Method"] = { select: { name: paymentMethod } };
  }
  if (notes) {
    properties.Notes = { rich_text: [{ text: { content: notes } }] };
  }

  const pageId = await createNotionPage({
    parent_id: parentId,
    title: description,
    properties,
  });

  if (!pageId) {
    return { success: false, message: "Failed to record transaction" };
  }

  const url = notionUrlFromId(pageId);
  return {
    success: true,
    message: `Recorded ${txType}: $${amount.toFixed(2)} — ${description} [View](${url})`,
    data: { page_id: pageId, url, amount, type: txType },
  };
}

async function handleQueryLedger(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const fiscalYear = typeof params.fiscal_year === "string" ? params.fiscal_year : undefined;
  const category = typeof params.category === "string" ? params.category : undefined;
  const accountCode = typeof params.account_code === "string" ? params.account_code : undefined;

  try {
    const result = await queryLedgerSummary({ fiscalYear, category, accountCode });

    if (result.transactions.length === 0) {
      return { success: true, message: "No transactions found matching those filters.", data: result.summary };
    }

    const { summary } = result;
    const lines: string[] = [
      `**Ledger Query Results** (${summary.transactionCount} transactions)`,
      ``,
      `**Totals:**`,
      `- Total Income: $${summary.totalIncome.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      `- Total COGS: $${summary.totalCOGS.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      `- Total OpEx: $${summary.totalExpenses.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      `- Total All Spend (COGS+OpEx): $${summary.totalAllSpend.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      `- Owner Investment / Capital: $${summary.totalOwnerInvestment.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      `- Net Income (Revenue - Spend): $${summary.netIncome.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      ``,
      `**By Category:**`,
    ];
    for (const [cat, amt] of Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${cat}: $${amt.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    }
    lines.push(``, `**By Account Code:**`);
    for (const [code, amt] of Object.entries(summary.byAccountCode).sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${code}: $${amt.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    }
    lines.push(``, `**By Fiscal Year:**`);
    for (const [yr, amt] of Object.entries(summary.byFiscalYear).sort()) {
      lines.push(`- ${yr}: $${amt.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    }
    lines.push(``, `Notion ledger: https://www.notion.so/6325d16870024b83876b9e591b3d2d9c`);

    return {
      success: true,
      message: lines.join("\n"),
      data: summary,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to query ledger: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function handleCorrectClaim(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const originalClaim = sanitizeText(String(params.original_claim || params.wrong || ""), 1000);
  const correction = sanitizeText(String(params.correction || params.correct || params.right || ""), 1000);
  const correctedBy = sanitizeTitle(String(params.corrected_by || "user"));
  const department = typeof params.department === "string" ? params.department.slice(0, 50) : "executive";

  if (!originalClaim || !correction) {
    return {
      success: false,
      message: "Both original_claim and correction are required",
    };
  }

  const text = `CORRECTION: "${originalClaim}" is WRONG. The correct information is: "${correction}". Corrected by ${correctedBy} on ${new Date().toISOString().split("T")[0]}.`;

  // 1. Write to abra_corrections table (this is what the chat/session routes read)
  const correctionRows = (await sbFetch("/rest/v1/abra_corrections", {
    method: "POST",
    headers: {
      Prefer: "return=representation",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      corrected_by: correctedBy,
      original_claim: originalClaim,
      correction,
      department,
      active: true,
    }),
  })) as Array<{ id: string }>;

  const correctionId = correctionRows[0]?.id;

  // 2. Also write to open_brain_entries so it surfaces in semantic search (HOT tier)
  let brainEntryId: string | null = null;
  try {
    const brainRows = (await sbFetch("/rest/v1/open_brain_entries", {
      method: "POST",
      headers: {
        Prefer: "return=representation",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_type: "agent",
        source_ref: "abra_correction",
        entry_type: "correction",
        title: `Correction: ${originalClaim.slice(0, 80)}`,
        raw_text: text,
        summary_text: text.slice(0, 500),
        category: "correction",
        department,
        confidence: "verified",
        priority: "critical",
        processed: true,
        tags: ["correction", "pinned"],
      }),
    })) as Array<{ id: string }>;

    brainEntryId = brainRows[0]?.id || null;
    if (brainEntryId) {
      embedBrainEntry(brainEntryId, text);
    }
  } catch {
    // Brain entry is supplementary — correction table is the source of truth
    console.error("[abra-actions] Failed to write correction to brain entries (will still work via abra_corrections table)");
  }

  // 3. Notify on Slack so the team knows a correction was logged
  await notify({
    channel: "alerts",
    text: `📌 *Correction Logged*\n• Wrong: "${originalClaim.slice(0, 100)}"\n• Correct: "${correction.slice(0, 100)}"\n• By: ${correctedBy}`,
  }).catch(() => {});

  return {
    success: true,
    message: `Correction pinned: "${originalClaim.slice(0, 60)}..." → "${correction.slice(0, 60)}..."`,
    data: { correction_id: correctionId || null, brain_entry_id: brainEntryId },
  };
}

// ─── CPG OPERATIONS HANDLERS ────────────────────────────────────────────

function toStringArrayLocal(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => typeof item === "string" ? item.trim() : String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

const MAX_PRODUCTION_COST = 500_000; // Safety limit for production run total cost

async function handleLogProductionRun(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const manufacturer = typeof params.manufacturer === "string" ? params.manufacturer.trim() : "";
  if (!manufacturer) return { success: false, message: "manufacturer is required" };

  const runDateRaw = typeof params.run_date === "string" ? params.run_date : "";
  if (!isValidDateString(runDateRaw)) return { success: false, message: "run_date must be a valid date (YYYY-MM-DD)" };

  const skusProduced = toStringArrayLocal(params.skus_produced);
  const totalUnitsOrdered = typeof params.total_units_ordered === "number"
    ? params.total_units_ordered
    : parseInt(String(params.total_units_ordered || "0"), 10);
  if (!totalUnitsOrdered || totalUnitsOrdered <= 0) {
    return { success: false, message: "total_units_ordered must be a positive number" };
  }

  const totalUnitsReceived = typeof params.total_units_received === "number"
    ? params.total_units_received
    : (typeof params.total_units_received === "string" && params.total_units_received
        ? parseInt(params.total_units_received, 10)
        : totalUnitsOrdered); // Default to ordered if not specified

  const totalCost = typeof params.total_cost === "number"
    ? params.total_cost
    : parseFloat(String(params.total_cost || "0"));
  if (isNaN(totalCost) || totalCost <= 0) {
    return { success: false, message: "total_cost must be a positive number" };
  }
  if (totalCost > MAX_PRODUCTION_COST) {
    return { success: false, message: `Total cost $${totalCost.toLocaleString()} exceeds safety limit of $${MAX_PRODUCTION_COST.toLocaleString()}. Record this manually.` };
  }

  const yieldRate = totalUnitsOrdered > 0 ? totalUnitsReceived / totalUnitsOrdered : 0;
  const costPerUnit = totalUnitsReceived > 0 ? totalCost / totalUnitsReceived : 0;
  const notes = typeof params.notes === "string" ? params.notes.slice(0, 2000) : "";

  const title = `Production Run — ${manufacturer} — ${runDateRaw}`;
  const text = [
    `Production run at ${manufacturer} on ${runDateRaw}.`,
    `SKUs: ${skusProduced.length > 0 ? skusProduced.join(", ") : "not specified"}.`,
    `Units ordered: ${totalUnitsOrdered.toLocaleString()}, received: ${totalUnitsReceived.toLocaleString()} (yield: ${(yieldRate * 100).toFixed(1)}%).`,
    `Total cost: $${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}. Cost per unit: $${costPerUnit.toFixed(4)}.`,
    notes ? `Notes: ${notes}` : "",
  ].filter(Boolean).join(" ");

  const metadata = {
    manufacturer,
    run_date: runDateRaw,
    skus_produced: skusProduced,
    total_units_ordered: totalUnitsOrdered,
    total_units_received: totalUnitsReceived,
    yield_rate: parseFloat(yieldRate.toFixed(4)),
    total_cost: totalCost,
    cost_per_unit: parseFloat(costPerUnit.toFixed(4)),
    cost_stage: "hard", // Logged by user = confirmed cost
  };

  const rows = (await sbFetch("/rest/v1/open_brain_entries", {
    method: "POST",
    headers: { Prefer: "return=representation", "Content-Type": "application/json" },
    body: JSON.stringify({
      source_type: "agent",
      source_ref: "abra_production_run",
      entry_type: "finding",
      title,
      raw_text: text,
      summary_text: text.slice(0, 500),
      category: "production_run",
      department: "operations",
      confidence: "high",
      priority: "normal",
      processed: true,
      tags: ["production", "cogs", "manufacturing"],
      metadata,
    }),
  })) as Array<{ id: string }>;

  const entryId = rows[0]?.id;
  if (entryId) {
    embedBrainEntry(entryId, `${title}: ${text}`);
  }

  return {
    success: true,
    message: `Production run logged: ${manufacturer} on ${runDateRaw} — ${totalUnitsReceived.toLocaleString()} units at $${costPerUnit.toFixed(4)}/unit (yield: ${(yieldRate * 100).toFixed(1)}%)`,
    data: {
      entry_id: entryId || null,
      cost_per_unit: parseFloat(costPerUnit.toFixed(4)),
      yield_rate: parseFloat(yieldRate.toFixed(4)),
      total_cost: totalCost,
    },
  };
}

async function handleRecordVendorQuote(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const vendor = typeof params.vendor === "string" ? params.vendor.trim() : "";
  if (!vendor) return { success: false, message: "vendor is required" };

  const itemDescription = typeof params.item_description === "string" ? params.item_description.trim() : "";
  if (!itemDescription) return { success: false, message: "item_description is required" };

  const quotedPrice = typeof params.quoted_price === "number"
    ? params.quoted_price
    : parseFloat(String(params.quoted_price || "0"));
  if (isNaN(quotedPrice) || quotedPrice <= 0) {
    return { success: false, message: "quoted_price must be a positive number" };
  }

  const priceType = String(params.price_type || "per_unit").toLowerCase();
  if (priceType !== "total" && priceType !== "per_unit") {
    return { success: false, message: "price_type must be 'total' or 'per_unit'" };
  }

  const quantity = typeof params.quantity === "number"
    ? params.quantity
    : (typeof params.quantity === "string" ? parseFloat(params.quantity) : undefined);
  const unit = typeof params.unit === "string" ? params.unit.trim() : "units";
  const validUntil = typeof params.valid_until === "string" && isValidDateString(params.valid_until)
    ? params.valid_until : undefined;
  const notes = typeof params.notes === "string" ? params.notes.slice(0, 2000) : "";

  // Calculate per-unit price if total and quantity given
  let perUnitPrice: number | undefined;
  if (priceType === "total" && quantity && quantity > 0) {
    perUnitPrice = quotedPrice / quantity;
  } else if (priceType === "per_unit") {
    perUnitPrice = quotedPrice;
  }

  const title = `Vendor Quote — ${vendor} — ${itemDescription}`;
  const text = [
    `Quote from ${vendor} for ${itemDescription}.`,
    priceType === "total"
      ? `Total price: $${quotedPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}${quantity ? ` for ${quantity.toLocaleString()} ${unit}` : ""}.`
      : `Price: $${quotedPrice.toFixed(4)} per ${unit}.`,
    perUnitPrice && priceType === "total" ? `Per-unit: $${perUnitPrice.toFixed(4)}/${unit}.` : "",
    quantity ? `Quantity: ${quantity.toLocaleString()} ${unit}.` : "",
    validUntil ? `Valid until: ${validUntil}.` : "",
    notes ? `Notes: ${notes}` : "",
    "COGS Stage: QUOTE (Stage 1 of 5 — this is a projected cost, not a hard number).",
  ].filter(Boolean).join(" ");

  const metadata = {
    vendor,
    item_description: itemDescription,
    quoted_price: quotedPrice,
    price_type: priceType,
    per_unit_price: perUnitPrice ? parseFloat(perUnitPrice.toFixed(4)) : null,
    quantity: quantity || null,
    unit,
    valid_until: validUntil || null,
    cogs_stage: "quote",
  };

  const rows = (await sbFetch("/rest/v1/open_brain_entries", {
    method: "POST",
    headers: { Prefer: "return=representation", "Content-Type": "application/json" },
    body: JSON.stringify({
      source_type: "agent",
      source_ref: "abra_vendor_quote",
      entry_type: "finding",
      title,
      raw_text: text,
      summary_text: text.slice(0, 500),
      category: "vendor_quote",
      department: "operations",
      confidence: "medium",
      priority: "normal",
      processed: true,
      tags: ["vendor", "quote", "cogs", "supply_chain"],
      metadata,
    }),
  })) as Array<{ id: string }>;

  const entryId = rows[0]?.id;
  if (entryId) {
    embedBrainEntry(entryId, `${title}: ${text}`);
  }

  return {
    success: true,
    message: `Vendor quote logged: ${vendor} — ${itemDescription} at ${
      perUnitPrice ? `$${perUnitPrice.toFixed(4)}/${unit}` : `$${quotedPrice.toLocaleString()} ${priceType}`
    }${validUntil ? ` (valid until ${validUntil})` : ""}. COGS stage: QUOTE (projected).`,
    data: {
      entry_id: entryId || null,
      per_unit_price: perUnitPrice ? parseFloat(perUnitPrice.toFixed(4)) : null,
      vendor,
      cogs_stage: "quote",
    },
  };
}

async function handleRunScenario(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const scenarioName = typeof params.scenario_name === "string" ? params.scenario_name.trim() : "";
  if (!scenarioName) return { success: false, message: "scenario_name is required" };

  const baseValues = params.base_values as Record<string, unknown> | undefined;
  if (!baseValues || typeof baseValues !== "object") {
    return { success: false, message: "base_values is required (object with revenue, cogs_per_unit, units)" };
  }

  const revenue = typeof baseValues.revenue === "number" ? baseValues.revenue : parseFloat(String(baseValues.revenue || "0"));
  const cogsPerUnit = typeof baseValues.cogs_per_unit === "number" ? baseValues.cogs_per_unit : parseFloat(String(baseValues.cogs_per_unit || "0"));
  const units = typeof baseValues.units === "number" ? baseValues.units : parseInt(String(baseValues.units || "0"), 10);
  const channel = typeof baseValues.channel === "string" ? baseValues.channel : "all";

  if (revenue <= 0 && units <= 0) {
    return { success: false, message: "base_values must include positive revenue or units" };
  }

  const adjustments = Array.isArray(params.adjustments) ? params.adjustments : [];
  if (adjustments.length === 0) {
    return { success: false, message: "At least one adjustment is required for scenario analysis" };
  }

  // Compute base metrics
  const baseTotalCogs = cogsPerUnit * units;
  const baseGrossMargin = revenue > 0 ? ((revenue - baseTotalCogs) / revenue) * 100 : 0;
  const baseContribution = revenue - baseTotalCogs; // Simplified; channel fees would be subtracted in full model

  // Compute each scenario variant
  const scenarios: Array<{
    label: string;
    variable: string;
    change_pct: number;
    revenue: number;
    total_cogs: number;
    gross_margin_pct: number;
    contribution: number;
  }> = [];

  for (const adj of adjustments) {
    if (!adj || typeof adj !== "object") continue;
    const adjObj = adj as Record<string, unknown>;
    const variable = String(adjObj.variable || "unknown");
    const changePct = typeof adjObj.change_pct === "number" ? adjObj.change_pct : parseFloat(String(adjObj.change_pct || "0"));
    const label = typeof adjObj.label === "string" ? adjObj.label : `${variable} ${changePct > 0 ? "+" : ""}${changePct}%`;

    let adjRevenue = revenue;
    let adjCogs = cogsPerUnit;
    let adjUnits = units;

    // Apply adjustment based on variable type
    const varLower = variable.toLowerCase();
    if (varLower.includes("cost") || varLower.includes("cogs") || varLower.includes("ingredient")) {
      adjCogs = cogsPerUnit * (1 + changePct / 100);
    } else if (varLower.includes("price") || varLower.includes("revenue")) {
      adjRevenue = revenue * (1 + changePct / 100);
    } else if (varLower.includes("volume") || varLower.includes("demand") || varLower.includes("unit")) {
      adjUnits = Math.round(units * (1 + changePct / 100));
      adjRevenue = units > 0 ? (revenue / units) * adjUnits : 0; // Scale revenue proportionally
    } else {
      // Default: treat as cost adjustment
      adjCogs = cogsPerUnit * (1 + changePct / 100);
    }

    const adjTotalCogs = adjCogs * adjUnits;
    const adjGrossMargin = adjRevenue > 0 ? ((adjRevenue - adjTotalCogs) / adjRevenue) * 100 : 0;

    scenarios.push({
      label,
      variable,
      change_pct: changePct,
      revenue: parseFloat(adjRevenue.toFixed(2)),
      total_cogs: parseFloat(adjTotalCogs.toFixed(2)),
      gross_margin_pct: parseFloat(adjGrossMargin.toFixed(1)),
      contribution: parseFloat((adjRevenue - adjTotalCogs).toFixed(2)),
    });
  }

  // Build comparison table as text
  const notes = typeof params.notes === "string" ? params.notes.slice(0, 2000) : "";
  const lines = [
    `⚠️ HYPOTHETICAL SCENARIO ANALYSIS — NOT A FORECAST`,
    `Scenario: ${scenarioName} | Channel: ${channel}`,
    ``,
    `BASE CASE: Revenue $${revenue.toLocaleString()}, COGS/unit $${cogsPerUnit.toFixed(4)}, Units ${units.toLocaleString()}, Gross Margin ${baseGrossMargin.toFixed(1)}%, Contribution $${baseContribution.toLocaleString()}`,
    ``,
    ...scenarios.map((s) =>
      `${s.label}: Revenue $${s.revenue.toLocaleString()}, Total COGS $${s.total_cogs.toLocaleString()}, Gross Margin ${s.gross_margin_pct}%, Contribution $${s.contribution.toLocaleString()} (${s.contribution >= baseContribution ? "+" : ""}$${(s.contribution - baseContribution).toLocaleString()} vs base)`
    ),
    notes ? `\nNotes: ${notes}` : "",
  ].filter(Boolean).join("\n");

  const title = `Scenario Analysis — ${scenarioName}`;

  // Log to brain for future reference
  const rows = (await sbFetch("/rest/v1/open_brain_entries", {
    method: "POST",
    headers: { Prefer: "return=representation", "Content-Type": "application/json" },
    body: JSON.stringify({
      source_type: "agent",
      source_ref: "abra_scenario",
      entry_type: "finding",
      title,
      raw_text: lines,
      summary_text: lines.slice(0, 500),
      category: "scenario_analysis",
      department: "executive",
      confidence: "medium",
      priority: "normal",
      processed: true,
      tags: ["scenario", "analysis", "planning"],
      metadata: {
        scenario_name: scenarioName,
        channel,
        base_values: { revenue, cogs_per_unit: cogsPerUnit, units },
        scenarios,
      },
    }),
  })) as Array<{ id: string }>;

  const entryId = rows[0]?.id;
  if (entryId) {
    embedBrainEntry(entryId, `${title}: ${lines}`);
  }

  return {
    success: true,
    message: lines,
    data: {
      entry_id: entryId || null,
      base: { revenue, cogs_per_unit: cogsPerUnit, units, gross_margin_pct: parseFloat(baseGrossMargin.toFixed(1)), contribution: parseFloat(baseContribution.toFixed(2)) },
      scenarios,
    },
  };
}

// ---------------------------------------------------------------------------
// Email Actions — read_email and search_email
// ---------------------------------------------------------------------------

async function handleReadEmail(params: Record<string, unknown>): Promise<ActionResult> {
  const messageId = typeof params.message_id === "string" ? params.message_id.trim() : "";
  if (!messageId) {
    return { success: false, message: "message_id is required. Use the message ID from the LIVE INBOX feed (e.g., '1234abcd5678efgh')." };
  }

  try {
    const { readEmail } = await import("@/lib/ops/gmail-reader");
    const email = await readEmail(messageId);
    if (!email) {
      return { success: false, message: `Could not read email with ID ${messageId}. It may have been deleted or the ID is invalid.` };
    }

    // Truncate very long email bodies to avoid blowing up context
    const maxBodyLen = 3000;
    const body = email.body.length > maxBodyLen
      ? email.body.slice(0, maxBodyLen) + `\n\n[... truncated — full email is ${email.body.length} chars]`
      : email.body;

    // Attachment info
    const attachments = email.attachments || [];
    const attachmentInfo = attachments.length > 0
      ? `\n\nAttachments (${attachments.length}):\n${attachments.map((a) => `  • ${a.filename} (${a.mimeType}, ${(a.size / 1024).toFixed(0)}KB)`).join("\n")}`
      : "";

    // If user requested attachment reading and there are extractable attachments
    const readAttachments = params.read_attachments === true && attachments.length > 0;
    let attachmentText = "";
    if (readAttachments) {
      try {
        const { readAllAttachments } = await import("@/lib/ops/gmail-reader");
        const contents = await readAllAttachments(messageId, attachments);
        for (const c of contents) {
          if (c.textContent) {
            attachmentText += `\n\n--- ATTACHMENT: ${c.filename} ---\n${c.textContent.slice(0, 5000)}`;
          }
        }
      } catch {
        attachmentText = "\n\n[Failed to extract attachment content]";
      }
    }

    return {
      success: true,
      message: `Email from ${email.from} — "${email.subject}" (${email.date}):\n\n${body}${attachmentInfo}${attachmentText}`,
      data: {
        id: email.id,
        threadId: email.threadId,
        from: email.from,
        to: email.to,
        subject: email.subject,
        date: email.date,
        body_length: email.body.length,
        attachments: attachments.map((a) => ({
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
          attachmentId: a.attachmentId,
        })),
      },
    };
  } catch (err) {
    return { success: false, message: `Failed to read email: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function handleSearchEmail(params: Record<string, unknown>): Promise<ActionResult> {
  const query = typeof params.query === "string" ? params.query.trim() : "";
  if (!query) {
    return { success: false, message: "query is required. Use Gmail search syntax (e.g., 'from:rene subject:invoice', 'after:2026/03/01 powers confections')." };
  }
  const count = typeof params.count === "number" ? Math.min(params.count, 10) : 5;

  try {
    const { searchEmails } = await import("@/lib/ops/gmail-reader");
    const emails = await searchEmails(query, count);
    if (emails.length === 0) {
      return { success: true, message: `No emails found matching "${query}".` };
    }

    const maxBodyPerEmail = 1500;
    const summaries = emails.map((e, i) => {
      const body = e.body.length > maxBodyPerEmail
        ? e.body.slice(0, maxBodyPerEmail) + `\n[... truncated — ${e.body.length} chars total]`
        : e.body;
      return `--- Email ${i + 1} of ${emails.length} ---\nFrom: ${e.from}\nTo: ${e.to}\nSubject: ${e.subject}\nDate: ${e.date}\nID: ${e.id}\n\n${body}`;
    });

    return {
      success: true,
      message: `Found ${emails.length} email(s) matching "${query}":\n\n${summaries.join("\n\n")}`,
      data: { count: emails.length, query },
    };
  } catch (err) {
    return { success: false, message: `Failed to search emails: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---------------------------------------------------------------------------
// QBO (QuickBooks Online) Actions
// ---------------------------------------------------------------------------

/** QBO Account ID mapping — matches Puzzle GL categories */
export const QBO_CATEGORIZATION_RULES: Array<{ pattern: string; accountId: number; accountName: string }> = [
  // Software & SaaS
  { pattern: "ANTHROPIC", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "APOLLO", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "CLAUDE", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "CLOUDFLARE", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "INVIDEO", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "METRICOOL", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "MIDJOURNEY", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "NOTION LABS", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "OPENAI", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "N8N", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "SPARK", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "SLACK", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "X CORP", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "VERCEL", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "SUPABASE", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "UPSTASH", accountId: 165, accountName: "Software - Operating Expense" },
  { pattern: "PADDLE.NET", accountId: 165, accountName: "Software - Operating Expense" },
  // Advertising
  { pattern: "FACEBK", accountId: 16, accountName: "Advertising & marketing" },
  { pattern: "FACEBOOK", accountId: 16, accountName: "Advertising & marketing" },
  { pattern: "META ADS", accountId: 16, accountName: "Advertising & marketing" },
  { pattern: "GOOGLE ADS", accountId: 16, accountName: "Advertising & marketing" },
  { pattern: "TIKTOK", accountId: 16, accountName: "Advertising & marketing" },
  { pattern: "CRAIGSLIST", accountId: 16, accountName: "Advertising & marketing" },
  { pattern: "AMAZON ADS", accountId: 16, accountName: "Advertising & marketing" },
  // Shipping
  { pattern: "PIRATE SHIP", accountId: 159, accountName: "Shipping & Delivery" },
  { pattern: "USPS", accountId: 159, accountName: "Shipping & Delivery" },
  { pattern: "FEDEX", accountId: 159, accountName: "Shipping & Delivery" },
  // Insurance
  { pattern: "GEICO", accountId: 42, accountName: "Insurance" },
  // Utilities
  { pattern: "T-MOBILE", accountId: 91, accountName: "Utilities" },
  { pattern: "TMOBILE", accountId: 91, accountName: "Utilities" },
  // Ground Transport
  { pattern: "EXXON", accountId: 162, accountName: "Ground Transportation" },
  { pattern: "SHELL OIL", accountId: 162, accountName: "Ground Transportation" },
  { pattern: "MAVERIK", accountId: 162, accountName: "Ground Transportation" },
  { pattern: "UBER", accountId: 162, accountName: "Ground Transportation" },
  { pattern: "LYFT", accountId: 162, accountName: "Ground Transportation" },
  // Tax & Accounting
  { pattern: "PILOT", accountId: 158, accountName: "Tax and Accounting" },
  // Hosting / COGS
  { pattern: "SHOPIFY", accountId: 166, accountName: "Hosting Fees" },
  // Bank Fees
  { pattern: "WIRE TRANSFER FEE", accountId: 160, accountName: "Bank Fees" },
  { pattern: "PAST DUE FEE", accountId: 160, accountName: "Bank Fees" },
  { pattern: "MONTHLY FEE", accountId: 160, accountName: "Bank Fees" },
  { pattern: "SERVICE CHARGE", accountId: 160, accountName: "Bank Fees" },
  // Interest
  { pattern: "INTEREST CHARGE", accountId: 163, accountName: "Interest Expense" },
  // Payment Processing (transfers, not expenses)
  { pattern: "STRIPE", accountId: 168, accountName: "Transfers in Transit" },
  // Credit Card Payments (internal transfers)
  { pattern: "CAPITAL ONE DES:MOBILE PMT", accountId: 169, accountName: "Credit Card Payments" },
  { pattern: "CAPITAL ONE MOBILE PYMT", accountId: 169, accountName: "Credit Card Payments" },
  // Hardware
  { pattern: "APPLE.COM", accountId: 156, accountName: "Computers & Hardware" },
  { pattern: "APPLE STORE", accountId: 156, accountName: "Computers & Hardware" },
  // Contractors
  { pattern: "UPWORK", accountId: 157, accountName: "Independent Contractors" },
  // Entertainment
  { pattern: "RANCH WORLD", accountId: 37, accountName: "Entertainment" },
  // Supplies
  { pattern: "VISTAPRINT", accountId: 83, accountName: "Supplies" },
  // Lodging
  { pattern: "HAMPTON", accountId: 161, accountName: "Lodging" },
  // *** CRITICAL: Rene investor money = LIABILITY, NEVER income ***
  { pattern: "RENE G. GONZALEZ", accountId: 167, accountName: "Investor Loan - Rene" },
  { pattern: "GONZALEZ, RENE", accountId: 167, accountName: "Investor Loan - Rene" },
  { pattern: "RENE G GONZALEZ", accountId: 167, accountName: "Investor Loan - Rene" },
];

export function qboCategorize(description: string): { accountId: number; accountName: string } | null {
  const upper = description.toUpperCase();
  for (const rule of QBO_CATEGORIZATION_RULES) {
    if (upper.includes(rule.pattern.toUpperCase())) {
      return { accountId: rule.accountId, accountName: rule.accountName };
    }
  }
  return null;
}

export function isReneInvestorTransfer(description: string): boolean {
  const upper = description.toUpperCase();
  return upper.includes("RENE G. GONZALEZ") ||
    upper.includes("GONZALEZ, RENE") ||
    upper.includes("RENE G GONZALEZ");
}

/**
 * query_qbo — Read-only queries against QuickBooks Online.
 * Supports: accounts, pnl, balance_sheet, pending_transactions
 */
async function handleQueryQBO(params: Record<string, unknown>): Promise<ActionResult> {
  const queryType = String(params.query_type || "accounts");
  const baseUrl = getInternalOpsBaseUrl();
  const QBO_TIMEOUT_MS = 15_000; // 15s timeout for QBO API calls

  try {
    switch (queryType) {
      case "accounts": {
        const res = await fetch(`${baseUrl}/api/ops/qbo/accounts`, { signal: AbortSignal.timeout(QBO_TIMEOUT_MS) });
        if (!res.ok) return { success: false, message: `QBO accounts query failed: ${res.status}` };
        const data = await res.json();
        const accounts = (data.accounts || [])
          .filter((a: Record<string, unknown>) => a.CurrentBalance !== 0)
          .map((a: Record<string, unknown>) => `${a.Name}: $${Number(a.CurrentBalance || 0).toFixed(2)} (${a.AccountType})`)
          .join("\n");
        return {
          success: true,
          message: `QBO has ${data.count} accounts. Non-zero balances:\n${accounts || "(none)"}`,
          data,
        };
      }
      case "categorization_rules": {
        const rules = QBO_CATEGORIZATION_RULES.map(r => `${r.pattern} -> ${r.accountName} (ID ${r.accountId})`).join("\n");
        return {
          success: true,
          message: `QBO categorization rules (${QBO_CATEGORIZATION_RULES.length}):\n${rules}`,
          data: { rules: QBO_CATEGORIZATION_RULES },
        };
      }
      case "categorize": {
        const description = String(params.description || "");
        if (!description) return { success: false, message: "No description provided" };
        const cat = qboCategorize(description);
        const isRene = isReneInvestorTransfer(description);
        if (isRene) {
          return {
            success: true,
            message: `INVESTOR LOAN: "${description}" -> Investor Loan - Rene (ID 167). This is liability, NOT income.`,
            data: { accountId: 167, accountName: "Investor Loan - Rene", isInvestorLoan: true },
          };
        }
        if (cat) {
          return {
            success: true,
            message: `Categorized: "${description}" -> ${cat.accountName} (ID ${cat.accountId})`,
            data: cat,
          };
        }
        return {
          success: true,
          message: `No auto-category found for "${description}". Needs manual review or new rule.`,
          data: { accountId: null, suggestion: "Review manually or ask Ben" },
        };
      }
      case "vendors": {
        const res = await fetch(`${baseUrl}/api/ops/qbo/query?type=vendors`, { signal: AbortSignal.timeout(QBO_TIMEOUT_MS) });
        if (!res.ok) return { success: false, message: `QBO vendor query failed: ${res.status}` };
        const data = (await res.json()) as { count: number; vendors: Array<{ Name: string; Balance: number; Active: boolean; Email: string | null; Phone: string | null }> };
        if (data.count === 0) {
          return { success: true, message: "No vendors found in QBO. Vendor records may not have been set up yet. Ask Ben to add vendors in QuickBooks, or I can note what needs to be configured." };
        }
        const active = data.vendors.filter(v => v.Active);
        const lines = active.map(v => {
          const contact = [v.Email, v.Phone].filter(Boolean).join(", ");
          return `• ${v.Name}${v.Balance ? ` (balance: $${v.Balance.toFixed(2)})` : ""}${contact ? ` — ${contact}` : ""}`;
        });
        return {
          success: true,
          message: `QBO Vendors (${active.length} active):\n${lines.join("\n")}`,
          data,
        };
      }
      case "pnl": {
        const start = typeof params.start === "string" ? params.start : undefined;
        const end = typeof params.end === "string" ? params.end : undefined;
        const qs = [start ? `start=${start}` : "", end ? `end=${end}` : ""].filter(Boolean).join("&");
        const res = await fetch(`${baseUrl}/api/ops/qbo/query?type=pnl${qs ? `&${qs}` : ""}`, { signal: AbortSignal.timeout(QBO_TIMEOUT_MS) });
        if (!res.ok) return { success: false, message: `QBO P&L report failed: ${res.status}` };
        const data = (await res.json()) as { period: { start: string; end: string }; summary: Record<string, string | number> };
        const entries = Object.entries(data.summary);
        if (entries.length === 0) {
          return { success: true, message: `P&L report (${data.period.start} to ${data.period.end}): No data found. QBO transactions may not be categorized yet. The book balances need reconciliation before P&L data will be meaningful.` };
        }
        const lines = entries.map(([k, v]) => `• ${k}: ${typeof v === "number" ? `$${v.toFixed(2)}` : v}`);
        return {
          success: true,
          message: `P&L Report (${data.period.start} to ${data.period.end}):\n${lines.join("\n")}\n\nNote: These figures reflect only what's been categorized in QBO. If bank feeds are behind, this may be incomplete.`,
          data,
        };
      }
      case "balance_sheet": {
        const res = await fetch(`${baseUrl}/api/ops/qbo/query?type=balance_sheet`, { signal: AbortSignal.timeout(QBO_TIMEOUT_MS) });
        if (!res.ok) return { success: false, message: `QBO balance sheet failed: ${res.status}` };
        const data = (await res.json()) as { asOf: string; summary: Record<string, string | number> };
        const entries = Object.entries(data.summary);
        if (entries.length === 0) {
          return { success: true, message: `Balance sheet as of ${data.asOf}: No data found. QBO may need reconciliation.` };
        }
        const lines = entries.map(([k, v]) => `• ${k}: ${typeof v === "number" ? `$${v.toFixed(2)}` : v}`);
        return {
          success: true,
          message: `Balance Sheet (as of ${data.asOf}):\n${lines.join("\n")}\n\nNote: These are QBO book values. Bank account balances may differ from actual bank balances if feeds are behind.`,
          data,
        };
      }
      case "purchases": {
        const limit = typeof params.limit === "number" ? params.limit : 20;
        const res = await fetch(`${baseUrl}/api/ops/qbo/query?type=purchases&limit=${limit}`, { signal: AbortSignal.timeout(QBO_TIMEOUT_MS) });
        if (!res.ok) return { success: false, message: `QBO purchases query failed: ${res.status}` };
        const data = (await res.json()) as { count: number; purchases: Array<{ Date: string; Amount: number; Vendor: string | null; Note: string | null; Lines: Array<{ Description: string; Amount: number; Account: string }> }> };
        if (data.count === 0) {
          return { success: true, message: "No purchases found in QBO." };
        }
        const lines = data.purchases.slice(0, 25).map(p => {
          const vendor = p.Vendor || "Unknown vendor";
          const desc = p.Lines?.[0]?.Description || p.Note || "";
          return `• ${p.Date}: $${p.Amount.toFixed(2)} — ${vendor}${desc ? ` (${desc.slice(0, 60)})` : ""}`;
        });
        return {
          success: true,
          message: `Recent QBO Purchases (${data.count}):\n${lines.join("\n")}`,
          data,
        };
      }
      case "cash_flow": {
        const start = typeof params.start === "string" ? params.start : undefined;
        const end = typeof params.end === "string" ? params.end : undefined;
        const qs = [start ? `start=${start}` : "", end ? `end=${end}` : ""].filter(Boolean).join("&");
        const res = await fetch(`${baseUrl}/api/ops/qbo/query?type=cash_flow${qs ? `&${qs}` : ""}`, { signal: AbortSignal.timeout(QBO_TIMEOUT_MS) });
        if (!res.ok) return { success: false, message: `QBO cash flow report failed: ${res.status}` };
        const data = (await res.json()) as { period: { start: string; end: string }; summary: Record<string, string | number> };
        const entries = Object.entries(data.summary);
        if (entries.length === 0) {
          return { success: true, message: `Cash flow report (${data.period.start} to ${data.period.end}): No data found. QBO transactions may not be categorized yet.` };
        }
        const lines = entries.map(([k, v]) => `• ${k}: ${typeof v === "number" ? `$${v.toFixed(2)}` : v}`);
        return {
          success: true,
          message: `Cash Flow Statement (${data.period.start} to ${data.period.end}):\n${lines.join("\n")}`,
          data,
        };
      }
      case "bills": {
        const start = typeof params.start === "string" ? params.start : undefined;
        const end = typeof params.end === "string" ? params.end : undefined;
        const qs = [start ? `start=${start}` : "", end ? `end=${end}` : ""].filter(Boolean).join("&");
        const res = await fetch(`${baseUrl}/api/ops/qbo/query?type=bills${qs ? `&${qs}` : ""}`, { signal: AbortSignal.timeout(QBO_TIMEOUT_MS) });
        if (!res.ok) return { success: false, message: `QBO bills query failed: ${res.status}` };
        const data = (await res.json()) as { count: number; bills: Array<{ Date: string; Amount: number; Balance: number; Vendor: string | null; DueDate: string | null; Status: string }> };
        if (data.count === 0) return { success: true, message: "No bills found in QBO." };
        const unpaid = data.bills.filter(b => b.Status === "unpaid");
        const lines = data.bills.slice(0, 20).map(b => {
          const vendor = b.Vendor || "Unknown vendor";
          const due = b.DueDate ? ` (due ${b.DueDate})` : "";
          const balance = b.Balance > 0 ? ` — $${b.Balance.toFixed(2)} outstanding` : " — paid";
          return `• ${b.Date}: $${b.Amount.toFixed(2)} — ${vendor}${due}${balance}`;
        });
        return {
          success: true,
          message: `QBO Bills (${data.count} total, ${unpaid.length} unpaid):\n${lines.join("\n")}`,
          data,
        };
      }
      case "invoices": {
        const start = typeof params.start === "string" ? params.start : undefined;
        const end = typeof params.end === "string" ? params.end : undefined;
        const qs = [start ? `start=${start}` : "", end ? `end=${end}` : ""].filter(Boolean).join("&");
        const res = await fetch(`${baseUrl}/api/ops/qbo/query?type=invoices${qs ? `&${qs}` : ""}`, { signal: AbortSignal.timeout(QBO_TIMEOUT_MS) });
        if (!res.ok) return { success: false, message: `QBO invoices query failed: ${res.status}` };
        const data = (await res.json()) as { count: number; invoices: Array<{ Date: string; Amount: number; Balance: number; Customer: string | null; DocNumber: string | null; Status: string }> };
        if (data.count === 0) return { success: true, message: "No invoices found in QBO." };
        const outstanding = data.invoices.filter(i => i.Status === "outstanding");
        const lines = data.invoices.slice(0, 20).map(inv => {
          const customer = inv.Customer || "Unknown customer";
          const doc = inv.DocNumber ? ` (#${inv.DocNumber})` : "";
          const balance = inv.Balance > 0 ? ` — $${inv.Balance.toFixed(2)} outstanding` : " — paid";
          return `• ${inv.Date}: $${inv.Amount.toFixed(2)} — ${customer}${doc}${balance}`;
        });
        return {
          success: true,
          message: `QBO Invoices (${data.count} total, ${outstanding.length} outstanding):\n${lines.join("\n")}`,
          data,
        };
      }
      case "customers": {
        const res = await fetch(`${baseUrl}/api/ops/qbo/query?type=customers`, { signal: AbortSignal.timeout(QBO_TIMEOUT_MS) });
        if (!res.ok) return { success: false, message: `QBO customers query failed: ${res.status}` };
        const data = (await res.json()) as { count: number; customers: Array<{ Name: string; Balance: number; Active: boolean; Email: string | null; Phone: string | null }> };
        if (data.count === 0) return { success: true, message: "No customers found in QBO." };
        const active = data.customers.filter(c => c.Active);
        const withBalance = active.filter(c => c.Balance > 0);
        const lines = withBalance.slice(0, 20).map(c => {
          const contact = [c.Email, c.Phone].filter(Boolean).join(", ");
          return `• ${c.Name}: $${c.Balance.toFixed(2)} balance${contact ? ` — ${contact}` : ""}`;
        });
        const noBalance = active.filter(c => c.Balance === 0);
        return {
          success: true,
          message: `QBO Customers (${active.length} active):\n${lines.join("\n") || "(none with outstanding balance)"}${noBalance.length ? `\n\n${noBalance.length} additional customers with $0 balance.` : ""}`,
          data,
        };
      }
      case "metrics": {
        const res = await fetch(`${baseUrl}/api/ops/qbo/query?type=metrics`, { signal: AbortSignal.timeout(QBO_TIMEOUT_MS) });
        if (!res.ok) return { success: false, message: `QBO metrics query failed: ${res.status}` };
        const data = (await res.json()) as {
          cashPosition: number; burnRate: number; runway: number | null;
          accountsReceivable: number; accountsPayable: number;
          netIncome: number; totalRevenue: number; totalExpenses: number;
          asOfDate: string; period: { start: string; end: string };
        };
        const runwayStr = data.runway != null ? `${data.runway} months` : "N/A (no expenses recorded)";
        return {
          success: true,
          message: [
            `QBO Financial Metrics (as of ${data.asOfDate}):`,
            `• Cash position: $${data.cashPosition.toFixed(2)}`,
            `• 30-day revenue: $${data.totalRevenue.toFixed(2)}`,
            `• 30-day expenses: $${data.totalExpenses.toFixed(2)}`,
            `• Net income (30d): $${data.netIncome.toFixed(2)}`,
            `• Accounts receivable: $${data.accountsReceivable.toFixed(2)}`,
            `• Accounts payable: $${data.accountsPayable.toFixed(2)}`,
            `• Monthly burn rate: $${data.burnRate.toFixed(2)}`,
            `• Runway: ${runwayStr}`,
          ].join("\n"),
          data,
        };
      }
      default:
        return { success: false, message: `Unknown query_type: ${queryType}. Use: accounts, categorization_rules, categorize, vendors, pnl, balance_sheet, purchases, cash_flow, bills, invoices, customers, metrics` };
    }
  } catch (err) {
    void capMarkFailure("qbo", err instanceof Error ? err.message : "query failed").catch(() => {});
    return { success: false, message: `QBO query error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// Known USA Gummies supply chain vendors and sales channels for setup assessment
const USA_GUMMIES_KNOWN_VENDORS = [
  { name: "Albanese", aliases: ["albanese confectionery", "albanese candy"], category: "Candy Supplier" },
  { name: "Belmark", aliases: ["belmark", "ninjaprinthouse", "ninja print house"], category: "Packaging" },
  { name: "Powers Confections", aliases: ["powers confections", "powers"], category: "Co-Packer" },
  { name: "PirateShip", aliases: ["pirateship", "pirate ship"], category: "Shipping" },
  { name: "Shopify", aliases: ["shopify"], category: "Sales Channel" },
  { name: "Amazon", aliases: ["amazon.com", "amazon seller", "amazon services"], category: "Sales Channel" },
  { name: "Faire", aliases: ["faire", "faire wholesale"], category: "Sales Channel" },
];

// Chart of accounts keywords required for C-Corp Form 1120 filing
const REQUIRED_1120_ACCOUNT_KEYWORDS: Record<string, string[]> = {
  "Sales - Shopify (DTC revenue)": ["shopify", "dtc"],
  "Sales - Amazon (marketplace)": ["amazon"],
  "Sales - Wholesale / Faire": ["wholesale", "faire", "distributor"],
  "COGS - Raw Materials (candy)": ["raw material", "candy", "albanese"],
  "COGS - Packaging": ["packaging", "belmark", "label"],
  "COGS - Co-Packing": ["co-pack", "copacking", "powers"],
  "COGS - Fulfillment / Shipping": ["fulfillment", "shipping", "pirate"],
  "Advertising & Marketing": ["advertising", "marketing", "ads"],
  "Platform Fees": ["platform fee", "marketplace fee", "selling fee"],
  "Owner Compensation": ["compensation", "salary", "wages", "payroll", "owner draw"],
};

/**
 * qbo_setup_assessment — Pull chart of accounts, vendors, and uncategorized transactions.
 * Compare against USA Gummies supply chain and identify gaps for C-Corp Form 1120 filing.
 */
async function handleQBOSetupAssessment(_params: Record<string, unknown>): Promise<ActionResult> {
  const baseUrl = getInternalOpsBaseUrl();
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  const QBO_TIMEOUT_MS = 20_000;

  try {
    // Fetch accounts, vendors, and uncategorized transaction preview in parallel
    const [accountsRes, vendorsRes, uncatRes] = await Promise.allSettled([
      fetch(`${baseUrl}/api/ops/qbo/accounts`, { signal: AbortSignal.timeout(QBO_TIMEOUT_MS) }),
      fetch(`${baseUrl}/api/ops/qbo/query?type=vendors`, { signal: AbortSignal.timeout(QBO_TIMEOUT_MS) }),
      fetch(`${baseUrl}/api/ops/qbo/categorize-batch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cronSecret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "preview" }),
        signal: AbortSignal.timeout(QBO_TIMEOUT_MS),
      }),
    ]);

    let accounts: Array<{ Name: string; AccountType: string }> = [];
    if (accountsRes.status === "fulfilled" && accountsRes.value.ok) {
      const d = (await accountsRes.value.json()) as { accounts: typeof accounts };
      accounts = d.accounts || [];
    }

    let qboVendors: Array<{ Name: string; Active: boolean }> = [];
    if (vendorsRes.status === "fulfilled" && vendorsRes.value.ok) {
      const d = (await vendorsRes.value.json()) as { vendors: typeof qboVendors };
      qboVendors = (d.vendors || []).filter(v => v.Active);
    }

    let uncategorized = 0, needsReview = 0;
    if (uncatRes.status === "fulfilled" && uncatRes.value.ok) {
      const d = (await uncatRes.value.json()) as { total: number; needsReview: number };
      uncategorized = d.total || 0;
      needsReview = d.needsReview || 0;
    }

    // --- Check 1: Missing vendors ---
    const vendorNamesLower = qboVendors.map(v => v.Name.toLowerCase());
    const missingVendors: string[] = [];
    for (const kv of USA_GUMMIES_KNOWN_VENDORS) {
      const found = vendorNamesLower.some(qn => kv.aliases.some(alias => qn.includes(alias)));
      if (!found) missingVendors.push(`${kv.name} (${kv.category})`);
    }

    // --- Check 2: Missing Form 1120 accounts ---
    const accountNamesLower = accounts.map(a => a.Name.toLowerCase());
    const missingAccounts: string[] = [];
    for (const [reqName, keywords] of Object.entries(REQUIRED_1120_ACCOUNT_KEYWORDS)) {
      const found = accountNamesLower.some(n => keywords.some(kw => n.includes(kw)));
      if (!found) missingAccounts.push(reqName);
    }

    // --- Health score ---
    const vendorScore = Math.round(
      ((USA_GUMMIES_KNOWN_VENDORS.length - missingVendors.length) / USA_GUMMIES_KNOWN_VENDORS.length) * 100,
    );
    const accountScore = Math.round(
      ((Object.keys(REQUIRED_1120_ACCOUNT_KEYWORDS).length - missingAccounts.length) / Object.keys(REQUIRED_1120_ACCOUNT_KEYWORDS).length) * 100,
    );

    // --- Build priorities ---
    const priorities: string[] = [];
    if (missingVendors.length > 0) {
      priorities.push(`Add ${missingVendors.length} missing vendor(s) in QBO: ${missingVendors.join(", ")}`);
    }
    if (missingAccounts.length > 0) {
      const preview = missingAccounts.slice(0, 3).join(", ");
      priorities.push(`Create ${missingAccounts.length} missing account(s) for Form 1120: ${preview}${missingAccounts.length > 3 ? ", ..." : ""}`);
    }
    if (needsReview > 0) {
      priorities.push(`Manually review ${needsReview} uncategorized transaction(s) that didn't match any rule`);
    }

    const vendorLine = missingVendors.length === 0
      ? `✓ All ${USA_GUMMIES_KNOWN_VENDORS.length} key vendors present`
      : `Missing: ${missingVendors.join(", ")}`;
    const accountLine = missingAccounts.length === 0
      ? `✓ All ${Object.keys(REQUIRED_1120_ACCOUNT_KEYWORDS).length} required accounts found`
      : `Missing: ${missingAccounts.join("; ")}`;

    const message = [
      `QBO Setup Assessment`,
      ``,
      `Vendor coverage: ${USA_GUMMIES_KNOWN_VENDORS.length - missingVendors.length}/${USA_GUMMIES_KNOWN_VENDORS.length} known vendors in QBO (${vendorScore}%)`,
      vendorLine,
      ``,
      `Form 1120 accounts: ${Object.keys(REQUIRED_1120_ACCOUNT_KEYWORDS).length - missingAccounts.length}/${Object.keys(REQUIRED_1120_ACCOUNT_KEYWORDS).length} required accounts found (${accountScore}%)`,
      accountLine,
      ``,
      `Uncategorized transactions: ${uncategorized} total (${needsReview} need manual review)`,
      ``,
      priorities.length > 0
        ? `Priorities:\n${priorities.map((p, i) => `${i + 1}. ${p}`).join("\n")}`
        : `No critical gaps found. QBO is well-configured for C-Corp filing.`,
    ].join("\n");

    return {
      success: true,
      message,
      data: {
        vendorScore,
        accountScore,
        missingVendors,
        missingAccounts,
        uncategorizedTransactions: uncategorized,
        needsManualReview: needsReview,
        qboVendorCount: qboVendors.length,
        qboAccountCount: accounts.length,
        priorities,
      },
    };
  } catch (err) {
    void capMarkFailure("qbo", err instanceof Error ? err.message : "setup assessment failed").catch(() => {});
    return { success: false, message: `QBO setup assessment error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * categorize_qbo_transaction — Categorize a bank feed transaction in QBO.
 * Auto-detects Rene investor transfers and flags them via Slack.
 */
async function handleCategorizeQBOTransaction(params: Record<string, unknown>): Promise<ActionResult> {
  const description = String(params.description || "");
  const amount = Number(params.amount || 0);
  const date = String(params.date || new Date().toISOString().split("T")[0]);
  const bankAccountId = Number(params.bank_account_id || 153); // Default: BofA checking

  if (!description) {
    return { success: false, message: "Transaction description is required" };
  }

  const cat = qboCategorize(description);
  const isRene = isReneInvestorTransfer(description);

  // CRITICAL: Rene transfers always get flagged via Slack
  if (isRene) {
    const accountId = 167; // Investor Loan - Rene
    try {
      await notify({
        channel: "alerts",
        text: [
          `:money_with_wings: *Investor Loan Detected*`,
          `> *From:* Rene G. Gonzalez Trust`,
          `> *Amount:* $${Math.abs(amount).toLocaleString()}`,
          `> *Date:* ${date}`,
          `> *Description:* ${description}`,
          ``,
          `Categorized as *Investor Loan - Rene* (liability, NOT income).`,
          `QBO Account ID: 167`,
        ].join("\n"),
      });
    } catch {
      // Best-effort Slack notification
    }

    // Create the deposit in QBO via import-batch
    try {
      const res = await fetch("https://www.usagummies.com/api/ops/qbo/import-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactions: [{
            date,
            description,
            amount: Math.abs(amount),
            accountId,
            isIncome: true, // Deposits into checking
            bankAccountId,
          }],
        }),
      });
      const result = await res.json();
      if (result.created > 0) {
        return {
          success: true,
          message: `Investor Loan from Rene: $${Math.abs(amount).toLocaleString()} on ${date} -> Investor Loan - Rene (liability). Posted to QBO. Slack alerted.`,
          data: { accountId, accountName: "Investor Loan - Rene", isInvestorLoan: true, qboResult: result },
        };
      }
      return { success: false, message: `QBO posting failed: ${JSON.stringify(result)}` };
    } catch (err) {
      return { success: false, message: `QBO posting error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // Normal categorization
  if (!cat) {
    return {
      success: true,
      message: `No auto-category for "${description}" ($${Math.abs(amount)}). Ask Ben how to categorize this.`,
      data: { needsManualReview: true },
    };
  }

  // Post to QBO
  try {
    const isIncome = amount > 0;
    const res = await fetch("https://www.usagummies.com/api/ops/qbo/import-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactions: [{
          date,
          description,
          amount: Math.abs(amount),
          accountId: cat.accountId,
          isIncome,
          bankAccountId,
        }],
      }),
    });
    const result = await res.json();
    if (result.created > 0) {
      return {
        success: true,
        message: `QBO: "${description}" ($${Math.abs(amount)}) -> ${cat.accountName}. Posted.`,
        data: { ...cat, qboResult: result },
      };
    }
    return { success: false, message: `QBO posting failed: ${JSON.stringify(result)}` };
  } catch (err) {
    return { success: false, message: `QBO posting error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function handleBatchCategorizeQBO(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const mode = String(params.mode || "preview").toLowerCase();
  const requestMode = mode === "auto" || mode === "execute" ? "execute" : "preview";
  const transactionIds = Array.isArray(params.transactionIds)
    ? params.transactionIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : undefined;

  try {
    const res = await fetch(`${getInternalOpsBaseUrl()}/api/ops/qbo/categorize-batch`, {
      method: "POST",
      headers: getInternalOpsHeaders(),
      body: JSON.stringify({
        mode: requestMode,
        ...(transactionIds && transactionIds.length > 0 ? { transactionIds } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(45000),
    });

    const text = await res.text();
    const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      return {
        success: false,
        message: `Batch categorization failed (${res.status}): ${String(data.error || text || "unknown error").slice(0, 300)}`,
      };
    }

    if (requestMode === "preview") {
      const total = Number(data.total || 0);
      const autoCategorizeable = Number(data.autoCategorizeable || 0);
      const needsReview = Number(data.needsReview || 0);
      const reneTransfers = Number(data.reneTransfers || 0);
      return {
        success: true,
        message:
          `QBO categorization preview: ${total} transaction(s) scanned; ` +
          `${autoCategorizeable} auto-categorizable, ${needsReview} need review` +
          `${reneTransfers > 0 ? `, ${reneTransfers} Rene investor transfer(s)` : ""}.`,
        data,
      };
    }

    return {
      success: true,
      message:
        `QBO batch categorization complete: ${Number(data.categorized || 0)} categorized, ` +
        `${Number(data.errors || 0)} errors` +
        `${Number(data.reneAlerts || 0) > 0 ? `, ${Number(data.reneAlerts || 0)} Rene alert(s)` : ""}.`,
      data,
    };
  } catch (err) {
    return {
      success: false,
      message: `Batch categorization error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function handleCreateQBOInvoice(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const customerName = sanitizeTitle(String(params.customerName || params.customer_name || ""));
  const customerEmail = String(params.customerEmail || params.customer_email || "").trim().toLowerCase();
  const memo = sanitizeText(String(params.memo || ""), 1000) || undefined;
  const dueDateRaw = String(params.dueDate || params.due_date || "").trim();
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDateRaw) ? dueDateRaw : undefined;
  const rawLineItems = Array.isArray(params.lineItems)
    ? params.lineItems
    : Array.isArray(params.line_items)
      ? params.line_items
      : [];

  const lineItems = rawLineItems
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const description = sanitizeTitle(String(row.description || ""));
      const quantity = Number(row.quantity || 0);
      const unitPrice = Number(row.unitPrice || row.unit_price || 0);
      if (!description || quantity <= 0 || unitPrice < 0) return null;
      return { description, quantity, unitPrice };
    })
    .filter((item): item is { description: string; quantity: number; unitPrice: number } => !!item);

  if (!customerName || lineItems.length === 0) {
    return { success: false, message: "customerName and at least one valid line item are required" };
  }

  try {
    const res = await fetch(`${getInternalOpsBaseUrl()}/api/ops/qbo/invoice`, {
      method: "POST",
      headers: getInternalOpsHeaders(),
      body: JSON.stringify({
        customerName,
        customerEmail: customerEmail || undefined,
        lineItems,
        dueDate,
        memo,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(45000),
    });

    const text = await res.text();
    const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      return {
        success: false,
        message: `QBO invoice failed (${res.status}): ${String(data.error || text || "unknown error").slice(0, 300)}`,
      };
    }

    return {
      success: true,
      message:
        `Created QBO invoice ${String(data.docNumber || data.invoiceId || "").trim() || "(draft)"} ` +
        `for ${customerName} totaling $${Number(data.total || 0).toFixed(2)}.`,
      data,
    };
  } catch (err) {
    return {
      success: false,
      message: `QBO invoice error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function handleUpdateShopifyInventory(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const variantId = String(params.variantId || params.variant_id || "").trim();
  const adjustment = Number(params.adjustment || 0);
  const reason = sanitizeTitle(String(params.reason || "correction")) || "correction";

  if (!variantId || !Number.isFinite(adjustment) || adjustment === 0) {
    return { success: false, message: "variantId and non-zero adjustment are required" };
  }

  try {
    const result = await adjustInventory(variantId, adjustment, reason);
    if (!result.success) {
      return { success: false, message: result.error || "Inventory adjustment failed" };
    }
    return {
      success: true,
      message:
        `Adjusted Shopify inventory by ${adjustment > 0 ? "+" : ""}${adjustment}` +
        `${typeof result.newQuantity === "number" ? `; new quantity ${result.newQuantity}` : ""}.`,
      data: result,
    };
  } catch (err) {
    return {
      success: false,
      message: `Shopify inventory error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function handleCreateShopifyDiscount(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const code = sanitizeTitle(String(params.code || ""));
  const type = String(params.type || "percentage").toLowerCase();
  const value = Number(params.value || 0);
  const startsAt = String(params.startsAt || params.starts_at || "").trim() || undefined;
  const endsAt = String(params.endsAt || params.ends_at || "").trim() || undefined;
  const appliesTo = params.appliesTo === "all" || !params.appliesTo
    ? "all"
    : Array.isArray(params.appliesTo)
      ? params.appliesTo.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : "all";

  if (!code || !Number.isFinite(value) || value <= 0) {
    return { success: false, message: "code and positive value are required" };
  }

  try {
    const result = await createShopifyDiscountCode({
      code,
      type: type === "fixed" ? "fixed" : "percentage",
      value,
      appliesTo,
      startsAt,
      endsAt,
    });
    if (!result.ok) {
      return { success: false, message: result.error || "Discount creation failed" };
    }
    return {
      success: true,
      message: `Created Shopify discount code ${result.code || code}.`,
      data: result,
    };
  } catch (err) {
    return {
      success: false,
      message: `Shopify discount error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function handleQueryShopifyOrders(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const statusRaw = String(params.status || "open").toLowerCase();
  const status = statusRaw === "closed" || statusRaw === "cancelled" ? statusRaw : "open";
  const days = Math.max(1, Math.min(90, Number(params.days || 7) || 7));
  const limit = Math.max(1, Math.min(100, Number(params.limit || 25) || 25));

  try {
    const orders = await queryRecentOrders({ status, days, limit });
    const revenue = orders.reduce((sum, order) => sum + order.totalAmount, 0);
    return {
      success: true,
      message:
        `Shopify ${status} orders over the last ${days} day(s): ${orders.length} order(s), ` +
        `$${revenue.toFixed(2)} total revenue.`,
      data: {
        status,
        days,
        count: orders.length,
        revenue,
        orders,
      },
    };
  } catch (err) {
    return {
      success: false,
      message: `Shopify order query error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function buildCustomReconciliationPeriod(period: "day" | "week" | "month"): ReconciliationPeriod {
  if (period === "month") {
    return buildReconciliationPeriod();
  }
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - (period === "week" ? 6 : 0));
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  return {
    startDate,
    endDate,
    label: period === "week" ? "Last 7 days" : "Today",
  };
}

async function handleReconcileTransactions(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const periodRaw = String(params.period || "month").toLowerCase();
  const period = periodRaw === "day" || periodRaw === "week" ? periodRaw : "month";

  try {
    const report = await generateReconciliationReport(buildCustomReconciliationPeriod(period));
    const issues = report.channels.filter((channel) => channel.status !== "matched").length;
    return {
      success: true,
      message:
        `Reconciliation for ${report.period.label}: ${report.channels.length} channel(s), ` +
        `${issues} with discrepancies, total variance $${report.totalVariance.toFixed(2)}.`,
      data: report,
    };
  } catch (err) {
    return {
      success: false,
      message: `Reconciliation error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// File Generation — Generate and upload spreadsheet/CSV files to Slack
// ---------------------------------------------------------------------------

/** Fetch data from a known source for file generation (avoids Claude output limits) */
async function fetchDataForFileGeneration(
  source: string,
  params: Record<string, unknown>,
): Promise<SpreadsheetData[]> {
  const baseUrl = getInternalOpsBaseUrl();
  const TIMEOUT = 15_000;

  // Call QBO API directly instead of going through internal HTTP routes
  // (Vercel serverless functions can't reliably self-reference due to concurrency limits)
  const { getValidAccessToken, getRealmId, forceRefreshTokens } = await import("@/lib/ops/qbo-auth");
  let accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("QBO not connected — no valid access token");
  const realmId = await getRealmId();
  if (!realmId) throw new Error("QBO not connected — no realm ID");
  const qboBase = process.env.QBO_SANDBOX === "true"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";

  async function qboQuery(query: string) {
    const url = `${qboBase}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=73`;
    let res = await fetch(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    // Retry once on 401 — Intuit may have invalidated the token early
    if (res.status === 401) {
      console.log("[abra-actions] QBO 401 in file generation — force-refreshing token...");
      const newToken = await forceRefreshTokens();
      if (newToken) {
        accessToken = newToken;
        res = await fetch(url, {
          headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(TIMEOUT),
        });
      }
    }
    if (!res.ok) throw new Error(`QBO API returned ${res.status}`);
    return res.json();
  }

  switch (source) {
    case "qbo_accounts":
    case "qbo_chart_of_accounts": {
      const data = (await qboQuery("SELECT * FROM Account MAXRESULTS 1000")) as {
        QueryResponse?: { Account?: Array<Record<string, unknown>> };
      };
      const accounts = data.QueryResponse?.Account || [];
      return [{
        sheetName: "Chart of Accounts",
        headers: ["ID", "Account Name", "Type", "Sub-Type", "Balance", "Active"],
        rows: accounts.map((a): (string | number | boolean | null)[] => [
          String(a.Id ?? ""),
          String(a.Name ?? ""),
          String(a.AccountType ?? ""),
          String(a.AccountSubType ?? ""),
          typeof a.CurrentBalance === "number" ? a.CurrentBalance : 0,
          a.Active !== false,
        ]),
      }];
    }
    case "qbo_vendors": {
      const data = (await qboQuery("SELECT * FROM Vendor MAXRESULTS 1000")) as {
        QueryResponse?: { Vendor?: Array<Record<string, unknown>> };
      };
      const vendors = data.QueryResponse?.Vendor || [];
      return [{
        sheetName: "Vendors",
        headers: ["Vendor Name", "Balance", "Active", "Email", "Phone"],
        rows: vendors.map((v): (string | number | boolean | null)[] => {
          const email = v.PrimaryEmailAddr && typeof v.PrimaryEmailAddr === "object"
            ? String((v.PrimaryEmailAddr as Record<string, unknown>).Address || "")
            : "";
          const phone = v.PrimaryPhone && typeof v.PrimaryPhone === "object"
            ? String((v.PrimaryPhone as Record<string, unknown>).FreeFormNumber || "")
            : "";
          return [
            String(v.DisplayName || v.CompanyName || ""),
            typeof v.Balance === "number" ? v.Balance : 0,
            v.Active !== false,
            email,
            phone,
          ];
        }),
      }];
    }
    case "qbo_pnl": {
      // P&L requires report endpoint, not query
      const start = typeof params.start === "string" ? params.start : undefined;
      const end = typeof params.end === "string" ? params.end : undefined;
      const qs = [
        start ? `start_date=${start}` : "",
        end ? `end_date=${end}` : "",
      ].filter(Boolean).join("&");
      const url = `${qboBase}/v3/company/${realmId}/reports/ProfitAndLoss${qs ? `?${qs}` : ""}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (!res.ok) throw new Error(`QBO P&L report failed: ${res.status}`);
      const report = (await res.json()) as Record<string, unknown>;
      // Extract rows from QBO report structure
      const rows: (string | number | boolean | null)[][] = [];
      function extractRows(section: Record<string, unknown>, depth = 0) {
        const header = section.Header as Record<string, unknown> | undefined;
        if (header?.ColData) {
          const cols = header.ColData as Array<{ value: string }>;
          rows.push([" ".repeat(depth * 2) + (cols[0]?.value || ""), "", cols[1]?.value ? Number(cols[1].value) || cols[1].value : 0]);
        }
        const rowData = section.Rows as { Row?: Array<Record<string, unknown>> } | undefined;
        if (rowData?.Row) {
          for (const row of rowData.Row) {
            const colData = row.ColData as Array<{ value: string }> | undefined;
            if (colData) {
              rows.push([" ".repeat(depth * 2) + (colData[0]?.value || ""), "", colData[1]?.value ? Number(colData[1].value) || colData[1].value : 0]);
            }
            if (row.Rows) extractRows(row as Record<string, unknown>, depth + 1);
            const summary = row.Summary as Record<string, unknown> | undefined;
            if (summary?.ColData) {
              const sCols = summary.ColData as Array<{ value: string }>;
              rows.push([" ".repeat(depth * 2) + "TOTAL: " + (sCols[0]?.value || ""), "", sCols[1]?.value ? Number(sCols[1].value) || sCols[1].value : 0]);
            }
          }
        }
      }
      if (report.Rows) extractRows(report as Record<string, unknown>);
      return [{
        sheetName: "P&L",
        headers: ["Account", "Type", "Amount"],
        rows,
      }];
    }
    case "kpi_daily_revenue":
    case "kpi_revenue_by_channel":
    case "kpi_revenue": {
      // Pull daily revenue by channel from Supabase kpi_timeseries
      const now = new Date();
      const monthStr = now.toISOString().slice(0, 7);
      const firstOfMonth = `${monthStr}-01`;
      const metrics = encodeURIComponent("(daily_revenue_shopify,daily_revenue_amazon,daily_orders_shopify,daily_orders_amazon)");
      const rows = (await sbFetch(
        `/rest/v1/kpi_timeseries?window_type=eq.daily&metric_name=in.${metrics}&captured_for_date=gte.${firstOfMonth}&select=metric_name,value,captured_for_date&order=captured_for_date.asc&limit=500`,
      )) as Array<{ metric_name: string; value: unknown; captured_for_date: string }>;

      const safeRows = Array.isArray(rows) ? rows : [];
      // Group by date
      const byDate = new Map<string, { shopify_rev: number; amazon_rev: number; shopify_orders: number; amazon_orders: number }>();
      for (const r of safeRows) {
        const d = r.captured_for_date;
        if (!byDate.has(d)) byDate.set(d, { shopify_rev: 0, amazon_rev: 0, shopify_orders: 0, amazon_orders: 0 });
        const entry = byDate.get(d)!;
        const v = typeof r.value === "number" ? r.value : parseFloat(String(r.value ?? 0)) || 0;
        if (r.metric_name === "daily_revenue_shopify") entry.shopify_rev += v;
        else if (r.metric_name === "daily_revenue_amazon") entry.amazon_rev += v;
        else if (r.metric_name === "daily_orders_shopify") entry.shopify_orders += v;
        else if (r.metric_name === "daily_orders_amazon") entry.amazon_orders += v;
      }

      const dates = Array.from(byDate.keys()).sort();
      // Compute 7-day rolling average (total revenue)
      const dailyTotals = dates.map((d) => (byDate.get(d)!.shopify_rev + byDate.get(d)!.amazon_rev));
      const dataRows: (string | number | null)[][] = dates.map((date, i) => {
        const e = byDate.get(date)!;
        const total = e.shopify_rev + e.amazon_rev;
        const totalOrders = e.shopify_orders + e.amazon_orders;
        const window = dailyTotals.slice(Math.max(0, i - 6), i + 1);
        const rolling7d = window.length > 0 ? Math.round((window.reduce((s, v) => s + v, 0) / window.length) * 100) / 100 : 0;
        const shopifyPct = total > 0 ? Math.round((e.shopify_rev / total) * 1000) / 10 : 0;
        const amazonPct = total > 0 ? Math.round((e.amazon_rev / total) * 1000) / 10 : 0;
        return [date, Math.round(e.shopify_rev * 100) / 100, Math.round(e.amazon_rev * 100) / 100, Math.round(total * 100) / 100, Math.round(e.shopify_orders), Math.round(e.amazon_orders), Math.round(totalOrders), shopifyPct, amazonPct, rolling7d];
      });

      // Summary sheet
      const shopifyTotal = dates.reduce((s, d) => s + byDate.get(d)!.shopify_rev, 0);
      const amazonTotal = dates.reduce((s, d) => s + byDate.get(d)!.amazon_rev, 0);
      const grandTotal = shopifyTotal + amazonTotal;
      const shopifyOrders = dates.reduce((s, d) => s + byDate.get(d)!.shopify_orders, 0);
      const amazonOrders = dates.reduce((s, d) => s + byDate.get(d)!.amazon_orders, 0);
      const totalOrders = shopifyOrders + amazonOrders;

      return [
        {
          sheetName: "Daily Revenue",
          headers: ["Date", "Shopify ($)", "Amazon ($)", "Total ($)", "Shopify Orders", "Amazon Orders", "Total Orders", "Shopify Mix %", "Amazon Mix %", "7-Day Rolling Avg ($)"],
          rows: dataRows,
        },
        {
          sheetName: "Summary",
          headers: ["Channel", "Revenue ($)", "Orders", "AOV ($)", "Mix %"],
          rows: [
            ["Shopify", Math.round(shopifyTotal * 100) / 100, Math.round(shopifyOrders), shopifyOrders > 0 ? Math.round((shopifyTotal / shopifyOrders) * 100) / 100 : 0, grandTotal > 0 ? Math.round((shopifyTotal / grandTotal) * 1000) / 10 : 0],
            ["Amazon", Math.round(amazonTotal * 100) / 100, Math.round(amazonOrders), amazonOrders > 0 ? Math.round((amazonTotal / amazonOrders) * 100) / 100 : 0, grandTotal > 0 ? Math.round((amazonTotal / grandTotal) * 1000) / 10 : 0],
            ["TOTAL", Math.round(grandTotal * 100) / 100, Math.round(totalOrders), totalOrders > 0 ? Math.round((grandTotal / totalOrders) * 100) / 100 : 0, 100],
          ],
        },
      ];
    }
    default:
      throw new Error(`Unknown data source: "${source}". Supported: qbo_accounts, qbo_vendors, qbo_pnl, kpi_daily_revenue, kpi_revenue_by_channel`);
  }
}

async function handleGenerateFile(params: Record<string, unknown>): Promise<ActionResult> {
  // Fall back to configured default Slack channel when the caller (e.g. web chat) has no channel context.
  // Set ABRA_SLACK_CHANNEL_ID in Vercel env to a Slack channel ID (e.g. C01234567) for web-chat file uploads.
  const DEFAULT_CHANNEL = (process.env.ABRA_SLACK_CHANNEL_ID || process.env.SLACK_OPS_CHANNEL_ID || process.env.SLACK_CHANNEL_DAILY || "").trim();
  const channelId = String(params.channel_id || params.channelId || DEFAULT_CHANNEL);
  console.log(`[handleGenerateFile] ENTRY — params keys: ${Object.keys(params).join(", ")}, channel_id=${channelId || "NONE"}, hasHeaders=${Array.isArray(params.headers)}, hasRows=${Array.isArray(params.rows)}, hasSheets=${Array.isArray(params.sheets)}, source=${params.source || "none"}`);
  const threadTs = params.thread_ts ? String(params.thread_ts) : undefined;
  const filename = String(params.filename || "report.csv");
  const title = params.title ? String(params.title) : undefined;
  const comment = params.comment ? String(params.comment) : undefined;
  const format = filename.endsWith(".xlsx") ? "xlsx" as const : "csv" as const;

  // If a data source is specified, fetch data server-side instead of from Claude's output
  // This allows large datasets (e.g., 169 QBO accounts) without hitting Claude output limits
  const source = typeof params.source === "string" ? params.source : "";
  if (source) {
    try {
      const fetchedSheets = await fetchDataForFileGeneration(source, params);
      if (fetchedSheets.length === 0) {
        return { success: false, message: `No data returned from source "${source}"` };
      }
      if (!channelId) {
        return { success: false, message: `File data fetched from "${source}" but no Slack channel configured. Set ABRA_SLACK_CHANNEL_ID in Vercel env to enable file uploads from web chat.` };
      }
      const result = await uploadFileToSlack({ channelId, threadTs, filename, title, comment, format, data: fetchedSheets });
      if (!result.ok) return { success: false, message: `File upload failed: ${result.error}` };
      return { success: true, message: `Uploaded ${filename} to Slack${result.permalink ? `: ${result.permalink}` : ""}`, data: { fileId: result.fileId, permalink: result.permalink } };
    } catch (err) {
      return { success: false, message: `Source fetch failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // Parse sheet data — expects { headers: string[], rows: any[][] } or array of sheets
  let sheets: SpreadsheetData[];
  if (Array.isArray(params.sheets)) {
    sheets = (params.sheets as Array<Record<string, unknown>>).map((s) => ({
      sheetName: s.sheetName ? String(s.sheetName) : undefined,
      headers: Array.isArray(s.headers) ? s.headers.map(String) : [],
      rows: Array.isArray(s.rows)
        ? (s.rows as unknown[][]).map((r) =>
            Array.isArray(r) ? r.map((v) => (v == null ? null : typeof v === "number" || typeof v === "boolean" ? v : String(v))) : [],
          )
        : [],
    }));
  } else if (params.headers && Array.isArray(params.headers)) {
    sheets = [{
      sheetName: params.sheetName ? String(params.sheetName) : undefined,
      headers: (params.headers as unknown[]).map(String),
      rows: Array.isArray(params.rows)
        ? (params.rows as unknown[][]).map((r) =>
            Array.isArray(r) ? r.map((v) => (v == null ? null : typeof v === "number" || typeof v === "boolean" ? v : String(v))) : [],
          )
        : [],
    }];
  } else {
    return { success: false, message: "generate_file requires 'headers' + 'rows' arrays, or a 'sheets' array." };
  }

  if (sheets.length === 0 || sheets[0].headers.length === 0) {
    return { success: false, message: "No data provided for file generation." };
  }

  if (!channelId) {
    return { success: false, message: "generate_file requires 'channel_id' to upload the file." };
  }

  const result = await uploadFileToSlack({
    channelId,
    threadTs,
    filename,
    title,
    comment,
    format,
    data: sheets,
  });

  if (!result.ok) {
    return { success: false, message: `File upload failed: ${result.error}` };
  }

  return {
    success: true,
    message: `Uploaded ${filename} to Slack${result.permalink ? `: ${result.permalink}` : ""}`,
    data: { fileId: result.fileId, permalink: result.permalink },
  };
}

const ACTION_HANDLERS: Record<
  string,
  (params: Record<string, unknown>) => Promise<ActionResult>
> = {
  send_slack: handleSendSlack,
  send_email: handleSendEmail,
  draft_email_reply: handleDraftEmailReply,
  create_task: handleCreateTask,
  update_notion: handleUpdateNotion,
  create_brain_entry: handleCreateBrainEntry,
  acknowledge_signal: handleAcknowledgeSignal,
  pause_initiative: handlePauseInitiative,
  create_notion_page: handleCreateNotionPage,
  record_transaction: handleRecordTransaction,
  query_ledger: handleQueryLedger,
  correct_claim: handleCorrectClaim,
  log_production_run: handleLogProductionRun,
  record_vendor_quote: handleRecordVendorQuote,
  run_scenario: handleRunScenario,
  read_email: handleReadEmail,
  search_email: handleSearchEmail,
  query_qbo: handleQueryQBO,
  qbo_setup_assessment: handleQBOSetupAssessment,
  categorize_qbo_transaction: handleCategorizeQBOTransaction,
  batch_categorize_qbo: handleBatchCategorizeQBO,
  create_qbo_invoice: handleCreateQBOInvoice,
  update_shopify_inventory: handleUpdateShopifyInventory,
  create_shopify_discount: handleCreateShopifyDiscount,
  query_shopify_orders: handleQueryShopifyOrders,
  reconcile_transactions: handleReconcileTransactions,
  create_wholesale_draft_order: handleCreateWholesaleDraftOrder,
  create_shopify_product_draft: handleCreateShopifyProductDraft,
  run_monthly_close: handleRunMonthlyClose,
  start_workflow: handleStartWorkflow,
  resume_workflow: handleResumeWorkflow,
  generate_file: handleGenerateFile,
};

async function fetchApproval(approvalId: string): Promise<ApprovalRow | null> {
  const rows = (await sbFetch(
    `/rest/v1/approvals?id=eq.${encodeURIComponent(approvalId)}&select=id,status,action_type,created_at,batch_group,decision_reasoning,resolved_payload,proposed_payload,auto_executed&limit=1`,
  )) as ApprovalRow[];
  return rows[0] || null;
}

async function claimPendingApproval(
  approvalId: string,
): Promise<{ claimId: string; approval: ApprovalRow } | null> {
  const claimId = randomUUID();
  const rows = (await sbFetch(
    `/rest/v1/approvals?id=eq.${encodeURIComponent(approvalId)}&status=eq.pending&batch_group=is.null`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=representation",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        batch_group: claimId,
      }),
    },
  )) as ApprovalRow[];

  if (!rows[0]?.id) return null;
  return { claimId, approval: rows[0] };
}

function parseApprovalId(status: string): string {
  const cleaned = (status || "").trim();
  if (!cleaned) return "";
  const idx = cleaned.indexOf(":");
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

async function updateAutoExecTracking(params: {
  approvalId: string;
  autoExecuted: boolean;
  result?: ActionResult;
}): Promise<void> {
  try {
    await sbFetch(`/rest/v1/approvals?id=eq.${encodeURIComponent(params.approvalId)}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auto_approved: params.autoExecuted,
        auto_executed: params.autoExecuted,
        executed_at: params.autoExecuted ? new Date().toISOString() : null,
        execution_result: params.result
          ? {
              success: params.result.success,
              message: params.result.message,
              data: params.result.data || null,
            }
          : null,
      }),
    });
  } catch {
    // best-effort tracking update
  }
}

async function writeAutoExecBrainEntry(action: AbraAction, result: ActionResult): Promise<void> {
  // Auto-exec audit entries go to decision_log, NOT the semantic brain.
  // Writing system_log to open_brain_entries pollutes vector search with noise.
  try {
    await sbFetch("/rest/v1/decision_log", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action_proposed: `Auto-executed: ${action.description}`,
        action_pattern: action.action_type,
        supporting_data: { action, result },
        decision: "auto_approved",
        reasoning: "Auto-executed within policy limits",
        decided_by: "system",
      }),
    });
  } catch {
    // best-effort audit write
  }
}

async function markApprovalResolved(params: {
  approvalId: string;
  status: "approved" | "denied";
  reasoning: string;
  claimId?: string;
  resultPayload?: unknown;
}): Promise<void> {
  const decidedBy = await resolveSystemUserId();
  if (!decidedBy) return;

  const claimFilter = params.claimId
    ? `&batch_group=eq.${encodeURIComponent(params.claimId)}`
    : "";

  await sbFetch(
    `/rest/v1/approvals?id=eq.${encodeURIComponent(params.approvalId)}&status=eq.pending${claimFilter}`,
    {
    method: "PATCH",
    headers: {
      Prefer: "return=minimal",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      status: params.status,
      decision: params.status,
      decision_reasoning: params.reasoning,
      decided_by_user_id: decidedBy,
      decided_at: new Date().toISOString(),
      ...(params.resultPayload ? { resolved_payload: params.resultPayload } : {}),
    }),
  });
}

function parseActionPayload(input: unknown): AbraAction | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  const action_type = String(row.action_type || "").trim();
  if (!action_type) return null;

  return {
    action_type,
    title: String(row.title || action_type),
    description: String(row.description || row.summary || action_type),
    department: String(row.department || "executive"),
    risk_level:
      row.risk_level === "critical" ||
      row.risk_level === "high" ||
      row.risk_level === "medium" ||
      row.risk_level === "low"
        ? row.risk_level
        : "medium",
    params:
      row.params && typeof row.params === "object"
        ? (row.params as Record<string, unknown>)
        : {},
    requires_approval: row.requires_approval !== false,
  };
}

export async function proposeAction(action: AbraAction): Promise<string> {
  const abraAgentId = await resolveAbraAgentId();
  const mappedType = mapApprovalActionType(action.action_type);

  const rows = (await sbFetch("/rest/v1/approvals", {
    method: "POST",
    headers: {
      Prefer: "return=representation",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requesting_agent_id: abraAgentId,
      action_type: mappedType,
      summary: action.description || action.title,
      proposed_payload: {
        ...action,
        original_action_type: action.action_type,
        confidence:
          typeof action.confidence === "number"
            ? Math.max(0, Math.min(1, action.confidence))
            : 0.5,
      },
      confidence: "medium",
      risk_level: action.risk_level,
      permission_tier: permissionTierForRisk(action.risk_level),
      status: "pending",
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }),
  })) as Array<{ id: string }>;

  const approvalId = rows[0]?.id;
  if (!approvalId) throw new Error("Failed to create approval");

  return `queued:${approvalId}`;
}

export async function canAutoExecute(action: AbraAction): Promise<boolean> {
  if (!isAutoExecutionGloballyEnabled()) return false;
  if (requiresExplicitPermission(action.action_type)) return false;

  const policy = AUTO_EXEC_POLICIES.find((item) => item.action_type === action.action_type);
  if (!policy || !policy.enabled) return false;
  const riskRank: Record<AbraAction["risk_level"], number> = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3,
  };
  if (riskRank[action.risk_level] > riskRank[policy.max_risk_level]) return false;

  const confidence =
    typeof action.confidence === "number"
      ? Math.max(0, Math.min(1, action.confidence))
      : 0.5;
  if (confidence < policy.min_confidence) return false;

  // Amount cap for financial actions (e.g. record_transaction)
  if (typeof policy.max_amount === "number" && action.params) {
    const rawAmount = action.params.amount ?? action.params.adjustment ?? 0;
    const amount = typeof rawAmount === "number"
      ? Math.abs(rawAmount)
      : Math.abs(parseFloat(String(rawAmount || "0")));
    if (amount > policy.max_amount) return false;
  }

  try {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const rows = (await sbFetch(
      `/rest/v1/approvals?auto_executed=eq.true&created_at=gte.${encodeURIComponent(dayStart.toISOString())}&select=id,proposed_payload&limit=1000`,
    )) as Array<{ id: string; proposed_payload?: unknown }>;

    const count = (Array.isArray(rows) ? rows : []).filter((row) => {
      if (!row.proposed_payload || typeof row.proposed_payload !== "object") return false;
      const payload = row.proposed_payload as Record<string, unknown>;
      const original = String(payload.original_action_type || payload.action_type || "");
      return original === action.action_type;
    }).length;

    return count < policy.daily_limit;
  } catch {
    return false;
  }
}

/**
 * Actions that execute directly without approval — no DB row, no Slack notification.
 * Only external-facing actions (send_email, send_slack) require human approval.
 * Everything else is internal data operations that Abra should just do.
 */
const DIRECT_EXEC_ACTIONS = new Set([
  // Read operations
  "read_email",
  "search_email",
  "query_ledger",
  // Internal data writes — Abra learning, organizing, recording
  "create_brain_entry",
  // NOTE: correct_claim is INTENTIONALLY EXCLUDED — it writes to HOT memory tier
  // and must go through approval. See abra-policy.ts tier: "approval_required".
  "acknowledge_signal",
  "create_task",
  "update_notion",
  "create_notion_page",
  "record_transaction",
  "log_production_run",
  "record_vendor_quote",
  "run_scenario",
  "pause_initiative",
  // Draft email replies go to Slack for review before sending — that IS the gate
  "draft_email_reply",
  // QBO operations — read-only queries and auto-categorization
  "query_qbo",
  "categorize_qbo_transaction",
]);

/** Map action types → event bus event types for cross-department cascades */
const ACTION_EVENT_MAP: Partial<Record<string, AbraEventType>> = {
  record_transaction: "transaction_recorded",
  log_production_run: "production_run_logged",
  record_vendor_quote: "vendor_quote_recorded",
  correct_claim: "correction_logged",
};

/** After a successful action, emit an event for cross-department workflows */
function emitPostActionEvent(action: AbraAction, result: ActionResult): void {
  const eventType = ACTION_EVENT_MAP[action.action_type];
  if (!eventType) return;

  emitEvent({
    type: eventType,
    department: action.department || "executive",
    timestamp: new Date().toISOString(),
    data: { ...action.params, result_message: result.message },
    sourceAction: action.action_type,
  }).catch((err) => {
    console.error("[abra-actions] Event bus emission failed:", err);
  });
}

/** Post pending approval to Slack with interactive buttons so Ben can approve from his phone */
async function notifySlackPendingApproval(approvalId: string, action: AbraAction, owner?: string): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) return;

  const ABRA_CONTROL = "C0ALS6W7VB4";
  const riskEmoji = action.risk_level === "high" || action.risk_level === "critical"
    ? "\u{1F6A8}" : action.risk_level === "medium" ? "\u{26A0}\u{FE0F}" : "\u{1F4CB}";
  const tier = permissionTierForRisk(action.risk_level);
  const summary = (action.description || action.title || "").slice(0, 300);
  const ownerTag = owner === "rene" ? " (assigned to Rene)"
    : owner === "ben" ? " (assigned to Ben)"
    : "";
  const previewLines: string[] = [
    `${riskEmoji} *Abra Needs Approval* (Tier ${tier})${ownerTag}`,
    `*Action:* \`${action.action_type}\``,
    `*Risk:* ${action.risk_level}`,
    `*Summary:* ${summary}`,
  ];

  if (action.action_type === "send_email") {
    const to = String(action.params.to || "").trim();
    const subject = String(action.params.subject || "").trim();
    const body = String(action.params.body || action.params.html || action.params.message || "").trim();
    if (to) previewLines.push(`*To:* ${to}`);
    if (subject) previewLines.push(`*Subject:* ${subject}`);
    if (body) {
      previewLines.push("*Body Preview:*");
      previewLines.push(`>${body.slice(0, 500).split("\n").join("\n> ")}`);
    }
  }

  if (action.action_type === "create_qbo_invoice") {
    const customerName = String(action.params.customerName || action.params.customer_name || "").trim();
    const lineItems = Array.isArray(action.params.lineItems)
      ? action.params.lineItems
      : Array.isArray(action.params.line_items)
        ? action.params.line_items
        : [];
    const total = lineItems.reduce((sum, item) => {
      if (!item || typeof item !== "object") return sum;
      const row = item as Record<string, unknown>;
      return sum + (Number(row.quantity || 0) * Number(row.unitPrice || row.unit_price || 0));
    }, 0);
    if (customerName) previewLines.push(`*Customer:* ${customerName}`);
    if (lineItems.length > 0) previewLines.push(`*Invoice Total:* $${total.toFixed(2)} across ${lineItems.length} line item(s)`);
  }

  if (action.action_type === "batch_categorize_qbo") {
    try {
      const previewRes = await fetch(`${getInternalOpsBaseUrl()}/api/ops/qbo/categorize-batch`, {
        method: "POST",
        headers: getInternalOpsHeaders(),
        body: JSON.stringify({ mode: "preview" }),
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      });
      if (previewRes.ok) {
        const preview = (await previewRes.json()) as Record<string, unknown>;
        previewLines.push(
          `*Preview:* ${Number(preview.total || 0)} scanned, ${Number(preview.autoCategorizeable || 0)} auto-categorizable, ${Number(preview.needsReview || 0)} need review`,
        );
      }
    } catch {
      // Best-effort preview only
    }
  }

  const fallbackText = `${riskEmoji} Abra Needs Approval (Tier ${tier}) — ${action.action_type}: ${summary}`;
  const buttons: Array<Record<string, unknown>> = [
    {
      type: "button",
      text: { type: "plain_text", text: action.action_type === "send_email" ? "Send" : "Approve", emoji: true },
      style: "primary",
      action_id: "approve_action",
      value: approvalId,
      confirm: {
        title: { type: "plain_text", text: "Approve this action?" },
        text: { type: "mrkdwn", text: `*${action.action_type}*: ${summary}` },
        confirm: { type: "plain_text", text: action.action_type === "send_email" ? "Send" : "Approve" },
        deny: { type: "plain_text", text: "Cancel" },
      },
    },
  ];

  if (action.action_type === "send_email") {
    buttons.push({
      type: "button",
      text: { type: "plain_text", text: "Edit", emoji: true },
      action_id: "edit_email_action",
      value: approvalId,
    });
  }

  buttons.push({
    type: "button",
    text: { type: "plain_text", text: action.action_type === "send_email" ? "Cancel" : "Reject", emoji: true },
    style: "danger",
    action_id: "reject_action",
    value: approvalId,
  });

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: previewLines.join("\n"),
      },
    },
    {
      type: "actions",
      elements: buttons,
    },
  ];

  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: ABRA_CONTROL,
        text: fallbackText,
        blocks,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // Slack notification is best-effort
  }
}

/**
 * Expire stale pending approvals older than the given TTL.
 * Run at the start of each inbox-scan cycle to prevent approval pile-up.
 */
export async function expireStaleApprovals(ttlHours = 24): Promise<number> {
  try {
    getSupabaseEnv(); // Validate credentials exist — throws if missing
  } catch {
    return 0; // No Supabase credentials configured
  }

  const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000).toISOString();

  try {
    const rows = (await sbFetch(
      `/rest/v1/approvals?status=eq.pending&created_at=lt.${cutoff}&select=id`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      },
    )) as Array<{ id: string }> | null;

    if (!rows || rows.length === 0) return 0;

    await sbFetch(
      `/rest/v1/approvals?status=eq.pending&created_at=lt.${cutoff}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "expired",
          decision_reasoning: `Auto-expired: pending > ${ttlHours}h`,
        }),
      },
    );

    return rows.length;
  } catch (err) {
    console.error("[abra-actions] expireStaleApprovals error:", err);
    return 0;
  }
}

export async function proposeAndMaybeExecute(action: AbraAction): Promise<{
  approval_id: string;
  auto_executed: boolean;
  result?: ActionResult;
}> {
  // Clamp risk level to policy floor (e.g., record_transaction can't be "low")
  const clampedRisk = clampRiskLevel(action.action_type, action.risk_level as RiskLevel);
  if (clampedRisk !== action.risk_level) {
    action = { ...action, risk_level: clampedRisk };
  }

  // ── Tier 1: Direct exec (read-only) — no approval row, no audit log ──
  if (policyCanDirectExec(action.action_type)) {
    const handler = ACTION_HANDLERS[action.action_type];
    if (handler) {
      try {
        const result = await handler(action.params || {});
        if (result.success) {
          void emitPostActionEvent(action, result);
        }
        return {
          approval_id: `direct:${randomUUID()}`,
          auto_executed: true,
          result,
        };
      } catch (err) {
        console.error(`[proposeAndMaybeExecute] Tier 1 direct exec FAILED for ${action.action_type}:`, err);
        // Fall through to normal approval flow on error
      }
    }
  }

  // ── Tier 2: Auto-exec with audit — execute immediately, log to decision_log ──
  const tier2Policy = policyCanAutoExec(action.action_type, action.risk_level as RiskLevel);
  const tier2Handler = ACTION_HANDLERS[action.action_type];
  const tier2NeedsApproval = policyRequiresApproval(action.action_type, action.risk_level as RiskLevel, extractAmount(action.params));
  console.log(`[proposeAndMaybeExecute] Tier 2 check for ${action.action_type}: policyOk=${tier2Policy}, hasHandler=${!!tier2Handler}, requiresApproval=${tier2NeedsApproval}, risk=${action.risk_level}`);

  if (tier2Policy) {
    if (tier2Handler && !tier2NeedsApproval) {
      try {
        console.log(`[proposeAndMaybeExecute] Tier 2 EXECUTING ${action.action_type} with params keys: ${Object.keys(action.params || {}).join(", ")}`);
        const result = await tier2Handler(action.params || {});
        console.log(`[proposeAndMaybeExecute] Tier 2 ${action.action_type} result: success=${result.success}, message=${result.message?.slice(0, 200)}`);
        if (result.success) {
          void emitPostActionEvent(action, result);
          void writeAutoExecBrainEntry(action, result);
        }
        return {
          approval_id: `auto:${randomUUID()}`,
          auto_executed: true,
          result,
        };
      } catch (err) {
        console.error(`[proposeAndMaybeExecute] Tier 2 auto-exec FAILED for ${action.action_type}:`, err);
        // Fall through to approval flow on error
      }
    } else {
      console.warn(`[proposeAndMaybeExecute] Tier 2 policy passed but blocked: hasHandler=${!!tier2Handler}, requiresApproval=${tier2NeedsApproval}`);
    }
  }

  // ── Tier 3: Approval required — create approval row, notify owner ──
  const status = await proposeAction(action);
  const approvalId = parseApprovalId(status);
  if (!approvalId) {
    throw new Error("Failed to derive approval id");
  }

  // Check auto-execute eligibility (legacy path — respects daily limits & global flag)
  const eligible = await canAutoExecute(action);
  if (!eligible) {
    // Not auto-executable → notify the right owner via Slack
    const owner = getApprovalOwner(action.action_type, action.risk_level as RiskLevel);
    await notifySlackPendingApproval(approvalId, action, owner);
    return { approval_id: approvalId, auto_executed: false };
  }

  const result = await executeAction(approvalId);
  const autoExecuted = !!result.success;
  await updateAutoExecTracking({ approvalId, autoExecuted, result });
  if (autoExecuted) {
    await writeAutoExecBrainEntry(action, result);
  }

  return {
    approval_id: approvalId,
    auto_executed: autoExecuted,
    ...(result ? { result } : {}),
  };
}

/** Extract a numeric amount from action params for policy cap checks */
function extractAmount(params: Record<string, unknown>): number | undefined {
  const raw = params.amount ?? params.total_cost ?? params.adjustment;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = parseFloat(raw.replace(/[$,]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Unclaim stale approvals that got stuck — if a batch_group was set (claimed)
 * but the approval was never resolved within STALE_CLAIM_TTL_MS, clear the
 * batch_group so it can be retried. This handles the case where the handler
 * succeeds but markApprovalResolved fails (network error, timeout, etc.)
 */
const STALE_CLAIM_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function unclaimIfStale(approvalId: string, approval: ApprovalRow): Promise<boolean> {
  if (approval.status !== "pending" || !approval.batch_group) return false;
  if (!approval.created_at) return false;

  // Check if the claim is old enough to be considered stale
  const claimedAt = new Date(approval.created_at).getTime();
  const now = Date.now();
  if (now - claimedAt < STALE_CLAIM_TTL_MS) return false;

  try {
    await sbFetch(
      `/rest/v1/approvals?id=eq.${encodeURIComponent(approvalId)}&status=eq.pending&batch_group=eq.${encodeURIComponent(approval.batch_group)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
        body: JSON.stringify({ batch_group: null }),
      },
    );
    return true;
  } catch {
    return false;
  }
}

export async function executeAction(approvalId: string): Promise<ActionResult> {
  if (!UUID_RE.test(approvalId)) {
    return { success: false, message: "Invalid approval ID format" };
  }
  const claimed = await claimPendingApproval(approvalId);
  if (!claimed) {
    const current = await fetchApproval(approvalId);
    if (!current) {
      return { success: false, message: "Approval not found" };
    }
    if (current.status === "approved") {
      return {
        success: true,
        message: "Approval already executed",
        data: current.resolved_payload || {},
      };
    }
    if (current.status === "pending" && current.batch_group) {
      // Try to unclaim if stale (handler succeeded but markResolved failed)
      const unclaimed = await unclaimIfStale(approvalId, current);
      if (unclaimed) {
        // Retry claim after unclaiming
        const retryClaim = await claimPendingApproval(approvalId);
        if (!retryClaim) {
          return { success: false, message: "Approval could not be reclaimed after stale unclaim" };
        }
        // Fall through to execution below by reassigning — but we can't reassign const.
        // Instead, recurse once (safe because unclaim already happened, won't loop).
        return executeAction(approvalId);
      }
      return {
        success: false,
        message: "Approval is currently being executed",
      };
    }
    return { success: false, message: `Approval is ${current.status}` };
  }

  const action = parseActionPayload(claimed.approval.proposed_payload);
  if (!action) {
    await markApprovalResolved({
      approvalId,
      status: "denied",
      reasoning: "Invalid action payload",
      claimId: claimed.claimId,
    });
    return { success: false, message: "Invalid action payload" };
  }

  const handler = ACTION_HANDLERS[action.action_type];
  if (!handler) {
    await markApprovalResolved({
      approvalId,
      status: "denied",
      reasoning: `No handler for ${action.action_type}`,
      claimId: claimed.claimId,
    });
    return { success: false, message: `No handler for ${action.action_type}` };
  }

  try {
    const result = await handler(action.params || {});
    if (result.success) {
      await markApprovalResolved({
        approvalId,
        status: "approved",
        reasoning: "Executed by Abra action engine",
        claimId: claimed.claimId,
        resultPayload: result.data || { message: result.message },
      });
      // Fire event bus — cascade cross-department effects
      void emitPostActionEvent(action, result);
      // Track outcome for feedback loop (dynamic import to avoid circular deps)
      import("@/lib/ops/abra-outcome-tracker")
        .then(({ trackAction, isTrackableAction }) => {
          if (isTrackableAction(action.action_type)) {
            const target =
              (action.params?.to as string) ||
              (action.params?.email as string) ||
              (action.params?.company as string) ||
              (action.params?.company_name as string) ||
              (action.params?.channel as string) ||
              (action.params?.order_id as string) ||
              action.title ||
              "unknown";
            return trackAction({
              action_id: approvalId,
              action_type: action.action_type,
              target,
              expected_outcome: action.description || `Successful ${action.action_type}`,
              notes: `Department: ${action.department}, Risk: ${action.risk_level}`,
            });
          }
        })
        .catch(() => {
          // Never let outcome tracking block action execution
        });
    } else {
      await markApprovalResolved({
        approvalId,
        status: "denied",
        reasoning: result.message,
        claimId: claimed.claimId,
      });
    }
    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Action handler failed";
    await markApprovalResolved({
      approvalId,
      status: "denied",
      reasoning: message,
      claimId: claimed.claimId,
      resultPayload: { error: message },
    });
    return { success: false, message };
  }
}

export function getAvailableActions(): string[] {
  return Object.keys(ACTION_HANDLERS);
}

export async function executeActionByType(
  actionType: string,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const handler = ACTION_HANDLERS[actionType];
  if (!handler) {
    return { success: false, message: `No handler for ${actionType}` };
  }
  return handler(params);
}

// ─── Shared Action Parsing Utilities ───────────────────────────────────────
// These are used by the web chat route AND Slack routes to parse/execute actions.

export type ActionDirective = {
  action: AbraAction;
  raw: string;
};

/** Known action types — reject anything not in this set to prevent prompt-injected novel action types */
export const KNOWN_ACTION_TYPES = new Set([
  "create_brain_entry",
  "acknowledge_signal",
  "send_slack",
  "create_task",
  "create_notion_page",
  "record_transaction",
  "query_ledger",
  "correct_claim",
  "send_email",
  "update_notion",
  "pause_initiative",
  "log_production_run",
  "record_vendor_quote",
  "run_scenario",
  "read_email",
  "search_email",
  "draft_email_reply",
  "query_qbo",
  "qbo_setup_assessment",
  "categorize_qbo_transaction",
  "batch_categorize_qbo",
  "create_qbo_invoice",
  "update_shopify_inventory",
  "create_shopify_discount",
  "query_shopify_orders",
  "reconcile_transactions",
  "start_workflow",
  "resume_workflow",
  "calculate_deal",
  "create_wholesale_draft_order",
  "create_shopify_product_draft",
  "store_brain_entry",
  "update_brain_entry",
  "search_brain",
  "log_metric",
  "run_monthly_close",
  "generate_file",
]);

/** When Claude emits action JSON without a nested "params" key, gather top-level
 *  non-standard keys as implicit params (e.g. query_type, period_start, etc.) */
function extractImplicitParams(obj: Record<string, unknown>, _actionType: string): Record<string, unknown> {
  const STANDARD_KEYS = new Set([
    "action_type", "action", "title", "description", "department",
    "risk_level", "params", "requires_approval",
  ]);
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!STANDARD_KEYS.has(key) && value !== undefined && value !== null) {
      params[key] = value;
    }
  }
  return params;
}

export function normalizeActionDirective(raw: unknown): AbraAction | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const actionType =
    typeof obj.action_type === "string" ? obj.action_type.trim().toLowerCase() : "";
  if (!actionType) return null;

  // Reject unknown action types — prevents prompt injection of novel actions
  if (!KNOWN_ACTION_TYPES.has(actionType)) return null;

  const rawRisk =
    obj.risk_level === "low" ||
    obj.risk_level === "medium" ||
    obj.risk_level === "high" ||
    obj.risk_level === "critical"
      ? obj.risk_level
      : "medium";

  // Defense-in-depth: financial and correction actions are NEVER "low" risk,
  // regardless of what Claude labels them.
  const ELEVATED_RISK_ACTIONS = new Set([
    "record_transaction",
    "correct_claim",
    "send_email",
    "send_slack",
    "draft_email_reply",
    "batch_categorize_qbo",
    "create_qbo_invoice",
    "update_shopify_inventory",
    "create_shopify_discount",
  ]);
  const risk = ELEVATED_RISK_ACTIONS.has(actionType) && rawRisk === "low"
    ? "medium"
    : rawRisk;

  // Truncate all string fields to prevent context-stuffing
  const title =
    typeof obj.title === "string" && obj.title.trim()
      ? obj.title.trim().slice(0, 200)
      : actionType;
  const description =
    typeof obj.description === "string" && obj.description.trim()
      ? obj.description.trim().slice(0, 500)
      : `Requested action: ${actionType}`;
  const department =
    typeof obj.department === "string" && obj.department.trim()
      ? obj.department.trim().slice(0, 50)
      : "executive";

  return {
    action_type: actionType,
    title,
    description,
    department,
    risk_level: risk,
    params:
      obj.params && typeof obj.params === "object" && !Array.isArray(obj.params)
        ? (obj.params as Record<string, unknown>)
        : extractImplicitParams(obj, actionType),
    requires_approval: obj.requires_approval !== false,
  };
}

export function parseActionDirectives(reply: string): {
  actions: ActionDirective[];
  cleanReply: string;
} {
  const pattern = /<action>\s*([\s\S]*?)\s*<\/action>/gi;
  const actions: ActionDirective[] = [];
  let cleanReply = reply;
  let match: RegExpExecArray | null;

  // Parse <action>{...}</action> tags
  while ((match = pattern.exec(reply)) !== null) {
    const block = match[0];
    const payloadRaw = match[1]?.trim() || "";
    // Always strip the block from cleanReply, whether or not it parses
    cleanReply = cleanReply.replace(block, "");
    try {
      const parsed = JSON.parse(payloadRaw) as unknown;
      const action = normalizeActionDirective(parsed);
      if (action) {
        actions.push({ action, raw: block });
      }
    } catch {
      // Ignore malformed blocks and keep response usable.
    }
  }
  // Also strip any remaining <action> blocks that didn't match the pattern
  // (e.g., function-call style like <action>read_email({...})</action>)
  cleanReply = cleanReply.replace(/<action>\s*[\s\S]*?\s*<\/action>/gi, "").trim();

  // Also parse markdown fenced code blocks like ```query_qbo\nkey: "value"\n```
  // Claude sometimes emits actions as fenced code blocks instead of <action> tags.
  const KNOWN_ACTION_TYPES = new Set([
    "query_qbo", "read_email", "search_email", "query_ledger", "send_slack",
    "create_brain_entry", "create_task", "update_notion", "create_notion_page",
    "categorize_qbo_transaction", "batch_categorize_qbo", "create_qbo_invoice",
    "record_transaction", "log_production_run", "record_vendor_quote", "run_scenario",
    "correct_claim", "update_shopify_inventory", "create_shopify_discount", "generate_file",
  ]);
  const codeBlockPattern = /```(\w+)\n([\s\S]*?)```/g;
  let cbMatch: RegExpExecArray | null;
  while ((cbMatch = codeBlockPattern.exec(reply)) !== null) {
    const lang = cbMatch[1];
    const block = cbMatch[0];
    const body = cbMatch[2]?.trim() || "";

    // Format 1: ```query_qbo\nkey: value\n``` — language IS the action type
    if (KNOWN_ACTION_TYPES.has(lang)) {
      const params: Record<string, unknown> = {};
      for (const line of body.split("\n")) {
        const kvMatch = line.match(/^(\w+):\s*(?:"([^"]*)"|'([^']*)'|(.+))$/);
        if (kvMatch) {
          params[kvMatch[1]] = kvMatch[2] ?? kvMatch[3] ?? kvMatch[4]?.trim();
        }
      }
      const action = normalizeActionDirective({
        action_type: lang,
        params,
        risk_level: "low",
      });
      if (action) {
        actions.push({ action, raw: block });
      }
      continue;
    }

    // Format 2: ```json\n{"action":"query_qbo",...}\n``` — JSON with action/action_type field
    if (lang === "json" || lang === "JSON") {
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        const actionType = String(parsed.action_type || parsed.action || "");
        if (KNOWN_ACTION_TYPES.has(actionType)) {
          const action = normalizeActionDirective({
            ...parsed,
            action_type: actionType,
            risk_level: parsed.risk_level || "low",
          });
          if (action) {
            actions.push({ action, raw: block });
          }
        }
      } catch {
        // Not valid JSON — skip
      }
    }
  }

  for (const directive of actions) {
    cleanReply = cleanReply.replace(directive.raw, "").trim();
  }

  return { actions, cleanReply: cleanReply.trim() };
}

/** Strip <action>...</action> blocks from text for user-facing display */
export function stripActionBlocks(text: string): string {
  return text.replace(/<action>\s*[\s\S]*?\s*<\/action>/gi, "").trim();
}

/**
 * Build the action instruction text for Claude's system prompt.
 * Used by web chat, Slack slash command, and Slack events processor.
 */
export function buildActionInstructions(availableActions: string[]): string {
  if (!availableActions || availableActions.length === 0) return "";
  return `\n\nACTION EXECUTION SYSTEM (YOU MUST USE THIS):
You have REAL action capabilities. Available actions: ${availableActions.join(", ")}.

BANNED PHRASES — NEVER say any of these:
• "I can't directly handle..."
• "I can't execute tasks..."
• "I don't have the ability to..."
• "I'm not able to..."
• "You should..." (when you could DO it instead)
• "Consider doing..." (when you could DO it instead)
• "I recommend..." followed by a list of steps the user should do themselves
Instead: USE your actions. If the user asks you to do something and you have an action for it, DO IT.

WHEN TO EMIT ACTIONS:
• User asks you to DO something (send, create, log, notify, remind, track, store) → EMIT the action.
• You learn new information about the business → create_brain_entry to remember it.
• A playbook step needs execution → execute it via action, don't just list it.
• Something important happened → send_slack to alert the team.

FORMAT (append <action> JSON blocks, max 3 per reply):
<action>{"action_type":"create_brain_entry","title":"...","description":"...","department":"executive","risk_level":"low","params":{"title":"...","text":"..."}}</action>

EXAMPLES:
• "remind the team about the production call" → emit send_slack action
• "we switched from Powers to XYZ for packaging" → emit create_brain_entry
• "create a task to follow up with the distributor" → emit create_task
• "save this as a report" → emit create_notion_page with database "meeting_notes"
• "log this to the pipeline" → emit create_notion_page with database "b2b_prospects"
• "record the $500 payment to Powers" → emit record_transaction with type "expense", amount 500, vendor "Powers Confections"
• "what are our total expenses?" → emit query_ledger to pull real numbers from the Notion ledger. NEVER guess financial totals from memory.
• "send Rene the expense report" → FIRST emit query_ledger to get real totals, THEN draft the reply with actual numbers.
• "we did a production run at Powers, 10,000 units, total cost $13,500" → emit log_production_run
• "Powers quoted us $1.20/unit for gummy base" → emit record_vendor_quote
• "what if ingredient costs go up 15%?" → emit run_scenario
• "did you see the email from Rene?" → emit read_email with the message_id from inbox.
• "find emails about the Powers invoice" → emit search_email with query "Powers invoice"
• "categorize all pending bank transactions" → emit batch_categorize_qbo with mode "auto"
• "create invoice for Brent Overman, 100 units at $3.50 each" → emit create_qbo_invoice
• "how many orders this week?" → emit query_shopify_orders with days 7
• "adjust Shopify inventory for variant X by -12" → emit update_shopify_inventory
• "create discount code LAUNCH20 for 20% off" → emit create_shopify_discount
• "reconcile this month" → emit reconcile_transactions with period "month"
• "export vendor list to Excel" → emit generate_file with filename="vendor_list.xlsx", source="qbo_vendors", risk_level="low"
• "give me the chart of accounts as a spreadsheet" → emit generate_file with filename="chart_of_accounts.xlsx", source="qbo_accounts", risk_level="low"
• "export P&L to XLSX" → emit generate_file with filename="pnl.xlsx", source="qbo_pnl", risk_level="low"
• "create a spreadsheet with this data" → emit generate_file with filename="export.xlsx", headers=[...], rows=[...], risk_level="low"

DATABASE KEYS for create_notion_page: meeting_notes, b2b_prospects, distributor_prospects, daily_performance, fleet_ops, inventory, sku_registry, cash_transactions, content_drafts, kpis, general

ACTION EXECUTION TIERS:
• AUTO-EXECUTE (low-risk, informational): create_brain_entry, acknowledge_signal, create_notion_page, create_task — these execute immediately.
• AUTO-EXECUTE (low-risk, read-only): read_email, search_email, query_ledger — auto-execute IMMEDIATELY.
• AUTO-EXECUTE (low-risk, commerce reads): query_qbo, query_shopify_orders, reconcile_transactions — auto-execute when emitted.
• AUTO-EXECUTE (low-risk, operational data): log_production_run, record_vendor_quote — auto-execute when emitted.
• AUTO-EXECUTE (stateless computation): run_scenario — computes hypotheticals. Auto-execute when emitted.
• AUTO-EXECUTE (file generation): generate_file — auto-executes immediately. Use whenever the user asks for a spreadsheet, XLSX, CSV, or file export. ALWAYS use risk_level: "low". The file is uploaded directly to Slack — NEVER say you can't generate files.
• AUTO-EXECUTE WITH CAPS (financial): record_transaction — auto-executes ONLY if amount ≤ $500.
• AUTO-EXECUTE WITH CAPS (inventory): update_shopify_inventory — auto-executes ONLY if absolute adjustment ≤ 500.
• ALWAYS QUEUED (requires human approval): send_email, send_slack, correct_claim, batch_categorize_qbo, create_qbo_invoice, create_shopify_discount — NEVER auto-execute.

generate_file USAGE:
• Server-side data sources (preferred — fetches live data automatically):
  - source="qbo_vendors" → full vendor list from QuickBooks
  - source="qbo_accounts" → chart of accounts from QuickBooks
  - source="qbo_pnl" → profit & loss report from QuickBooks
• Direct data (when you already have the data inline):
  - headers=["Col1","Col2",...], rows=[["val1","val2",...],...]
• Always set filename with .xlsx extension for Excel, .csv for CSV.
• Example: emit generate_file with filename="vendor_list.xlsx", source="qbo_vendors", risk_level="low"

⚠️ ACTION SAFETY RULES:
1. record_transaction — ONLY emit with amounts the USER explicitly stated. NEVER estimate amounts.
2. correct_claim — ALWAYS confirm exact wording with user. Corrections permanently override data.
3. log_production_run — ONLY emit with cost figures from VERIFIED sources. NEVER estimate production costs.
4. run_scenario — Label EVERY output "⚠️ HYPOTHETICAL SCENARIO — not a forecast."
5. create_brain_entry — Make titles factual and specific. NEVER store unverified dollar figures.
6. create_qbo_invoice — ONLY emit with explicit quantities and unit prices. Never invent invoice totals.
7. update_shopify_inventory — ONLY emit when the SKU/variant is explicit. Never guess which variant to adjust.
8. generate_file — ALWAYS use risk_level: "low" and prefer source= parameter over inline data. NEVER say you can't generate files.
9. GENERAL: If unsure whether to emit an action, DON'T. Ask the user first.`;
}

// ─── NAMED EXPORTS FOR TOOL_USE (route.ts executeToolCall) ──────────────
export {
  handleUpdateNotion as execUpdateNotion,
  handleCreateNotionPage as execCreateNotionPage,
  handleSendSlack as execSendSlack,
  handleCreateBrainEntry as execCreateBrainEntry,
  handleQueryLedger as execQueryLedger,
  handleSendEmail as execSendEmail,
  handleCreateTask as execCreateTask,
};
