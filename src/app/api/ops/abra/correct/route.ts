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
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  canUseSupabase,
  markSupabaseFailure,
  markSupabaseSuccess,
} from "@/lib/ops/supabase-resilience";
import { supersedeStaleEntries } from "@/lib/ops/abra-fact-lifecycle";
import { validateRequest, CorrectRequestSchema } from "@/lib/ops/validation";

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
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await auth();

  const v = await validateRequest(req, CorrectRequestSchema);
  if (!v.success) return v.response;

  const originalClaim = v.data.original_claim;
  const correction = v.data.correction;
  const department = v.data.department || null;

  try {
    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      return NextResponse.json(
        { error: "Brain temporarily unavailable (circuit open)" },
        { status: 503 },
      );
    }

    const correctedBy = session?.user?.email || "cron@system";
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

    // 3. Supersede stale brain entries that conflict with this correction
    const sourceRef = `correction-${correctionId || Date.now()}`;
    const superseded = await supersedeStaleEntries({
      correctionEmbedding: embedding,
      correctionBrainEntrySourceRef: sourceRef,
      correctionId: correctionId || "unknown",
      originalClaim: originalClaim,
    });

    return NextResponse.json({
      success: true,
      id: correctionId,
      supersededCount: superseded.supersededCount,
      supersededIds: superseded.supersededIds,
      message: `Correction stored. ${superseded.supersededCount > 0 ? `${superseded.supersededCount} conflicting entries superseded.` : ""}Abra will prioritize this over conflicting older data.`,
    });
  } catch (error) {
    if (isSupabaseRelatedError(error)) {
      await markSupabaseFailure(error);
    }
    console.error("[correct] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Correction failed" }, { status: 500 });
  }
}
