/**
 * GET /api/ops/department/[dept] — Full department state
 *
 * Returns complete operational context for a department:
 * - Department metadata (owner, description, goals)
 * - Active initiatives with task progress
 * - Open questions
 * - Recent corrections
 * - KPIs
 * - AI spend for department
 * - Dashboard config
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  canUseSupabase,
  markSupabaseFailure,
  markSupabaseSuccess,
} from "@/lib/ops/supabase-resilience";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_DEPARTMENTS = [
  "finance",
  "operations",
  "sales_and_growth",
  "supply_chain",
  "executive",
];

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials");
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
    signal: init.signal || AbortSignal.timeout(10000),
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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dept: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { dept } = await params;

  if (!VALID_DEPARTMENTS.includes(dept)) {
    return NextResponse.json(
      {
        error: `Invalid department: ${dept}. Valid: ${VALID_DEPARTMENTS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  try {
    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      return NextResponse.json(
        { error: "Supabase temporarily unavailable", circuitOpen: true },
        { status: 503 },
      );
    }

    // Fetch all department data in parallel
    const [
      departmentRows,
      initiativeRows,
      questionRows,
      correctionRows,
      costRows,
    ] = await Promise.all([
      // Department metadata
      sbFetch(
        `/rest/v1/abra_departments?name=eq.${dept}&select=name,owner_name,description,key_context,dashboard_config,current_priorities,long_term_goals,short_term_goals&limit=1`,
      ).catch(() => []),

      // Active initiatives
      sbFetch(
        `/rest/v1/abra_initiatives?department=eq.${dept}&status=not.in.(completed,paused)&select=id,title,goal,status,questions,answers,tasks,kpis,created_at&order=created_at.desc&limit=10`,
      ).catch(() => []),

      // Open questions
      sbFetch(
        `/rest/v1/abra_unanswered_questions?department=eq.${dept}&answered=eq.false&select=id,question,asked_by,context,created_at&order=created_at.desc&limit=10`,
      ).catch(() => []),

      // Recent corrections
      sbFetch(
        `/rest/v1/abra_corrections?department=eq.${dept}&active=eq.true&select=id,original_claim,correction,corrected_by,created_at&order=created_at.desc&limit=5`,
      ).catch(() => []),

      // AI spend this month
      sbFetch("/rest/v1/rpc/get_monthly_ai_spend", {
        method: "POST",
        body: JSON.stringify({}),
      }).catch(() => []),
    ]);

    await markSupabaseSuccess();

    const departmentMeta = Array.isArray(departmentRows)
      ? departmentRows[0] || null
      : null;

    const initiatives = (
      Array.isArray(initiativeRows) ? initiativeRows : []
    ).map(
      (init: {
        id: string;
        title: string | null;
        goal: string;
        status: string;
        questions: Array<{ key: string }> | null;
        answers: Record<string, string> | null;
        tasks: Array<{ title: string; status: string }> | null;
        kpis: Array<{ metric: string; target: string }> | null;
        created_at: string;
      }) => {
        const questions = init.questions || [];
        const answers = init.answers || {};
        const tasks = init.tasks || [];
        const completedTasks = tasks.filter(
          (t) => t.status === "completed",
        ).length;

        return {
          id: init.id,
          title: init.title,
          goal: init.goal,
          status: init.status,
          open_questions: questions.filter((q) => !answers[q.key]).length,
          total_questions: questions.length,
          task_progress: {
            completed: completedTasks,
            total: tasks.length,
          },
          kpis: init.kpis,
          created_at: init.created_at,
        };
      },
    );

    // Extract department cost from monthly spend (cost_log has department column)
    const monthlyCostData = Array.isArray(costRows) ? costRows : [];
    const deptCost = monthlyCostData.find(
      (c: { department?: string }) => c.department === dept,
    );

    return NextResponse.json({
      department: departmentMeta
        ? {
            name: departmentMeta.name,
            owner: departmentMeta.owner_name,
            description: departmentMeta.description,
            key_context: departmentMeta.key_context,
            current_priorities: departmentMeta.current_priorities || [],
            long_term_goals: departmentMeta.long_term_goals || [],
            short_term_goals: departmentMeta.short_term_goals || [],
            dashboard_config: departmentMeta.dashboard_config || {},
          }
        : { name: dept, owner: null, description: null },
      initiatives,
      open_questions: Array.isArray(questionRows) ? questionRows : [],
      recent_corrections: Array.isArray(correctionRows)
        ? correctionRows
        : [],
      ai_spend: deptCost
        ? {
            this_month: Number(deptCost.total_cost || 0),
            calls: Number(deptCost.call_count || 0),
          }
        : { this_month: 0, calls: 0 },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    if (/supabase|rest\/v1/i.test(message)) {
      await markSupabaseFailure(error);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
