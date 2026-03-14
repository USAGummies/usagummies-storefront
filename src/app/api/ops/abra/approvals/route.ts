import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { isAuthorized } from "@/lib/ops/abra-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ApprovalRow = {
  id: string;
  requesting_agent_id: string | null;
  action_type: string;
  summary: string;
  risk_level: "low" | "medium" | "high" | "critical" | null;
  permission_tier: number | null;
  status: string;
  proposed_payload: unknown;
  resolved_payload: unknown;
  decision: "approved" | "denied" | "modified" | null;
  decision_reasoning: string | null;
  decided_at: string | null;
  requested_at: string;
  created_at?: string | null;
  auto_executed?: boolean | null;
  auto_approved?: boolean | null;
  executed_at?: string | null;
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

async function resolveUserIdFromEmail(email: string): Promise<string | null> {
  try {
    const encoded = encodeURIComponent(email.toLowerCase());
    const rows = (await sbFetch(
      `/rest/v1/users?select=id&email=eq.${encoded}&limit=1`,
    )) as Array<{ id: string }>;
    return rows[0]?.id || null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const status = (url.searchParams.get("status") || "pending").toLowerCase();
  const VALID_APPROVAL_STATUSES = new Set(["pending", "approved", "denied", "rejected"]);
  const statusFilter =
    status === "all"
      ? ""
      : status === "rejected"
        ? "&status=eq.denied"
        : VALID_APPROVAL_STATUSES.has(status)
          ? `&status=eq.${encodeURIComponent(status)}`
          : "";

  try {
    const rows = (await sbFetch(
      `/rest/v1/approvals?select=id,requesting_agent_id,action_type,summary,risk_level,permission_tier,status,proposed_payload,resolved_payload,decision,decision_reasoning,decided_at,requested_at,created_at,auto_executed,auto_approved,executed_at&order=requested_at.desc&limit=50${statusFilter}`,
    )) as ApprovalRow[];

    return NextResponse.json({
      approvals: Array.isArray(rows) ? rows : [],
      count: Array.isArray(rows) ? rows.length : 0,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load approvals",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await auth();

  let payload: {
    id?: unknown;
    decision?: unknown;
    comment?: unknown;
  } = {};

  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  const decisionRaw =
    typeof payload.decision === "string" ? payload.decision.trim().toLowerCase() : "";

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id must be a valid UUID" }, { status: 400 });
  }

  if (!["approved", "rejected"].includes(decisionRaw)) {
    return NextResponse.json(
      { error: "decision must be approved or rejected" },
      { status: 400 },
    );
  }

  const mappedDecision = decisionRaw === "rejected" ? "denied" : "approved";

  try {
    const existing = (await sbFetch(
      `/rest/v1/approvals?id=eq.${id}&select=*`,
    )) as Array<Record<string, unknown>>;

    if (!existing[0]) {
      return NextResponse.json({ error: "Approval not found" }, { status: 404 });
    }

    const deciderUserId = session?.user?.email
      ? await resolveUserIdFromEmail(session.user.email)
      : null;
    const existingRow = existing[0];

    const updatePayload: Record<string, unknown> = {
      status: mappedDecision,
      decision: mappedDecision,
      decided_at: new Date().toISOString(),
      decision_reasoning:
        typeof payload.comment === "string" ? payload.comment.slice(0, 2000) : null,
      decided_by_user_id: deciderUserId,
    };

    const actionPayload = existingRow.action_payload || existingRow.proposed_payload;
    if (mappedDecision === "approved" && actionPayload) {
      updatePayload.resolved_payload = actionPayload;
    }

    const updated = (await sbFetch(`/rest/v1/approvals?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=representation",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updatePayload),
    })) as ApprovalRow[];

    return NextResponse.json({ approval: updated[0] || null });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update approval",
      },
      { status: 500 },
    );
  }
}
