import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  canUseSupabase,
  markSupabaseFailure,
  markSupabaseSuccess,
} from "@/lib/ops/supabase-resilience";
import { getSpendByDepartment } from "@/lib/ops/abra-cost-tracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_DEPARTMENTS = [
  "finance",
  "operations",
  "sales_and_growth",
  "supply_chain",
  "executive",
] as const;

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
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
    signal: init.signal || AbortSignal.timeout(12000),
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
    throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${typeof json === "string" ? json : JSON.stringify(json)}`);
  }

  return json;
}

function settledValue<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
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
  if (!VALID_DEPARTMENTS.includes(dept as (typeof VALID_DEPARTMENTS)[number])) {
    return NextResponse.json(
      { error: `Invalid department: ${dept}` },
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

    const [
      departmentResult,
      initiativesResult,
      questionsResult,
      correctionsResult,
      kpisResult,
      teamResult,
      dashboardConfigResult,
      spendByDeptResult,
    ] = await Promise.allSettled([
      sbFetch(`/rest/v1/abra_departments?name=eq.${dept}&select=name,owner_name,description,key_context,current_priorities,long_term_goals,short_term_goals,dashboard_config&limit=1`),
      sbFetch(`/rest/v1/abra_initiatives?department=eq.${dept}&status=not.in.(completed,paused)&select=id,title,goal,status,questions,answers,tasks,kpis,created_at,updated_at&order=created_at.desc&limit=20`),
      sbFetch(`/rest/v1/abra_unanswered_questions?department=eq.${dept}&answered=eq.false&select=id,question,asked_by,context,created_at&order=created_at.desc&limit=20`),
      sbFetch(`/rest/v1/abra_corrections?department=eq.${dept}&active=eq.true&select=id,original_claim,correction,corrected_by,created_at&order=created_at.desc&limit=20`),
      sbFetch(`/rest/v1/open_brain_entries?department=eq.${dept}&entry_type=eq.kpi&select=id,title,summary_text,raw_text,priority,created_at&order=created_at.desc&limit=20`),
      sbFetch(`/rest/v1/abra_team?department=eq.${dept}&select=id,name,role,email,responsibilities,key_context&order=name.asc&limit=100`),
      sbFetch(`/rest/v1/abra_departments?name=eq.${dept}&select=dashboard_config&limit=1`),
      getSpendByDepartment(),
    ]);

    const departmentRows = settledValue(departmentResult, [] as Array<Record<string, unknown>>);
    const initiatives = settledValue(initiativesResult, [] as Array<Record<string, unknown>>);
    const openQuestions = settledValue(questionsResult, [] as Array<Record<string, unknown>>);
    const recentCorrections = settledValue(correctionsResult, [] as Array<Record<string, unknown>>);
    const kpis = settledValue(kpisResult, [] as Array<Record<string, unknown>>);
    const teamMembers = settledValue(teamResult, [] as Array<Record<string, unknown>>);
    const dashboardRows = settledValue(dashboardConfigResult, [] as Array<Record<string, unknown>>);
    const spendByDept = settledValue(spendByDeptResult, {} as Record<string, number>);

    const department = Array.isArray(departmentRows) ? departmentRows[0] || null : null;
    const dashboardConfig = Array.isArray(dashboardRows) ? dashboardRows[0]?.dashboard_config || {} : {};
    const deptSpend = Number(spendByDept[dept] || 0);

    await markSupabaseSuccess();

    return NextResponse.json({
      department,
      initiatives,
      open_questions: openQuestions,
      recent_corrections: recentCorrections,
      kpis,
      ai_spend: {
        this_month: Math.round(deptSpend * 100) / 100,
      },
      team_members: teamMembers,
      dashboard_config: dashboardConfig,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    await markSupabaseFailure(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch department state" },
      { status: 500 },
    );
  }
}
