/**
 * POST /api/ops/abra/write-back — Let Abra write observations back to brain
 *
 * Body: { table: 'open_brain_entries'|'email_events', action: 'insert'|'update', data: Record<string,any>, reason: string }
 * Returns: { success: true, id: string }
 *
 * Security: Admin-only. No DELETE. Validates table names against allowlist.
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
export const maxDuration = 25;

const ALLOWED_TABLES = new Set(["open_brain_entries", "email_events"]);
const ALLOWED_ACTIONS = new Set(["insert", "update"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FIELD_LENGTH = 50000; // cap any single string field
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const ADMIN_EMAILS = new Set([
  "ben@usagummies.com",
  "benjamin.stutman@gmail.com",
]);

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
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

function isSupabaseRelatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /supabase|rest\/v1|service_role|SUPABASE/i.test(message);
}

async function buildEmbedding(text: string): Promise<number[]> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error("OPENAI_API_KEY not configured");

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Embedding failed (${res.status}): ${errText.slice(0, 200)}`,
    );
  }

  const data = await res.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error("Failed to parse embedding vector");
  }
  return embedding as number[];
}

export async function POST(req: Request) {
  // 1. Auth check: admin role only
  const session = await auth();
  if (!session?.user?.email || !ADMIN_EMAILS.has(session.user.email.toLowerCase())) {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }

  // 2. Parse and validate
  let payload: {
    table?: unknown;
    action?: unknown;
    data?: unknown;
    reason?: unknown;
  } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const table = typeof payload.table === "string" ? payload.table.trim() : "";
  const action = typeof payload.action === "string" ? payload.action.trim() : "";
  const data =
    payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : null;
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";

  if (!ALLOWED_TABLES.has(table)) {
    return NextResponse.json(
      { error: `Invalid table. Allowed: ${[...ALLOWED_TABLES].join(", ")}` },
      { status: 400 },
    );
  }

  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: `Invalid action. Allowed: ${[...ALLOWED_ACTIONS].join(", ")}` },
      { status: 400 },
    );
  }

  if (!data) {
    return NextResponse.json({ error: "data object is required" }, { status: 400 });
  }

  if (!reason) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }
  if (reason.length > 1000) {
    return NextResponse.json({ error: "reason must be under 1000 characters" }, { status: 400 });
  }

  // Cap all string values in data to prevent context-stuffing
  const cappedData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    cappedData[key] = typeof value === "string" ? value.slice(0, MAX_FIELD_LENGTH) : value;
  }

  try {
    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      return NextResponse.json(
        { error: "Brain temporarily unavailable (circuit open)" },
        { status: 503 },
      );
    }

    let resultId: string | null = null;

    if (action === "insert") {
      // Generate embedding for new entries
      const embeddingText =
        (typeof cappedData.title === "string" ? cappedData.title + ". " : "") +
        (typeof cappedData.raw_text === "string"
          ? cappedData.raw_text
          : typeof cappedData.summary_text === "string"
            ? cappedData.summary_text
            : "");

      const insertData: Record<string, unknown> = { ...cappedData };

      if (embeddingText.trim().length > 0) {
        const embedding = await buildEmbedding(embeddingText.slice(0, 8000));
        insertData.embedding = embedding;
      }

      const rows = (await sbFetch(`/rest/v1/${table}`, {
        method: "POST",
        headers: {
          Prefer: "return=representation",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(insertData),
      })) as Array<{ id: string }>;

      resultId = rows[0]?.id || null;
    } else if (action === "update") {
      // Update requires a valid UUID id field
      const id = typeof cappedData.id === "string" ? cappedData.id.trim() : "";
      if (!id) {
        return NextResponse.json(
          { error: "data.id is required for update action" },
          { status: 400 },
        );
      }
      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: "data.id must be a valid UUID" },
          { status: 400 },
        );
      }

      const updateData: Record<string, unknown> = { ...cappedData };
      delete updateData.id; // Don't include id in PATCH body

      const rows = (await sbFetch(`/rest/v1/${table}?id=eq.${id}`, {
        method: "PATCH",
        headers: {
          Prefer: "return=representation",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updateData),
      })) as Array<{ id: string }>;

      resultId = rows[0]?.id || id;
    }

    // 5. Audit log
    try {
      await sbFetch("/rest/v1/open_brain_entries", {
        method: "POST",
        headers: {
          Prefer: "return=minimal",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source_type: "agent",
          source_ref: `write-back-${action}-${Date.now()}`,
          entry_type: "finding",
          title: `Abra Write-Back: ${action} on ${table}`,
          raw_text: `Action: ${action}. Table: ${table}. Reason: ${reason}. Target ID: ${resultId || "new"}. By: ${session.user.email}`,
          summary_text: reason,
          category: "system_log",
          department: "systems",
          confidence: "high",
          priority: "low",
          processed: true,
        }),
      });
    } catch (auditErr) {
      // Audit log failure shouldn't block the main operation
      console.error("[write-back] Audit log failed:", auditErr);
    }

    await markSupabaseSuccess();

    return NextResponse.json({
      success: true,
      id: resultId,
      table,
      action,
    });
  } catch (error) {
    if (isSupabaseRelatedError(error)) {
      await markSupabaseFailure(error);
    }
    const message = error instanceof Error ? error.message : "Write-back failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
