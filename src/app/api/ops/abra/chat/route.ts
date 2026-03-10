/**
 * POST /api/ops/abra/chat — Web chat endpoint for Abra
 *
 * Body: { message: string, history?: ChatMessage[] }
 * Returns: { reply: string, sources: [...], confidence: number }
 *
 * Uses temporal search + dynamic system prompt for accurate, recency-aware answers.
 */

import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@/lib/auth/config";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  canUseSupabase,
  markSupabaseFailure,
  markSupabaseSuccess,
} from "@/lib/ops/supabase-resilience";
import {
  buildAbraSystemPrompt,
  type AbraCorrection,
  type AbraDepartment,
  type AbraInitiativeContext,
  type AbraCostContext,
} from "@/lib/ops/abra-system-prompt";
import {
  detectQuestions,
  computeConfidence,
  shouldAskQuestions,
} from "@/lib/ops/abra-question-detector";
import { detectDepartment, type PlaybookQuestion } from "@/lib/ops/department-playbooks";
import {
  logAICost,
  extractClaudeUsage,
  getMonthlySpend,
  getPreferredClaudeModel,
  checkBudgetAndAlert,
} from "@/lib/ops/abra-cost-tracker";
import {
  getMarginAnalysis,
  getRevenueSnapshot,
} from "@/lib/ops/abra-financial-intel";
import { searchTiered, buildTieredContext, type TieredSearchResult } from "@/lib/ops/abra-memory-tiers";
import { logAnswer, extractProvenance } from "@/lib/ops/abra-source-provenance";
import { getTeamMembers, getVendors, buildTeamContext } from "@/lib/ops/abra-team-directory";
import { getActiveSignals, buildSignalsContext } from "@/lib/ops/abra-operational-signals";
import {
  getAvailableActions,
  proposeAndMaybeExecute,
  type AbraAction,
} from "@/lib/ops/abra-actions";
import {
  buildConversationContext,
  saveMessage,
} from "@/lib/ops/abra-chat-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DEFAULT_MATCH_COUNT = 8;
const DEFAULT_CLAUDE_MODEL =
  process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const MAX_MESSAGE_LENGTH = 4000;

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ActionDirective = {
  action: AbraAction;
  raw: string;
};

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error(
      "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}) {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  headers.set("Content-Type", "application/json");

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

function isSupabaseRelatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /supabase|rest\/v1|service_role|SUPABASE/i.test(message);
}

function sanitizeHistory(history: unknown): ChatMessage[] {
  if (!Array.isArray(history)) return [];

  return history
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object",
    )
    .map((item): ChatMessage => {
      const role: ChatMessage["role"] =
        item.role === "assistant"
          ? "assistant"
          : item.role === "system"
            ? "system"
            : "user";
      return {
        role,
        content:
          typeof item.content === "string" ? item.content.trim() : "",
      };
    })
    .filter((item) => item.content.length > 0)
    .slice(-12);
}

function normalizeActionDirective(raw: unknown): AbraAction | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const actionType =
    typeof obj.action_type === "string" ? obj.action_type.trim() : "";
  if (!actionType) return null;

  const risk =
    obj.risk_level === "low" ||
    obj.risk_level === "medium" ||
    obj.risk_level === "high" ||
    obj.risk_level === "critical"
      ? obj.risk_level
      : "medium";

  return {
    action_type: actionType,
    title:
      typeof obj.title === "string" && obj.title.trim()
        ? obj.title.trim()
        : actionType,
    description:
      typeof obj.description === "string" && obj.description.trim()
        ? obj.description.trim()
        : `Requested action: ${actionType}`,
    department:
      typeof obj.department === "string" && obj.department.trim()
        ? obj.department.trim()
        : "executive",
    risk_level: risk,
    params:
      obj.params && typeof obj.params === "object" && !Array.isArray(obj.params)
        ? (obj.params as Record<string, unknown>)
        : {},
    requires_approval: obj.requires_approval !== false,
  };
}

function parseActionDirectives(reply: string): {
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

// ─── Intent Detection (keyword-based, not LLM) ───
const INITIATIVE_TRIGGERS =
  /\b(get .+ under control|let'?s work on|build .+ structure|set up .+ department|organize .+ department|establish .+ process)\b/i;
const SESSION_TRIGGERS =
  /\b(let'?s (have a |)meet|start a (meeting|session|review)|review .+ department|how'?s .+ doing|check in on)\b/i;
const COST_TRIGGERS =
  /\b(ai spend|ai cost|how much .+ spend|budget|monthly spend|cost report)\b/i;

type DetectedIntent =
  | { type: "initiative"; department: string | null; goal: string }
  | { type: "session"; department: string | null; sessionType: string }
  | { type: "cost" }
  | { type: "chat" };

function detectIntent(message: string): DetectedIntent {
  if (COST_TRIGGERS.test(message)) {
    return { type: "cost" };
  }
  if (INITIATIVE_TRIGGERS.test(message)) {
    const department = detectDepartment(message);
    return { type: "initiative", department, goal: message };
  }
  if (SESSION_TRIGGERS.test(message)) {
    const department = detectDepartment(message);
    const sessionType = /review/i.test(message) ? "review" : "meeting";
    return { type: "session", department, sessionType };
  }
  return { type: "chat" };
}

async function fetchActiveInitiatives(): Promise<AbraInitiativeContext[]> {
  try {
    const rows = (await sbFetch(
      "/rest/v1/abra_initiatives?status=not.in.(completed,paused)&select=id,department,title,goal,status,questions,answers&order=created_at.desc&limit=5",
    )) as Array<{
      id: string;
      department: string;
      title: string | null;
      goal: string;
      status: string;
      questions: Array<{ key: string }>;
      answers: Record<string, string>;
    }>;

    return rows.map((r) => ({
      id: r.id,
      department: r.department,
      title: r.title,
      goal: r.goal,
      status: r.status,
      open_question_count: (r.questions || []).filter(
        (q) => !r.answers?.[q.key],
      ).length,
    }));
  } catch {
    return [];
  }
}

type AskingInitiative = {
  id: string;
  department: string;
  title: string | null;
  questions: PlaybookQuestion[];
  answers: Record<string, unknown>;
};

async function fetchAskingInitiative(
  department: string | null,
): Promise<AskingInitiative | null> {
  try {
    let path =
      "/rest/v1/abra_initiatives?status=eq.asking_questions&select=id,department,title,questions,answers&order=updated_at.desc&limit=5";
    if (department) {
      path += `&department=eq.${department}`;
    }

    const rows = (await sbFetch(path)) as Array<{
      id: string;
      department: string;
      title: string | null;
      questions: unknown;
      answers: unknown;
    }>;

    for (const row of rows) {
      const questions = Array.isArray(row.questions)
        ? (row.questions as PlaybookQuestion[])
        : [];
      if (!questions.length) continue;
      const answers =
        row.answers && typeof row.answers === "object"
          ? (row.answers as Record<string, unknown>)
          : {};
      const hasOpen = questions.some((q) => !valueAsText(answers[q.key], ""));
      if (hasOpen) {
        return {
          id: row.id,
          department: row.department,
          title: row.title,
          questions,
          answers,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function valueAsText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function extractInitiativeAnswers(
  message: string,
  initiative: AskingInitiative,
): Record<string, string> | null {
  const openQuestions = initiative.questions.filter(
    (question) => !valueAsText(initiative.answers[question.key], ""),
  );
  if (!openQuestions.length) return null;

  const parsed: Record<string, string> = {};
  const numbered = Array.from(
    message.matchAll(/(?:^|\n)\s*(\d+)[).:-]\s*([^\n]+)/g),
  );
  if (numbered.length > 0) {
    for (const match of numbered) {
      const index = Number.parseInt(match[1], 10) - 1;
      if (index >= 0 && index < openQuestions.length) {
        const answer = match[2].trim();
        if (answer) {
          parsed[openQuestions[index].key] = answer;
        }
      }
    }
  }

  const lines = message
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const pair = line.match(/^([^:]{2,80}):\s*(.+)$/);
    if (!pair) continue;
    const keyText = pair[1].toLowerCase().trim().replace(/\s+/g, "_");
    const answer = pair[2].trim();
    if (!answer) continue;
    const question = openQuestions.find((q) => {
      const keyMatch = q.key.toLowerCase() === keyText;
      const fuzzyMatch = q.q.toLowerCase().includes(pair[1].toLowerCase().trim());
      return keyMatch || fuzzyMatch;
    });
    if (question) {
      parsed[question.key] = answer;
    }
  }

  if (Object.keys(parsed).length === 0 && openQuestions.length === 1) {
    const fallback = message.trim();
    if (fallback.length >= 2 && fallback.length <= 500) {
      parsed[openQuestions[0].key] = fallback;
    }
  }

  if (Object.keys(parsed).length === 0) {
    return null;
  }
  return parsed;
}

async function fetchCostSummary(): Promise<AbraCostContext | null> {
  try {
    const spend = await getMonthlySpend();
    return {
      total: spend.total,
      budget: spend.budget,
      remaining: spend.remaining,
      pctUsed: spend.pctUsed,
      byProvider: spend.byProvider,
      byEndpoint: spend.byEndpoint,
    };
  } catch {
    return null;
  }
}

function isFinanceQuestion(message: string): boolean {
  return /\b(finance|financial|revenue|margin|cogs|gross profit|profitability|aov|cash flow|budget)\b/i.test(
    message,
  );
}

async function fetchFinancialContext(): Promise<string | null> {
  try {
    const [monthSnapshot, weekSnapshot, margins] = await Promise.all([
      getRevenueSnapshot("month"),
      getRevenueSnapshot("week"),
      getMarginAnalysis(),
    ]);

    const lines = [
      `Current month revenue: Shopify $${monthSnapshot.shopify_revenue.toFixed(2)}, Amazon $${monthSnapshot.amazon_revenue.toFixed(2)}, total $${monthSnapshot.total_revenue.toFixed(2)} (${monthSnapshot.order_count} orders, AOV $${monthSnapshot.avg_order_value.toFixed(2)}, ${monthSnapshot.vs_prior_period_pct >= 0 ? "+" : ""}${monthSnapshot.vs_prior_period_pct.toFixed(2)}% vs prior period).`,
      `Last 7 days revenue: total $${weekSnapshot.total_revenue.toFixed(2)} (${weekSnapshot.order_count} orders, AOV $${weekSnapshot.avg_order_value.toFixed(2)}).`,
      `Estimated gross margin: ${margins.estimated_gross_margin_pct.toFixed(2)}% with estimated COGS per unit $${margins.estimated_cogs_per_unit.toFixed(2)} (estimated gross profit $${margins.estimated_gross_profit.toFixed(2)} on revenue $${margins.revenue.toFixed(2)}).`,
    ];

    return lines.join("\n");
  } catch {
    return null;
  }
}

type CompetitorIntelRow = {
  competitor_name: string;
  data_type: string;
  title: string;
  detail: string | null;
  created_at: string;
};

const KNOWN_COMPETITORS = [
  "haribo",
  "trolli",
  "albanese",
  "sour patch",
  "black forest",
  "welch",
  "smartsweets",
  "yumearth",
  "skittles",
];

function isCompetitorQuestion(message: string): boolean {
  return /\b(competitor|competition|compete|vs\.?|pricing|promo|promotion|market share|positioning)\b/i.test(
    message,
  );
}

function extractCompetitorHint(message: string): string | null {
  const lower = message.toLowerCase();
  for (const name of KNOWN_COMPETITORS) {
    if (lower.includes(name)) return name;
  }
  const vsMatch = lower.match(/\bvs\.?\s+([a-z0-9][a-z0-9\s-]{1,40})/i);
  if (vsMatch?.[1]) return vsMatch[1].trim();
  const compMatch = lower.match(/\bcompetitor\s+([a-z0-9][a-z0-9\s-]{1,40})/i);
  if (compMatch?.[1]) return compMatch[1].trim();
  return null;
}

function inferCompetitorDataType(message: string): string {
  const lower = message.toLowerCase();
  if (/\b(price|priced|pricing|\$|cost|cheaper|expensive)\b/.test(lower)) {
    return "pricing";
  }
  if (/\b(promo|promotion|discount|coupon|sale|deal)\b/.test(lower)) {
    return "promotion";
  }
  if (/\b(review|rating|stars?|feedback)\b/.test(lower)) {
    return "review";
  }
  if (/\b(launch|flavor|sku|pack|size|ingredient|formula|product)\b/.test(lower)) {
    return "product";
  }
  return "market_position";
}

function buildCompetitorDedupeKey(params: {
  competitorName: string;
  dataType: string;
  message: string;
}): string {
  const canonical = [
    params.competitorName.toLowerCase(),
    params.dataType.toLowerCase(),
    params.message.trim().toLowerCase(),
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

function shouldCaptureCompetitorIntel(message: string): boolean {
  if (!isCompetitorQuestion(message)) return false;
  if (message.trim().length < 20) return false;
  return /\b(saw|heard|noticed|offering|launched|running|selling|priced|discount|promo|review)\b/i.test(
    message,
  );
}

async function captureCompetitorIntelFromChat(params: {
  message: string;
  userEmail: string;
  threadId: string;
}) {
  if (!shouldCaptureCompetitorIntel(params.message)) return;
  const competitorName = extractCompetitorHint(params.message);
  if (!competitorName) return;

  const title =
    params.message.length > 120
      ? `${params.message.slice(0, 117)}...`
      : params.message;
  const dataType = inferCompetitorDataType(params.message);
  const dedupeKey = buildCompetitorDedupeKey({
    competitorName,
    dataType,
    message: params.message,
  });

  try {
    await sbFetch("/rest/v1/abra_competitor_intel?on_conflict=dedupe_key", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        competitor_name: competitorName,
        data_type: dataType,
        title,
        detail: params.message,
        source: "manual",
        metadata: {
          captured_from_chat: true,
          thread_id: params.threadId,
        },
        dedupe_key: dedupeKey,
        department: "sales_and_growth",
        created_by: params.userEmail,
      }),
    });
  } catch {
    await sbFetch("/rest/v1/abra_competitor_intel", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        competitor_name: competitorName,
        data_type: dataType,
        title,
        detail: params.message,
        source: "manual",
        metadata: {
          captured_from_chat: true,
          thread_id: params.threadId,
        },
        department: "sales_and_growth",
        created_by: params.userEmail,
      }),
    });
  }
}

async function fetchCompetitorContext(message: string): Promise<string | null> {
  try {
    const hint = extractCompetitorHint(message);
    const params = new URLSearchParams({
      select: "competitor_name,data_type,title,detail,created_at",
      order: "created_at.desc",
      limit: "8",
    });
    if (hint) {
      const cleaned = hint.replace(/\*/g, "");
      params.set("competitor_name", `ilike.*${cleaned}*`);
    }

    const rows = (await sbFetch(
      `/rest/v1/abra_competitor_intel?${params.toString()}`,
    )) as CompetitorIntelRow[];
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const lines = rows.slice(0, 6).map((row, idx) => {
      const detail = row.detail ? ` — ${row.detail.slice(0, 160)}` : "";
      return `${idx + 1}. ${row.competitor_name} [${row.data_type}] ${row.title}${detail}`;
    });

    return `Recent competitor intelligence:\n${lines.join("\n")}\nUse this context in sales_and_growth recommendations and competitor comparisons.`;
  } catch {
    return null;
  }
}

async function buildEmbedding(query: string): Promise<number[]> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw new Error("OPENAI_API_KEY not configured for embeddings");
  }

  const embeddingRes = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: query,
      dimensions: 1536,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!embeddingRes.ok) {
    const errorText = await embeddingRes.text().catch(() => "");
    throw new Error(
      `Embedding generation failed (${embeddingRes.status}): ${errorText.slice(0, 200)}`,
    );
  }

  const data = await embeddingRes.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error("Failed to parse embedding vector");
  }

  return embedding as number[];
}

async function fetchCorrections(): Promise<AbraCorrection[]> {
  try {
    return (await sbFetch(
      "/rest/v1/abra_corrections?active=eq.true&order=created_at.desc&limit=10&select=original_claim,correction,corrected_by,department",
    )) as AbraCorrection[];
  } catch {
    return [];
  }
}

async function fetchDepartments(): Promise<AbraDepartment[]> {
  try {
    return (await sbFetch(
      "/rest/v1/abra_departments?select=name,owner_name,description,key_context,operating_pillar,executive_role,sub_departments,parent_department&order=name",
    )) as AbraDepartment[];
  } catch {
    return [];
  }
}

async function logUnansweredQuestion(
  question: string,
  askedBy: string,
  context: string,
) {
  try {
    await sbFetch("/rest/v1/abra_unanswered_questions", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question,
        asked_by: askedBy,
        context: context.slice(0, 500),
      }),
    });
  } catch {
    // Best-effort
  }
}

function buildConversation(history: ChatMessage[]): string {
  if (!history.length) return "";
  return history
    .slice(-6)
    .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
    .join("\n");
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function makeThreadId(): string {
  return crypto.randomUUID();
}

function queueChatHistory(params: {
  threadId: string;
  userEmail: string;
  userMessage: string;
  assistantMessage: string;
  modelUsed?: string;
  metadata?: Record<string, unknown>;
}) {
  if (!isUuidLike(params.threadId)) return;
  void saveMessage({
    thread_id: params.threadId,
    role: "user",
    content: params.userMessage,
    user_email: params.userEmail,
  }).catch(() => {});

  void saveMessage({
    thread_id: params.threadId,
    role: "assistant",
    content: params.assistantMessage,
    model_used: params.modelUsed,
    metadata: params.metadata || {},
    user_email: params.userEmail,
  }).catch(() => {});
}

async function generateClaudeReply(input: {
  message: string;
  history: ChatMessage[];
  tieredResults: TieredSearchResult;
  corrections: AbraCorrection[];
  departments: AbraDepartment[];
  activeInitiatives?: AbraInitiativeContext[];
  costSummary?: AbraCostContext | null;
  financialContext?: string | null;
  competitorContext?: string | null;
  teamContext?: string;
  signalsContext?: string;
  availableActions?: string[];
  detectedDepartment?: string | null;
}): Promise<{
  reply: string;
  modelUsed: string;
  confidence: number;
  sources: Array<never>;
  usage: { inputTokens: number; outputTokens: number };
  earlyExit?: boolean;
}> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  const selectedModel = await getPreferredClaudeModel(DEFAULT_CLAUDE_MODEL);

  const systemPrompt = buildAbraSystemPrompt({
    format: "web",
    corrections: input.corrections,
    departments: input.departments,
    conversationDepartment: input.detectedDepartment || null,
    activeInitiatives: input.activeInitiatives,
    costSummary: input.costSummary,
    financialContext: input.financialContext,
    competitorContext: input.competitorContext,
    teamContext: input.teamContext,
    signalsContext: input.signalsContext,
  });
  const actionInstructions =
    input.availableActions && input.availableActions.length > 0
      ? `\n\nAvailable actions: ${input.availableActions.join(", ")}.\nIf action is needed, append exactly one block like:\n<action>{"action_type":"send_slack","title":"...","description":"...","department":"executive","risk_level":"low","requires_approval":true,"params":{"channel":"alerts","message":"..."}}</action>`
      : "";

  const historyText = buildConversation(input.history);
  const contextText = buildTieredContext(input.tieredResults);
  const confidence = computeConfidence(input.tieredResults.all);
  const normalizedConfidence = confidence / 100;
  if (normalizedConfidence < 0.2 && input.tieredResults.all.length < 2) {
    return {
      reply:
        "I don't have enough information to answer that confidently. Could you teach me? Use the format: `teach: [topic] - [what I should know]`",
      sources: [],
      confidence,
      modelUsed: selectedModel,
      usage: { inputTokens: 0, outputTokens: 0 },
      earlyExit: true,
    };
  }

  const confidenceHint =
    shouldAskQuestions(confidence, input.tieredResults.all)
      ? "\n\nIMPORTANT: Your confidence for this query is LOW. Consider asking the user to confirm or provide more information rather than guessing."
      : "";

  const userPrompt = [
    historyText ? `Recent conversation:\n${historyText}` : "",
    `User question:\n${input.message}`,
    `Retrieved context:\n${contextText}${confidenceHint}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const maxTokens = selectedModel.includes("haiku") ? 500 : 900;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: selectedModel,
      max_tokens: maxTokens,
      temperature: 0.2,
      system: `${systemPrompt}${actionInstructions}`,
      messages: [{ role: "user", content: userPrompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  const text = await res.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }

  if (!res.ok) {
    throw new Error(
      `Claude API failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  // Log cost
  const usage = extractClaudeUsage(payload);
  if (usage) {
    void logAICost({
      model: selectedModel,
      provider: "anthropic",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      endpoint: "chat",
      department: input.detectedDepartment || undefined,
    });
    void checkBudgetAndAlert().catch(() => {});
  }

  const content = Array.isArray(payload.content)
    ? payload.content
    : [];
  const reply = content
    .map((item) =>
      item && typeof item === "object" && "text" in item
        ? String(item.text || "")
        : "",
    )
    .join("\n")
    .trim();

  if (!reply) {
    throw new Error("Claude returned an empty response");
  }

  return {
    reply,
    modelUsed: selectedModel,
    confidence,
    sources: [],
    usage: usage || { inputTokens: 0, outputTokens: 0 },
  };
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await auth();
  const actorEmail = session?.user?.email || "cron@system";

  let payload: { message?: unknown; history?: unknown; thread_id?: unknown } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  const message =
    typeof payload.message === "string"
      ? payload.message.replaceAll("\0", "").trim()
      : "";
  if (!message) {
    return NextResponse.json(
      { error: "message is required" },
      { status: 400 },
    );
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      {
        error: `message exceeds max length (${MAX_MESSAGE_LENGTH} chars)`,
      },
      { status: 400 },
    );
  }

  const history = sanitizeHistory(payload.history);
  const requestedThreadId =
    typeof payload.thread_id === "string" ? payload.thread_id.trim() : "";
  const threadId =
    requestedThreadId && isUuidLike(requestedThreadId)
      ? requestedThreadId
      : makeThreadId();
  const messageDepartment = detectDepartment(message);

  try {
    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      return NextResponse.json(
        {
          error:
            "Supabase dependency is temporarily unavailable (circuit open)",
          circuitOpen: true,
          cooldownUntil: circuitCheck.state.cooldownUntil,
        },
        { status: 503 },
      );
    }
    void captureCompetitorIntelFromChat({
      message,
      userEmail: actorEmail,
      threadId,
    }).catch(() => {});

    let effectiveHistory = history;
    if (isUuidLike(threadId)) {
      try {
        const stored = await buildConversationContext(threadId, 12);
        if (stored.length > 0) {
          effectiveHistory = stored;
        }
      } catch {
        // Best-effort: fall back to client-provided history.
      }
    }

    // ─── Intent Detection ───
    const intent = detectIntent(message);

    // Handle cost query shortcut
    if (intent.type === "cost") {
      const spend = await getMonthlySpend();
      const costReply = `**AI Spend Report (${new Date().toISOString().slice(0, 7)})**\n\n` +
        `• Total: **$${spend.total.toFixed(2)}** / $${spend.budget}\n` +
        `• Remaining: $${spend.remaining.toFixed(2)} (${spend.pctUsed}% used)\n` +
        `• API calls: ${spend.callCount}\n` +
        (Object.keys(spend.byEndpoint).length > 0
          ? `• By endpoint: ${Object.entries(spend.byEndpoint).map(([k, v]) => `${k}: $${(Number(v) || 0).toFixed(2)}`).join(", ")}\n`
          : "") +
        (Object.keys(spend.byProvider).length > 0
          ? `• By provider: ${Object.entries(spend.byProvider).map(([k, v]) => `${k}: $${(Number(v) || 0).toFixed(2)}`).join(", ")}`
          : "");

      queueChatHistory({
        threadId,
        userEmail: actorEmail,
        userMessage: message,
        assistantMessage: costReply,
        metadata: { intent: "cost" },
      });
      return NextResponse.json({
        reply: costReply,
        confidence: 1,
        sources: [],
        intent: "cost",
        thread_id: threadId,
      });
    }

    // If there is an active initiative in question phase and this message looks
    // like answers, auto-route to initiative PATCH flow.
    const initiativeDepartmentHint = messageDepartment;
    const activeAskingInitiative = await fetchAskingInitiative(
      initiativeDepartmentHint,
    );
    const extractedAnswers = activeAskingInitiative
      ? extractInitiativeAnswers(message, activeAskingInitiative)
      : null;

    if (activeAskingInitiative && extractedAnswers) {
      const host =
        process.env.NEXTAUTH_URL ||
        (process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : "http://localhost:3000");
      const cookie = req.headers.get("cookie") || "";

      try {
        const patchRes = await fetch(`${host}/api/ops/abra/initiative`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookie,
          },
          body: JSON.stringify({
            id: activeAskingInitiative.id,
            answers: extractedAnswers,
          }),
          signal: AbortSignal.timeout(20000),
        });

        if (patchRes.ok) {
          const patchData = await patchRes.json();
          const updated =
            patchData?.initiative && typeof patchData.initiative === "object"
              ? (patchData.initiative as {
                  id: string;
                  title?: string | null;
                  status?: string;
                  questions?: PlaybookQuestion[];
                  answers?: Record<string, unknown>;
                  tasks?: Array<{ title?: string; priority?: string }>;
                  kpis?: Array<{ metric?: string; target?: string }>;
                })
              : null;

          if (updated?.status === "approved") {
            const topTasks = Array.isArray(updated.tasks)
              ? updated.tasks
                  .slice(0, 5)
                  .map((task, idx) => {
                    const label =
                      typeof task?.title === "string"
                        ? task.title
                        : `Task ${idx + 1}`;
                    const priority =
                      typeof task?.priority === "string"
                        ? ` [${task.priority}]`
                        : "";
                    return `${idx + 1}. ${label}${priority}`;
                  })
                  .join("\n")
              : "";
            const topKpis = Array.isArray(updated.kpis)
              ? updated.kpis
                  .slice(0, 4)
                  .map((kpi) => {
                    if (typeof kpi === "string") return `- ${kpi}`;
                    const metric =
                      typeof kpi?.metric === "string" ? kpi.metric : "kpi";
                    const target =
                      typeof kpi?.target === "string" ? kpi.target : "";
                    return target ? `- ${metric}: ${target}` : `- ${metric}`;
                  })
                  .join("\n")
              : "";

            const approvedReply = [
              `Initiative **${updated.title || activeAskingInitiative.title || "plan"}** is now approved.`,
              topTasks ? `Top tasks:\n${topTasks}` : "",
              topKpis ? `KPI targets:\n${topKpis}` : "",
            ]
              .filter(Boolean)
              .join("\n\n");

            queueChatHistory({
              threadId,
              userEmail: actorEmail,
              userMessage: message,
              assistantMessage: approvedReply,
              metadata: {
                intent: "initiative_answers",
                initiative_id: updated.id || activeAskingInitiative.id,
              },
            });
            return NextResponse.json({
              reply: approvedReply,
              confidence: 1,
              sources: [],
              intent: "initiative_answers",
              initiative_id: updated.id || activeAskingInitiative.id,
              plan: patchData?.plan || null,
              thread_id: threadId,
            });
          }

          const questions = Array.isArray(updated?.questions)
            ? (updated?.questions as PlaybookQuestion[])
            : activeAskingInitiative.questions;
          const answers =
            updated?.answers && typeof updated.answers === "object"
              ? (updated.answers as Record<string, unknown>)
              : activeAskingInitiative.answers;
          const openQuestions = questions.filter(
            (question) => !valueAsText(answers[question.key], ""),
          );
          const questionList = openQuestions
            .slice(0, 5)
            .map((question, idx) => `${idx + 1}. ${question.q}`)
            .join("\n");
          const followupReply =
            openQuestions.length > 0
              ? `Captured those answers for **${updated?.title || activeAskingInitiative.title || "your initiative"}**. I still need:\n\n${questionList}`
              : `Captured those answers for **${updated?.title || activeAskingInitiative.title || "your initiative"}**.`;

          queueChatHistory({
            threadId,
            userEmail: actorEmail,
            userMessage: message,
            assistantMessage: followupReply,
            metadata: {
              intent: "initiative_answers",
              initiative_id: updated?.id || activeAskingInitiative.id,
            },
          });
          return NextResponse.json({
            reply: followupReply,
            confidence: 1,
            sources: [],
            intent: "initiative_answers",
            initiative_id: updated?.id || activeAskingInitiative.id,
            plan: patchData?.plan || null,
            thread_id: threadId,
          });
        }
      } catch {
        // If patch route fails, continue with standard intent handling.
      }
    }

    // Handle initiative trigger — redirect to initiative flow
    if (intent.type === "initiative") {
      const host =
        process.env.NEXTAUTH_URL ||
        (process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : "http://localhost:3000");
      const cookie = req.headers.get("cookie") || "";

      try {
        const initRes = await fetch(`${host}/api/ops/abra/initiative`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookie,
          },
          body: JSON.stringify({
            department: intent.department,
            goal: intent.goal,
          }),
          signal: AbortSignal.timeout(28000),
        });

        if (initRes.ok) {
          const initData = await initRes.json();
          const questions = Array.isArray(initData.questions)
            ? initData.questions
            : [];
          const qList = questions
            .slice(0, 5)
            .map(
              (q: { q: string; default?: string; options?: string[] }, i: number) =>
                `${i + 1}. ${q.q}${q.default ? ` (default: ${q.default})` : ""}${q.options ? ` [${q.options.join(", ")}]` : ""}`,
            )
            .join("\n");

          const initReply =
            `I've started a new **${initData.department}** initiative: **${initData.title}**\n\n` +
            `I've done some research and identified the baseline requirements. Now I need to ask you some questions to customize the plan:\n\n${qList}\n\n` +
            `You can answer these questions here, or I can use the defaults and generate a plan right away.`;

          queueChatHistory({
            threadId,
            userEmail: actorEmail,
            userMessage: message,
            assistantMessage: initReply,
            metadata: {
              intent: "initiative",
              initiative_id: initData.id,
            },
          });
          return NextResponse.json({
            reply: initReply,
            confidence: 1,
            sources: [],
            intent: "initiative",
            initiative_id: initData.id,
            thread_id: threadId,
          });
        }
      } catch {
        // Fall through to normal chat if initiative creation fails
      }
    }

    // Handle session trigger
    if (intent.type === "session") {
      const host =
        process.env.NEXTAUTH_URL ||
        (process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : "http://localhost:3000");
      const cookie = req.headers.get("cookie") || "";

      try {
        const sessRes = await fetch(`${host}/api/ops/abra/session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookie,
          },
          body: JSON.stringify({
            department: intent.department,
            session_type: intent.sessionType,
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (sessRes.ok) {
          const sessData = await sessRes.json();
          const agenda = Array.isArray(sessData.agenda) ? sessData.agenda : [];
          const agendaList = agenda
            .map((a: string, i: number) => `${i + 1}. ${a}`)
            .join("\n");

          const sessReply =
            `**${sessData.title}** — ${sessData.session_type} started\n\n` +
            `**Agenda:**\n${agendaList}\n\n` +
            `Let's work through these items. What would you like to start with?`;

          queueChatHistory({
            threadId,
            userEmail: actorEmail,
            userMessage: message,
            assistantMessage: sessReply,
            metadata: {
              intent: "session",
              session_id: sessData.id,
            },
          });
          return NextResponse.json({
            reply: sessReply,
            confidence: 1,
            sources: [],
            intent: "session",
            session_id: sessData.id,
            thread_id: threadId,
          });
        }
      } catch {
        // Fall through to normal chat
      }
    }

    // ─── Normal RAG Chat Flow ───
    // Tiered memory search (hot/warm/cold with fallback)
    const embedding = await buildEmbedding(message);
    const tieredResults = await searchTiered({
      embedding,
      matchCount: DEFAULT_MATCH_COUNT,
      filterTables: ["brain", "email"],
    });

    await markSupabaseSuccess();

    // Fetch corrections + departments + initiatives + cost + team + signals (parallel)
    const [corrections, departments, activeInitiatives, costSummary, teamMembers, vendors, signals] =
      await Promise.all([
        fetchCorrections(),
        fetchDepartments(),
        fetchActiveInitiatives(),
        fetchCostSummary(),
        getTeamMembers(),
        getVendors(),
        getActiveSignals({ limit: 5 }),
      ]);
    const financialContext = isFinanceQuestion(message)
      ? await fetchFinancialContext()
      : null;
    const competitorContext =
      isCompetitorQuestion(message) || messageDepartment === "sales_and_growth"
        ? await fetchCompetitorContext(message)
        : null;

    // Build dynamic context strings for system prompt
    const today = new Date().toISOString().split("T")[0];
    const teamContext = buildTeamContext(teamMembers, vendors, today);
    const signalsContext = buildSignalsContext(signals);

    const availableActions = getAvailableActions();

    const claudeResult = await generateClaudeReply({
      message,
      history: effectiveHistory,
      tieredResults,
      corrections,
      departments,
      activeInitiatives,
      costSummary,
      financialContext,
      competitorContext,
      teamContext,
      signalsContext,
      availableActions,
      detectedDepartment: messageDepartment,
    });
    const actionNotices: string[] = [];
    let baseReply = claudeResult.reply;
    if (!claudeResult.earlyExit) {
      const parsedActions = parseActionDirectives(claudeResult.reply);
      baseReply = parsedActions.cleanReply || claudeResult.reply;
      for (const directive of parsedActions.actions.slice(0, 3)) {
        try {
          const outcome = await proposeAndMaybeExecute(directive.action);
          if (outcome.auto_executed) {
            actionNotices.push(
              `Done: auto-executed \`${directive.action.action_type}\` (${outcome.approval_id}).`,
            );
          } else {
            actionNotices.push(
              `Queued for approval: \`${directive.action.action_type}\` (${outcome.approval_id}).`,
            );
          }
        } catch (error) {
          actionNotices.push(
            `Failed to queue action \`${directive.action.action_type}\`: ${error instanceof Error ? error.message : "unknown error"}`,
          );
        }
      }
    }

    const reply = [
      baseReply,
      actionNotices.length > 0 ? actionNotices.join("\n") : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const seenIds = new Set<string>();
    const uniqueSources = tieredResults.all.filter((row) => {
      const sourceKey =
        row.id ||
        `${row.source_table}:${row.title || ""}:${(row.summary_text || row.raw_text || "").slice(0, 50)}`;
      if (seenIds.has(sourceKey)) return false;
      seenIds.add(sourceKey);
      return true;
    });

    const responseSources = claudeResult.earlyExit ? [] : uniqueSources;
    const confidence = claudeResult.confidence;

    // Log answer provenance (best-effort, non-blocking)
    const provenance = extractProvenance(responseSources);
    void logAnswer({
      question: message,
      answer: reply,
      source_ids: provenance.source_ids,
      source_tables: provenance.source_tables,
      confidence,
      memory_tiers_used: provenance.memory_tiers_used,
      department: messageDepartment,
      asked_by: actorEmail,
      channel: "web",
      model_used: claudeResult.modelUsed,
    });

    // Log unanswered questions
    const detectedQuestions = detectQuestions(reply);
    if (
      detectedQuestions.length > 0 ||
      shouldAskQuestions(confidence, tieredResults.all)
    ) {
      for (const q of detectedQuestions.slice(0, 3)) {
        await logUnansweredQuestion(
          q,
          actorEmail,
          `Original question: ${message}`,
        );
      }
    }

    queueChatHistory({
      threadId,
      userEmail: actorEmail,
      userMessage: message,
      assistantMessage: reply,
      modelUsed: claudeResult.modelUsed,
      metadata: {
        confidence,
        tier_counts: tieredResults.tierCounts,
      },
    });

    return NextResponse.json({
      reply,
      confidence,
      thread_id: threadId,
      tierCounts: tieredResults.tierCounts,
      sources: responseSources.map((row) => ({
        id: row.id,
        source_table: row.source_table,
        title: row.title || "(untitled)",
        similarity: row.similarity,
        temporal_score: row.temporal_score,
        days_ago: row.days_ago,
        category: row.category,
        department: row.department,
        memory_tier: row.memory_tier,
        metadata: row.metadata || {},
      })),
      actions: actionNotices,
    });
  } catch (error) {
    if (isSupabaseRelatedError(error)) {
      await markSupabaseFailure(error);
    }

    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
