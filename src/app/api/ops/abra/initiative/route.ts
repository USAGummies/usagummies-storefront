/**
 * /api/ops/abra/initiative — Department initiative management
 *
 * POST: Create new initiative { department, goal }
 * GET: Fetch initiatives ?department=finance&status=active
 * PATCH: Update initiative { id, answers?, status? }
 *
 * Flow: create → research → ask questions → receive answers → generate plan → execute
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  canUseSupabase,
  markSupabaseFailure,
  markSupabaseSuccess,
} from "@/lib/ops/supabase-resilience";
import {
  getPlaybook,
  detectDepartment,
  type PlaybookQuestion,
} from "@/lib/ops/department-playbooks";
import { logAICost, extractClaudeUsage } from "@/lib/ops/abra-cost-tracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DEFAULT_CLAUDE_MODEL =
  process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";

type Initiative = {
  id: string;
  department: string;
  title: string | null;
  goal: string;
  status: string;
  baseline_requirements: unknown[];
  custom_requirements: unknown[];
  questions: unknown[];
  answers: Record<string, unknown>;
  tasks: unknown[];
  kpis: unknown[];
  research_findings: unknown[];
  initiated_by: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
};

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}) {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

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

/**
 * Research a department goal — calls the research endpoint internally
 */
async function callResearch(
  query: string,
  department: string,
  host: string,
  cookie: string,
): Promise<{
  findings: { topic: string; summary: string; relevance: string }[];
  baseline_requirements: string[];
  recommendations: string[];
}> {
  const url = `${host}/api/ops/abra/research`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ query, department }),
    signal: AbortSignal.timeout(25000),
  });

  if (!res.ok) {
    // Non-fatal: return empty if research fails
    return { findings: [], baseline_requirements: [], recommendations: [] };
  }

  return res.json();
}

/**
 * Generate a title for the initiative using Claude
 */
async function generateTitle(
  goal: string,
  department: string,
): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return `${department} initiative`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_CLAUDE_MODEL,
        max_tokens: 50,
        temperature: 0.1,
        system:
          "Return ONLY a short title (3-6 words) for a business initiative. No quotes, no explanation.",
        messages: [
          {
            role: "user",
            content: `Department: ${department}\nGoal: ${goal}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json();

    // Log cost
    const usage = extractClaudeUsage(data as Record<string, unknown>);
    if (usage) {
      void logAICost({
        model: DEFAULT_CLAUDE_MODEL,
        provider: "anthropic",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        endpoint: "initiative/title",
        department,
      });
    }

    const content = Array.isArray(data?.content) ? data.content : [];
    const text = content
      .map((item: Record<string, unknown>) =>
        item && "text" in item ? String(item.text || "") : "",
      )
      .join("")
      .trim();
    return text || `${department} initiative`;
  } catch {
    return `${department} initiative`;
  }
}

/**
 * Generate plan (tasks + KPIs) from answered questions using Claude
 */
async function generatePlan(
  initiative: Initiative,
): Promise<{ tasks: unknown[]; kpis: string[] }> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    // Fallback to playbook template
    const playbook = getPlaybook(initiative.department);
    return {
      tasks: playbook?.taskTemplate || [],
      kpis: playbook?.kpis || [],
    };
  }

  const playbook = getPlaybook(initiative.department);
  const today = new Date().toISOString().split("T")[0];

  const systemPrompt = `You are a business operations planner for USA Gummies (small CPG candy company, ~3 people). Today is ${today}.
Generate a detailed task plan based on the initiative answers. Return ONLY valid JSON:
{
  "tasks": [
    { "title": "string", "description": "string (1-2 sentences)", "priority": "critical|high|medium|low", "estimated_hours": number }
  ],
  "kpis": ["kpi_name_snake_case"]
}
Rules:
- 8-15 tasks, ordered by priority and logical sequence
- Be specific to USA Gummies (DTC via Shopify, Amazon marketplace, wholesale via Faire)
- Consider their co-packer Powers Confections in Spokane, WA
- Tasks should be actionable by a small team
- No markdown fences — raw JSON only`;

  const userPrompt = [
    `Department: ${initiative.department}`,
    `Goal: ${initiative.goal}`,
    `Baseline requirements:\n${(initiative.baseline_requirements as string[]).map((r) => `- ${r}`).join("\n")}`,
    `Answers:\n${Object.entries(initiative.answers as Record<string, string>)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join("\n")}`,
    playbook
      ? `Template tasks for reference:\n${playbook.taskTemplate.map((t) => `- [${t.priority}] ${t.title}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_CLAUDE_MODEL,
        max_tokens: 1500,
        temperature: 0.15,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: AbortSignal.timeout(25000),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`Claude failed: ${text.slice(0, 200)}`);

    const data = JSON.parse(text) as Record<string, unknown>;

    // Log cost
    const usage = extractClaudeUsage(data);
    if (usage) {
      void logAICost({
        model: DEFAULT_CLAUDE_MODEL,
        provider: "anthropic",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        endpoint: "initiative/plan",
        department: initiative.department,
      });
    }

    const content = Array.isArray(data.content) ? data.content : [];
    const reply = content
      .map((item) =>
        item && typeof item === "object" && "text" in item
          ? String((item as Record<string, unknown>).text || "")
          : "",
      )
      .join("")
      .trim();

    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      return {
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        kpis: Array.isArray(parsed.kpis) ? (parsed.kpis as string[]) : [],
      };
    }
  } catch {
    // Fallback to playbook
  }

  return {
    tasks: playbook?.taskTemplate || [],
    kpis: playbook?.kpis || [],
  };
}

// ─── POST: Create new initiative ───
async function handlePost(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: { department?: unknown; goal?: unknown } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const goalRaw =
    typeof payload.goal === "string" ? payload.goal.trim() : "";
  if (!goalRaw) {
    return NextResponse.json(
      { error: "goal is required" },
      { status: 400 },
    );
  }

  // Auto-detect department from goal if not provided
  let department =
    typeof payload.department === "string"
      ? payload.department.trim().toLowerCase().replace(/[\s-]+/g, "_")
      : null;
  if (!department) {
    department = detectDepartment(goalRaw);
  }
  if (!department) {
    return NextResponse.json(
      {
        error:
          "Could not determine department. Please specify: finance, operations, sales_and_growth, supply_chain, or executive.",
      },
      { status: 400 },
    );
  }

  try {
    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      return NextResponse.json(
        { error: "Brain temporarily unavailable" },
        { status: 503 },
      );
    }

    // 1. Get playbook
    const playbook = getPlaybook(department);

    // 2. Generate title
    const title = await generateTitle(goalRaw, department);

    // 3. Call research (internal)
    const host =
      process.env.NEXTAUTH_URL ||
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";
    const cookie = req.headers.get("cookie") || "";

    const research = await callResearch(
      `${department} department setup for a CPG gummy candy company: ${goalRaw}`,
      department,
      host,
      cookie,
    );

    // 4. Build questions from playbook + research
    const questions: PlaybookQuestion[] = playbook
      ? [...playbook.questions]
      : [];

    // Add any unique research-driven questions (avoid duplicates)
    const existingKeys = new Set(questions.map((q) => q.key));
    if (research.recommendations.length > 0) {
      // If research found recommendations not covered by playbook, note them
      for (const rec of research.recommendations.slice(0, 3)) {
        const key = `research_${existingKeys.size + 1}`;
        if (!existingKeys.has(key)) {
          questions.push({
            key,
            q: `Based on research: "${rec}" — Does this apply to you?`,
            options: ["yes", "no", "not sure"],
          });
          existingKeys.add(key);
        }
      }
    }

    // 5. Create initiative record
    const rows = (await sbFetch("/rest/v1/abra_initiatives", {
      method: "POST",
      headers: {
        Prefer: "return=representation",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        department,
        title,
        goal: goalRaw,
        status: "asking_questions",
        baseline_requirements: research.baseline_requirements.length > 0
          ? research.baseline_requirements
          : playbook?.baseline || [],
        custom_requirements: [],
        questions,
        answers: {},
        tasks: [],
        kpis: playbook?.kpis || [],
        research_findings: research.findings,
        initiated_by: session.user.email,
      }),
    })) as Initiative[];

    await markSupabaseSuccess();

    const created = rows[0];
    if (!created?.id) {
      throw new Error("Failed to create initiative");
    }

    return NextResponse.json({
      id: created.id,
      department: created.department,
      title: created.title,
      goal: created.goal,
      status: created.status,
      questions: created.questions,
      baseline_requirements: created.baseline_requirements,
      research_findings: created.research_findings,
    });
  } catch (error) {
    if (isSupabaseRelatedError(error)) {
      await markSupabaseFailure(error);
    }
    const message =
      error instanceof Error ? error.message : "Initiative creation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── GET: Fetch initiatives ───
async function handleGet(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const department = url.searchParams.get("department");
  const status = url.searchParams.get("status");
  const id = url.searchParams.get("id");

  try {
    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      return NextResponse.json(
        { error: "Brain temporarily unavailable" },
        { status: 503 },
      );
    }

    let path = "/rest/v1/abra_initiatives?select=*&order=created_at.desc";
    if (id) {
      path += `&id=eq.${id}`;
    }
    if (department) {
      path += `&department=eq.${department}`;
    }
    if (status) {
      if (status === "active") {
        path += `&status=not.in.(completed,paused)`;
      } else {
        path += `&status=eq.${status}`;
      }
    }
    path += "&limit=20";

    const results = (await sbFetch(path)) as Initiative[];
    await markSupabaseSuccess();

    return NextResponse.json({ initiatives: results });
  } catch (error) {
    if (isSupabaseRelatedError(error)) {
      await markSupabaseFailure(error);
    }
    const message =
      error instanceof Error ? error.message : "Fetch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── PATCH: Update initiative (answers, status) ───
async function handlePatch(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: {
    id?: unknown;
    answers?: unknown;
    status?: unknown;
  } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) {
    return NextResponse.json(
      { error: "id is required" },
      { status: 400 },
    );
  }

  try {
    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      return NextResponse.json(
        { error: "Brain temporarily unavailable" },
        { status: 503 },
      );
    }

    // Fetch current initiative
    const existing = (await sbFetch(
      `/rest/v1/abra_initiatives?id=eq.${id}&select=*`,
    )) as Initiative[];
    if (existing.length === 0) {
      return NextResponse.json(
        { error: "Initiative not found" },
        { status: 404 },
      );
    }

    const initiative = existing[0];
    const updates: Record<string, unknown> = {};

    // Merge answers
    if (payload.answers && typeof payload.answers === "object") {
      const currentAnswers =
        (initiative.answers as Record<string, unknown>) || {};
      updates.answers = { ...currentAnswers, ...payload.answers };
    }

    // If answers provided and all questions answered → generate plan
    if (updates.answers) {
      const questions = initiative.questions as PlaybookQuestion[];
      const answers = updates.answers as Record<string, string>;
      const requiredKeys = questions.map((q) => q.key);
      const answeredKeys = Object.keys(answers);

      // Check if all required questions have answers (or defaults)
      const allAnswered = requiredKeys.every(
        (key) =>
          answeredKeys.includes(key) ||
          questions.find((q) => q.key === key)?.default,
      );

      if (allAnswered) {
        // Fill in defaults for unanswered questions
        for (const q of questions) {
          if (!answers[q.key] && q.default) {
            answers[q.key] = q.default;
          }
        }
        updates.answers = answers;

        // Generate plan
        const plan = await generatePlan({
          ...initiative,
          answers: answers,
        });
        updates.tasks = plan.tasks;
        updates.kpis = plan.kpis;
        updates.status = "approved";
        updates.approved_by = session.user.email;
      } else {
        updates.status = "asking_questions";
      }
    }

    // Manual status override
    if (
      typeof payload.status === "string" &&
      [
        "researching",
        "planning",
        "asking_questions",
        "approved",
        "executing",
        "paused",
        "completed",
      ].includes(payload.status)
    ) {
      updates.status = payload.status;
    }

    // Apply updates
    const updated = (await sbFetch(
      `/rest/v1/abra_initiatives?id=eq.${id}`,
      {
        method: "PATCH",
        headers: {
          Prefer: "return=representation",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      },
    )) as Initiative[];

    await markSupabaseSuccess();

    return NextResponse.json({
      initiative: updated[0] || { ...initiative, ...updates },
    });
  } catch (error) {
    if (isSupabaseRelatedError(error)) {
      await markSupabaseFailure(error);
    }
    const message =
      error instanceof Error ? error.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return handlePost(req);
}

export async function GET(req: Request) {
  return handleGet(req);
}

export async function PATCH(req: Request) {
  return handlePatch(req);
}
