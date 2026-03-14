/**
 * Abra Source Provenance & Answer Logging
 *
 * Tracks:
 * 1. Which sources were used to answer each question
 * 2. Confidence scores
 * 3. Whether the answer was later corrected (for truth benchmarking)
 * 4. User feedback (thumbs up/down)
 */

export type AnswerLogEntry = {
  question: string;
  answer: string;
  source_ids: string[];
  source_tables: string[];
  confidence: number;
  memory_tiers_used: string[];
  department: string | null;
  asked_by: string;
  channel: "web" | "slack" | "api";
  model_used: string;
  input_tokens?: number;
  output_tokens?: number;
};

export type AnswerLogRow = AnswerLogEntry & {
  id: string;
  was_corrected: boolean;
  correction_id: string | null;
  user_feedback: "positive" | "negative" | null;
  created_at: string;
};

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  // abra_answer_log.confidence is NUMERIC(4,3), max absolute value < 10
  const clamped = Math.max(0, Math.min(9.999, value));
  return Number(clamped.toFixed(3));
}

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const env = getSupabaseEnv();
  if (!env) return null;

  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(5000),
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

/**
 * Log an answer for provenance tracking (best-effort, never blocks).
 * Returns the answer log ID for later feedback/correction linking.
 */
export async function logAnswer(entry: AnswerLogEntry): Promise<string | null> {
  try {
    const rows = (await sbFetch("/rest/v1/abra_answer_log", {
      method: "POST",
      headers: {
        Prefer: "return=representation",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question: entry.question.slice(0, 2000),
        answer: entry.answer.slice(0, 5000),
        source_ids: entry.source_ids,
        source_tables: entry.source_tables,
        confidence: normalizeConfidence(entry.confidence),
        memory_tiers_used: entry.memory_tiers_used,
        department: entry.department,
        asked_by: entry.asked_by,
        channel: entry.channel,
        model_used: entry.model_used,
        input_tokens: entry.input_tokens || 0,
        output_tokens: entry.output_tokens || 0,
      }),
    })) as Array<{ id: string }> | null;

    return rows?.[0]?.id || null;
  } catch (error) {
    console.error(
      "[provenance] Failed to log answer:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Record user feedback on an answer.
 */
export async function recordFeedback(
  answerLogId: string,
  feedback: "positive" | "negative",
): Promise<boolean> {
  try {
    await sbFetch(`/rest/v1/abra_answer_log?id=eq.${answerLogId}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_feedback: feedback,
      }),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Mark an answer as corrected (links to correction ID).
 */
export async function markAnswerCorrected(
  answerLogId: string,
  correctionId: string,
): Promise<boolean> {
  try {
    await sbFetch(`/rest/v1/abra_answer_log?id=eq.${answerLogId}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        was_corrected: true,
        correction_id: correctionId,
      }),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get recent answers for a department (for truth benchmarking).
 */
export async function getRecentAnswers(params: {
  department?: string;
  limit?: number;
  channel?: string;
}): Promise<AnswerLogRow[]> {
  try {
    const filters: string[] = [];
    if (params.department) {
      filters.push(`department=eq.${params.department}`);
    }
    if (params.channel) {
      filters.push(`channel=eq.${params.channel}`);
    }
    const filterStr = filters.length > 0 ? `&${filters.join("&")}` : "";
    const limit = params.limit || 20;

    return (await sbFetch(
      `/rest/v1/abra_answer_log?select=*&order=created_at.desc&limit=${limit}${filterStr}`,
    )) as AnswerLogRow[];
  } catch {
    return [];
  }
}

/**
 * Build source provenance metadata for a set of search results.
 * Returns arrays of source IDs and tables for the answer log.
 */
export function extractProvenance(
  results: Array<{
    id: string;
    source_table: string;
    memory_tier?: string;
  }>,
): {
  source_ids: string[];
  source_tables: string[];
  memory_tiers_used: string[];
} {
  const source_ids = [...new Set(results.map((r) => r.id).filter(Boolean))];
  const source_tables = [...new Set(results.map((r) => r.source_table))];
  const memory_tiers_used = [
    ...new Set(results.map((r) => r.memory_tier || "cold")),
  ];

  return { source_ids, source_tables, memory_tiers_used };
}
