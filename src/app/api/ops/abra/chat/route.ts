import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  canUseSupabase,
  markSupabaseFailure,
  markSupabaseSuccess,
} from "@/lib/ops/supabase-resilience";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_MATCH_COUNT = 8;
const MAX_CONTEXT_CHARS = 3000;
const DEFAULT_CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type UnifiedSearchRow = {
  id: string;
  source_table: "brain" | "email";
  title: string | null;
  raw_text: string | null;
  summary_text: string | null;
  category: string | null;
  department: string | null;
  similarity: number;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!baseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
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
    throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${typeof json === "string" ? json : JSON.stringify(json)}`);
  }

  return json;
}

function isSupabaseRelatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /supabase|rest\/v1|service_role|SUPABASE/i.test(message);
}

function sanitizeHistory(history: unknown): ChatMessage[] {
  if (!Array.isArray(history)) return [];

  return history
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item): ChatMessage => {
      const role: ChatMessage["role"] = item.role === "assistant" ? "assistant" : "user";
      return {
        role,
        content: typeof item.content === "string" ? item.content.trim() : "",
      };
    })
    .filter((item) => item.content.length > 0)
    .slice(-12);
}

async function buildEmbedding(query: string): Promise<number[]> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw new Error("OPENAI_API_KEY not configured for embeddings");
  }

  const embeddingRes = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: query,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!embeddingRes.ok) {
    const errorText = await embeddingRes.text().catch(() => "");
    throw new Error(`Embedding generation failed (${embeddingRes.status}): ${errorText.slice(0, 200)}`);
  }

  const data = await embeddingRes.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error("Failed to parse embedding vector");
  }

  return embedding as number[];
}

function buildContext(results: UnifiedSearchRow[]): string {
  if (!results.length) return "No relevant records found.";

  return results
    .map((row, idx) => {
      const title = row.title || "(untitled)";
      const source = row.source_table;
      const similarity = typeof row.similarity === "number" ? row.similarity.toFixed(3) : "0.000";
      const text = (row.raw_text || row.summary_text || "").slice(0, MAX_CONTEXT_CHARS);
      const metadata = row.metadata ? JSON.stringify(row.metadata) : "{}";
      return [
        `Source ${idx + 1}`,
        `Table: ${source}`,
        `Title: ${title}`,
        `Similarity: ${similarity}`,
        `Category: ${row.category || "n/a"} | Department: ${row.department || "n/a"}`,
        `Metadata: ${metadata}`,
        `Content:`,
        text || "(empty)",
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function buildConversation(history: ChatMessage[]): string {
  if (!history.length) return "";
  return history
    .slice(-6)
    .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
    .join("\n");
}

async function generateClaudeReply(input: {
  message: string;
  history: ChatMessage[];
  results: UnifiedSearchRow[];
}) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const system = [
    "You are Abra, the AI operations assistant for USA Gummies.",
    "Answer using only the provided business context (emails + open brain records).",
    "Be concise, actionable, and specific with dates/numbers when available.",
    "If context is insufficient, say what is missing instead of guessing.",
    "Include short source citations like [brain:Title] or [email:Subject].",
  ].join(" ");

  const historyText = buildConversation(input.history);
  const contextText = buildContext(input.results);
  const userPrompt = [
    historyText ? `Recent conversation:\n${historyText}` : "",
    `User question:\n${input.message}`,
    `Retrieved context:\n${contextText}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_CLAUDE_MODEL,
      max_tokens: 900,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: userPrompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  const text = await res.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }

  if (!res.ok) {
    throw new Error(`Claude API failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const content = Array.isArray(payload.content) ? payload.content : [];
  const reply = content
    .map((item) => (item && typeof item === "object" && "text" in item ? String(item.text || "") : ""))
    .join("\n")
    .trim();

  if (!reply) {
    throw new Error("Claude returned an empty response");
  }

  return reply;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: { message?: unknown; history?: unknown } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const history = sanitizeHistory(payload.history);

  try {
    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      return NextResponse.json(
        {
          error: "Supabase dependency is temporarily unavailable (circuit open)",
          circuitOpen: true,
          cooldownUntil: circuitCheck.state.cooldownUntil,
        },
        { status: 503 },
      );
    }

    const embedding = await buildEmbedding(message);
    const results = (await sbFetch("/rest/v1/rpc/search_unified", {
      method: "POST",
      body: JSON.stringify({
        query_embedding: embedding,
        match_count: DEFAULT_MATCH_COUNT,
        filter_tables: ["brain", "email"],
      }),
    })) as UnifiedSearchRow[];

    await markSupabaseSuccess();

    const reply = await generateClaudeReply({
      message,
      history,
      results: results.slice(0, DEFAULT_MATCH_COUNT),
    });

    return NextResponse.json({
      reply,
      sources: results.slice(0, DEFAULT_MATCH_COUNT).map((row) => ({
        id: row.id,
        source_table: row.source_table,
        title: row.title || "(untitled)",
        similarity: row.similarity,
        category: row.category,
        department: row.department,
        metadata: row.metadata || {},
      })),
    });
  } catch (error) {
    if (isSupabaseRelatedError(error)) {
      await markSupabaseFailure(error);
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
