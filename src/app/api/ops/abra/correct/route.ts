/**
 * POST /api/ops/abra/correct — Submit a correction to Abra's knowledge
 *
 * Body: { original_claim: string, correction: string, department?: string }
 * Returns: { success: true, id: string }
 *
 * Corrections are pinned overrides that Abra will always prefer over stale data.
 * Also writes a high-priority brain entry so the correction appears in future searches.
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

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${typeof json === "string" ? json : JSON.stringify(json)}`,
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
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: {
    original_claim?: unknown;
    correction?: unknown;
    department?: unknown;
  } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const originalClaim =
    typeof payload.original_claim === "string"
      ? payload.original_claim.trim()
      : "";
  const correction =
    typeof payload.correction === "string" ? payload.correction.trim() : "";
  const department =
    typeof payload.department === "string" ? payload.department.trim() : null;

  if (!originalClaim || !correction) {
    return NextResponse.json(
      { error: "original_claim and correction are required" },
      { status: 400 },
    );
  }

  try {
    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      return NextResponse.json(
        { error: "Brain temporarily unavailable (circuit open)" },
        { status: 503 },
      );
    }

    const correctedBy = session.user.email;
    const embeddingText = `CORRECTION: ${originalClaim} → ${correction}`;
    const embedding = await buildEmbedding(embeddingText.slice(0, 8000));

    // 1. Insert into abra_corrections
    const correctionRows = (await sbFetch("/rest/v1/abra_corrections", {
      method: "POST",
      headers: {
        Prefer: "return=representation",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        corrected_by: correctedBy,
        original_claim: originalClaim,
        correction,
        department,
        embedding,
      }),
    })) as Array<{ id: string }>;

    const correctionId = correctionRows[0]?.id;

    // 2. Also write to open_brain_entries as a high-priority correction entry
    await sbFetch("/rest/v1/open_brain_entries", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_type: "manual",
        source_ref: `correction-${correctionId || Date.now()}`,
        entry_type: "correction",
        title: `Correction: ${originalClaim.slice(0, 100)}`,
        raw_text: `WRONG: ${originalClaim}\nCORRECT: ${correction}\nCorrected by: ${correctedBy}`,
        summary_text: correction,
        category: "correction",
        department: department || "executive",
        confidence: "high",
        priority: "critical",
        processed: true,
        embedding,
      }),
    });

    await markSupabaseSuccess();

    return NextResponse.json({
      success: true,
      id: correctionId,
      message: `Correction stored. Abra will prioritize this over conflicting older data.`,
    });
  } catch (error) {
    if (isSupabaseRelatedError(error)) {
      await markSupabaseFailure(error);
    }
    const message =
      error instanceof Error ? error.message : "Correction failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
