/**
 * POST /api/ops/pipeline/enrich — Brain-enriched deal intelligence
 *
 * Accepts an array of deal summaries, searches Abra's brain (emails + brain)
 * for relevant context, then uses Claude to generate next-step recommendations.
 *
 * Body: { deals: Array<{ id, name, email, stage, dealValue, qualification }> } (max 10)
 * Returns: { enriched: Array<{ id, insight, nextStep, relatedEmails }> }
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

type DealInput = {
  id: string;
  name: string;
  email?: string;
  stage: string;
  dealValue?: number;
  qualification?: string;
};

type EnrichResult = {
  id: string;
  insight: string;
  nextStep: string;
  relatedEmails: string[];
};

// ── Supabase fetch helper ──

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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
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

// ── Claude enrichment call ──

async function enrichWithClaude(
  deals: DealInput[],
  brainContext: string,
): Promise<EnrichResult[]> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const system = [
    "You are Abra, the AI operations assistant for USA Gummies.",
    "Your task: enrich B2B pipeline deals with brain intelligence.",
    "For each deal, provide a brief insight based on email history and brain context,",
    "a concrete next step recommendation, and list any related email subjects.",
    "Respond with ONLY a valid JSON array. No markdown fences, no explanation.",
    'Each element: {"id": "deal-id", "insight": "1-2 sentence intel", "nextStep": "specific action", "relatedEmails": ["subject1", "subject2"]}',
  ].join(" ");

  const dealsText = deals
    .map(
      (d, i) =>
        `Deal ${i + 1} (id: ${d.id}):\nName: ${d.name}\nEmail: ${d.email || "none"}\nStage: ${d.stage}\nValue: $${d.dealValue || 0}\nQualification: ${d.qualification || "unknown"}`,
    )
    .join("\n\n");

  const userPrompt = [
    "Enrich these pipeline deals with intelligence:\n",
    dealsText,
    brainContext
      ? `\nBusiness context from brain (emails + notes):\n${brainContext}`
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
      max_tokens: 1500,
      temperature: 0.15,
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

  const jsonMatch = reply.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("Claude did not return a valid JSON array");
  }

  const parsed = JSON.parse(jsonMatch[0]) as EnrichResult[];
  return parsed;
}

// ── Route handler ──

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: { deals?: unknown } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  if (!Array.isArray(payload.deals) || payload.deals.length === 0) {
    return NextResponse.json(
      { error: "deals array is required" },
      { status: 400 },
    );
  }

  const deals: DealInput[] = (payload.deals as DealInput[]).slice(0, 10);

  try {
    let brainContext = "";
    const circuitCheck = await canUseSupabase();

    if (circuitCheck.allowed) {
      try {
        const combinedText = deals
          .map((d) => `${d.name} ${d.email || ""} ${d.stage} wholesale distributor`)
          .join(" ")
          .slice(0, 500);

        const embedding = await buildEmbedding(combinedText);
        const results = (await sbFetch("/rest/v1/rpc/search_unified", {
          method: "POST",
          body: JSON.stringify({
            query_embedding: embedding,
            match_count: 8,
            filter_tables: ["brain", "email"],
          }),
        })) as Array<{
          title: string | null;
          raw_text: string | null;
          summary_text: string | null;
        }>;

        await markSupabaseSuccess();

        brainContext = results
          .slice(0, 5)
          .map(
            (r) =>
              `${r.title || "(untitled)"}: ${(r.raw_text || r.summary_text || "").slice(0, 400)}`,
          )
          .join("\n");
      } catch (err) {
        if (isSupabaseRelatedError(err)) {
          await markSupabaseFailure(err);
        }
      }
    }

    const enriched = await enrichWithClaude(deals, brainContext);

    return NextResponse.json({ enriched });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Enrichment failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
