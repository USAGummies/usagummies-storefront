import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  canUseSupabase,
  markSupabaseFailure,
  markSupabaseSuccess,
} from "@/lib/ops/supabase-resilience";
import { getSpendByDepartment } from "@/lib/ops/abra-cost-tracker";
import { OPERATING_PILLARS } from "@/lib/ops/department-playbooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DepartmentRow = {
  name: string;
  owner_name?: string | null;
  description?: string | null;
  key_context?: string | null;
  current_priorities?: unknown;
  long_term_goals?: unknown;
  short_term_goals?: unknown;
  dashboard_config?: unknown;
  operating_pillar?: string | null;
  executive_role?: string | null;
  sub_departments?: unknown;
  parent_department?: string | null;
};

type OperatingPillarRow = {
  id: string;
  name: string;
  description?: string | null;
  departments?: unknown;
};

type ExecutiveRoleRow = {
  role: string;
  title?: string | null;
  full_name?: string | null;
  departments?: unknown;
};

const ALL_DEPARTMENTS = Array.from(
  new Set(
    Object.values(OPERATING_PILLARS).flatMap((pillar) => pillar.departments),
  ),
);

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
    throw new Error(
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
    );
  }

  return json;
}

function settledValue<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

function normalizeDepartment(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === "string" ? item.trim() : String(item || "").trim(),
      )
      .filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) =>
            typeof item === "string" ? item.trim() : String(item || "").trim(),
          )
          .filter(Boolean);
      }
    } catch {
      // Fallback to comma-delimited parsing.
    }
    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function findPillarForDepartment(department: string): string | null {
  for (const [pillarId, pillar] of Object.entries(OPERATING_PILLARS)) {
    if (pillar.departments.includes(department)) return pillarId;
  }
  return null;
}

function normalizeRoleKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function resolveExecutiveRole(
  roles: ExecutiveRoleRow[],
  department: string,
  roleHint: string | null | undefined,
): ExecutiveRoleRow | null {
  const normalizedHint = roleHint ? normalizeRoleKey(roleHint) : "";
  const byRoleHint = roles.find((role) => {
    const normalizedRole = normalizeRoleKey(role.role || "");
    const normalizedTitle = normalizeRoleKey(role.title || "");
    return (
      normalizedHint.length > 0 &&
      (normalizedRole === normalizedHint || normalizedTitle === normalizedHint)
    );
  });
  if (byRoleHint) return byRoleHint;

  return (
    roles.find((role) => toStringArray(role.departments).includes(department)) ||
    null
  );
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dept: string }> },
) {
  if (!(await isAuthorized(_req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { dept } = await params;
  const normalizedDept = normalizeDepartment(dept);
  if (!ALL_DEPARTMENTS.includes(normalizedDept)) {
    return NextResponse.json(
      {
        error: `Invalid department: ${dept}`,
        valid_departments: ALL_DEPARTMENTS,
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

    const [
      departmentResult,
      allDepartmentsResult,
      pillarsResult,
      executiveRolesResult,
      initiativesResult,
      questionsResult,
      correctionsResult,
      kpisResult,
      teamResult,
      dashboardConfigResult,
      spendByDeptResult,
    ] = await Promise.allSettled([
      sbFetch(
        `/rest/v1/abra_departments?name=eq.${normalizedDept}&select=name,owner_name,description,key_context,current_priorities,long_term_goals,short_term_goals,dashboard_config,operating_pillar,executive_role,sub_departments,parent_department&limit=1`,
      ),
      sbFetch(
        "/rest/v1/abra_departments?select=name,owner_name,description,operating_pillar,executive_role,sub_departments,parent_department&order=name.asc&limit=200",
      ),
      sbFetch(
        "/rest/v1/abra_operating_pillars?select=id,name,description,departments&order=name.asc&limit=20",
      ),
      sbFetch(
        "/rest/v1/abra_executive_roles?select=role,title,full_name,departments&order=title.asc&limit=50",
      ),
      sbFetch(
        `/rest/v1/abra_initiatives?department=eq.${normalizedDept}&status=not.in.(completed,paused)&select=id,title,goal,status,questions,answers,tasks,kpis,created_at,updated_at&order=created_at.desc&limit=20`,
      ),
      sbFetch(
        `/rest/v1/abra_unanswered_questions?department=eq.${normalizedDept}&answered=eq.false&select=id,question,asked_by,context,created_at&order=created_at.desc&limit=20`,
      ),
      sbFetch(
        `/rest/v1/abra_corrections?department=eq.${normalizedDept}&active=eq.true&select=id,original_claim,correction,corrected_by,created_at&order=created_at.desc&limit=20`,
      ),
      sbFetch(
        `/rest/v1/open_brain_entries?department=eq.${normalizedDept}&entry_type=eq.kpi&select=id,title,summary_text,raw_text,priority,created_at&order=created_at.desc&limit=20`,
      ),
      sbFetch(
        `/rest/v1/abra_team?department=eq.${normalizedDept}&select=id,name,role,email,responsibilities,key_context&order=name.asc&limit=100`,
      ),
      sbFetch(
        `/rest/v1/abra_departments?name=eq.${normalizedDept}&select=dashboard_config&limit=1`,
      ),
      getSpendByDepartment(),
    ]);

    const departmentRows = settledValue(departmentResult, [] as DepartmentRow[]) as DepartmentRow[];
    const allDepartments = settledValue(
      allDepartmentsResult,
      [] as DepartmentRow[],
    ) as DepartmentRow[];
    const pillars = settledValue(pillarsResult, [] as OperatingPillarRow[]) as OperatingPillarRow[];
    const executiveRoles = settledValue(
      executiveRolesResult,
      [] as ExecutiveRoleRow[],
    ) as ExecutiveRoleRow[];
    const initiatives = settledValue(
      initiativesResult,
      [] as Array<Record<string, unknown>>,
    ) as Array<Record<string, unknown>>;
    const openQuestions = settledValue(
      questionsResult,
      [] as Array<Record<string, unknown>>,
    ) as Array<Record<string, unknown>>;
    const recentCorrections = settledValue(
      correctionsResult,
      [] as Array<Record<string, unknown>>,
    ) as Array<Record<string, unknown>>;
    const kpis = settledValue(kpisResult, [] as Array<Record<string, unknown>>) as Array<Record<string, unknown>>;
    const teamMembers = settledValue(
      teamResult,
      [] as Array<Record<string, unknown>>,
    ) as Array<Record<string, unknown>>;
    const dashboardRows = settledValue(
      dashboardConfigResult,
      [] as Array<Record<string, unknown>>,
    ) as Array<Record<string, unknown>>;
    const spendByDept = settledValue(
      spendByDeptResult,
      {} as Record<string, number>,
    ) as Record<string, number>;

    const department = Array.isArray(departmentRows)
      ? departmentRows[0] || null
      : null;
    const dashboardConfig = Array.isArray(dashboardRows)
      ? dashboardRows[0]?.dashboard_config || {}
      : {};
    const deptSpend = Number(spendByDept[normalizedDept] || 0);

    const subDepartments = toStringArray(department?.sub_departments);
    const pillarId =
      (typeof department?.operating_pillar === "string" &&
      department.operating_pillar
        ? department.operating_pillar
        : null) || findPillarForDepartment(normalizedDept);

    const pillarFromTable = pillars.find((pillar) => pillar.id === pillarId);
    const fallbackPillar = pillarId
      ? {
          id: pillarId,
          name: OPERATING_PILLARS[pillarId]?.name || pillarId,
          description: null,
          departments: OPERATING_PILLARS[pillarId]?.departments || [],
        }
      : null;
    const pillar = pillarFromTable || fallbackPillar;

    const pillarDepartments = pillar
      ? toStringArray(pillar.departments).length > 0
        ? toStringArray(pillar.departments)
        : OPERATING_PILLARS[pillar.id]?.departments || []
      : [];
    const siblingDepartments = pillarDepartments.filter(
      (name) => name !== normalizedDept,
    );

    const siblingDepartmentDetails = allDepartments
      .filter((row) => siblingDepartments.includes(row.name))
      .map((row) => ({
        name: row.name,
        owner_name: row.owner_name || null,
        executive_role: row.executive_role || null,
      }));

    const executiveRole = resolveExecutiveRole(
      executiveRoles,
      normalizedDept,
      department?.executive_role,
    );

    await markSupabaseSuccess();

    return NextResponse.json({
      department: department
        ? {
            ...department,
            name: department.name,
            sub_departments: subDepartments,
          }
        : null,
      operating_pillar: pillar
        ? {
            id: pillar.id,
            name: pillar.name,
            description: pillar.description || null,
            departments: pillarDepartments,
            sibling_departments: siblingDepartments,
            sibling_department_details: siblingDepartmentDetails,
          }
        : null,
      executive_role: executiveRole
        ? {
            role: executiveRole.role,
            title: executiveRole.title || null,
            full_name: executiveRole.full_name || null,
            departments: toStringArray(executiveRole.departments),
          }
        : null,
      initiatives,
      open_questions: openQuestions,
      recent_corrections: recentCorrections,
      kpis,
      ai_spend: {
        this_month: Math.round(deptSpend * 100) / 100,
      },
      team_members: teamMembers,
      dashboard_config: dashboardConfig,
      all_departments: ALL_DEPARTMENTS,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    await markSupabaseFailure(error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch department state",
      },
      { status: 500 },
    );
  }
}
