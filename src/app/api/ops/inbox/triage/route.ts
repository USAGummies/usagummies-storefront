/**
 * POST /api/ops/inbox/triage — AI-powered email triage
 *
 * Accepts an array of inbox messages, uses Abra's brain (Supabase RAG)
 * + Claude to categorize each by urgency and business area.
 *
 * Body: { messages: Array<{ id, subject, sender, snippet }> }  (max 20)
 * Returns: { triaged: Array<{ id, urgency, category, summary }> }
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
export const maxDuration = 30;

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_CLAUDE_MODEL =
  process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";

type TriageInput = {
  id: string;
  subject: string;
  sender: string;
  snippet: string;
};

type TriageResult = {
  id: string;
  urgency: "Critical" | "Action Required" | "FYI" | "Low";
  category: string;
  summary: string;
};

// ── Supabase fetch helper (mirrors chat/route.ts) ──

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error(
      "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
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

// ── Embedding helper ──

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

// ── Claude triage call ──

async function triageWithClaude(
  messages: TriageInput[],
  brainContext: string,
): Promise<TriageResult[]> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const system = [
    "You are Abra, the AI operations assistant for USA Gummies.",
    "Your task: categorize inbox messages by urgency and business area.",
    "Urgency levels: Critical (needs immediate action), Action Required (respond within 24h), FYI (informational), Low (can ignore).",
    "Respond with ONLY a valid JSON array. No markdown fences, no explanation.",
    "Each element: {\"id\": \"msg-id\", \"urgency\": \"Critical|Action Required|FYI|Low\", \"category\": \"short label\", \"summary\": \"1-line summary\"}",
  ].join(" ");

  const messagesText = messages
    .map(
      (m, i) =>
        `Message ${i + 1} (id: ${m.id}):\nFrom: ${m.sender}\nSubject: ${m.subject}\nSnippet: ${m.snippet}`,
    )
    .join("\n\n");

  const userPrompt = [
    "Triage these inbox messages:\n",
    messagesText,
    brainContext
      ? `\nBusiness context from brain:\n${brainContext}`
      : "",
    "\nReturn JSON array only.",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_CLAUDE_MODEL,
      max_tokens: 1200,
      temperature: 0.1,
      system,
      messages: [{ role: "user", content: userPrompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Claude API failed (${res.status}): ${text.slice(0, 300)}`);
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Failed to parse Claude response");
  }

  const content = Array.isArray(payload.content) ? payload.content : [];
  const reply = content
    .map((item) =>
      item && typeof item === "object" && "text" in item
        ? String(item.text || "")
        : "",
    )
    .join("")
    .trim();

  // Parse JSON from reply (Claude may wrap in markdown fences)
  const jsonMatch = reply.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("Claude did not return a valid JSON array");
  }

  const parsed = JSON.parse(jsonMatch[0]) as TriageResult[];
  return parsed;
}

// ── Route handler ──

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: { messages?: unknown } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return NextResponse.json(
      { error: "messages array is required" },
      { status: 400 },
    );
  }

  // Cap at 20 messages
  const messages: TriageInput[] = (payload.messages as TriageInput[]).slice(
    0,
    20,
  );

  try {
    // Build context from brain (optional — graceful if Supabase is down)
    let brainContext = "";
    const circuitCheck = await canUseSupabase();

    if (circuitCheck.allowed) {
      try {
        const combinedText = messages
          .map((m) => `${m.subject} ${m.snippet}`)
          .join(" ")
          .slice(0, 500);

        const embedding = await buildEmbedding(combinedText);
        const results = (await sbFetch("/rest/v1/rpc/search_unified", {
          method: "POST",
          body: JSON.stringify({
            query_embedding: embedding,
            match_count: 5,
            filter_tables: ["brain", "email"],
          }),
        })) as Array<{
          title: string | null;
          raw_text: string | null;
          summary_text: string | null;
        }>;

        await markSupabaseSuccess();

        brainContext = results
          .slice(0, 3)
          .map(
            (r) =>
              `${r.title || "(untitled)"}: ${(r.raw_text || r.summary_text || "").slice(0, 300)}`,
          )
          .join("\n");
      } catch (err) {
        if (isSupabaseRelatedError(err)) {
          await markSupabaseFailure(err);
        }
        // Continue without brain context — triage still works
      }
    }

    // Call Claude for triage
    const triaged = await triageWithClaude(messages, brainContext);

    return NextResponse.json({ triaged });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Triage failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
