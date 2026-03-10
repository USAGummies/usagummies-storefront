import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  canUseSupabase,
  markSupabaseFailure,
  markSupabaseSuccess,
} from "@/lib/ops/supabase-resilience";
import { OPERATING_PILLARS } from "@/lib/ops/department-playbooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DepartmentRow = {
  name: string;
  owner_name?: string | null;
  owner_email?: string | null;
  description?: string | null;
  key_context?: string | null;
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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${typeof json === "string" ? json : JSON.stringify(json)}`,
    );
  }

  return json;
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

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      return NextResponse.json(
        { error: "Supabase temporarily unavailable", circuitOpen: true },
        { status: 503 },
      );
    }

    const [departments, operatingPillars, executiveRoles] = await Promise.all([
      sbFetch(
        "/rest/v1/abra_departments?select=name,owner_name,owner_email,description,key_context,operating_pillar,executive_role,sub_departments,parent_department&order=name.asc&limit=200",
      ) as Promise<DepartmentRow[]>,
      sbFetch(
        "/rest/v1/abra_operating_pillars?select=id,name,description,departments&order=name.asc&limit=20",
      ) as Promise<OperatingPillarRow[]>,
      sbFetch(
        "/rest/v1/abra_executive_roles?select=role,title,full_name,departments&order=title.asc&limit=50",
      ) as Promise<ExecutiveRoleRow[]>,
    ]);

    const pillarRows = Array.isArray(operatingPillars) ? operatingPillars : [];
    const departmentRows = Array.isArray(departments) ? departments : [];
    const roleRows = Array.isArray(executiveRoles) ? executiveRoles : [];

    const departmentByName = new Map(
      departmentRows.map((row) => [row.name, row]),
    );

    const orderedPillarIds = Object.keys(OPERATING_PILLARS);
    const pillarMap = new Map(pillarRows.map((row) => [row.id, row]));

    const grouped = orderedPillarIds.map((pillarId) => {
      const fallback = OPERATING_PILLARS[pillarId];
      const row = pillarMap.get(pillarId);
      const names =
        row && toStringArray(row.departments).length > 0
          ? toStringArray(row.departments)
          : fallback?.departments || [];

      const departmentsForPillar = names.map((name) => {
        const dept = departmentByName.get(name);
        if (!dept) {
          return {
            name,
            owner_name: null,
            owner_email: null,
            description: null,
            key_context: null,
            operating_pillar: pillarId,
            executive_role: null,
            executive_role_detail: null,
            sub_departments: [],
            parent_department: null,
          };
        }

        const role = resolveExecutiveRole(roleRows, name, dept.executive_role);
        return {
          ...dept,
          sub_departments: toStringArray(dept.sub_departments),
          executive_role_detail: role
            ? {
                role: role.role,
                title: role.title || null,
                full_name: role.full_name || null,
                departments: toStringArray(role.departments),
              }
            : null,
        };
      });

      return {
        id: pillarId,
        name: row?.name || fallback?.name || pillarId,
        description: row?.description || null,
        departments: departmentsForPillar,
      };
    });

    await markSupabaseSuccess();

    return NextResponse.json({
      pillars: grouped,
      departments: departmentRows.map((dept) => ({
        ...dept,
        sub_departments: toStringArray(dept.sub_departments),
      })),
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    await markSupabaseFailure(error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch departments",
      },
      { status: 500 },
    );
  }
}
