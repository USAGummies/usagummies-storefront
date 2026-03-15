import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DraftApproval = {
  id: string;
  action_type: string;
  summary: string;
  supporting_data: string | null;
  confidence: string | null;
  risk_level: string | null;
  status: string;
  requested_at: string;
  proposed_payload: {
    to?: string;
    subject?: string;
    body?: string;
    source_email_id?: string;
    note_for_ben?: string;
  } | null;
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

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  headers.set("Content-Type", "application/json");

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

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch auto_reply approvals (pending + recently resolved)
    const rows = (await sbFetch(
      `/rest/v1/approvals?select=id,action_type,summary,supporting_data,confidence,risk_level,status,requested_at,proposed_payload&action_type=eq.auto_reply&order=requested_at.desc&limit=50`,
    )) as DraftApproval[];

    const drafts = (Array.isArray(rows) ? rows : []).map((row) => {
      const payload =
        row.proposed_payload && typeof row.proposed_payload === "object"
          ? (row.proposed_payload as Record<string, unknown>)
          : {};

      // Email fields are nested under payload.params (from proposeAction)
      const params =
        payload.params && typeof payload.params === "object"
          ? (payload.params as Record<string, unknown>)
          : payload;

      return {
        id: row.id,
        status: row.status,
        to: (params.to as string) || "Unknown",
        subject: (params.subject as string) || "(No subject)",
        body: (params.body as string) || "",
        noteForBen: (params.note_for_ben as string) || null,
        sourceEmailId: (params.source_email_id as string) || null,
        confidence: row.confidence,
        riskLevel: row.risk_level,
        summary: row.summary,
        requestedAt: row.requested_at,
      };
    });

    const pending = drafts.filter((d) => d.status === "pending");
    const resolved = drafts.filter((d) => d.status !== "pending");

    return NextResponse.json({
      pending,
      resolved,
      totalPending: pending.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load drafts",
      },
      { status: 500 },
    );
  }
}
