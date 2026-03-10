/**
 * POST /api/ops/abra/dashboard-config — Abra proposes dashboard changes
 * GET  /api/ops/abra/dashboard-config — Fetch current dashboard config for a department
 *
 * Dashboard config controls widget ordering, visibility, and priorities
 * for each department's ops dashboard view.
 *
 * Changes go through the proposal/approval gate before being applied.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { isAuthorized } from "@/lib/ops/abra-auth";
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

type DashboardWidget = {
  id: string;
  [key: string]: unknown;
};

type DashboardConfig = {
  widgets?: DashboardWidget[];
  [key: string]: unknown;
};

type DashboardChanges = {
  add_widget?: DashboardWidget;
  remove_widget?: string;
  reorder?: string[];
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

/**
 * GET — Fetch dashboard config for a department
 * Query params: ?department=finance
 */
export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const department = url.searchParams.get("department");

  if (!department || !VALID_DEPARTMENTS.includes(department)) {
    return NextResponse.json(
      {
        error: `department required. Valid: ${VALID_DEPARTMENTS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  try {
    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      return NextResponse.json(
        { error: "Supabase temporarily unavailable" },
        { status: 503 },
      );
    }

    const rows = (await sbFetch(
      `/rest/v1/abra_departments?name=eq.${department}&select=name,dashboard_config,current_priorities,long_term_goals,short_term_goals&limit=1`,
    )) as Array<{
      name: string;
      dashboard_config: Record<string, unknown> | null;
      current_priorities: unknown[] | null;
      long_term_goals: unknown[] | null;
      short_term_goals: unknown[] | null;
    }>;

    await markSupabaseSuccess();

    const dept = Array.isArray(rows) ? rows[0] : null;
    if (!dept) {
      return NextResponse.json(
        { error: `Department "${department}" not found` },
        { status: 404 },
      );
    }

    return NextResponse.json({
      department: dept.name,
      dashboard_config: dept.dashboard_config || {},
      current_priorities: dept.current_priorities || [],
      long_term_goals: dept.long_term_goals || [],
      short_term_goals: dept.short_term_goals || [],
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/supabase|rest\/v1/i.test(msg)) await markSupabaseFailure(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST — Update dashboard config for a department
 *
 * Body: {
 *   department: string,
 *   dashboard_config?: object,  // widget ordering, visibility
 *   current_priorities?: string[],
 *   long_term_goals?: string[],
 *   short_term_goals?: string[],
 * }
 *
 * This is a direct update (no approval gate for now — admin only).
 * In the future, Abra can use /api/ops/abra/propose for approval flow.
 */
export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await auth();

  let body: {
    department?: string;
    changes?: DashboardChanges;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const department = body.department;
  if (!department || !VALID_DEPARTMENTS.includes(department)) {
    return NextResponse.json(
      {
        error: `department required. Valid: ${VALID_DEPARTMENTS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const changes = body.changes;
  if (!changes || typeof changes !== "object") {
    return NextResponse.json(
      { error: "changes is required" },
      { status: 400 },
    );
  }

  if (!changes.add_widget && !changes.remove_widget && !changes.reorder) {
    return NextResponse.json(
      { error: "changes must include add_widget, remove_widget, or reorder" },
      { status: 400 },
    );
  }

  try {
    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      return NextResponse.json(
        { error: "Supabase temporarily unavailable" },
        { status: 503 },
      );
    }

    const existingRows = (await sbFetch(
      `/rest/v1/abra_departments?name=eq.${department}&select=name,dashboard_config&limit=1`,
    )) as Array<{ name: string; dashboard_config: DashboardConfig | null }>;

    const existing = existingRows[0];
    if (!existing) {
      return NextResponse.json(
        { error: `Department "${department}" not found` },
        { status: 404 },
      );
    }

    const currentConfig: DashboardConfig = (
      existing.dashboard_config &&
      typeof existing.dashboard_config === "object" &&
      !Array.isArray(existing.dashboard_config)
    )
      ? { ...existing.dashboard_config }
      : {};

    const currentWidgets = Array.isArray(currentConfig.widgets)
      ? [...currentConfig.widgets]
      : [];
    const widgetById = new Map<string, DashboardWidget>(
      currentWidgets
        .filter((w) => w && typeof w.id === "string" && w.id.trim().length > 0)
        .map((w) => [w.id, w]),
    );

    if (changes.add_widget) {
      if (!changes.add_widget.id || typeof changes.add_widget.id !== "string") {
        return NextResponse.json(
          { error: "changes.add_widget.id is required" },
          { status: 400 },
        );
      }
      widgetById.set(changes.add_widget.id, changes.add_widget);
    }

    if (changes.remove_widget) {
      widgetById.delete(changes.remove_widget);
    }

    let nextWidgets = Array.from(widgetById.values());
    if (Array.isArray(changes.reorder) && changes.reorder.length > 0) {
      const order = new Map(changes.reorder.map((id, idx) => [id, idx]));
      nextWidgets = nextWidgets.sort((a, b) => {
        const aOrder = order.has(a.id) ? order.get(a.id)! : Number.MAX_SAFE_INTEGER;
        const bOrder = order.has(b.id) ? order.get(b.id)! : Number.MAX_SAFE_INTEGER;
        if (aOrder === bOrder) return a.id.localeCompare(b.id);
        return aOrder - bOrder;
      });
    }

    const nextConfig: DashboardConfig = {
      ...currentConfig,
      widgets: nextWidgets,
    };

    const updated = await sbFetch(`/rest/v1/abra_departments?name=eq.${department}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=representation",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dashboard_config: nextConfig,
      }),
    });

    await markSupabaseSuccess();

    const row = Array.isArray(updated) ? updated[0] : null;
    if (!row) {
      return NextResponse.json(
        { error: `Department "${department}" not found` },
        { status: 404 },
      );
    }

    return NextResponse.json({
      department: row.name,
      dashboard_config: row.dashboard_config || {},
      applied_changes: changes,
      updated_by: session?.user?.email || "cron@system",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/supabase|rest\/v1/i.test(msg)) await markSupabaseFailure(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
