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

/**
 * GET — Fetch dashboard config for a department
 * Query params: ?department=finance
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
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
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    department?: string;
    dashboard_config?: Record<string, unknown>;
    current_priorities?: string[];
    long_term_goals?: string[];
    short_term_goals?: string[];
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

  // Build update payload — only include provided fields
  const updateFields: Record<string, unknown> = {};
  if (body.dashboard_config !== undefined)
    updateFields.dashboard_config = body.dashboard_config;
  if (body.current_priorities !== undefined)
    updateFields.current_priorities = body.current_priorities;
  if (body.long_term_goals !== undefined)
    updateFields.long_term_goals = body.long_term_goals;
  if (body.short_term_goals !== undefined)
    updateFields.short_term_goals = body.short_term_goals;

  if (Object.keys(updateFields).length === 0) {
    return NextResponse.json(
      {
        error:
          "At least one field required: dashboard_config, current_priorities, long_term_goals, short_term_goals",
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

    const updated = await sbFetch(
      `/rest/v1/abra_departments?name=eq.${department}`,
      {
        method: "PATCH",
        headers: {
          Prefer: "return=representation",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updateFields),
      },
    );

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
      current_priorities: row.current_priorities || [],
      long_term_goals: row.long_term_goals || [],
      short_term_goals: row.short_term_goals || [],
      updated_by: session.user.email,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/supabase|rest\/v1/i.test(msg)) await markSupabaseFailure(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
