/**
 * POST /api/ops/abra/insights — Quick brain insights for dashboard cards
 *
 * Accepts a topic string, queries brain for relevant context, and returns
 * Claude-generated insight bullets. Designed for embedding into dashboard
 * cards across multiple pages (KPIs, Supply Chain, Wholesale, etc.)
 *
 * Body: { topic: string, maxResults?: number }
 * Returns: { insights: string[], sources: { title: string, source_table: string }[] }
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
const DEFAULT_CLAUDE_MODEL =
  process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";

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
    throw new Error(`Embedding failed (${res.status}): ${errText.slice(0, 200)}`);
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

  let payload: { topic?: unknown; maxResults?: unknown } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const topic = typeof payload.topic === "string" ? payload.topic.trim() : "";
  if (!topic) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 });
  }

  const matchCount = Math.min(
    typeof payload.maxResults === "number" ? payload.maxResults : 6,
    10,
  );

  try {
    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      return NextResponse.json(
        { error: "Brain temporarily unavailable", insights: [], sources: [] },
        { status: 503 },
      );
    }

    const embedding = await buildEmbedding(topic);
    const results = (await sbFetch("/rest/v1/rpc/search_unified", {
      method: "POST",
      body: JSON.stringify({
        query_embedding: embedding,
        match_count: matchCount,
        filter_tables: ["brain", "email"],
      }),
    })) as Array<{
      title: string | null;
      raw_text: string | null;
      summary_text: string | null;
      source_table: string;
    }>;

    await markSupabaseSuccess();

    if (results.length === 0) {
      return NextResponse.json({ insights: ["No relevant data found in brain."], sources: [] });
    }

    const context = results
      .slice(0, matchCount)
      .map(
        (r) =>
          `[${r.source_table}] ${r.title || "(untitled)"}: ${(r.raw_text || r.summary_text || "").slice(0, 400)}`,
      )
      .join("\n\n");

    // Ask Claude for concise insights
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_CLAUDE_MODEL,
        max_tokens: 500,
        temperature: 0.15,
        system:
          "You are Abra, the AI ops assistant for USA Gummies. Return ONLY a JSON array of 3-5 concise insight strings (each 1 sentence, <100 chars). Focus on actionable intelligence. No markdown fences.",
        messages: [
          {
            role: "user",
            content: `Topic: ${topic}\n\nContext from brain:\n${context}\n\nReturn JSON array of insight strings only.`,
          },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Claude failed (${res.status}): ${text.slice(0, 200)}`);
    }

    let claudePayload: Record<string, unknown> = {};
    try {
      claudePayload = JSON.parse(text);
    } catch {
      throw new Error("Failed to parse Claude response");
    }

    const content = Array.isArray(claudePayload.content) ? claudePayload.content : [];
    const reply = content
      .map((item) =>
        item && typeof item === "object" && "text" in item
          ? String(item.text || "")
          : "",
      )
      .join("")
      .trim();

    const jsonMatch = reply.match(/\[[\s\S]*\]/);
    let insights: string[] = [];
    if (jsonMatch) {
      try {
        insights = JSON.parse(jsonMatch[0]) as string[];
      } catch {
        insights = [reply.slice(0, 200)];
      }
    } else {
      insights = [reply.slice(0, 200)];
    }

    const sources = results.slice(0, matchCount).map((r) => ({
      title: r.title || "(untitled)",
      source_table: r.source_table,
    }));

    return NextResponse.json({ insights, sources });
  } catch (error) {
    if (isSupabaseRelatedError(error)) {
      await markSupabaseFailure(error);
    }
    const message = error instanceof Error ? error.message : "Insights failed";
    return NextResponse.json({ error: message, insights: [], sources: [] }, { status: 500 });
  }
}
