import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  getPlaybook,
  type DepartmentPlaybook,
} from "@/lib/ops/department-playbooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoredPlaybook = DepartmentPlaybook & {
  version?: number;
  updated_at?: string;
  updated_by?: string;
};

type DashboardConfig = {
  playbook_override?: StoredPlaybook;
  playbook_versions?: StoredPlaybook[];
  [key: string]: unknown;
};

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

function mergePlaybook(
  base: DepartmentPlaybook,
  override: Partial<DepartmentPlaybook> | undefined,
): DepartmentPlaybook {
  if (!override) return base;
  return {
    description: override.description || base.description,
    baseline:
      Array.isArray(override.baseline) && override.baseline.length > 0
        ? override.baseline
        : base.baseline,
    questions:
      Array.isArray(override.questions) && override.questions.length > 0
        ? override.questions
        : base.questions,
    taskTemplate:
      Array.isArray(override.taskTemplate) && override.taskTemplate.length > 0
        ? override.taskTemplate
        : base.taskTemplate,
    kpis:
      Array.isArray(override.kpis) && override.kpis.length > 0
        ? override.kpis
        : base.kpis,
  };
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const department = url.searchParams.get("department")?.trim().toLowerCase();
  if (!department) {
    return NextResponse.json({ error: "department is required" }, { status: 400 });
  }

  const base = getPlaybook(department);
  if (!base) {
    return NextResponse.json({ error: "Unknown department" }, { status: 404 });
  }

  try {
    const rows = (await sbFetch(
      `/rest/v1/abra_departments?name=eq.${encodeURIComponent(department)}&select=name,dashboard_config&limit=1`,
    )) as Array<{ name: string; dashboard_config: DashboardConfig | null }>;

    const dashboardConfig = rows[0]?.dashboard_config || {};
    const override = dashboardConfig.playbook_override;
    const versions = Array.isArray(dashboardConfig.playbook_versions)
      ? dashboardConfig.playbook_versions
      : [];

    return NextResponse.json({
      department,
      playbook: mergePlaybook(base, override),
      base_playbook: base,
      override: override || null,
      versions,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch playbook",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: {
    department?: unknown;
    overrides?: Partial<DepartmentPlaybook>;
  } = {};

  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const department =
    typeof payload.department === "string"
      ? payload.department.trim().toLowerCase()
      : "";
  if (!department) {
    return NextResponse.json({ error: "department is required" }, { status: 400 });
  }

  const base = getPlaybook(department);
  if (!base) {
    return NextResponse.json({ error: "Unknown department" }, { status: 404 });
  }

  const overrides = payload.overrides;
  if (!overrides || typeof overrides !== "object") {
    return NextResponse.json(
      { error: "overrides object is required" },
      { status: 400 },
    );
  }

  try {
    const rows = (await sbFetch(
      `/rest/v1/abra_departments?name=eq.${encodeURIComponent(department)}&select=name,dashboard_config&limit=1`,
    )) as Array<{ name: string; dashboard_config: DashboardConfig | null }>;

    const row = rows[0];
    if (!row) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    const dashboardConfig: DashboardConfig =
      row.dashboard_config && typeof row.dashboard_config === "object"
        ? { ...row.dashboard_config }
        : {};

    const previousOverride = dashboardConfig.playbook_override;
    const previousVersions = Array.isArray(dashboardConfig.playbook_versions)
      ? [...dashboardConfig.playbook_versions]
      : [];

    if (previousOverride) {
      previousVersions.push(previousOverride);
    }

    const latestVersion = previousVersions.reduce((max, item) => {
      const version = Number(item?.version || 0);
      return version > max ? version : max;
    }, 0);

    const nextOverride: StoredPlaybook = {
      ...mergePlaybook(base, overrides),
      version: latestVersion + 1,
      updated_at: new Date().toISOString(),
      updated_by: session.user.email,
    };

    const nextDashboardConfig: DashboardConfig = {
      ...dashboardConfig,
      playbook_override: nextOverride,
      playbook_versions: previousVersions.slice(-20),
    };

    const updated = (await sbFetch(
      `/rest/v1/abra_departments?name=eq.${encodeURIComponent(department)}`,
      {
        method: "PATCH",
        headers: {
          Prefer: "return=representation",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ dashboard_config: nextDashboardConfig }),
      },
    )) as Array<{ name: string; dashboard_config: DashboardConfig | null }>;

    return NextResponse.json({
      department,
      playbook: nextOverride,
      versions: nextDashboardConfig.playbook_versions || [],
      updated_department: updated[0]?.name || department,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update playbook",
      },
      { status: 500 },
    );
  }
}
