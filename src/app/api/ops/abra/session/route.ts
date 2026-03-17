/**
 * /api/ops/abra/session — Meeting & session management
 *
 * POST: Start session { department?, initiative_id?, session_type }
 * GET: Fetch sessions ?department=finance&status=active
 * PATCH: Update session { id, notes?, action_items?, decisions?, status? }
 * DELETE: End session { id } — saves to brain, creates tasks, completes
 *
 * Session types: meeting, review, teaching, research, planning
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  canUseSupabase,
  markSupabaseFailure,
  markSupabaseSuccess,
} from "@/lib/ops/supabase-resilience";
import { logAICost, extractClaudeUsage } from "@/lib/ops/abra-cost-tracker";
import {
  createMeetingNotesPage,
  notionPageUrlFromId,
} from "@/lib/ops/abra-notion-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DEFAULT_CLAUDE_MODEL =
  process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

const VALID_SESSION_TYPES = [
  "meeting",
  "review",
  "teaching",
  "research",
  "planning",
] as const;

type ScratchpadEntry = {
  key: string;
  value: unknown;
  reasoning?: string;
  timestamp: string;
};

type Session = {
  id: string;
  department: string | null;
  initiative_id: string | null;
  session_type: string;
  title: string | null;
  agenda: unknown[];
  notes: unknown[];
  action_items: unknown[];
  decisions: unknown[];
  open_questions: unknown[];
  scratchpad: ScratchpadEntry[];
  user_email: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
    );
  }
  return json;
}

function isSupabaseRelatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /supabase|rest\/v1|service_role|SUPABASE/i.test(message);
}

/**
 * Auto-generate agenda from open items for a department
 */
async function buildAgenda(
  department: string | null,
  initiativeId: string | null,
): Promise<string[]> {
  const agenda: string[] = [];

  try {
    // 1. Open initiative questions
    if (initiativeId) {
      const initiatives = (await sbFetch(
        `/rest/v1/abra_initiatives?id=eq.${encodeURIComponent(initiativeId)}&select=title,goal,status,questions,answers`,
      )) as Array<{
        title: string;
        goal: string;
        status: string;
        questions: Array<{ key: string; q: string }>;
        answers: Record<string, string>;
      }>;

      if (initiatives.length > 0) {
        const init = initiatives[0];
        agenda.push(`Review initiative: ${init.title || init.goal}`);

        // Count unanswered questions
        const unanswered = (init.questions || []).filter(
          (q) => !init.answers?.[q.key],
        );
        if (unanswered.length > 0) {
          agenda.push(
            `Answer ${unanswered.length} open question${unanswered.length > 1 ? "s" : ""} for initiative`,
          );
        }
      }
    } else if (department) {
      // Get active initiatives for department
      const initiatives = (await sbFetch(
        `/rest/v1/abra_initiatives?department=eq.${encodeURIComponent(department)}&status=not.in.(completed,paused)&select=title,status&limit=5`,
      )) as Array<{ title: string; status: string }>;

      if (initiatives.length > 0) {
        agenda.push(
          `Review ${initiatives.length} active initiative${initiatives.length > 1 ? "s" : ""}`,
        );
        for (const init of initiatives.slice(0, 3)) {
          agenda.push(`  → ${init.title} (${init.status})`);
        }
      }
    }

    // 2. Unanswered questions for department
    if (department) {
      const questions = (await sbFetch(
        `/rest/v1/abra_unanswered_questions?department=eq.${encodeURIComponent(department)}&status=eq.open&select=question&limit=5&order=created_at.desc`,
      )) as Array<{ question: string }>;

      if (questions.length > 0) {
        agenda.push(
          `Address ${questions.length} unanswered question${questions.length > 1 ? "s" : ""}`,
        );
      }
    }

    // 3. Active tasks for department
    if (department) {
      try {
        const activeTasks = (await sbFetch(
          `/rest/v1/abra_tasks?department=eq.${encodeURIComponent(department)}&status=in.(pending,in_progress)&select=id&limit=20`,
        )) as Array<{ id: string }>;

        if (activeTasks.length > 0) {
          agenda.push(
            `Review ${activeTasks.length} active task${activeTasks.length > 1 ? "s" : ""}`,
          );
        }
      } catch {
        // Best-effort only — some environments may still use legacy task tables.
      }
    }

    // 4. Recent corrections to review
    if (department) {
      const corrections = (await sbFetch(
        `/rest/v1/abra_corrections?department=eq.${encodeURIComponent(department)}&active=eq.true&select=correction&limit=3&order=created_at.desc`,
      )) as Array<{ correction: string }>;

      if (corrections.length > 0) {
        agenda.push(`Review ${corrections.length} recent correction${corrections.length > 1 ? "s" : ""}`);
      }
    }
  } catch {
    // Best-effort agenda building — don't fail if some queries error
  }

  // Always add standard items
  if (agenda.length === 0) {
    agenda.push("Review current priorities");
    agenda.push("Discuss blockers and needs");
  }
  agenda.push("Action items and next steps");

  return agenda;
}

/**
 * Generate session title using Claude
 */
async function generateSessionTitle(
  sessionType: string,
  department: string | null,
  agenda: string[],
): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return `${department || "General"} ${sessionType}`;
  }

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
        max_tokens: 40,
        temperature: 0.1,
        system:
          "Return ONLY a short title (3-7 words) for a business meeting/session. No quotes, no explanation.",
        messages: [
          {
            role: "user",
            content: `Type: ${sessionType}\nDepartment: ${department || "general"}\nAgenda: ${agenda.slice(0, 3).join(", ")}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json();
    const usage = extractClaudeUsage(data as Record<string, unknown>);
    if (usage) {
      void logAICost({
        model: DEFAULT_CLAUDE_MODEL,
        provider: "anthropic",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        endpoint: "session/title",
        department: department || undefined,
      });
    }

    const content = Array.isArray(data?.content) ? data.content : [];
    const text = content
      .map((item: Record<string, unknown>) =>
        item && "text" in item ? String(item.text || "") : "",
      )
      .join("")
      .trim();
    return text || `${department || "General"} ${sessionType}`;
  } catch {
    return `${department || "General"} ${sessionType}`;
  }
}

/**
 * Save session summary to brain as a knowledge entry
 */
async function saveSessionToBrain(session: Session): Promise<void> {
  const notes = Array.isArray(session.notes) ? session.notes : [];
  const decisions = Array.isArray(session.decisions) ? session.decisions : [];
  const actionItems = Array.isArray(session.action_items)
    ? session.action_items
    : [];
  const scratchpad = Array.isArray(session.scratchpad) ? session.scratchpad : [];

  if (notes.length === 0 && decisions.length === 0) return;

  const summaryParts = [
    `Session: ${session.title || session.session_type}`,
    session.department ? `Department: ${session.department}` : "",
    notes.length > 0
      ? `Notes:\n${notes.map((n) => `- ${typeof n === "string" ? n : JSON.stringify(n)}`).join("\n")}`
      : "",
    decisions.length > 0
      ? `Decisions:\n${decisions.map((d) => `- ${typeof d === "string" ? d : JSON.stringify(d)}`).join("\n")}`
      : "",
    actionItems.length > 0
      ? `Action Items:\n${actionItems.map((a) => `- ${typeof a === "string" ? a : JSON.stringify(a)}`).join("\n")}`
      : "",
    scratchpad.length > 0
      ? `Reasoning Notes:\n${scratchpad.map((s) => `- [${s.key}] ${typeof s.value === "string" ? s.value : JSON.stringify(s.value)}${s.reasoning ? ` (reasoning: ${s.reasoning})` : ""}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // Build embedding for the summary
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return;

  try {
    const embRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: summaryParts.slice(0, 2000),
        dimensions: 1536,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!embRes.ok) return;

    const embData = await embRes.json();
    const embedding = embData?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) return;

    // Log embedding cost
    const tokens = embData?.usage?.total_tokens || 0;
    void logAICost({
      model: "text-embedding-3-small",
      provider: "openai",
      inputTokens: tokens,
      outputTokens: 0,
      endpoint: "session/embed",
    });

    // Insert brain entry
    await sbFetch("/rest/v1/open_brain_entries", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_type: "session",
        source_ref: session.id,
        entry_type: "session_summary",
        title: `Session: ${session.title || session.session_type} (${new Date().toISOString().split("T")[0]})`,
        raw_text: summaryParts,
        summary_text: summaryParts.slice(0, 500),
        // Keep session summaries inside the existing category constraint.
        category: "operational",
        department: session.department,
        confidence: "medium",
        priority: "normal",
        processed: true,
        embedding,
      }),
    });
  } catch (error) {
    console.error("[abra/session] saveSessionToBrain failed:", error);
  }
}

function normalizeActionItems(actionItems: unknown[]): Array<{
  title: string;
  description?: string;
  priority: "critical" | "high" | "normal" | "low";
}> {
  const normalized: Array<{
    title: string;
    description?: string;
    priority: "critical" | "high" | "normal" | "low";
  }> = [];

  for (const item of actionItems) {
    if (typeof item === "string" && item.trim()) {
      normalized.push({
        title: item.trim().slice(0, 160),
        description: item.trim().slice(0, 1000),
        priority: "high",
      });
      continue;
    }
    if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      const title = typeof row.title === "string"
        ? row.title.trim()
        : typeof row.task === "string"
          ? row.task.trim()
          : "";
      if (!title) continue;
      const priorityRaw =
        typeof row.priority === "string" ? row.priority.toLowerCase() : "normal";
      const priority: "critical" | "high" | "normal" | "low" =
        priorityRaw === "critical" ||
        priorityRaw === "high" ||
        priorityRaw === "normal" ||
        priorityRaw === "low"
          ? priorityRaw
          : "normal";
      normalized.push({
        title: title.slice(0, 160),
        description:
          typeof row.description === "string"
            ? row.description.slice(0, 1000)
            : undefined,
        priority,
      });
    }
  }
  return normalized;
}

async function createTasksFromActionItems(
  session: Session,
): Promise<{ createdCount: number; table: "abra_tasks" | "tasks" | null }> {
  const actionItems = Array.isArray(session.action_items)
    ? session.action_items
    : [];
  const tasks = normalizeActionItems(actionItems);
  if (tasks.length === 0) return { createdCount: 0, table: null };

  const payloadForAbraTasks = tasks.map((task) => ({
    department: session.department,
    session_id: session.id,
    title: task.title,
    description: task.description || null,
    priority: task.priority,
    status: "pending",
    source: "session_action_item",
  }));

  try {
    await sbFetch("/rest/v1/abra_tasks", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payloadForAbraTasks),
    });
    return { createdCount: payloadForAbraTasks.length, table: "abra_tasks" };
  } catch {
    // Fallback to legacy core tasks table.
  }

  const payloadForLegacyTasks = tasks.map((task) => ({
    task_type: "analysis",
    title: task.title,
    description:
      task.description ||
      `Action item from session ${session.title || session.id} (${session.department || "general"}).`,
    priority: task.priority,
    status: "pending",
    input_ref: `session:${session.id}`,
  }));

  try {
    await sbFetch("/rest/v1/tasks", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payloadForLegacyTasks),
    });
    return { createdCount: payloadForLegacyTasks.length, table: "tasks" };
  } catch {
    return { createdCount: 0, table: null };
  }
}

// ─── POST: Start new session ───
async function handlePost(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userSession = await auth();
  const actorEmail = userSession?.user?.email || "cron@system";

  let payload: {
    department?: unknown;
    initiative_id?: unknown;
    session_type?: unknown;
  } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sessionType =
    typeof payload.session_type === "string"
      ? payload.session_type.trim().toLowerCase()
      : "meeting";

  if (
    !VALID_SESSION_TYPES.includes(
      sessionType as (typeof VALID_SESSION_TYPES)[number],
    )
  ) {
    return NextResponse.json(
      {
        error: `Invalid session_type. Must be one of: ${VALID_SESSION_TYPES.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const department =
    typeof payload.department === "string"
      ? payload.department.trim().toLowerCase()
      : null;
  const initiativeIdRaw =
    typeof payload.initiative_id === "string"
      ? payload.initiative_id.trim()
      : null;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const initiativeId = initiativeIdRaw && UUID_RE.test(initiativeIdRaw) ? initiativeIdRaw : null;

  try {
    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      return NextResponse.json(
        { error: "Brain temporarily unavailable" },
        { status: 503 },
      );
    }

    // Build agenda from open items
    const agenda = await buildAgenda(department, initiativeId);

    // Generate title
    const title = await generateSessionTitle(sessionType, department, agenda);

    // Create session
    const rows = (await sbFetch("/rest/v1/abra_sessions", {
      method: "POST",
      headers: {
        Prefer: "return=representation",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        department,
        initiative_id: initiativeId,
        session_type: sessionType,
        title,
        agenda,
        notes: [],
        action_items: [],
        decisions: [],
        open_questions: [],
        scratchpad: [],
        user_email: actorEmail,
        status: "active",
        started_at: new Date().toISOString(),
      }),
    })) as Session[];

    await markSupabaseSuccess();

    const created = rows[0];
    if (!created?.id) {
      throw new Error("Failed to create session");
    }

    return NextResponse.json({
      id: created.id,
      title: created.title,
      session_type: created.session_type,
      department: created.department,
      initiative_id: created.initiative_id,
      agenda: created.agenda,
      status: created.status,
      started_at: created.started_at,
    });
  } catch (error) {
    if (isSupabaseRelatedError(error)) {
      await markSupabaseFailure(error);
    }
    const message =
      error instanceof Error ? error.message : "Session creation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── GET: Fetch sessions ───
async function handleGet(req: Request) {
  if (!(await isAuthorized(req))) {
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

    let path = "/rest/v1/abra_sessions?select=*&order=created_at.desc";
    if (id) {
      // Validate UUID format to prevent PostgREST filter manipulation
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
      }
      path += `&id=eq.${id}`;
    }
    if (department) path += `&department=eq.${encodeURIComponent(department.slice(0, 50))}`;
    if (status) {
      const safeStatus = status.replace(/[^a-z_]/gi, "").slice(0, 20);
      path += `&status=eq.${safeStatus}`;
    }
    path += "&limit=20";

    const results = (await sbFetch(path)) as Session[];
    await markSupabaseSuccess();

    return NextResponse.json({ sessions: results });
  } catch (error) {
    if (isSupabaseRelatedError(error)) {
      await markSupabaseFailure(error);
    }
    const message =
      error instanceof Error ? error.message : "Fetch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── PATCH: Update session (notes, action items, decisions) ───
async function handlePatch(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: {
    id?: unknown;
    notes?: unknown;
    action_items?: unknown;
    decisions?: unknown;
    open_questions?: unknown;
    scratchpad_entry?: unknown;
    status?: unknown;
  } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }

  const status =
    typeof payload.status === "string"
      ? payload.status.trim().toLowerCase()
      : "";
  if (status === "completed") {
    return handleEndSession(req, {
      id,
      notes: payload.notes,
      action_items: payload.action_items,
      decisions: payload.decisions,
    });
  }

  try {
    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      return NextResponse.json(
        { error: "Brain temporarily unavailable" },
        { status: 503 },
      );
    }

    // Fetch existing session
    const existing = (await sbFetch(
      `/rest/v1/abra_sessions?id=eq.${id}&select=*`,
    )) as Session[];
    if (existing.length === 0) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 },
      );
    }

    const session = existing[0];
    if (session.status !== "active") {
      return NextResponse.json(
        { error: "Session is not active" },
        { status: 400 },
      );
    }

    const updates: Record<string, unknown> = {};

    // Max items per array to prevent unbounded growth
    const MAX_ARRAY_ITEMS = 200;
    const MAX_NEW_ITEMS_PER_REQUEST = 50;

    // Append notes (array merge — pre-truncate existing to bound memory)
    if (Array.isArray(payload.notes)) {
      const currentNotes = (Array.isArray(session.notes) ? session.notes : []).slice(-MAX_ARRAY_ITEMS);
      const newNotes = payload.notes.slice(0, MAX_NEW_ITEMS_PER_REQUEST);
      updates.notes = [...currentNotes, ...newNotes].slice(-MAX_ARRAY_ITEMS);
    }

    // Append action items
    if (Array.isArray(payload.action_items)) {
      const current = (Array.isArray(session.action_items)
        ? session.action_items
        : []).slice(-MAX_ARRAY_ITEMS);
      const newItems = payload.action_items.slice(0, MAX_NEW_ITEMS_PER_REQUEST);
      updates.action_items = [...current, ...newItems].slice(-MAX_ARRAY_ITEMS);
    }

    // Append decisions
    if (Array.isArray(payload.decisions)) {
      const current = (Array.isArray(session.decisions)
        ? session.decisions
        : []).slice(-MAX_ARRAY_ITEMS);
      const newItems = payload.decisions.slice(0, MAX_NEW_ITEMS_PER_REQUEST);
      updates.decisions = [...current, ...newItems].slice(-MAX_ARRAY_ITEMS);
    }

    // Append open questions
    if (Array.isArray(payload.open_questions)) {
      const current = (Array.isArray(session.open_questions)
        ? session.open_questions
        : []).slice(-MAX_ARRAY_ITEMS);
      const newItems = payload.open_questions.slice(0, MAX_NEW_ITEMS_PER_REQUEST);
      updates.open_questions = [...current, ...newItems].slice(-MAX_ARRAY_ITEMS);
    }

    // Scratchpad entry — multi-turn reasoning working memory
    // Allows Abra to store intermediate reasoning, hypotheses, and partial conclusions
    if (payload.scratchpad_entry && typeof payload.scratchpad_entry === "object") {
      const entry = payload.scratchpad_entry as Record<string, unknown>;
      const currentScratchpad = Array.isArray(session.scratchpad)
        ? [...session.scratchpad]
        : [];
      const newEntry: ScratchpadEntry = {
        key: String(entry.key || `scratch_${currentScratchpad.length}`),
        value: entry.value ?? null,
        reasoning: typeof entry.reasoning === "string" ? entry.reasoning : undefined,
        timestamp: new Date().toISOString(),
      };
      // Upsert: replace if key already exists, otherwise append
      const existingIdx = currentScratchpad.findIndex(
        (s) => s.key === newEntry.key,
      );
      if (existingIdx >= 0) {
        currentScratchpad[existingIdx] = newEntry;
      } else {
        currentScratchpad.push(newEntry);
      }
      updates.scratchpad = currentScratchpad;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ session });
    }

    const updated = (await sbFetch(`/rest/v1/abra_sessions?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=representation",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    })) as Session[];

    await markSupabaseSuccess();

    return NextResponse.json({ session: updated[0] || session });
  } catch (error) {
    if (isSupabaseRelatedError(error)) {
      await markSupabaseFailure(error);
    }
    const message =
      error instanceof Error ? error.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── END SESSION: Save + task creation + complete ───
async function handleEndSession(
  req: Request,
  presetPayload?: {
    id?: unknown;
    notes?: unknown;
    action_items?: unknown;
    decisions?: unknown;
  },
) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: {
    id?: unknown;
    notes?: unknown;
    action_items?: unknown;
    decisions?: unknown;
  } = presetPayload || {};
  if (!presetPayload) {
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
  }

  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      return NextResponse.json(
        { error: "Brain temporarily unavailable" },
        { status: 503 },
      );
    }

    // Fetch session
    const existing = (await sbFetch(
      `/rest/v1/abra_sessions?id=eq.${id}&select=*`,
    )) as Session[];
    if (existing.length === 0) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 },
      );
    }

    const session = existing[0];

    const finalUpdates: Record<string, unknown> = {};
    if (Array.isArray(payload.notes)) {
      finalUpdates.notes = [
        ...(Array.isArray(session.notes) ? session.notes : []),
        ...payload.notes,
      ];
    }
    if (Array.isArray(payload.action_items)) {
      finalUpdates.action_items = [
        ...(Array.isArray(session.action_items) ? session.action_items : []),
        ...payload.action_items,
      ];
    }
    if (Array.isArray(payload.decisions)) {
      finalUpdates.decisions = [
        ...(Array.isArray(session.decisions) ? session.decisions : []),
        ...payload.decisions,
      ];
    }

    let sessionToClose: Session = session;
    if (Object.keys(finalUpdates).length > 0) {
      const merged = (await sbFetch(`/rest/v1/abra_sessions?id=eq.${id}`, {
        method: "PATCH",
        headers: {
          Prefer: "return=representation",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(finalUpdates),
      })) as Session[];
      if (merged[0]) {
        sessionToClose = merged[0];
      }
    }

    // 1. Save full session notes + decisions summary to brain.
    await saveSessionToBrain(sessionToClose);

    // 2. Create tasks from action items.
    const taskResult = await createTasksFromActionItems(sessionToClose);

    // 3. Mark session completed.
    const now = new Date().toISOString();
    await sbFetch(`/rest/v1/abra_sessions?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: "completed",
        ended_at: now,
      }),
    });

    await markSupabaseSuccess();

    // Fire-and-forget Notion sync for meeting notes.
    void createMeetingNotesPage({
      title: sessionToClose.title || `${sessionToClose.department || "general"} session`,
      department: sessionToClose.department || "general",
      notes: Array.isArray(sessionToClose.notes) ? sessionToClose.notes : [],
      decisions: Array.isArray(sessionToClose.decisions)
        ? sessionToClose.decisions
        : [],
      action_items: Array.isArray(sessionToClose.action_items)
        ? sessionToClose.action_items
        : [],
      started_at: sessionToClose.started_at,
      ended_at: now,
    })
      .then(async (pageId) => {
        if (!pageId) return;
        const pageUrl = notionPageUrlFromId(pageId);
        const scratchpad = Array.isArray(sessionToClose.scratchpad)
          ? [...sessionToClose.scratchpad]
          : [];
        scratchpad.push({
          key: "notion_page_url",
          value: pageUrl,
          reasoning: "Session synced to Notion meeting notes.",
          timestamp: new Date().toISOString(),
        });
        await sbFetch(`/rest/v1/abra_sessions?id=eq.${id}`, {
          method: "PATCH",
          headers: {
            Prefer: "return=minimal",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            scratchpad,
          }),
        });
      })
      .catch(() => {});

    return NextResponse.json({
      status: "completed",
      session_id: id,
      saved_to_brain: true,
      tasks_created: taskResult.createdCount,
      tasks_table: taskResult.table,
      notion_sync: "scheduled",
      ended_at: now,
    });
  } catch (error) {
    if (isSupabaseRelatedError(error)) {
      await markSupabaseFailure(error);
    }
    const message =
      error instanceof Error ? error.message : "End session failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  if (action === "end") {
    return handleEndSession(req);
  }
  return handlePost(req);
}

export async function GET(req: Request) {
  return handleGet(req);
}

export async function PATCH(req: Request) {
  return handlePatch(req);
}

export async function DELETE(req: Request) {
  return handleEndSession(req);
}
