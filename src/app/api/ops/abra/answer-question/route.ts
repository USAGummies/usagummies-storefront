/**
 * POST /api/ops/abra/answer-question — Answer a logged unanswered question
 *
 * Body: { question_id: string, answer: string }
 * Returns: { success: true }
 *
 * Updates the question status and writes the answer as a brain entry.
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

  let payload: { question_id?: unknown; answer?: unknown } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const questionId =
    typeof payload.question_id === "string"
      ? payload.question_id.trim()
      : "";
  const answer =
    typeof payload.answer === "string" ? payload.answer.trim() : "";

  if (!questionId || !answer) {
    return NextResponse.json(
      { error: "question_id and answer are required" },
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

    // 1. Get the question
    const questions = (await sbFetch(
      `/rest/v1/abra_unanswered_questions?id=eq.${questionId}&select=*`,
    )) as Array<{
      id: string;
      question: string;
      department: string | null;
      status: string;
    }>;

    if (questions.length === 0) {
      return NextResponse.json(
        { error: "Question not found" },
        { status: 404 },
      );
    }

    const question = questions[0];
    if (question.status === "answered") {
      return NextResponse.json(
        { error: "Question already answered" },
        { status: 400 },
      );
    }

    // 2. Update question status
    await sbFetch(
      `/rest/v1/abra_unanswered_questions?id=eq.${questionId}`,
      {
        method: "PATCH",
        headers: {
          Prefer: "return=minimal",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: "answered",
          answer,
          answered_by: session.user.email,
          resolved_at: new Date().toISOString(),
        }),
      },
    );

    // 3. Write answer as a brain entry
    const embeddingText = `Q: ${question.question}\nA: ${answer}`;
    const embedding = await buildEmbedding(embeddingText.slice(0, 8000));

    await sbFetch("/rest/v1/open_brain_entries", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_type: "manual",
        source_ref: `answer-${questionId}`,
        entry_type: "teaching",
        title: `Answer: ${question.question.slice(0, 100)}`,
        raw_text: `Question: ${question.question}\n\nAnswer (by ${session.user.email}): ${answer}`,
        summary_text: answer.slice(0, 500),
        category: "teaching",
        department: question.department || "executive",
        confidence: "high",
        priority: "important",
        processed: true,
        embedding,
      }),
    });

    await markSupabaseSuccess();

    return NextResponse.json({
      success: true,
      message: "Question answered and stored in brain.",
    });
  } catch (error) {
    if (isSupabaseRelatedError(error)) {
      await markSupabaseFailure(error);
    }
    const message =
      error instanceof Error ? error.message : "Answer failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
