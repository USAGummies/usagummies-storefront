/**
 * /api/ops/abra/team — Team & Vendor Directory API
 *
 * GET: Fetch team members and vendors
 *   ?type=team — team only
 *   ?type=vendors — vendors only
 *   ?department=finance — filter by department
 *   (no params) — returns both
 *
 * POST: Add team member or vendor
 *   { type: "team", name, role, department, ... }
 *   { type: "vendor", name, vendor_type, ... }
 *
 * PATCH: Update team member or vendor
 *   { type: "team", id, ... }
 *   { type: "vendor", id, ... }
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  getTeamMembers,
  getVendors,
  getTeamByDepartment,
} from "@/lib/ops/abra-team-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing Supabase config");
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

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const department = url.searchParams.get("department");

  try {
    const result: Record<string, unknown> = {};

    if (!type || type === "team") {
      result.team = department
        ? await getTeamByDepartment(department)
        : await getTeamMembers();
    }

    if (!type || type === "vendors") {
      result.vendors = await getVendors();
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const type = payload.type as string;

  try {
    if (type === "team") {
      const row = await sbFetch("/rest/v1/abra_team", {
        method: "POST",
        headers: {
          Prefer: "return=representation",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: payload.name,
          role: payload.role,
          email: payload.email || null,
          department: payload.department,
          responsibilities: payload.responsibilities || [],
          is_active: true,
        }),
      });
      return NextResponse.json({ success: true, data: row });
    }

    if (type === "vendor") {
      const row = await sbFetch("/rest/v1/abra_vendors", {
        method: "POST",
        headers: {
          Prefer: "return=representation",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: payload.name,
          vendor_type: payload.vendor_type,
          contact_name: payload.contact_name || null,
          contact_email: payload.contact_email || null,
          location: payload.location || null,
          products_services: payload.products_services || [],
          notes: payload.notes || null,
          is_active: true,
        }),
      });
      return NextResponse.json({ success: true, data: row });
    }

    return NextResponse.json(
      { error: "type must be 'team' or 'vendor'" },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}

// Fields that can be updated via PATCH — prevents arbitrary column writes
const TEAM_UPDATABLE_FIELDS = new Set([
  "name", "role", "department", "email", "phone", "notes",
  "status", "responsibilities", "start_date",
]);
const VENDOR_UPDATABLE_FIELDS = new Set([
  "name", "vendor_type", "contact_name", "contact_email", "contact_phone",
  "notes", "status", "terms", "payment_terms",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const type = payload.type as string;
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }

  try {
    const isVendor = type === "vendor";
    const table = isVendor ? "abra_vendors" : "abra_team";
    const allowedFields = isVendor ? VENDOR_UPDATABLE_FIELDS : TEAM_UPDATABLE_FIELDS;

    // Only allow known fields — reject unknown columns
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (key === "type" || key === "id") continue;
      if (!allowedFields.has(key)) continue;
      // Cap string values
      updates[key] = typeof value === "string" ? value.slice(0, 1000) : value;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    await sbFetch(`/rest/v1/${table}?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed" },
      { status: 500 },
    );
  }
}
