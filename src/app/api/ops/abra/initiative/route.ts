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
import { notify } from "@/lib/ops/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DEFAULT_CLAUDE_MODEL =
  process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";

type DependencyRelationship = "blocks" | "informs" | "requires" | "enables";

type DependencyRow = {
  id: string;
  initiative_id: string;
  depends_on_id: string;
  relationship_type: DependencyRelationship;
  created_at?: string;
};

type DependencyNode = {
  dependency_id: string;
  initiative_id: string;
  title: string;
  department: string;
  status: string;
  relationship_type: DependencyRelationship;
};

type DependencyView = {
  blocks: DependencyNode[];
  blocked_by: DependencyNode[];
  informs: DependencyNode[];
  informed_by: DependencyNode[];
};

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

type InitiativeTask = {
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  department: string;
  estimated_hours?: number;
  depends_on?: string[];
};

type InitiativeKpiTarget = {
  metric: string;
  target: string;
  timeframe: string;
  baseline?: string;
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

function valueToString(value: unknown, fallback = "TBD"): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function fillTemplate(
  template: string,
  answers: Record<string, unknown>,
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) =>
    valueToString(answers[key], key.replace(/_/g, " ")),
  );
}

function buildTasksFromTemplate(
  department: string,
  taskTemplate: Array<{
    title: string;
    description: string;
    priority: "critical" | "high" | "medium" | "low";
    estimated_hours?: number;
    depends_on?: string[];
  }>,
  answers: Record<string, unknown>,
): InitiativeTask[] {
  return taskTemplate.map((task) => ({
    title: fillTemplate(task.title, answers),
    description: fillTemplate(task.description, answers),
    priority: task.priority,
    department,
    estimated_hours: task.estimated_hours,
    depends_on: task.depends_on,
  }));
}

function buildKpiTargets(
  kpis: string[],
  answers: Record<string, unknown>,
): InitiativeKpiTarget[] {
  return kpis.map((kpi) => {
    const baselineValue =
      answers.current_baseline ||
      answers.current_metric ||
      answers.current_state;
    const targetValue =
      answers.target ||
      answers.target_outcome ||
      answers.goal ||
      "Improve by 10-20% from baseline";

    return {
      metric: kpi,
      target: typeof targetValue === "string" ? targetValue : String(targetValue),
      timeframe: valueToString(answers.timeframe, "90 days"),
      ...(baselineValue
        ? { baseline: valueToString(baselineValue) }
        : {}),
    };
  });
}

function inClause(values: string[]): string {
  return encodeURIComponent(`(${values.join(",")})`);
}

function normalizeRelationship(value: unknown): DependencyRelationship {
  if (
    typeof value === "string" &&
    ["blocks", "informs", "requires", "enables"].includes(value)
  ) {
    return value as DependencyRelationship;
  }
  return "blocks";
}

function emptyDependencyView(): DependencyView {
  return {
    blocks: [],
    blocked_by: [],
    informs: [],
    informed_by: [],
  };
}

function parseInitialDependencies(
  raw: unknown,
): Array<{ depends_on_id: string; relationship_type: DependencyRelationship }> {
  if (!Array.isArray(raw)) return [];
  const parsed: Array<{ depends_on_id: string; relationship_type: DependencyRelationship }> = [];

  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      parsed.push({
        depends_on_id: item.trim(),
        relationship_type: "blocks",
      });
      continue;
    }

    if (item && typeof item === "object") {
      const dep = item as Record<string, unknown>;
      const dependsOnId =
        typeof dep.depends_on_id === "string"
          ? dep.depends_on_id
          : typeof dep.initiative_id === "string"
            ? dep.initiative_id
            : "";
      if (!dependsOnId.trim()) continue;
      parsed.push({
        depends_on_id: dependsOnId.trim(),
        relationship_type: normalizeRelationship(
          dep.relationship_type || dep.relationship,
        ),
      });
    }
  }

  const seen = new Set<string>();
  return parsed.filter((dep) => {
    const key = `${dep.depends_on_id}:${dep.relationship_type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function addDependencies(
  initiativeId: string,
  deps: Array<{ depends_on_id: string; relationship_type: DependencyRelationship }>,
): Promise<void> {
  if (!deps.length) return;

  const rows = deps
    .filter((dep) => dep.depends_on_id !== initiativeId)
    .map((dep) => ({
      initiative_id: initiativeId,
      depends_on_id: dep.depends_on_id,
      relationship_type: dep.relationship_type,
    }));

  if (!rows.length) return;

  await sbFetch("/rest/v1/abra_initiative_dependencies", {
    method: "POST",
    headers: {
      Prefer: "resolution=ignore-duplicates,return=minimal",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(rows),
  });
}

async function removeDependency(initiativeId: string, dependencyId: string): Promise<void> {
  if (!initiativeId || !dependencyId) return;
  await sbFetch(
    `/rest/v1/abra_initiative_dependencies?id=eq.${dependencyId}&initiative_id=eq.${initiativeId}`,
    { method: "DELETE", headers: { Prefer: "return=minimal" } },
  );
}

async function buildDependencyViews(
  initiatives: Initiative[],
): Promise<Record<string, DependencyView>> {
  const initiativeIds = initiatives.map((initiative) => initiative.id).filter(Boolean);
  const views: Record<string, DependencyView> = {};
  for (const id of initiativeIds) {
    views[id] = emptyDependencyView();
  }
  if (!initiativeIds.length) return views;

  const [outgoing, incoming] = (await Promise.all([
    sbFetch(
      `/rest/v1/abra_initiative_dependencies?initiative_id=in.${inClause(initiativeIds)}&select=id,initiative_id,depends_on_id,relationship_type,created_at&limit=500`,
    ),
    sbFetch(
      `/rest/v1/abra_initiative_dependencies?depends_on_id=in.${inClause(initiativeIds)}&select=id,initiative_id,depends_on_id,relationship_type,created_at&limit=500`,
    ),
  ])) as [DependencyRow[], DependencyRow[]];

  const allDeps = [...outgoing, ...incoming];
  if (!allDeps.length) return views;

  const relatedIds = new Set<string>(initiativeIds);
  for (const dep of allDeps) {
    if (dep.initiative_id) relatedIds.add(dep.initiative_id);
    if (dep.depends_on_id) relatedIds.add(dep.depends_on_id);
  }

  const relatedRows = (await sbFetch(
    `/rest/v1/abra_initiatives?id=in.${inClause(Array.from(relatedIds))}&select=id,title,department,status&limit=500`,
  )) as Array<{ id: string; title: string | null; department: string | null; status: string | null }>;
  const relatedMap = new Map(relatedRows.map((row) => [row.id, row]));

  function makeNode(depId: string, id: string, relationship: DependencyRelationship): DependencyNode {
    const row = relatedMap.get(id);
    return {
      dependency_id: depId,
      initiative_id: id,
      title: row?.title || "Untitled initiative",
      department: row?.department || "unknown",
      status: row?.status || "unknown",
      relationship_type: relationship,
    };
  }

  for (const dep of allDeps) {
    const sourceId = dep.initiative_id;
    const targetId = dep.depends_on_id;
    if (!sourceId || !targetId) continue;
    if (!views[sourceId]) views[sourceId] = emptyDependencyView();
    if (!views[targetId]) views[targetId] = emptyDependencyView();

    const sourceView = views[sourceId];
    const targetView = views[targetId];
    const sourceToTarget = makeNode(dep.id, targetId, dep.relationship_type);
    const targetToSource = makeNode(dep.id, sourceId, dep.relationship_type);

    if (dep.relationship_type === "blocks" || dep.relationship_type === "requires") {
      sourceView.blocked_by.push(sourceToTarget);
      targetView.blocks.push(targetToSource);
      continue;
    }

    sourceView.informed_by.push(sourceToTarget);
    targetView.informs.push(targetToSource);
  }

  return views;
}

async function notifyDependencyStatusChange(
  initiative: Initiative,
  nextStatus: string,
): Promise<void> {
  if (!["completed", "paused"].includes(nextStatus)) return;

  const rows = (await sbFetch(
    `/rest/v1/abra_initiative_dependencies?depends_on_id=eq.${initiative.id}&relationship_type=in.${encodeURIComponent("(blocks,requires)")}&select=id,initiative_id,depends_on_id,relationship_type`,
  )) as DependencyRow[];

  if (!rows.length) return;

  const blockedIds = Array.from(new Set(rows.map((row) => row.initiative_id)));
  if (!blockedIds.length) return;

  const blockedRows = (await sbFetch(
    `/rest/v1/abra_initiatives?id=in.${inClause(blockedIds)}&select=id,title,department,status&limit=500`,
  )) as Array<{ id: string; title: string | null; department: string | null; status: string | null }>;

  const title = initiative.title || initiative.goal || "Untitled initiative";
  const dept = initiative.department.replace(/_/g, " ");
  const actionText =
    nextStatus === "completed"
      ? `${title} (${dept}) is now complete.`
      : `${title} (${dept}) is now paused.`;

  const lines = blockedRows.map((row) => {
    const blockedTitle = row.title || "Untitled initiative";
    const blockedDept = (row.department || "unknown").replace(/_/g, " ");
    if (nextStatus === "completed") {
      return `• This unblocks: "${blockedTitle}" (${blockedDept})`;
    }
    return `• Impacted: "${blockedTitle}" (${blockedDept})`;
  });

  await notify({
    channel: "alerts",
    text: `${nextStatus === "completed" ? "🔓 *Blocker Resolved*" : "⏸️ *Blocker Status Changed*"}\n${actionText}\n${lines.join("\n")}`,
  });
}

// ─── POST: Create new initiative ───
async function handlePost(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: { department?: unknown; goal?: unknown; depends_on?: unknown[] } = {};
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
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000");
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

    // 5. Parse optional dependency links for this initiative
    const dependencies = parseInitialDependencies(payload.depends_on);

    // 6. Create initiative record
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

    await addDependencies(created.id, dependencies);
    const dependencyViews = await buildDependencyViews([created]);
    const view = dependencyViews[created.id] || emptyDependencyView();

    return NextResponse.json({
      id: created.id,
      department: created.department,
      title: created.title,
      goal: created.goal,
      status: created.status,
      questions: created.questions,
      baseline_requirements: created.baseline_requirements,
      research_findings: created.research_findings,
      blocks: view.blocks,
      blocked_by: view.blocked_by,
      informs: view.informs,
      informed_by: view.informed_by,
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
  const includeDependencies = url.searchParams.get("include_dependencies") === "true";

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
    const dependencyViews = includeDependencies
      ? await buildDependencyViews(results)
      : {};
    await markSupabaseSuccess();

    const initiatives = includeDependencies
      ? results.map((initiative) => ({
          ...initiative,
          ...(dependencyViews[initiative.id] || emptyDependencyView()),
        }))
      : results;

    return NextResponse.json({ initiatives });
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
    add_dependency?: unknown;
    remove_dependency?: unknown;
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

    const playbook = getPlaybook(initiative.department);
    const playbookQuestions = playbook?.questions || [];

    // Merge answers
    if (payload.answers && typeof payload.answers === "object") {
      const currentAnswers =
        (initiative.answers as Record<string, unknown>) || {};
      const mergedAnswers = { ...currentAnswers, ...payload.answers };

      const questionsFromInitiative = Array.isArray(initiative.questions)
        ? (initiative.questions as PlaybookQuestion[])
        : [];
      const questions =
        questionsFromInitiative.length > 0
          ? questionsFromInitiative
          : playbookQuestions;

      const normalizedAnswers: Record<string, unknown> = { ...mergedAnswers };
      for (const question of questions) {
        if (
          (normalizedAnswers[question.key] === undefined ||
            normalizedAnswers[question.key] === null ||
            valueToString(normalizedAnswers[question.key], "").trim() === "") &&
          question.default
        ) {
          normalizedAnswers[question.key] = question.default;
        }
      }

      updates.answers = normalizedAnswers;

      const requiredKeys = questions.map((q) => q.key);
      const allAnswered = requiredKeys.every((key) => {
        const value = normalizedAnswers[key];
        return valueToString(value, "").trim().length > 0;
      });

      if (allAnswered && playbook) {
        updates.tasks = buildTasksFromTemplate(
          initiative.department,
          playbook.taskTemplate,
          normalizedAnswers,
        );
        updates.kpis = buildKpiTargets(playbook.kpis, normalizedAnswers);
        updates.status = "approved";
        updates.approved_by = session.user.email;
      } else if (allAnswered) {
        updates.status = "approved";
        updates.approved_by = session.user.email;
      } else {
        updates.status = "asking_questions";
      }
    }

    // Dependency management (table-backed)
    if (payload.add_dependency && typeof payload.add_dependency === "object") {
      const dep = payload.add_dependency as Record<string, unknown>;
      const dependsOnId =
        typeof dep.depends_on_id === "string"
          ? dep.depends_on_id.trim()
          : "";
      const relationshipType = normalizeRelationship(dep.relationship_type);
      if (dependsOnId) {
        await addDependencies(id, [
          {
            depends_on_id: dependsOnId,
            relationship_type: relationshipType,
          },
        ]);
      }
    }

    const removeDependencyId =
      payload.remove_dependency &&
      typeof payload.remove_dependency === "object" &&
      typeof (payload.remove_dependency as Record<string, unknown>).dependency_id === "string"
        ? ((payload.remove_dependency as Record<string, unknown>)
            .dependency_id as string)
        : typeof payload.remove_dependency === "string"
          ? payload.remove_dependency
          : "";
    if (removeDependencyId) {
      await removeDependency(id, removeDependencyId);
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
    const updated =
      Object.keys(updates).length > 0
        ? ((await sbFetch(
            `/rest/v1/abra_initiatives?id=eq.${id}`,
            {
              method: "PATCH",
              headers: {
                Prefer: "return=representation",
                "Content-Type": "application/json",
              },
              body: JSON.stringify(updates),
            },
          )) as Initiative[])
        : [initiative];

    await markSupabaseSuccess();

    const updatedInitiative = updated[0] || { ...initiative, ...updates };
    if (
      initiative.status !== updatedInitiative.status &&
      (updatedInitiative.status === "completed" ||
        updatedInitiative.status === "paused")
    ) {
      void notifyDependencyStatusChange(
        updatedInitiative,
        updatedInitiative.status,
      ).catch(() => {});
    }
    const dependencyViews = await buildDependencyViews([updatedInitiative]);
    const enrichedInitiative = {
      ...updatedInitiative,
      ...(dependencyViews[updatedInitiative.id] || emptyDependencyView()),
    };
    return NextResponse.json({
      initiative: enrichedInitiative,
      plan:
        updatedInitiative.status === "approved"
          ? {
              tasks: Array.isArray(updatedInitiative.tasks)
                ? updatedInitiative.tasks
                : [],
              kpis: Array.isArray(updatedInitiative.kpis)
                ? updatedInitiative.kpis
                : [],
            }
          : null,
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
