/**
 * POST /api/ops/abra/chat — Web chat endpoint for Abra
 *
 * Body: { message: string, history?: ChatMessage[] }
 * Returns: { reply: string, sources: [...], confidence: number }
 *
 * Uses temporal search + dynamic system prompt for accurate, recency-aware answers.
 *
 * This route is a thin orchestrator. Business logic lives in:
 * - abra-intent.ts         — intent detection (regex-based, no LLM)
 * - abra-context-builder.ts — data fetching (Supabase, Shopify, QBO, etc.)
 * - abra-action-executor.ts — action directive parsing & execution
 * - abra-chat-persistence.ts — chat history, summarization, provenance
 */

import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
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
  type LiveDataContext,
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
  getRevenueSnapshot,
} from "@/lib/ops/abra-financial-intel";
import { searchWithTemporalAwareness, buildTieredContext, type TieredSearchResult } from "@/lib/ops/abra-memory-tiers";
import { getTeamMembers, getVendors, buildTeamContext } from "@/lib/ops/abra-team-directory";
import { getActiveSignals, buildSignalsContext } from "@/lib/ops/abra-operational-signals";
import {
  getAvailableActions,
  parseActionDirectives,
} from "@/lib/ops/abra-actions";
import { analyzePipeline } from "@/lib/ops/abra-pipeline-intelligence";
import { EMAIL_EXTRACTION_SKILL } from "@/lib/ops/abra-skill-email-data-extraction";
import { DEAL_CALCULATOR_SKILL } from "@/lib/ops/abra-skill-deal-calculator";
import { buildCrossDepartmentStrategy } from "@/lib/ops/abra-strategy-orchestrator";
import { getSystemHealth } from "@/lib/ops/abra-health-monitor";

// ─── Extracted modules ───
import {
  detectIntent,
  isFinanceQuestion,
  needsEmailExtractionSkill,
  needsDealCalculatorSkill,
  isCompetitorQuestion,
} from "@/lib/ops/abra-intent";
import { getCapabilityContext, markSuccess as capMarkSuccess, markFailure as capMarkFailure } from "@/lib/ops/capability-registry";
import { getFinanceTruthContext } from "@/lib/ops/finance-truth";
import { getBacklogContext } from "@/lib/ops/abra-operational-backlog";
import {
  isSupabaseRelatedError,
  fetchActiveInitiatives,
  fetchAskingInitiative,
  extractInitiativeAnswers,
  fetchCostSummary,
  fetchLiveBusinessSnapshot,
  fetchFinancialContext,
  fetchLedgerContext,
  fetchCompetitorContext,
  captureCompetitorIntelFromChat,
  buildEmbedding,
  fetchCorrections,
  fetchDepartments,
  valueAsText,
} from "@/lib/ops/abra-context-builder";
import { executeActions } from "@/lib/ops/abra-action-executor";
import {
  isUuidLike,
  makeThreadId,
  queueChatHistory,
  buildConversationContext,
  logProvenance,
  logUnansweredQuestions,
} from "@/lib/ops/abra-chat-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_MATCH_COUNT = 8;
const DEFAULT_CLAUDE_MODEL =
  process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const MAX_MESSAGE_LENGTH = 16000;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// ─── File Upload Helpers ───

async function extractFileText(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const buffer = Buffer.from(await file.arrayBuffer());

  if (file.type.includes("pdf") || ext === "pdf") {
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      const parsed = await parser.getText();
      await parser.destroy();
      return parsed?.text?.trim() || "";
    } catch {
      return "[PDF extraction failed — file may be scanned/image-only]";
    }
  }

  if (file.type.includes("spreadsheet") || file.type.includes("excel") || ext === "xlsx" || ext === "xls") {
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const rows: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        rows.push(`--- Sheet: ${sheetName} ---`);
        const csv = XLSX.utils.sheet_to_csv(sheet);
        rows.push(csv);
      }
      return rows.join("\n").trim();
    } catch {
      return "[Spreadsheet extraction failed]";
    }
  }

  // CSV, JSON, TXT, MD — read as text
  const text = await file.text();
  return text.trim();
}

async function ingestFileToMemory(file: File, extractedText: string, uploaderEmail: string): Promise<string> {
  try {
    const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!baseUrl || !serviceKey || !extractedText) return "";

    const { generateEmbeddings } = await import("@/lib/ops/abra-embeddings");
    const docId = crypto.randomUUID();
    // Store a single summary chunk for the full document (up to 8000 chars for embedding)
    const summaryText = extractedText.slice(0, 8000);
    const embeddings = await generateEmbeddings([summaryText]);

    const row = {
      source_type: "manual",
      source_ref: `document:${docId}:1`,
      entry_type: "research",
      title: file.name,
      raw_text: `[document:${docId} mime:${file.type} uploaded_by:${uploaderEmail}]\n${extractedText}`.slice(0, 50000),
      summary_text: extractedText.slice(0, 500),
      category: "financial",
      department: "operations",
      confidence: "medium",
      priority: "normal",
      processed: true,
      tags: ["document_upload", `uploaded_by:${uploaderEmail.toLowerCase()}`],
      embedding: embeddings[0] || null,
      created_at: new Date().toISOString(),
    };

    const headers = new Headers();
    headers.set("apikey", serviceKey);
    headers.set("Authorization", `Bearer ${serviceKey}`);
    headers.set("Content-Type", "application/json");
    headers.set("Prefer", "return=minimal");
    await fetch(`${baseUrl}/rest/v1/open_brain_entries`, {
      method: "POST",
      headers,
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(15000),
    });
    return docId;
  } catch (err) {
    console.error("[abra] File memory ingestion failed:", err instanceof Error ? err.message : err);
    return "";
  }
}

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function sanitizeHistory(history: unknown): ChatMessage[] {
  if (!Array.isArray(history)) return [];

  return history
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object",
    )
    .map((item): ChatMessage => {
      // SECURITY: Never allow client to inject "system" role messages — treat as "user"
      const role: ChatMessage["role"] =
        item.role === "assistant"
          ? "assistant"
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

function buildConversation(history: ChatMessage[]): string {
  if (!history.length) return "";
  return history
    .slice(-6)
    .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
    .join("\n");
}

// ─── LLM Call ───

async function generateClaudeReply(input: {
  message: string;
  history: ChatMessage[];
  tieredResults: TieredSearchResult;
  corrections: AbraCorrection[];
  departments: AbraDepartment[];
  activeInitiatives?: AbraInitiativeContext[];
  costSummary?: AbraCostContext | null;
  financialContext?: string | null;
  ledgerContext?: string | null;
  competitorContext?: string | null;
  teamContext?: string;
  signalsContext?: string;
  availableActions?: string[];
  detectedDepartment?: string | null;
  liveSnapshot?: string | null;
  deadlineSignal?: AbortSignal;
  isFinanceRelated?: boolean;
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
    includeFinanceFramework: input.isFinanceRelated,
  });
  // Only include full action instructions when the message likely needs actions
  const messageNeedsActions = /\b(send|create|log|notify|remind|track|store|record|draft|email|slack|save|update|correct|calculate|run scenario|option|notion|build|compile|finish|finalize|download|export|format)\b/i.test(input.message);
  const actionInstructions =
    messageNeedsActions && input.availableActions && input.availableActions.length > 0
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
• "we did a production run at Powers, 10,000 units, total cost $13,500" → emit log_production_run with manufacturer, run_date, total_units_ordered, total_cost
• "Powers quoted us $1.20/unit for gummy base" → emit record_vendor_quote with vendor, item_description, quoted_price, price_type "per_unit"
• "what if ingredient costs go up 15%?" → emit run_scenario with scenario_name, base_values (from latest production data), adjustments [{variable: "ingredient_cost", change_pct: 15}]
• "did you see the email from Rene?" → You can see subjects in LIVE INBOX. To read the full email, emit read_email with the message_id from the inbox listing.
• "what did Rene say in that email?" → emit read_email with message_id from LIVE INBOX to get the full body, then summarize.
• "find emails about the Powers invoice" → emit search_email with query "Powers invoice" to search Gmail.
• "check if we got the Faire order confirmation" → emit search_email with query "from:faire.com order confirmation"
• "set up QuickBooks" → This is OUTSIDE your actions, so explain what's needed and offer to create_task or send_slack about it.

DATABASE KEYS for create_notion_page: meeting_notes, b2b_prospects, distributor_prospects, daily_performance, fleet_ops, inventory, sku_registry, cash_transactions, content_drafts, kpis, general

ACTION EXECUTION TIERS:
• AUTO-EXECUTE (low-risk, informational): create_brain_entry, acknowledge_signal, create_notion_page, create_task — these execute immediately when emitted.
• AUTO-EXECUTE (low-risk, read-only): read_email, search_email — these only READ data, never modify anything. Auto-execute IMMEDIATELY when emitted. When a user asks about an email, DO NOT ask permission — just read it.
• AUTO-EXECUTE (low-risk, operational data): log_production_run, record_vendor_quote — these log operational data. Auto-execute when emitted.
• AUTO-EXECUTE (stateless computation): run_scenario — computes hypotheticals without changing financial state. Auto-execute when emitted.
• AUTO-EXECUTE WITH CAPS (financial): record_transaction — auto-executes ONLY if amount ≤ $500. Larger amounts queue for approval.
• ALWAYS QUEUED (requires human approval): send_email, send_slack, correct_claim — these NEVER auto-execute.

⚠️ ACTION SAFETY RULES (CRITICAL — violations create bad data):

1. record_transaction — VERIFY BEFORE EMITTING:
   • ONLY emit with amounts the USER explicitly stated or that come from VERIFIED data sources.
   • NEVER compute or estimate a transaction amount yourself. If the user says "record the Powers payment" but doesn't say the amount, ASK: "How much was the payment?"
   • NEVER emit record_transaction based on numbers you found in brain entries unless they're tagged "verified_sales_data".
   • The amount field has a hard safety limit of $100,000. Anything above is rejected as likely hallucination.

2. correct_claim — CONFIRM BEFORE EMITTING:
   • Corrections go to the HOT memory tier and PERMANENTLY OVERRIDE all other data. This is the most powerful write operation you have.
   • ALWAYS confirm the exact wording with the user before emitting: "I'll log this correction: [original] → [corrected]. Is that exactly right?"
   • NEVER emit correct_claim based on your own inference. Only the USER can tell you something is wrong.
   • If the user says "that's wrong" but doesn't give the correct figure, ASK for it. Do NOT guess the correction.

3. log_production_run — VERIFY BEFORE EMITTING:
   • ONLY emit with cost figures the USER explicitly stated or from VERIFIED invoices/receipts.
   • NEVER estimate production costs. If the user says "we did a run at Powers" but doesn't mention the cost, ASK.
   • The total_cost field has a safety limit of $500,000. Anything above is rejected.

4. run_scenario — LABEL OUTPUTS CLEARLY:
   • EVERY scenario output MUST be labeled "⚠️ HYPOTHETICAL SCENARIO — not a forecast."
   • Use real base values when available (latest production run COGS, actual pricing, real volume). State which inputs are real data and which are assumptions.
   • NEVER present scenario outputs as projections or forecasts.

3. create_brain_entry — USE ACCURATE TITLES:
   • The title becomes searchable memory. Make it factual and specific, not vague.
   • NEVER create brain entries with dollar figures in them unless the source is verified. Brain entries with wrong numbers pollute future searches.

4. GENERAL: If you're unsure whether to emit an action, DON'T. Ask the user first. A missed action is recoverable; a wrong action creates bad data.

FINANCIAL INTEGRITY REMINDER (applies to EVERY response):
• Every dollar figure you state MUST have a [source: ...] citation. No exceptions.
• If the user corrects a number, STOP, acknowledge the error, ask for the right figure. Never defend wrong data.
• "I don't have verified data for that" is always acceptable. A wrong number is never acceptable.

MARGIN & COST CLAIM VERIFICATION (applies when user asserts financial metrics):
• If the user states a blended/aggregate margin (e.g., "our margin is 65%"), CHALLENGE IT:
  1. Ask: "Which margin? Gross, contribution, or net?"
  2. Ask: "On which channel? DTC, Amazon, and wholesale have very different cost structures."
  3. Ask: "What's the source? Financial statements, a calculation, or an estimate?"
• NEVER accept an unverified margin claim and apply it to calculations. Aggregate margins are misleading — per our CPG reasoning rules.
• If the user insists, log it as a CLAIM with source "user_assertion" and flag it: "Unverified — needs reconciliation against channel-specific actuals."
• Similarly for COGS claims: always ask "Is this from a production run invoice, a vendor quote, or an estimate?" before recording.`
      : "";

  const historyText = buildConversation(input.history);
  const contextText = buildTieredContext(input.tieredResults);
  // Build live data context so confidence reflects authoritative data sources
  const liveDataCtx: LiveDataContext = {
    hasLiveSnapshot: Boolean(input.liveSnapshot && input.liveSnapshot.length > 50),
    hasFinancialContext: Boolean(input.financialContext && input.financialContext.length > 20),
    hasLedgerContext: Boolean(input.ledgerContext && input.ledgerContext.length > 20),
    hasCostSummary: Boolean(input.costSummary),
    hasCompetitorContext: Boolean(input.competitorContext && input.competitorContext.length > 20),
  };
  const confidence = computeConfidence(input.tieredResults.all, liveDataCtx);
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
    input.ledgerContext ? `\n${input.ledgerContext}` : "",
    historyText ? `Recent conversation:\n${historyText}` : "",
    `User question:\n${input.message}`,
    `Retrieved context:\n${contextText}${confidenceHint}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const maxTokens = selectedModel.includes("haiku") ? 3000 : 6000;
  // Combine per-call timeout with global deadline signal (if provided)
  // Use manual AbortController linkage for Node 18 compat (no AbortSignal.any)
  const llmAbort = new AbortController();
  const localTimer = setTimeout(() => llmAbort.abort(), 25000);
  if (input.deadlineSignal) {
    if (input.deadlineSignal.aborted) llmAbort.abort();
    else input.deadlineSignal.addEventListener("abort", () => llmAbort.abort(), { once: true });
  }
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
      system: `${actionInstructions}\n\n${systemPrompt}${needsEmailExtractionSkill(input.message) ? `\n\n${EMAIL_EXTRACTION_SKILL.prompt}` : ""}${needsDealCalculatorSkill(input.message) ? `\n\n${DEAL_CALCULATOR_SKILL.prompt}` : ""}`,
      messages: [{ role: "user", content: userPrompt }],
    }),
    signal: llmAbort.signal,
  });
  clearTimeout(localTimer);

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
    void capMarkFailure("anthropic", `HTTP ${res.status}: ${text.slice(0, 100)}`).catch(() => {});
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

// ─── POST Handler ───

export async function POST(req: Request) {
  // Rate limit — strict tier (AI costs money)
  const { checkRateLimit } = await import("@/lib/ops/rate-limit");
  const rl = await checkRateLimit(req, "strict");
  if (rl.limited) return rl.response!;

  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await auth();
  const actorEmail = session?.user?.email || "cron@system";
  const url = new URL(req.url);
  const mode = (url.searchParams.get("mode") || "").toLowerCase();
  const healthMode = mode === "health" || mode === "quick";

  // ─── Parse request (JSON or multipart/form-data with optional file) ───
  let payload: {
    message?: unknown;
    history?: unknown;
    thread_id?: unknown;
    actor_label?: unknown;
    channel?: unknown;
  } = {};
  let uploadedFileContext = "";
  let uploadedFileName = "";
  let uploadedDocId = "";

  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    try {
      const formData = await req.formData();
      payload = {
        message: formData.get("message") as string | null,
        history: (() => { try { return JSON.parse(formData.get("history") as string || "[]"); } catch { return []; } })(),
        thread_id: formData.get("thread_id") as string | null,
        actor_label: formData.get("actor_label") as string | null,
        channel: formData.get("channel") as string | null,
      };
      const file = formData.get("file");
      if (file instanceof File && file.size > 0) {
        if (file.size > MAX_FILE_SIZE_BYTES) {
          return NextResponse.json({ error: "File exceeds 10MB limit" }, { status: 400 });
        }
        const fileText = await extractFileText(file);
        if (fileText) {
          uploadedFileName = file.name;
          uploadedFileContext = `\n\n--- UPLOADED DOCUMENT: ${file.name} ---\n${fileText.slice(0, 12000)}\n--- END DOCUMENT ---\n`;
          // Store in memory (non-blocking)
          void ingestFileToMemory(file, fileText, actorEmail).then((id) => { uploadedDocId = id; }).catch(() => {});
        }
      }
    } catch {
      return NextResponse.json({ error: "Invalid multipart payload" }, { status: 400 });
    }
  } else {
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        { status: 400 },
      );
    }
  }

  const rawMessage =
    typeof payload.message === "string"
      ? payload.message.replaceAll("\0", "").trim()
      : "";
  if (!rawMessage) {
    return NextResponse.json(
      { error: "message is required" },
      { status: 400 },
    );
  }
  if (rawMessage.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      {
        error: `message exceeds max length (${MAX_MESSAGE_LENGTH} chars)`,
      },
      { status: 400 },
    );
  }
  // If a file was uploaded, append its content to the message so the LLM sees it
  const message = uploadedFileContext
    ? `${rawMessage}${uploadedFileContext}`
    : rawMessage;

  const history = sanitizeHistory(payload.history);
  const requestedThreadId =
    typeof payload.thread_id === "string" ? payload.thread_id.trim() : "";
  const threadId =
    requestedThreadId && isUuidLike(requestedThreadId)
      ? requestedThreadId
      : makeThreadId();
  const actorLabel =
    typeof payload.actor_label === "string" && payload.actor_label.trim()
      ? payload.actor_label.trim().slice(0, 120)
      : actorEmail;
  const VALID_CHANNELS = ["web", "slack", "api"] as const;
  type AnswerChannel = (typeof VALID_CHANNELS)[number];
  const rawChannel = typeof payload.channel === "string" ? payload.channel.trim() : "";
  const channel: AnswerChannel = (VALID_CHANNELS as readonly string[]).includes(rawChannel)
    ? (rawChannel as AnswerChannel)
    : "web";
  const messageDepartment = detectDepartment(message);

  if (healthMode) {
    const reply = buildHealthModeReply(message);
    queueChatHistory({
      threadId,
      userEmail: actorEmail,
      userMessage: message,
      assistantMessage: reply,
      metadata: { intent: "health_mode" },
      actorLabel,
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

  // Vercel Hobby plan kills functions at 60s — use AbortController to cancel
  // in-flight work at 45s so we have time to return a graceful response.
  const DEADLINE_MS = 50_000;
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => deadlineController.abort(), DEADLINE_MS);
  const startMs = Date.now();
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
          // Map stored messages to strip any "system" role (treat as "user")
          effectiveHistory = stored.map((m) => ({
            role: m.role === "assistant" ? "assistant" as const : "user" as const,
            content: m.content,
          }));
        }
      } catch {
        // Best-effort: fall back to client-provided history.
      }
    }

    // ─── Intent Detection ───
    const intent = detectIntent(message);

    // Handle cost query with LLM synthesis
    if (intent.type === "cost") {
      const spend = await getMonthlySpend();
      const templateCostReply = `AI Spend Report (${new Date().toISOString().slice(0, 7)}):\n` +
        `Total: $${spend.total.toFixed(2)} / $${spend.budget}\n` +
        `Remaining: $${spend.remaining.toFixed(2)} (${spend.pctUsed}% used)\n` +
        `API calls: ${spend.callCount}\n` +
        (Object.keys(spend.byEndpoint).length > 0
          ? `By endpoint: ${Object.entries(spend.byEndpoint).map(([k, v]) => `${k}: $${(Number(v) || 0).toFixed(2)}`).join(", ")}\n`
          : "") +
        (Object.keys(spend.byProvider).length > 0
          ? `By provider: ${Object.entries(spend.byProvider).map(([k, v]) => `${k}: $${(Number(v) || 0).toFixed(2)}`).join(", ")}`
          : "");

      let costReply = templateCostReply;
      try {
        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        if (anthropicKey) {
          const costPrompt = `You are Abra, the AI operations assistant for USA Gummies. The user asked about AI costs/spending. Here is the current cost data:\n\n${templateCostReply}\n\nProvide a concise analysis addressing: "${message}". Include the exact numbers, highlight if spend is on track or needs attention, and note which endpoints/providers are consuming the most. Keep it under 200 words. Format with markdown.`;
          const llmRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "claude-sonnet-4-6",
              max_tokens: 400,
              temperature: 0.2,
              messages: [{ role: "user", content: costPrompt }],
            }),
            signal: AbortSignal.timeout(15_000),
          });
          if (llmRes.ok) {
            const llmData = await llmRes.json() as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
            const llmText = (llmData.content || [])
              .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
              .map((b) => b.text)
              .join("");
            if (llmText.length > 20) {
              costReply = llmText;
              void logAICost?.({
                endpoint: "abra-chat-cost",
                provider: "anthropic",
                model: "claude-sonnet-4-6",
                inputTokens: llmData.usage?.input_tokens || 0,
                outputTokens: llmData.usage?.output_tokens || 0,
              }).catch(() => {});
            }
          }
        }
      } catch (err) {
        console.error("[abra] Cost LLM synthesis failed, using template:", err instanceof Error ? err.message : err);
      }

      queueChatHistory({
        threadId,
        userEmail: actorEmail,
        userMessage: message,
        assistantMessage: costReply,
        metadata: { intent: "cost" },
        actorLabel,
      });
      return NextResponse.json({
        reply: costReply,
        confidence: 95,
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
      const templateReply = noDeals
        ? "No active deals found in the pipeline."
        : [
            `Total pipeline value: $${summary.total_pipeline_value.toFixed(2)}`,
            `Active deals: ${allDeals.length}`,
            `Win rate (30d): ${summary.win_rate_30d.toFixed(1)}%`,
            `Avg deal cycle: ${summary.avg_deal_cycle_days.toFixed(1)} days`,
            stageLines ? `\nDeals by stage:\n${stageLines}` : "",
            `\nAt-risk deals:\n${atRiskLine}`,
          ]
            .filter(Boolean)
            .join("\n");

      // LLM synthesis: pass pipeline data + user question to Claude for intelligent analysis
      let pipelineReply = templateReply;
      try {
        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        if (anthropicKey) {
          const pipelinePrompt = `You are Abra, the AI operations assistant for USA Gummies. The user asked about the sales pipeline. Here is the current pipeline data:\n\n${templateReply}\n\nProvide a concise, executive-level analysis of this pipeline data. Address the user's specific question: "${message}". Highlight the most important insights: deal momentum, risk areas, and recommended next actions. Use specific numbers from the data. Keep it under 300 words. Format with markdown.`;
          const llmRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "claude-sonnet-4-6",
              max_tokens: 600,
              temperature: 0.2,
              messages: [{ role: "user", content: pipelinePrompt }],
            }),
            signal: AbortSignal.timeout(15_000),
          });
          if (llmRes.ok) {
            const llmData = await llmRes.json() as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
            const llmText = (llmData.content || [])
              .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
              .map((b) => b.text)
              .join("");
            if (llmText.length > 20) {
              pipelineReply = llmText;
              void logAICost?.({
                endpoint: "abra-chat-pipeline",
                provider: "anthropic",
                model: "claude-sonnet-4-6",
                inputTokens: llmData.usage?.input_tokens || 0,
                outputTokens: llmData.usage?.output_tokens || 0,
              }).catch(() => {});
            }
          }
        }
      } catch (err) {
        console.error("[abra] Pipeline LLM synthesis failed, using template:", err instanceof Error ? err.message : err);
        // Falls back to templateReply
      }

      queueChatHistory({
        threadId,
        userEmail: actorEmail,
        userMessage: message,
        assistantMessage: pipelineReply,
        metadata: { intent: "pipeline" },
      });

      return NextResponse.json({
        reply: pipelineReply,
        confidence: 0.9,
        sources: [],
        intent: "pipeline",
        thread_id: threadId,
      });
    }

    // ─── Finance Fast-Path ───
    // Only use fast-path for direct QBO data queries (balances, transactions, P&L).
    // Complex analytical questions (readiness assessment, setup plan, COGS breakdown,
    // margin analysis) go through the main Claude path which has brain context + corrections.
    const isDirectQBOQuery = intent.type === "finance" && /\b(balance|transaction|p&l|profit.?loss|bank|checking|credit card|vendor list|recent (purchase|expense|payment))\b/i.test(message) && !/\b(assess|plan|priorit|missing|set up|setup|readiness|what.*(need|should|missing)|breakdown|analysis|margin|cogs)\b/i.test(message);
    if (isDirectQBOQuery) {
      let financeData = "";
      try {
        // Fetch QBO accounts directly via our own API
        const qboRes = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL || "https://www.usagummies.com"}/api/ops/qbo/accounts`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (qboRes.ok) {
          const qboJson = (await qboRes.json()) as {
            count?: number;
            accounts?: Array<{
              Id: string;
              Name: string;
              AccountType: string;
              AccountSubType?: string;
              CurrentBalance?: number;
              Active?: boolean;
            }>;
          };
          const accounts = qboJson.accounts || [];

          // Build a structured summary
          const bankAccounts = accounts.filter(
            (a) => a.AccountType === "Bank" && a.Active !== false,
          );
          const liabilityAccounts = accounts.filter(
            (a) =>
              (a.AccountType === "Other Current Liability" ||
                a.AccountType === "Long Term Liability" ||
                a.AccountType === "Credit Card") &&
              a.Active !== false,
          );
          const expenseAccounts = accounts.filter(
            (a) =>
              (a.AccountType === "Expense" ||
                a.AccountType === "Other Expense" ||
                a.AccountType === "Cost of Goods Sold") &&
              a.Active !== false,
          );
          const incomeAccounts = accounts.filter(
            (a) =>
              (a.AccountType === "Income" || a.AccountType === "Other Income") &&
              a.Active !== false,
          );
          const assetAccounts = accounts.filter(
            (a) =>
              (a.AccountType === "Other Current Asset" ||
                a.AccountType === "Fixed Asset") &&
              a.Active !== false,
          );

          // Show all accounts with non-zero balances, plus a summary count of zero-balance accounts
          const fmtNonZero = (accts: typeof accounts, label: string) => {
            const nonZero = accts.filter((a) => (a.CurrentBalance ?? 0) !== 0);
            const zeroCount = accts.length - nonZero.length;
            const lines = nonZero.map(
              (a) =>
                `  • ${a.Name} (ID ${a.Id}): $${(a.CurrentBalance ?? 0).toFixed(2)} [${a.AccountSubType || a.AccountType}]`,
            );
            if (zeroCount > 0) {
              lines.push(`  (+ ${zeroCount} more ${label} accounts with $0 balance)`);
            }
            return lines.join("\n");
          };

          // For expense/COGS specifically, list ALL account names (without balance) so Abra knows the structure
          const fmtExpenseStructure = (accts: typeof accounts) => {
            const nonZero = accts.filter((a) => (a.CurrentBalance ?? 0) !== 0);
            const zero = accts.filter((a) => (a.CurrentBalance ?? 0) === 0);
            const lines = nonZero.map(
              (a) =>
                `  • ${a.Name} (ID ${a.Id}): $${(a.CurrentBalance ?? 0).toFixed(2)} [${a.AccountSubType || a.AccountType}]`,
            );
            // Group zero-balance expense accounts by parent category for structure visibility
            const categories = new Map<string, string[]>();
            for (const a of zero) {
              const parent = a.Name.includes(":") ? a.Name.split(":")[0].trim() : a.AccountSubType || a.AccountType;
              if (!categories.has(parent)) categories.set(parent, []);
              categories.get(parent)!.push(a.Name);
            }
            if (categories.size > 0) {
              lines.push(`  (${zero.length} more accounts at $0, categories: ${Array.from(categories.keys()).slice(0, 15).join(", ")})`);
            }
            return lines.join("\n");
          };

          financeData = [
            `QBO Chart of Accounts — ${accounts.length} total accounts`,
            "",
            `**Bank Accounts (${bankAccounts.length}):**`,
            fmtNonZero(bankAccounts, "bank"),
            "",
            `**Income Accounts (${incomeAccounts.length}):**`,
            fmtNonZero(incomeAccounts, "income"),
            "",
            `**Expense/COGS Accounts (${expenseAccounts.length}):**`,
            fmtExpenseStructure(expenseAccounts),
            "",
            `**Liability Accounts (${liabilityAccounts.length}):**`,
            fmtNonZero(liabilityAccounts, "liability"),
            "",
            `**Asset Accounts (${assetAccounts.length}):**`,
            fmtNonZero(assetAccounts, "asset"),
          ].join("\n");
        } else {
          financeData =
            "QBO API returned an error. QBO may not be connected — check /ops/finance for connection status.";
        }
      } catch (err) {
        financeData = `Could not reach QBO API: ${err instanceof Error ? err.message : "unknown error"}`;
      }

      // Also pull revenue snapshot for richer context
      let revenueContext = "";
      try {
        const rev = await getRevenueSnapshot("month");
        if (rev) {
          revenueContext = `\n\nRevenue Snapshot (rolling 30d):\n• Shopify: $${rev.shopify_revenue.toFixed(2)}\n• Amazon: $${rev.amazon_revenue.toFixed(2)}\n• Total: $${rev.total_revenue.toFixed(2)}\n• Orders: ${rev.order_count}\n• Avg order value: $${rev.avg_order_value.toFixed(2)}\n• vs prior period: ${rev.vs_prior_period_pct >= 0 ? "+" : ""}${rev.vs_prior_period_pct.toFixed(1)}%`;
        }
      } catch {
        // Non-critical
      }

      // Pull additional QBO data based on what the user is asking about
      const qboBase = process.env.NEXT_PUBLIC_BASE_URL || "https://www.usagummies.com";
      const wantsVendors = /vendor|supplier|co.?pack|who .* (pay|buy)|powers|albanese|1099|contractor/i.test(message);
      const wantsPnl = /p&l|profit.*loss|income.*statement|revenue.*expense|margin|cogs|cost of goods|profitability|breakeven|net (income|loss)/i.test(message);
      const wantsPurchases = /purchase|expense|spend|where .* money|what .* pay|every transaction|all transactions|transaction (list|detail|history)|general ledger|trial balance|recent (activity|charges)|last 30 days/i.test(message);
      const wantsBalanceSheet = /balance sheet|assets|liabilities|equity|net worth|capital structure|what do we (owe|own)|investor loan/i.test(message);

      const extraFetches = await Promise.allSettled([
        wantsVendors
          ? fetch(`${qboBase}/api/ops/qbo/query?type=vendors`, { signal: AbortSignal.timeout(8_000) }).then(r => r.ok ? r.json() : null)
          : Promise.resolve(null),
        wantsPnl
          ? fetch(`${qboBase}/api/ops/qbo/query?type=pnl`, { signal: AbortSignal.timeout(8_000) }).then(r => r.ok ? r.json() : null)
          : Promise.resolve(null),
        wantsPurchases
          ? fetch(`${qboBase}/api/ops/qbo/query?type=purchases&limit=${/every|all|last 30/i.test(message) ? 100 : 25}`, { signal: AbortSignal.timeout(8_000) }).then(r => r.ok ? r.json() : null)
          : Promise.resolve(null),
        wantsBalanceSheet
          ? fetch(`${qboBase}/api/ops/qbo/query?type=balance_sheet`, { signal: AbortSignal.timeout(8_000) }).then(r => r.ok ? r.json() : null)
          : Promise.resolve(null),
      ]);

      const vendorData = extraFetches[0].status === "fulfilled" ? extraFetches[0].value as Record<string, unknown> | null : null;
      const pnlData = extraFetches[1].status === "fulfilled" ? extraFetches[1].value as Record<string, unknown> | null : null;
      const purchaseData = extraFetches[2].status === "fulfilled" ? extraFetches[2].value as Record<string, unknown> | null : null;
      const bsData = extraFetches[3].status === "fulfilled" ? extraFetches[3].value as Record<string, unknown> | null : null;

      if (vendorData && Array.isArray((vendorData as { vendors?: unknown[] }).vendors)) {
        const vendors = (vendorData as { vendors: Array<{ Name: string; Balance: number; Active: boolean; Email: string | null }> }).vendors.filter(v => v.Active);
        if (vendors.length > 0) {
          financeData += `\n\n**QBO Vendors (${vendors.length} active):**\n${vendors.map(v => `  • ${v.Name}${v.Email ? ` (${v.Email})` : ""}${v.Balance ? ` — balance: $${v.Balance.toFixed(2)}` : ""}`).join("\n")}`;
        } else {
          financeData += `\n\n**Vendors:** No vendor records found in QBO yet. Key vendors for USA Gummies include Powers Confections (co-packer), Albanese (ingredients), NinjaPrintHouse (packaging). These need to be set up in QuickBooks.`;
        }
      }

      if (pnlData) {
        const summary = (pnlData as { summary?: Record<string, unknown>; period?: { start: string; end: string } }).summary || {};
        const period = (pnlData as { period?: { start: string; end: string } }).period;
        const entries = Object.entries(summary).filter(([, v]) => v !== 0 && v !== "0.00");
        if (entries.length > 0) {
          financeData += `\n\n**P&L (${period?.start || "YTD"} to ${period?.end || "today"}):**\n${entries.map(([k, v]) => `  • ${k}: ${typeof v === "number" ? `$${v.toFixed(2)}` : v}`).join("\n")}`;
        } else {
          financeData += `\n\n**P&L:** No P&L data available. QBO transactions need to be categorized before a P&L can be generated. The bank feed may need syncing and reconciliation.`;
        }
      }

      if (purchaseData && Array.isArray((purchaseData as { purchases?: unknown[] }).purchases)) {
        const purchases = (purchaseData as { purchases: Array<{ Date: string; Amount: number; Vendor: string | null; Lines: Array<{ Description: string; Account: string }> }> }).purchases;
        if (purchases.length > 0) {
          financeData += `\n\n**Recent Purchases (${purchases.length}):**\n${purchases.slice(0, 15).map(p => `  • ${p.Date}: $${p.Amount.toFixed(2)} — ${p.Vendor || "Unknown"}${p.Lines?.[0]?.Account ? ` [${p.Lines[0].Account}]` : ""}`).join("\n")}`;
        }
      }

      if (bsData) {
        const summary = (bsData as { summary?: Record<string, unknown> }).summary || {};
        const entries = Object.entries(summary).filter(([, v]) => v !== 0 && v !== "0.00");
        if (entries.length > 0) {
          financeData += `\n\n**Balance Sheet:**\n${entries.map(([k, v]) => `  • ${k}: ${typeof v === "number" ? `$${v.toFixed(2)}` : v}`).join("\n")}\n\nNote: Bank balances shown are QBO book balances, which may differ from actual bank balances.`;
        }
      }

      // Also pull verified ledger data from Notion (Layer 3: bank deposits) — authoritative source
      let ledgerContext = "";
      try {
        const lc = await fetchLedgerContext(message);
        if (lc) {
          ledgerContext = `\n\n${lc}`;
        }
      } catch {
        // Non-critical
      }

      // LLM synthesis
      let financeReply = financeData;
      try {
        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        console.log("[abra] Finance LLM synthesis: key present?", !!anthropicKey, "financeData length:", financeData.length);
        if (anthropicKey) {
          const isCashQuestion = /\b(cash position|bank balance|checking balance|how much .*(in the bank|do we have|cash|money)|current balance|account balance|overdrawn|overdraft)\b/i.test(message);
          const isReconciliationQuestion = /\b(reconcil|setup|configure|set up|get started|initial|onboard|clean up|organize)\b/i.test(message);
          const financePrompt = `You are Abra, the AI operations assistant for USA Gummies (a CPG confectionery gummy company). The user asked a financial question. Here is QBO data:\n\n${financeData}${revenueContext}${ledgerContext}\n\n${isReconciliationQuestion ? `RECONCILIATION & SETUP CONTEXT:\nThe QBO books are in early setup stage. Bank feeds are connected but transactions are minimally categorized. Key tasks Rene (bookkeeper) and Abra are working on:\n1. Import and categorize all historical transactions\n2. Set up proper vendor records (Powers Confections, Albanese, NinjaPrintHouse, Pirate Ship, etc.)\n3. Map the chart of accounts to the C-Corp structure (Form 1120)\n4. Reconcile bank feeds with actual bank statements\n5. Set up proper COGS tracking (forward: $1.522/unit from Albanese+Belmark+Powers; historical Run #1: $3.11/unit)\n6. Configure revenue accounts by channel (DTC/Amazon/Wholesale)\nAbra can help with batch categorization, transaction import, and data organization. Rene should focus on professional review and sign-off.\n\n` : ""}CRITICAL RULES:\n1. Any transfer from "Rene G. Gonzalez" or "Rene G Gonzalez Trust" is an INVESTOR LOAN (liability account ID 167), NEVER income. This is investor capital, not revenue.\n2. **MOST IMPORTANT RULE — READ THIS CAREFULLY:** The balances below are QBO BOOK BALANCES ONLY. QuickBooks book balances frequently diverge from actual bank balances when bank feed imports are behind, transactions are uncategorized, or reconciliation hasn't been done recently. ${isCashQuestion ? "The user is asking about cash/bank balances. You MUST lead your response with a prominent warning box like: '⚠️ **Important: These are QuickBooks book balances, not live bank balances.** QBO bank feeds may be behind — the actual bank balance could be significantly different. Please verify against your bank account directly before making any decisions based on these numbers.' Do NOT present QBO book balances as the actual cash position. Do NOT say 'the checking account is overdrawn' — say 'QBO books show X, but this may not reflect the actual bank balance.'" : "Label any balance figures as 'per QBO books' — never present them as definitive."}\n3. **WHEN DATA IS MISSING OR ALL ZEROS:** If the QBO data shows all $0.00 balances for categories like COGS, Expenses, or Income, do NOT present those zeros as fact. Instead explain honestly: "QBO doesn't have categorized data for this yet — the bank feed transactions haven't been fully imported and categorized. I'll flag this for Ben to get set up." Offer to note what needs to be configured.\n4. **KNOWN VENDORS (even if not in QBO yet):** Key USA Gummies vendors include Powers Confections (co-packer, Janesville WI), Albanese Confectionery (gummy base/ingredients), NinjaPrintHouse (packaging/labels), Pirate Ship (shipping), and various software (Shopify, Anthropic, Slack). If user asks about vendors and QBO has none, share this knowledge and note QBO vendor records need setup.\n5. **BE HONEST AND HELPFUL:** If you don't have the data to answer, say so clearly. Offer to flag it for configuration. Never make up numbers. Never present incomplete data as complete.\n6. **VERIFIED FINANCIAL DATA TAKES PRIORITY:** If both QBO data and Notion Ledger data are available, the Notion Ledger (verified from Found Banking records) is more authoritative for historical P&L, vendor totals, and revenue figures. QBO is the current working system being set up.\n7. **CORPORATE STRUCTURE:** USA Gummies is a C-Corporation (Wyoming), files Form 1120. Cash-basis accounting (per Found Banking). The chart of accounts follows standard categories mapped from Found to QBO.\n8. **KEY FINANCIALS (verified):** 2025 revenue $1,484.80, 2025 net income -$30,183.14 (launch year). 2026 YTD revenue ~$2,931.36. COGS per unit: FORWARD $1.522 (Albanese $0.919 + Belmark $0.144 + Powers $0.350 [quote] + freight $0.109) — use for all margin/pricing. HISTORICAL $3.11 (Dutch Valley Run #1, 2,500 units, Sept 2025 — initial small batch, not representative). Current burn rate: ~$1,000-1,300/month.\n9. **WHEN WORKING WITH RENE (bookkeeper):** Rene is building the books from scratch. Be collaborative. If he asks for data, pull it from QBO and Notion and present it clearly. If data isn't in the system yet, explain what needs to be configured and offer to help set it up. Don't ask clarifying questions when you can look up the answer. When creating deliverables, create them as Notion pages under the Bookkeeping Hub.\n\nProvide a clear, helpful response to: "${message}"\n\nInclude specific account names, IDs, and balances where relevant. If the user asks about the Chart of Accounts, list the accounts organized by type. If asking about reconciliation or setup, provide a concrete action plan with what Abra can handle vs what needs manual review. Keep it concise but complete. Format with markdown.`;
          const llmRes = await fetch(
            "https://api.anthropic.com/v1/messages",
            {
              method: "POST",
              headers: {
                "x-api-key": anthropicKey,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "claude-sonnet-4-6",
                max_tokens: 4000,
                temperature: 0.2,
                messages: [{ role: "user", content: financePrompt }],
              }),
              signal: AbortSignal.timeout(45_000),
            },
          );
          if (llmRes.ok) {
            const llmData = (await llmRes.json()) as {
              content?: Array<{ type: string; text?: string }>;
              usage?: { input_tokens?: number; output_tokens?: number };
            };
            const llmText = (llmData.content || [])
              .filter(
                (b): b is { type: "text"; text: string } =>
                  b.type === "text" && typeof b.text === "string",
              )
              .map((b) => b.text)
              .join("");
            if (llmText.length > 20) {
              financeReply = llmText;
              void logAICost?.({
                endpoint: "abra-chat-finance",
                provider: "anthropic",
                model: "claude-sonnet-4-6",
                inputTokens: llmData.usage?.input_tokens || 0,
                outputTokens: llmData.usage?.output_tokens || 0,
              }).catch(() => {});
            } else {
              console.warn("[abra] Finance LLM returned short response:", llmText.length, "chars. First 200:", llmText.slice(0, 200));
            }
          } else {
            const errBody = await llmRes.text().catch(() => "");
            console.error("[abra] Finance LLM API failed:", llmRes.status, errBody.slice(0, 300));
          }
        }
      } catch (err) {
        console.error(
          "[abra] Finance LLM synthesis failed, using template:",
          err instanceof Error ? err.message : err,
        );
      }

      queueChatHistory({
        threadId,
        userEmail: actorEmail,
        userMessage: message,
        assistantMessage: financeReply,
        metadata: { intent: "finance" },
      });

      return NextResponse.json({
        reply: financeReply,
        confidence: 95,
        sources: [],
        intent: "finance",
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
              actorLabel,
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
            actorLabel,
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
            actorLabel,
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
            actorLabel,
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
    const [corrections, departments, activeInitiatives, costSummary, teamMembers, vendors, signals, liveSnapshot, financialContext, ledgerCtx, financeTruth, capabilityStatus, backlogCtx] =
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
        // Fetch verified ledger data for financial questions (Notion Cash & Transactions DB)
        isFinanceQuestion(message)
          ? fetchLedgerContext(message).catch((err) => {
              console.error("[abra] Ledger fetch failed:", err instanceof Error ? err.message : err);
              return null;
            })
          : Promise.resolve(null),
        // Finance truth layer — verified figures, source hierarchy, COGS truth
        isFinanceQuestion(message)
          ? getFinanceTruthContext().catch((err) => {
              console.error("[abra] Finance truth layer fetch failed:", err instanceof Error ? err.message : err);
              return null as string | null;
            })
          : Promise.resolve(null as string | null),
        // Capability registry — real-time integration health for context
        getCapabilityContext().catch(() => null as string | null),
        // Operational backlog — what Abra needs to work on
        supabaseCircuitOpen ? Promise.resolve(null as string | null) : getBacklogContext().catch(() => null as string | null),
      ]);
    const competitorContext =
      isCompetitorQuestion(message) || messageDepartment === "sales_and_growth"
        ? await fetchCompetitorContext(message)
        : null;

    // Build dynamic context strings for system prompt
    const today = new Date().toISOString().split("T")[0];
    const teamContext = buildTeamContext(teamMembers, vendors, today);
    // Suppress operational signals/alerts for pure finance conversations to prevent
    // irrelevant GitHub CI failures, ops alerts, etc. from polluting accounting answers
    const isFinanceConversation = isFinanceQuestion(message);
    const signalsContext = isFinanceConversation ? "" : buildSignalsContext(signals);

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
    else if (!liveSnapshot.includes("LIVE INBOX")) dataStatus.push("⚠️ Email inbox feed: UNAVAILABLE (Gmail not configured or auth failed). You CANNOT see or check emails. If asked about emails, tell the user you don't have email access right now and ask them to paste the relevant content.");
    if (!financialContext) dataStatus.push("⚠️ Financial KPI data: UNAVAILABLE (no KPI timeseries data returned)");
    // Inject capability health so Claude knows what's up/down right now
    if (capabilityStatus) dataStatus.push(`\n[INTEGRATION HEALTH: ${capabilityStatus}]`);
    const dataStatusLine = dataStatus.length > 0 ? `\n[DATA FEED STATUS: ${dataStatus.join("; ")}. Do NOT invent numbers for unavailable feeds. If brain search failed, tell the user your memory is temporarily unavailable.]` : "";
    // Combine finance truth layer with existing financial context for finance questions
    const enrichedFinancialContext = isFinanceConversation && financeTruth
      ? [financialContext, financeTruth].filter(Boolean).join("\n\n")
      : financialContext;
    const augmentedLiveSnapshot = [liveSnapshot, temporalHint, dataStatusLine, backlogCtx].filter(Boolean).join("\n") || null;

    // Check deadline before expensive LLM call
    if (deadlineController.signal.aborted) {
      throw new DOMException("Deadline exceeded", "AbortError");
    }

    const claudeResult = await generateClaudeReply({
      message,
      history: effectiveHistory,
      tieredResults,
      corrections,
      departments,
      activeInitiatives,
      costSummary,
      financialContext: enrichedFinancialContext,
      ledgerContext: ledgerCtx,
      competitorContext,
      teamContext,
      signalsContext,
      availableActions,
      detectedDepartment: messageDepartment,
      liveSnapshot: augmentedLiveSnapshot,
      deadlineSignal: deadlineController.signal,
      isFinanceRelated: isFinanceQuestion(message),
    });
    // Track Anthropic API success in capability registry
    void capMarkSuccess("anthropic").catch(() => {});
    const actionNotices: string[] = [];
    let baseReply = claudeResult.reply;
    if (!claudeResult.earlyExit) {
      const actionResult = await executeActions(claudeResult.reply);
      baseReply = actionResult.cleanReply;
      actionNotices.push(...actionResult.actionNotices);

      // If we got read-only data back (email, ledger), do a follow-up Claude call with real data injected
      // Skip if we're past 35s to avoid hitting the 50s deadline with a second LLM call
      if (actionResult.readOnlyResults.length > 0 && (Date.now() - startMs) < 35_000) {
        const dataContext = actionResult.readOnlyResults.join("\n\n");
        const followUpResult = await generateClaudeReply({
          message: `The user asked: "${message}"\n\nHere is the data I just retrieved from our systems:\n\n${dataContext}\n\nNow answer the user's original question using this REAL data. Use exact numbers from the data — never estimate or guess. Be specific and actionable.`,
          history: effectiveHistory,
          tieredResults,
          corrections,
          departments,
          activeInitiatives,
          costSummary,
          financialContext: enrichedFinancialContext,
          ledgerContext: ledgerCtx,
          competitorContext,
          teamContext,
          signalsContext,
          availableActions,
          detectedDepartment: messageDepartment,
          liveSnapshot: augmentedLiveSnapshot,
          deadlineSignal: deadlineController.signal,
        });
        baseReply = followUpResult.reply;
        // Strip any action directives from the follow-up (don't double-execute)
        const followUpParsed = parseActionDirectives(baseReply);
        baseReply = followUpParsed.cleanReply || baseReply;
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
    logProvenance({
      message,
      reply,
      sources: responseSources,
      confidence,
      department: messageDepartment,
      actorEmail,
      channel,
      modelUsed: claudeResult.modelUsed,
    });

    // Log unanswered questions
    void logUnansweredQuestions({
      reply,
      confidence,
      sources: responseSources,
      message,
      actorEmail,
    });

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
      actorLabel,
    });

    clearTimeout(deadlineTimer);
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
    clearTimeout(deadlineTimer);

    // Check if this was our deadline abort
    if (deadlineController.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      return NextResponse.json({
        reply: "I'm still gathering data for your request, but I hit my response time limit. Could you try a more specific question, or ask me to focus on just one part of what you need?",
        confidence: 0.3,
        sources: [],
        intent: "timeout",
        thread_id: threadId,
        timeout: true,
      });
    }

    if (isSupabaseRelatedError(error)) {
      await markSupabaseFailure(error);
    }

    // Never leak internal error details (Supabase URLs, stack traces) to client
    const rawMsg = error instanceof Error ? error.message : "Unknown error";
    const safeMessage = rawMsg.includes("supabase") || rawMsg.includes("SUPABASE") || rawMsg.includes("postgresql") || rawMsg.length > 200
      ? "An internal error occurred. Please try again."
      : rawMsg.replace(/https?:\/\/[^\s]+/g, "[redacted]");
    return NextResponse.json({ error: safeMessage }, { status: 500 });
  }
}
