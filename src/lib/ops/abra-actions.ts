import { notify } from "@/lib/ops/notify";
import { randomUUID } from "node:crypto";
import { sendOpsEmail } from "@/lib/ops/email";
import { createNotionPage, updateNotionPage } from "@/lib/ops/abra-notion-write";
import { DB } from "@/lib/notion/client";
import { generateEmbedding } from "@/lib/ops/abra-embeddings";

/** Map friendly database keys → Notion database IDs for create_notion_page action */
const NOTION_DB_MAP: Record<string, string> = {
  meeting_notes: process.env.NOTION_MEETING_NOTES_DB_ID || process.env.NOTION_MEETING_DB_ID || "",
  b2b_prospects: process.env.NOTION_B2B_PROSPECTS_DB || "",
  distributor_prospects: process.env.NOTION_DISTRIBUTOR_PROSPECTS_DB || "",
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
  max_risk_level: "low";
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
];

const EXTERNAL_SUBMISSION_ACTIONS = new Set([
  "send_email",
  "send_slack",
  "update_notion",
  "draft_email_reply",
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
    throw new Error(
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
    );
  }
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
  const body = sanitizeText(String(params.body || params.html || params.message || ""), 10000);
  if (!to || !body) {
    return { success: false, message: "Missing email recipient or body" };
  }

  // Safety: only send to known/allowed recipients
  if (!isAllowedEmailRecipient(to)) {
    return {
      success: false,
      message: `Email recipient "${to}" is not in the allowed list. Only @usagummies.com and pre-approved addresses are permitted.`,
    };
  }

  await sendOpsEmail({ to, subject, body });
  return { success: true, message: `Email sent to ${to}` };
}

async function handleDraftEmailReply(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const to = String(params.to || "").toLowerCase().trim();
  const subject = sanitizeTitle(String(params.subject || "Re: (no subject)"));
  const body = sanitizeText(String(params.body || ""), 10000);
  const sourceEmailId = typeof params.source_email_id === "string" ? params.source_email_id : null;

  if (!to || !body) {
    return { success: false, message: "Missing email recipient or body for draft reply" };
  }

  if (!isAllowedEmailRecipient(to)) {
    return {
      success: false,
      message: `Email recipient "${to}" is not in the allowed list. Only @usagummies.com and pre-approved addresses are permitted.`,
    };
  }

  await sendOpsEmail({ to, subject, body });

  // Update source email's draft_status to 'sent' if we have a reference
  if (sourceEmailId) {
    try {
      await sbFetch(
        `/rest/v1/email_events?id=eq.${encodeURIComponent(sourceEmailId)}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ draft_status: "sent" }),
        },
      );
    } catch (err) {
      console.error(`[abra-actions] Failed to update draft_status for ${sourceEmailId}:`, err);
    }
  }

  return { success: true, message: `Draft reply sent to ${to} (${subject})` };
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
  const category = VALID_BRAIN_CATEGORIES.has(rawCategory) ? rawCategory : "system_log";
  const rawEntryType = typeof params.entry_type === "string" ? params.entry_type.toLowerCase() : "";
  const entryType = VALID_BRAIN_ENTRY_TYPES.has(rawEntryType) ? rawEntryType : "system_log";
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

  const pageId = await createNotionPage({
    parent_id: parentId,
    title,
    ...(content ? { content } : {}),
    ...(properties ? { properties } : {}),
  });

  if (!pageId) {
    return { success: false, message: "Failed to create Notion page" };
  }

  const url = notionUrlFromId(pageId);
  return {
    success: true,
    message: `Created Notion page: [${title}](${url})`,
    data: { page_id: pageId, url },
  };
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
  "gmail.com", // Ben's personal
]);

/** Additional allowed specific addresses (for known contacts) */
const ALLOWED_EMAIL_ADDRESSES = new Set([
  "ben@usagummies.com",
  "benjamin.stutman@gmail.com",
]);

function isAllowedEmailRecipient(email: string): boolean {
  const normalized = email.toLowerCase().trim();
  if (ALLOWED_EMAIL_ADDRESSES.has(normalized)) return true;
  const domain = normalized.split("@")[1];
  return domain ? ALLOWED_EMAIL_DOMAINS.has(domain) : false;
}

// ── Transaction validation ──────────────────────────────────────────────────

const VALID_TX_TYPES = new Set(["income", "expense", "transfer", "refund", "cogs", "tax", "shipping"]);
const MAX_TX_AMOUNT = 100_000; // Hard safety limit — anything higher is likely a hallucination

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

  const properties: Record<string, unknown> = {
    Amount: { number: amount },
    Type: { select: { name: txType } },
    Category: { select: { name: category } },
    Date: { date: { start: dateStr } },
  };
  if (vendor) {
    properties.Vendor = { rich_text: [{ text: { content: vendor.slice(0, 200) } }] };
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

  const yieldRate = totalUnitsReceived / totalUnitsOrdered;
  const costPerUnit = totalCost / totalUnitsReceived;
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
      adjRevenue = (revenue / units) * adjUnits; // Scale revenue proportionally
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

    return {
      success: true,
      message: `Email from ${email.from} — "${email.subject}" (${email.date}):\n\n${body}`,
      data: {
        id: email.id,
        threadId: email.threadId,
        from: email.from,
        to: email.to,
        subject: email.subject,
        date: email.date,
        body_length: email.body.length,
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
  correct_claim: handleCorrectClaim,
  log_production_run: handleLogProductionRun,
  record_vendor_quote: handleRecordVendorQuote,
  run_scenario: handleRunScenario,
  read_email: handleReadEmail,
  search_email: handleSearchEmail,
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
  try {
    await sbFetch("/rest/v1/open_brain_entries", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_type: "agent",
        source_ref: "auto-exec",
        entry_type: "system_log",
        title: `Auto-executed: ${action.description}`,
        raw_text: JSON.stringify({ action, result }),
        summary_text: result.message.slice(0, 500),
        category: "system_log",
        department: action.department || "operations",
        confidence: "high",
        priority: "normal",
        processed: true,
      }),
    });
  } catch {
    // best-effort brain write
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
  if (policy.max_risk_level !== "low" || action.risk_level !== "low") return false;

  const confidence =
    typeof action.confidence === "number"
      ? Math.max(0, Math.min(1, action.confidence))
      : 0.5;
  if (confidence < policy.min_confidence) return false;

  // Amount cap for financial actions (e.g. record_transaction)
  if (typeof policy.max_amount === "number" && action.params) {
    const amount = typeof action.params.amount === "number"
      ? Math.abs(action.params.amount)
      : Math.abs(parseFloat(String(action.params.amount || "0")));
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

export async function proposeAndMaybeExecute(action: AbraAction): Promise<{
  approval_id: string;
  auto_executed: boolean;
  result?: ActionResult;
}> {
  const status = await proposeAction(action);
  const approvalId = parseApprovalId(status);
  if (!approvalId) {
    throw new Error("Failed to derive approval id");
  }

  const eligible = await canAutoExecute(action);
  if (!eligible) {
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
]);

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
        : {},
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

  while ((match = pattern.exec(reply)) !== null) {
    const block = match[0];
    const payloadRaw = match[1]?.trim() || "";
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
• "we did a production run at Powers, 10,000 units, total cost $13,500" → emit log_production_run
• "Powers quoted us $1.20/unit for gummy base" → emit record_vendor_quote
• "what if ingredient costs go up 15%?" → emit run_scenario
• "did you see the email from Rene?" → emit read_email with the message_id from inbox.
• "find emails about the Powers invoice" → emit search_email with query "Powers invoice"

DATABASE KEYS for create_notion_page: meeting_notes, b2b_prospects, distributor_prospects, daily_performance, fleet_ops, inventory, sku_registry, cash_transactions, content_drafts, kpis, general

ACTION EXECUTION TIERS:
• AUTO-EXECUTE (low-risk, informational): create_brain_entry, acknowledge_signal, create_notion_page, create_task — these execute immediately.
• AUTO-EXECUTE (low-risk, read-only): read_email, search_email — auto-execute IMMEDIATELY.
• AUTO-EXECUTE (low-risk, operational data): log_production_run, record_vendor_quote — auto-execute when emitted.
• AUTO-EXECUTE (stateless computation): run_scenario — computes hypotheticals. Auto-execute when emitted.
• AUTO-EXECUTE WITH CAPS (financial): record_transaction — auto-executes ONLY if amount ≤ $500.
• ALWAYS QUEUED (requires human approval): send_email, send_slack, correct_claim — NEVER auto-execute.

⚠️ ACTION SAFETY RULES:
1. record_transaction — ONLY emit with amounts the USER explicitly stated. NEVER estimate amounts.
2. correct_claim — ALWAYS confirm exact wording with user. Corrections permanently override data.
3. log_production_run — ONLY emit with cost figures from VERIFIED sources. NEVER estimate production costs.
4. run_scenario — Label EVERY output "⚠️ HYPOTHETICAL SCENARIO — not a forecast."
5. create_brain_entry — Make titles factual and specific. NEVER store unverified dollar figures.
6. GENERAL: If unsure whether to emit an action, DON'T. Ask the user first.`;
}
