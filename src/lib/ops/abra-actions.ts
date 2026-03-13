import { notify } from "@/lib/ops/notify";
import { randomUUID } from "node:crypto";
import { sendOpsEmail } from "@/lib/ops/email";
import { createNotionPage, updateNotionPage } from "@/lib/ops/abra-notion-write";
import { DB } from "@/lib/notion/client";

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
};

function isAutoExecutionGloballyEnabled(): boolean {
  const raw = String(process.env.ABRA_AUTO_EXEC_ENABLED || "").trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "off", "no"].includes(raw);
}

export const AUTO_EXEC_POLICIES: AutoExecPolicy[] = [
  {
    action_type: "create_brain_entry",
    max_risk_level: "low",
    min_confidence: 0.7,
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
    min_confidence: 0.7,
    daily_limit: 25,
    enabled: true,
  },
  {
    action_type: "record_transaction",
    max_risk_level: "low",
    min_confidence: 0.8,
    daily_limit: 50,
    enabled: true,
  },
  {
    action_type: "correct_claim",
    max_risk_level: "low",
    min_confidence: 0.9,
    daily_limit: 10,
    enabled: true,
  },
];

const EXTERNAL_SUBMISSION_ACTIONS = new Set([
  "send_email",
  "send_slack",
  "update_notion",
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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${typeof json === "string" ? json : JSON.stringify(json)}`,
    );
  }
  return json;
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
  const message = String(params.message || "");
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
  const to = String(params.to || "");
  const subject = String(params.subject || "Abra action");
  const body = String(params.body || params.html || params.message || "");
  if (!to || !body) {
    return { success: false, message: "Missing email recipient or body" };
  }
  await sendOpsEmail({ to, subject, body });
  return { success: true, message: `Email sent to ${to}` };
}

async function handleCreateTask(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const title = String(params.title || "").trim();
  if (!title) return { success: false, message: "Task title is required" };

  const description = String(params.description || "");
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
  const pageId = typeof params.page_id === "string" ? params.page_id : "";
  const content = typeof params.content === "string" ? params.content : undefined;
  const properties =
    params.properties && typeof params.properties === "object"
      ? (params.properties as Record<string, unknown>)
      : undefined;

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
  const title = String(params.title || "Abra Update");
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

async function handleCreateBrainEntry(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const title = String(params.title || "Action log");
  const text = String(params.text || params.content || "");
  if (!text) return { success: false, message: "Brain entry text is required" };

  const rows = (await sbFetch("/rest/v1/open_brain_entries", {
    method: "POST",
    headers: {
      Prefer: "return=representation",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_type: "agent",
      source_ref: "abra_action",
      entry_type: "system_log",
      title,
      raw_text: text,
      summary_text: text.slice(0, 500),
      category: "system_log",
      department: "executive",
      confidence: "medium",
      priority: "normal",
      processed: true,
    }),
  })) as Array<{ id: string }>;

  return {
    success: true,
    message: "Brain entry created",
    data: { entry_id: rows[0]?.id || null },
  };
}

async function handleAcknowledgeSignal(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const signalId = String(params.signal_id || "");
  if (!signalId) return { success: false, message: "signal_id is required" };

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
  return NOTION_DB_MAP[normalized] || NOTION_DB_MAP.general || "";
}

function notionUrlFromId(pageId: string): string {
  return `https://www.notion.so/${pageId.replace(/-/g, "")}`;
}

async function handleCreateNotionPage(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const dbKey = String(params.database || params.db || "general");
  const title = String(params.title || "Abra Report");
  const content = typeof params.content === "string" ? params.content : undefined;
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

async function handleRecordTransaction(
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const description = String(params.description || params.title || "Transaction");
  const amount = typeof params.amount === "number" ? params.amount : parseFloat(String(params.amount || "0"));
  const txType = String(params.type || "expense");
  const category = String(params.category || "general");
  const vendor = typeof params.vendor === "string" ? params.vendor : undefined;
  const dateStr = typeof params.date === "string" ? params.date : new Date().toISOString().split("T")[0];

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
  const originalClaim = String(params.original_claim || params.wrong || "");
  const correction = String(params.correction || params.correct || params.right || "");
  const correctedBy = String(params.corrected_by || "user");
  const department = typeof params.department === "string" ? params.department : "executive";

  if (!originalClaim || !correction) {
    return {
      success: false,
      message: "Both original_claim and correction are required",
    };
  }

  // Store as a pinned brain entry with correction + pinned tags
  const text = `CORRECTION: "${originalClaim}" is WRONG. The correct information is: "${correction}". Corrected by ${correctedBy} on ${new Date().toISOString().split("T")[0]}.`;

  const rows = (await sbFetch("/rest/v1/open_brain_entries", {
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

  // Also notify on Slack so the team knows a correction was logged
  await notify({
    channel: "alerts",
    text: `📌 *Correction Logged*\n• Wrong: "${originalClaim.slice(0, 100)}"\n• Correct: "${correction.slice(0, 100)}"\n• By: ${correctedBy}`,
  }).catch(() => {});

  return {
    success: true,
    message: `Correction pinned: "${originalClaim.slice(0, 60)}..." → "${correction.slice(0, 60)}..."`,
    data: { entry_id: rows[0]?.id || null },
  };
}

const ACTION_HANDLERS: Record<
  string,
  (params: Record<string, unknown>) => Promise<ActionResult>
> = {
  send_slack: handleSendSlack,
  send_email: handleSendEmail,
  create_task: handleCreateTask,
  update_notion: handleUpdateNotion,
  create_brain_entry: handleCreateBrainEntry,
  acknowledge_signal: handleAcknowledgeSignal,
  pause_initiative: handlePauseInitiative,
  create_notion_page: handleCreateNotionPage,
  record_transaction: handleRecordTransaction,
  correct_claim: handleCorrectClaim,
};

async function fetchApproval(approvalId: string): Promise<ApprovalRow | null> {
  const rows = (await sbFetch(
    `/rest/v1/approvals?id=eq.${approvalId}&select=id,status,action_type,created_at,batch_group,decision_reasoning,resolved_payload,proposed_payload,auto_executed&limit=1`,
  )) as ApprovalRow[];
  return rows[0] || null;
}

async function claimPendingApproval(
  approvalId: string,
): Promise<{ claimId: string; approval: ApprovalRow } | null> {
  const claimId = randomUUID();
  const rows = (await sbFetch(
    `/rest/v1/approvals?id=eq.${approvalId}&status=eq.pending&batch_group=is.null`,
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
    await sbFetch(`/rest/v1/approvals?id=eq.${params.approvalId}`, {
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
    `/rest/v1/approvals?id=eq.${params.approvalId}&status=eq.pending${claimFilter}`,
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

export async function executeAction(approvalId: string): Promise<ActionResult> {
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
