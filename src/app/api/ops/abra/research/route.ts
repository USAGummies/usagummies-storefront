/**
 * POST /api/ops/abra/research — Abra research endpoint
 *
 * Body: { query: string, department?: string, context?: string }
 * Returns: {
 *   findings: { topic: string, summary: string, relevance: string }[],
 *   baseline_requirements: string[],
 *   recommendations: string[],
 *   brain_sources: { title: string, days_ago: number }[]
 * }
 *
 * Searches brain first, then uses Claude to synthesize structured findings.
 * Cost: ~$0.05-0.10 per call.
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  canUseSupabase,
  markSupabaseFailure,
  markSupabaseSuccess,
} from "@/lib/ops/supabase-resilience";
import { logAICost, extractClaudeUsage } from "@/lib/ops/abra-cost-tracker";
import { getPlaybook } from "@/lib/ops/department-playbooks";
import type { TemporalSearchRow } from "@/lib/ops/abra-system-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DEFAULT_CLAUDE_MODEL =
  process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

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
      model: "text-embedding-3-small",
      input: text,
      dimensions: 1536,
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

  // Log embedding cost
  const tokens = data?.usage?.total_tokens || 0;
  void logAICost({
    model: "text-embedding-3-small",
    provider: "openai",
    inputTokens: tokens,
    outputTokens: 0,
    endpoint: "research",
  });

  return embedding as number[];
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: { query?: unknown; department?: unknown; context?: unknown } =
    {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const query =
    typeof payload.query === "string" ? payload.query.trim() : "";
  if (!query) {
    return NextResponse.json(
      { error: "query is required" },
      { status: 400 },
    );
  }

  const department =
    typeof payload.department === "string"
      ? payload.department.trim().toLowerCase()
      : null;
  const extraContext =
    typeof payload.context === "string" ? payload.context.trim() : "";

  try {
    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      return NextResponse.json(
        { error: "Brain temporarily unavailable" },
        { status: 503 },
      );
    }

    // 1. Search brain for existing knowledge
    const embedding = await buildEmbedding(query);
    const brainResults = (await sbFetch("/rest/v1/rpc/search_temporal", {
      method: "POST",
      body: JSON.stringify({
        query_embedding: embedding,
        match_count: 6,
        filter_tables: ["brain"],
      }),
    })) as TemporalSearchRow[];

    await markSupabaseSuccess();

    // 2. Get playbook baseline if department is known
    const playbook = department ? getPlaybook(department) : null;

    // 3. Build context from brain results
    const brainContext = brainResults
      .slice(0, 4)
      .map(
        (r) =>
          `[${r.source_table}] ${r.title || "(untitled)"} (${r.days_ago}d ago): ${(r.raw_text || r.summary_text || "").slice(0, 300)}`,
      )
      .join("\n\n");

    // 4. Call Claude for structured research
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey)
      throw new Error("ANTHROPIC_API_KEY not configured");

    const today = new Date().toISOString().split("T")[0];
    const playbookHint = playbook
      ? `\n\nKnown baseline requirements for ${department}:\n${playbook.baseline.map((b) => `- ${b}`).join("\n")}`
      : "";

    const systemPrompt = `You are a business operations research analyst for USA Gummies, a dye-free gummy candy company. Today is ${today}.

Your job is to research a topic and return STRUCTURED findings that can be used to build an operational plan.

Return ONLY valid JSON with this exact structure:
{
  "findings": [
    { "topic": "string", "summary": "1-2 sentence finding", "relevance": "high|medium|low" }
  ],
  "baseline_requirements": ["requirement1", "requirement2", ...],
  "recommendations": ["recommendation1", "recommendation2", ...]
}

Rules:
- Include 5-10 findings covering the essential components
- Baseline requirements are universal (any company in this space needs them)
- Recommendations are specific to a small CPG/candy company
- Be practical and actionable, not theoretical
- Consider DTC (Shopify), Amazon marketplace, and wholesale channels
- The company has ~3 team members, limited budget, needs lean processes
- No markdown fences in the output — just raw JSON`;

    const userPrompt = [
      `Research topic: ${query}`,
      department ? `Department: ${department}` : "",
      extraContext ? `Additional context: ${extraContext}` : "",
      brainContext
        ? `\nExisting knowledge in brain:\n${brainContext}`
        : "",
      playbookHint,
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
        max_tokens: 1200,
        temperature: 0.2,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: AbortSignal.timeout(25000),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Claude failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }

    let claudePayload: Record<string, unknown> = {};
    try {
      claudePayload = JSON.parse(text);
    } catch {
      throw new Error("Failed to parse Claude response");
    }

    // Log cost
    const usage = extractClaudeUsage(claudePayload);
    if (usage) {
      void logAICost({
        model: DEFAULT_CLAUDE_MODEL,
        provider: "anthropic",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        endpoint: "research",
        department: department || undefined,
      });
    }

    // Extract text from Claude response
    const content = Array.isArray(claudePayload.content)
      ? claudePayload.content
      : [];
    const reply = content
      .map((item) =>
        item && typeof item === "object" && "text" in item
          ? String(item.text || "")
          : "",
      )
      .join("")
      .trim();

    // Parse JSON from reply
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    let findings: { topic: string; summary: string; relevance: string }[] =
      [];
    let baselineRequirements: string[] = [];
    let recommendations: string[] = [];

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        findings = Array.isArray(parsed.findings)
          ? (parsed.findings as typeof findings)
          : [];
        baselineRequirements = Array.isArray(parsed.baseline_requirements)
          ? (parsed.baseline_requirements as string[])
          : [];
        recommendations = Array.isArray(parsed.recommendations)
          ? (parsed.recommendations as string[])
          : [];
      } catch {
        // Fallback — return raw text as single finding
        findings = [{ topic: query, summary: reply.slice(0, 500), relevance: "medium" }];
      }
    }

    // Merge playbook baseline if available
    if (playbook) {
      const existingSet = new Set(
        baselineRequirements.map((r) => r.toLowerCase()),
      );
      for (const b of playbook.baseline) {
        if (!existingSet.has(b.toLowerCase())) {
          baselineRequirements.push(b);
        }
      }
    }

    return NextResponse.json({
      findings,
      baseline_requirements: baselineRequirements,
      recommendations,
      brain_sources: brainResults.slice(0, 4).map((r) => ({
        title: r.title || "(untitled)",
        days_ago: r.days_ago,
        source_table: r.source_table,
      })),
    });
  } catch (error) {
    if (isSupabaseRelatedError(error)) {
      await markSupabaseFailure(error);
    }
    const message =
      error instanceof Error ? error.message : "Research failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
