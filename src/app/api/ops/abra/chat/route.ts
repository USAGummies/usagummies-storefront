/**
 * POST /api/ops/abra/chat — Web chat endpoint for Abra
 *
 * Body: { message: string, history?: ChatMessage[] }
 * Returns: { reply: string, sources: [...], confidence: number }
 *
 * Uses temporal search + dynamic system prompt for accurate, recency-aware answers.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
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
import { logAICost, extractClaudeUsage, getMonthlySpend } from "@/lib/ops/abra-cost-tracker";
import { searchTiered, buildTieredContext, type TieredSearchResult } from "@/lib/ops/abra-memory-tiers";
import { logAnswer, extractProvenance } from "@/lib/ops/abra-source-provenance";
import { getTeamMembers, getVendors, buildTeamContext } from "@/lib/ops/abra-team-directory";
import { getActiveSignals, buildSignalsContext } from "@/lib/ops/abra-operational-signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DEFAULT_MATCH_COUNT = 8;
const DEFAULT_CLAUDE_MODEL =
  process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
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
        item.role === "assistant" ? "assistant" : "user";
      return {
        role,
        content:
          typeof item.content === "string" ? item.content.trim() : "",
      };
    })
    .filter((item) => item.content.length > 0)
    .slice(-12);
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
    };
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
      "/rest/v1/abra_departments?select=name,owner_name,description,key_context&order=name",
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

async function generateClaudeReply(input: {
  message: string;
  history: ChatMessage[];
  tieredResults: TieredSearchResult;
  corrections: AbraCorrection[];
  departments: AbraDepartment[];
  activeInitiatives?: AbraInitiativeContext[];
  costSummary?: AbraCostContext | null;
  teamContext?: string;
  signalsContext?: string;
}) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const systemPrompt = buildAbraSystemPrompt({
    format: "web",
    corrections: input.corrections,
    departments: input.departments,
    activeInitiatives: input.activeInitiatives,
    costSummary: input.costSummary,
    teamContext: input.teamContext,
    signalsContext: input.signalsContext,
  });

  const historyText = buildConversation(input.history);
  const contextText = buildTieredContext(input.tieredResults);
  const confidence = computeConfidence(input.tieredResults.all);

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

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_CLAUDE_MODEL,
      max_tokens: 900,
      temperature: 0.2,
      system: systemPrompt,
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
      model: DEFAULT_CLAUDE_MODEL,
      provider: "anthropic",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      endpoint: "chat",
    });
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

  return reply;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: { message?: unknown; history?: unknown } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  const message =
    typeof payload.message === "string" ? payload.message.trim() : "";
  if (!message) {
    return NextResponse.json(
      { error: "message is required" },
      { status: 400 },
    );
  }

  const history = sanitizeHistory(payload.history);

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

      return NextResponse.json({
        reply: costReply,
        confidence: 1,
        sources: [],
        intent: "cost",
      });
    }

    // If there is an active initiative in question phase and this message looks
    // like answers, auto-route to initiative PATCH flow.
    const initiativeDepartmentHint = detectDepartment(message);
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

            return NextResponse.json({
              reply: approvedReply,
              confidence: 1,
              sources: [],
              intent: "initiative_answers",
              initiative_id: updated.id || activeAskingInitiative.id,
              plan: patchData?.plan || null,
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

          return NextResponse.json({
            reply:
              openQuestions.length > 0
                ? `Captured those answers for **${updated?.title || activeAskingInitiative.title || "your initiative"}**. I still need:\n\n${questionList}`
                : `Captured those answers for **${updated?.title || activeAskingInitiative.title || "your initiative"}**.`,
            confidence: 1,
            sources: [],
            intent: "initiative_answers",
            initiative_id: updated?.id || activeAskingInitiative.id,
            plan: patchData?.plan || null,
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

          return NextResponse.json({
            reply: initReply,
            confidence: 1,
            sources: [],
            intent: "initiative",
            initiative_id: initData.id,
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

          return NextResponse.json({
            reply: sessReply,
            confidence: 1,
            sources: [],
            intent: "session",
            session_id: sessData.id,
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

    // Build dynamic context strings for system prompt
    const today = new Date().toISOString().split("T")[0];
    const teamContext = buildTeamContext(teamMembers, vendors, today);
    const signalsContext = buildSignalsContext(signals);

    const confidence = computeConfidence(tieredResults.all);

    const reply = await generateClaudeReply({
      message,
      history,
      tieredResults,
      corrections,
      departments,
      activeInitiatives,
      costSummary,
      teamContext,
      signalsContext,
    });

    // Log answer provenance (best-effort, non-blocking)
    const provenance = extractProvenance(tieredResults.all);
    void logAnswer({
      question: message,
      answer: reply,
      source_ids: provenance.source_ids,
      source_tables: provenance.source_tables,
      confidence,
      memory_tiers_used: provenance.memory_tiers_used,
      department: detectDepartment(message),
      asked_by: session.user.email,
      channel: "web",
      model_used: DEFAULT_CLAUDE_MODEL,
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
          session.user.email,
          `Original question: ${message}`,
        );
      }
    }

    return NextResponse.json({
      reply,
      confidence,
      tierCounts: tieredResults.tierCounts,
      sources: tieredResults.all.map((row) => ({
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
