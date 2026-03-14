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
  getCalendarMonthRevenue,
  getMarginAnalysis,
  getRevenueSnapshot,
} from "@/lib/ops/abra-financial-intel";
import { searchTiered, searchWithTemporalAwareness, buildTieredContext, type TieredSearchResult } from "@/lib/ops/abra-memory-tiers";
import { logAnswer, extractProvenance } from "@/lib/ops/abra-source-provenance";
import { getTeamMembers, getVendors, buildTeamContext } from "@/lib/ops/abra-team-directory";
import { getActiveSignals, buildSignalsContext } from "@/lib/ops/abra-operational-signals";
import {
  getAvailableActions,
  proposeAndMaybeExecute,
  type AbraAction,
} from "@/lib/ops/abra-actions";
import { analyzePipeline } from "@/lib/ops/abra-pipeline-intelligence";
import {
  buildConversationContext,
  saveMessage,
} from "@/lib/ops/abra-chat-history";
import { buildCrossDepartmentStrategy } from "@/lib/ops/abra-strategy-orchestrator";
import { getSystemHealth } from "@/lib/ops/abra-health-monitor";

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

function buildHealthModeReply(message: string): string {
  const normalized = message.toLowerCase();
  if (/\b(what|sell|product|products|gummies)\b/.test(normalized)) {
    return "USA Gummies sells dye-free gummy candy, gift bundles, and wholesale-ready assortments across DTC, Amazon, and wholesale channels.";
  }
  if (/\b(cost|spend|budget)\b/.test(normalized)) {
    return "Abra health mode is online. Use a normal chat request for a full cost breakdown.";
  }
  return "Abra is online. Health mode is responding and authenticated.";
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
const PIPELINE_TRIGGERS =
  /\b(sales pipeline|pipeline health|pipeline status|b2b pipeline|b2b deals?|wholesale deals?|pipeline deals?|active deals?|deal(s| ) (status|details|breakdown)|show .+ pipeline|what deals|which deals|which companies .+ pipeline|who .+ in .+ pipeline|pipeline summary|deal pipeline|b2b prospects?|top .+ deals?|prospects? by .+ value|biggest deals?|largest deals?|deal value)\b/i;
const STRATEGY_TRIGGERS =
  /\b(strategy|strategic plan|financial plan|budget plan|amazon ad strategy|amazon ads strategy|ppc strategy|campaign strategy)\b/i;
const DIAGNOSTICS_TRIGGERS =
  /\b(diagnos|self.?check|what'?s broken|are you (working|ok|healthy)|system health|feed status|check yourself|run diagnostics)\b/i;

type DetectedIntent =
  | { type: "initiative"; department: string | null; goal: string }
  | { type: "session"; department: string | null; sessionType: string }
  | { type: "cost" }
  | { type: "pipeline" }
  | { type: "strategy"; objective: string; department: string | null }
  | { type: "diagnostics" }
  | { type: "chat" };

function detectIntent(message: string): DetectedIntent {
  if (DIAGNOSTICS_TRIGGERS.test(message)) {
    return { type: "diagnostics" };
  }
  if (COST_TRIGGERS.test(message)) {
    return { type: "cost" };
  }
  if (PIPELINE_TRIGGERS.test(message)) {
    return { type: "pipeline" };
  }
  if (STRATEGY_TRIGGERS.test(message)) {
    const department = detectDepartment(message);
    return { type: "strategy", objective: message, department };
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
  return /\b(finance|financial|revenue|margin|cogs|gross profit|profitability|aov|cash flow|budget|money|sales|orders|income|expenses|spending|p&l|profit|loss)\b/i.test(
    message,
  );
}

/**
 * Fetch a real-time snapshot of today's business activity.
 * Runs on EVERY chat to ensure Abra always has current data.
 * Lightweight — only fetches summary counts, not full payloads.
 */
async function fetchLiveBusinessSnapshot(): Promise<string | null> {
  const lines: string[] = [];
  const today = new Date().toISOString().split("T")[0];

  // 1. Shopify orders (last 24h) — lightweight REST call
  try {
    const shopifyDomain = process.env.SHOPIFY_STORE || process.env.SHOPIFY_STORE_DOMAIN;
    const shopifyToken = process.env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    const shopifyVersion = process.env.SHOPIFY_API_VERSION || "2024-10";
    if (shopifyDomain && shopifyToken) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const url = `https://${shopifyDomain}/admin/api/${shopifyVersion}/orders.json?status=any&created_at_min=${since}&limit=250`;
      const res = await fetch(url, {
        headers: { "X-Shopify-Access-Token": shopifyToken, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        const orders = Array.isArray(data.orders) ? data.orders as Array<{ name?: string; total_price?: string; created_at?: string; financial_status?: string; fulfillment_status?: string | null; customer?: { first_name?: string; last_name?: string }; line_items?: Array<{ title?: string; quantity?: number }> }> : [];
        if (orders.length > 0) {
          const totalRev = orders.reduce((s, o) => s + parseFloat(o.total_price || "0"), 0);
          const unfulfilled = orders.filter(o => !o.fulfillment_status || o.fulfillment_status === "null").length;
          lines.push(`LIVE SHOPIFY (last 24h, as of ${today}): ${orders.length} orders, $${totalRev.toFixed(2)} revenue, ${unfulfilled} unfulfilled.`);
          // Show most recent 5 orders
          const recent = orders.slice(0, 5);
          for (const o of recent) {
            const items = (o.line_items || []).map(li => `${li.quantity}x ${li.title}`).join(", ");
            const custName = [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ") || "Guest";
            lines.push(`  • ${o.name}: $${o.total_price} from ${custName} — ${items} (${o.financial_status || "pending"}, ${o.fulfillment_status || "unfulfilled"})`);
          }
          if (orders.length > 5) lines.push(`  ... and ${orders.length - 5} more orders.`);
        } else {
          lines.push(`LIVE SHOPIFY (last 24h): No orders.`);
        }
      }
    }
  } catch { /* non-fatal */ }

  // 2. Recent emails (last 5 inbox subjects) — lightweight metadata only
  try {
    const gmailUser = process.env.GMAIL_USER || process.env.GMAIL_SENDER;
    const gmailClientId = process.env.GMAIL_CLIENT_ID;
    const gmailRefreshToken = process.env.GMAIL_REFRESH_TOKEN;
    if (gmailUser && gmailClientId && gmailRefreshToken) {
      // Dynamic import to avoid loading googleapis on every request
      const { listEmails } = await import("@/lib/ops/gmail-reader");
      const envelopes = await listEmails({ count: 8, folder: "INBOX" });
      if (envelopes.length > 0) {
        lines.push(`LIVE INBOX (${envelopes.length} most recent):`);
        for (const e of envelopes.slice(0, 8)) {
          const age = e.date ? `${Math.round((Date.now() - new Date(e.date).getTime()) / 3600000)}h ago` : "";
          lines.push(`  • From: ${e.from} — "${e.subject}" (${age})`);
        }
      }
    }
  } catch { /* non-fatal */ }

  return lines.length > 0 ? lines.join("\n") : null;
}

async function fetchFinancialContext(): Promise<string | null> {
  try {
    const [calMonth, weekSnapshot] = await Promise.all([
      getCalendarMonthRevenue(),
      getRevenueSnapshot("week"),
    ]);

    // Guard: if both sources return zero data, treat as unavailable
    if (calMonth.days_with_data === 0 && weekSnapshot.order_count === 0) {
      console.log("[abra] Financial context: both KPI sources returned zero data");
      return null;
    }

    const lines = [
      `${calMonth.month} calendar month revenue (${calMonth.days_with_data} days of data): Shopify $${calMonth.shopify_revenue.toFixed(2)} (${calMonth.shopify_orders} orders), Amazon $${calMonth.amazon_revenue.toFixed(2)} (${calMonth.amazon_orders} orders), TOTAL $${calMonth.total_revenue.toFixed(2)} (${calMonth.total_orders} orders, AOV $${calMonth.avg_order_value.toFixed(2)}).`,
      `Last 7 days revenue: total $${weekSnapshot.total_revenue.toFixed(2)} (${weekSnapshot.order_count} orders, AOV $${weekSnapshot.avg_order_value.toFixed(2)}).`,
    ];

    return lines.join("\n");
  } catch (err) {
    console.error("[abra] Financial context fetch failed:", err instanceof Error ? err.message : err);
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
  liveSnapshot?: string | null;
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
      ? `\n\nACTION EXECUTION SYSTEM (YOU MUST USE THIS):
You have REAL action capabilities. Available actions: ${input.availableActions.join(", ")}.

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
• "create a P&L breakdown" → create the table in your response AND emit create_notion_page to persist it
• "those numbers are wrong, it was actually $X" → emit correct_claim with original_claim and correction
• "set up QuickBooks" → This is OUTSIDE your actions, so explain what's needed and offer to create_task or send_slack about it.

DATABASE KEYS for create_notion_page: meeting_notes, b2b_prospects, distributor_prospects, daily_performance, fleet_ops, inventory, sku_registry, cash_transactions, content_drafts, kpis, general

Some actions auto-execute (create_brain_entry, acknowledge_signal, create_notion_page, record_transaction, create_task, correct_claim). Others queue for approval (send_email, send_slack). Either way — EMIT the action block.

FINANCIAL INTEGRITY REMINDER (applies to EVERY response):
• Every dollar figure you state MUST have a [source: ...] citation. No exceptions.
• If the user corrects a number, STOP, acknowledge the error, ask for the right figure. Never defend wrong data.
• "I don't have verified data for that" is always acceptable. A wrong number is never acceptable.`
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
    input.liveSnapshot ? `LIVE BUSINESS DATA (real-time, as of right now):\n${input.liveSnapshot}` : "",
    historyText ? `Recent conversation:\n${historyText}` : "",
    `User question:\n${input.message}`,
    `Retrieved context:\n${contextText}${confidenceHint}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const maxTokens = selectedModel.includes("haiku") ? 3000 : 6000;
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
      system: `${actionInstructions}\n\n${systemPrompt}`,
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
  const url = new URL(req.url);
  const mode = (url.searchParams.get("mode") || "").toLowerCase();
  const healthMode = mode === "health" || mode === "quick";

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

  if (healthMode) {
    const reply = buildHealthModeReply(message);
    queueChatHistory({
      threadId,
      userEmail: actorEmail,
      userMessage: message,
      assistantMessage: reply,
      metadata: { intent: "health_mode" },
    });
    return NextResponse.json({
      reply,
      confidence: 1,
      sources: [],
      intent: "health_mode",
      thread_id: threadId,
      mode: "health",
    });
  }

  try {
    // Circuit breaker check — if Supabase is down, we'll skip memory search
    // but still serve the chat with live data feeds (graceful degradation)
    const circuitCheck = await canUseSupabase();
    const supabaseCircuitOpen = !circuitCheck.allowed;
    if (supabaseCircuitOpen) {
      console.log("[abra] Supabase circuit open — will skip memory search, continuing with live data only");
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

    if (intent.type === "pipeline") {
      const summary = await analyzePipeline();
      const allDeals = summary.all_active_deals || [];

      // Group deals by stage WITH company names
      const stageMap = new Map<string, typeof allDeals>();
      for (const deal of allDeals) {
        const stage = deal.stage || "unknown";
        if (!stageMap.has(stage)) stageMap.set(stage, []);
        stageMap.get(stage)!.push(deal);
      }

      const stageLines = Array.from(stageMap.entries())
        .sort((a, b) => {
          const valA = a[1].reduce((s, d) => s + d.value, 0);
          const valB = b[1].reduce((s, d) => s + d.value, 0);
          return valB - valA;
        })
        .slice(0, 8)
        .map(([stage, deals]) => {
          const label = stage.replaceAll("_", " ");
          const totalValue = deals.reduce((s, d) => s + d.value, 0);
          const dealList = deals
            .slice(0, 5)
            .map((d) => `  → ${d.company_name}: $${d.value.toFixed(2)} (${d.days_in_stage}d in stage)`)
            .join("\n");
          return `• **${label}**: ${deals.length} deal${deals.length !== 1 ? "s" : ""} ($${totalValue.toFixed(2)})\n${dealList}`;
        })
        .join("\n");

      const atRiskLine =
        summary.at_risk_deals.length > 0
          ? summary.at_risk_deals
              .slice(0, 5)
              .map((deal) => `  → ${deal.company_name}: $${deal.value.toFixed(2)} (${deal.stage}, ${deal.days_in_stage}d stale)`)
              .join("\n")
          : "None";

      const noDeals = allDeals.length === 0;
      const pipelineReply = noDeals
        ? "**Sales Pipeline Snapshot**\n\nNo active deals found in the pipeline. Deals are tracked in the B2B Prospects and Distributor Prospects databases in Notion, and synced to Supabase."
        : [
            "**Sales Pipeline Snapshot**",
            `• Total pipeline value: **$${summary.total_pipeline_value.toFixed(2)}**`,
            `• Active deals: **${allDeals.length}**`,
            `• Win rate (30d): ${summary.win_rate_30d.toFixed(1)}%`,
            `• Avg deal cycle: ${summary.avg_deal_cycle_days.toFixed(1)} days`,
            stageLines ? `\n**Deals by stage**\n${stageLines}` : "",
            `\n**At-risk deals**\n${atRiskLine}`,
            `\n_All data sourced from Notion B2B/Distributor databases and Supabase deal records._`,
          ]
            .filter(Boolean)
            .join("\n");

      queueChatHistory({
        threadId,
        userEmail: actorEmail,
        userMessage: message,
        assistantMessage: pipelineReply,
        metadata: { intent: "pipeline" },
      });

      return NextResponse.json({
        reply: pipelineReply,
        confidence: 1,
        sources: [],
        intent: "pipeline",
        thread_id: threadId,
      });
    }

    if (intent.type === "diagnostics") {
      let healthReport: string;
      try {
        const health = await getSystemHealth();
        const integrationLines = health.integrations.length > 0
          ? health.integrations
              .map((i) => `| ${i.system_name} | ${i.connection_status} | ${i.last_success_at?.slice(0, 16) || "never"} | ${i.error_summary || "—"} |`)
              .join("\n")
          : "| No integrations tracked | — | — | — |";

        const feedLines = health.feeds.feeds.length > 0
          ? health.feeds.feeds
              .map((f) => `| ${f.feed_key} | ${f.is_active ? "active" : "disabled"} | ${f.last_run_at?.slice(0, 16) || "never"} | ${f.last_status || "—"} | ${f.consecutive_failures} |`)
              .join("\n")
          : "| No feeds configured | — | — | — | — |";

        const deadLetterLines = health.feeds.dead_letters.length > 0
          ? health.feeds.dead_letters
              .slice(0, 5)
              .map((d) => `• ${d.feed_key}: ${d.error_message || "unknown error"} (${d.created_at?.slice(0, 16) || "?"})`)
              .join("\n")
          : "None";

        healthReport = [
          "**Abra System Diagnostics**",
          "",
          "**Integrations**",
          "| System | Status | Last Success | Error |",
          "|--------|--------|-------------|-------|",
          integrationLines,
          "",
          "**Auto-Teach Feeds**",
          `| Feed | Status | Last Run | Result | Failures |`,
          `|------|--------|----------|--------|----------|`,
          feedLines,
          "",
          `**Summary**: ${health.uptime.healthy} healthy, ${health.uptime.degraded} degraded, ${health.uptime.down} down`,
          `• Total feeds: ${health.feeds.total_feeds} (${health.feeds.active} active, ${health.feeds.disabled} disabled)`,
          `• Unresolved dead letters: ${health.feeds.unresolved_dead_letters}`,
          "",
          health.feeds.dead_letters.length > 0 ? `**Dead Letters**\n${deadLetterLines}` : "",
          "",
          `_Last checked: ${health.last_checked}_`,
        ].filter(Boolean).join("\n");
      } catch (err) {
        healthReport = `**Abra System Diagnostics**\n\nFailed to retrieve health data: ${err instanceof Error ? err.message : "unknown error"}`;
      }

      queueChatHistory({
        threadId,
        userEmail: actorEmail,
        userMessage: message,
        assistantMessage: healthReport,
        metadata: { intent: "diagnostics" },
      });
      return NextResponse.json({
        reply: healthReport,
        confidence: 1,
        sources: [],
        intent: "diagnostics",
        thread_id: threadId,
      });
    }

    if (intent.type === "strategy") {
      const host =
        process.env.NEXTAUTH_URL ||
        (process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : "http://localhost:3000");
      const cookie = req.headers.get("cookie") || "";

      const strategy = await buildCrossDepartmentStrategy({
        objective: intent.objective,
        topic: intent.department,
        depth: "quick",
        host,
        cookieHeader: cookie,
        actorEmail,
      });

      const deptLines = strategy.departments
        .slice(0, 8)
        .map((dept) => `• ${dept.department}: ${dept.actions.slice(0, 2).join(" | ")}`)
        .join("\n");
      const financialLines = strategy.financial_controls
        .slice(0, 5)
        .map((line) => `• ${line}`)
        .join("\n");
      const kpiLines = strategy.kpi_guardrails
        .slice(0, 5)
        .map((line) => `• ${line}`)
        .join("\n");
      const gateLines = strategy.decision_gates
        .slice(0, 5)
        .map((line) => `• ${line}`)
        .join("\n");
      const externalActionLines =
        strategy.external_actions.length > 0
          ? strategy.external_actions
              .slice(0, 5)
              .map(
                (action) =>
                  `• ${action.title} [${action.department}] — approval required`,
              )
              .join("\n")
          : "• No external actions proposed.";

      const strategyReply = [
        `**Cross-Department Strategy Ready**`,
        `_Mode: quick (chat-safe). For full deep research run /api/ops/abra/strategy?mode=deep with the same objective._`,
        "",
        strategy.summary,
        "",
        `**Department Execution Matrix**`,
        deptLines || "• Department matrix unavailable.",
        "",
        `**Financial Controls**`,
        financialLines || "• Financial controls unavailable.",
        "",
        `**KPI Guardrails**`,
        kpiLines || "• KPI guardrails unavailable.",
        "",
        `**Decision Gates**`,
        gateLines || "• Decision gates unavailable.",
        "",
        `**External Actions (Permission-First)**`,
        externalActionLines,
      ].join("\n");

      queueChatHistory({
        threadId,
        userEmail: actorEmail,
        userMessage: message,
        assistantMessage: strategyReply,
        metadata: {
          intent: "strategy",
          topic: strategy.topic,
          confidence: strategy.confidence,
          external_actions: strategy.external_actions.length,
        },
      });

      return NextResponse.json({
        reply: strategyReply,
        confidence: strategy.confidence,
        sources: [],
        intent: "strategy",
        strategy,
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
    // Tiered memory search (hot/warm/cold with fallback) + date-aware retrieval
    // Graceful degradation: if embedding fails OR circuit is open, continue with empty context + live data
    let tieredResults: TieredSearchResult = { hot: [], warm: [], cold: [], all: [], tierCounts: { hot: 0, warm: 0, cold: 0 } };
    let temporalRange: import("@/lib/ops/abra-temporal-resolver").TemporalRange | null = null;
    let embeddingFailed = supabaseCircuitOpen; // If circuit is open, skip embedding entirely
    if (!supabaseCircuitOpen) {
      try {
        const embedding = await buildEmbedding(message);
        const searchResult = await searchWithTemporalAwareness({
          message,
          embedding,
          matchCount: DEFAULT_MATCH_COUNT,
          filterTables: ["brain", "email"],
        });
        tieredResults = searchResult.results;
        temporalRange = searchResult.temporalRange;
        await markSupabaseSuccess();
      } catch (embErr) {
        console.error("[abra] Embedding/search failed, continuing with live data only:", embErr instanceof Error ? embErr.message : embErr);
        embeddingFailed = true;
      }
    }

    // Fetch corrections + departments + initiatives + cost + team + signals + live data (parallel)
    // When Supabase circuit is open, skip Supabase-dependent fetches to avoid 15s timeouts
    const [corrections, departments, activeInitiatives, costSummary, teamMembers, vendors, signals, liveSnapshot, financialContext] =
      await Promise.all([
        supabaseCircuitOpen ? Promise.resolve([] as Awaited<ReturnType<typeof fetchCorrections>>) : fetchCorrections(),
        supabaseCircuitOpen ? Promise.resolve([] as Awaited<ReturnType<typeof fetchDepartments>>) : fetchDepartments(),
        supabaseCircuitOpen ? Promise.resolve([] as Awaited<ReturnType<typeof fetchActiveInitiatives>>) : fetchActiveInitiatives(),
        supabaseCircuitOpen ? Promise.resolve(null as Awaited<ReturnType<typeof fetchCostSummary>>) : fetchCostSummary(),
        supabaseCircuitOpen ? Promise.resolve([] as Awaited<ReturnType<typeof getTeamMembers>>) : getTeamMembers(),
        supabaseCircuitOpen ? Promise.resolve([] as Awaited<ReturnType<typeof getVendors>>) : getVendors(),
        supabaseCircuitOpen ? Promise.resolve([] as Awaited<ReturnType<typeof getActiveSignals>>) : getActiveSignals({ limit: 5 }),
        fetchLiveBusinessSnapshot(), // Always fetch — uses Shopify/email APIs, not Supabase
        fetchFinancialContext(),      // Always fetch — uses KPI timeseries, not Supabase
      ]);
    const competitorContext =
      isCompetitorQuestion(message) || messageDepartment === "sales_and_growth"
        ? await fetchCompetitorContext(message)
        : null;

    // Build dynamic context strings for system prompt
    const today = new Date().toISOString().split("T")[0];
    const teamContext = buildTeamContext(teamMembers, vendors, today);
    const signalsContext = buildSignalsContext(signals);

    const availableActions = getAvailableActions();

    // If temporal range was detected, augment the message with date context
    const temporalHint = temporalRange
      ? `\n[TEMPORAL CONTEXT: User is asking about "${temporalRange.label}" which resolves to ${temporalRange.start}${temporalRange.start !== temporalRange.end ? ` through ${temporalRange.end}` : ""}. Date-matched brain entries (if any) are included in the HOT tier of retrieved context below.]`
      : "";
    // Build data availability status so Claude knows what feeds are up/down
    const dataStatus: string[] = [];
    if (supabaseCircuitOpen) dataStatus.push("🔴 Supabase circuit OPEN: All brain memory, corrections, departments, initiatives, signals, and team data unavailable. Only live Shopify/email feeds and KPI timeseries are active.");
    else if (embeddingFailed) dataStatus.push("🔴 Brain memory search: FAILED (embedding service down — no brain/email context available)");
    if (!liveSnapshot) dataStatus.push("⚠️ Live Shopify/email snapshot: UNAVAILABLE (API timeout or not configured)");
    if (!financialContext) dataStatus.push("⚠️ Financial KPI data: UNAVAILABLE (no KPI timeseries data returned)");
    const dataStatusLine = dataStatus.length > 0 ? `\n[DATA FEED STATUS: ${dataStatus.join("; ")}. Do NOT invent numbers for unavailable feeds. If brain search failed, tell the user your memory is temporarily unavailable.]` : "";
    const augmentedLiveSnapshot = [liveSnapshot, temporalHint, dataStatusLine].filter(Boolean).join("\n") || null;

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
      liveSnapshot: augmentedLiveSnapshot,
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
