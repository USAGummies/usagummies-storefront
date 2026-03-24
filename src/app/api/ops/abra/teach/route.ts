/**
 * POST /api/ops/abra/teach — Teach Abra domain knowledge
 *
 * Body: { department: string, content: string, title?: string }
 * Returns: { success: true, id: string }
 *
 * Teachings are written as high-priority brain entries that will appear
 * in future searches. Department owners can educate Abra about their domain.
 */

import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@/lib/auth/config";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  canUseSupabase,
  markSupabaseFailure,
  markSupabaseSuccess,
} from "@/lib/ops/supabase-resilience";
import { validateRequest, TeachRequestSchema } from "@/lib/ops/validation";

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

  const v = await validateRequest(req, TeachRequestSchema);
  if (!v.success) return v.response;

  const department = v.data.department?.toLowerCase() || "";
  const content = v.data.content;
  const source = typeof v.data.source === "string" ? v.data.source : "";
  // Detect if this is a correction (supersedes conflicting entries)
  const isCorrection = /^correct|^correction|supersede|replaces|not.*was/i.test(content) ||
    source.includes("correction");
  const title =
    v.data.title || `${isCorrection ? "Correction" : "Teaching"}: ${department || "general"} — ${content.slice(0, 60)}`;
  const sourceRef = `teaching-${createHash("sha256")
    .update(`${department}|${title}|${content}`)
    .digest("hex")
    .slice(0, 24)}`;

  try {
    const circuitCheck = await canUseSupabase();
    if (!circuitCheck.allowed) {
      return NextResponse.json(
        { error: "Brain temporarily unavailable (circuit open)" },
        { status: 503 },
      );
    }

    // Validate department exists if provided
    if (department) {
      const depts = (await sbFetch(
        `/rest/v1/abra_departments?name=eq.${encodeURIComponent(department)}&select=name`,
      )) as Array<{ name: string }>;

      if (depts.length === 0) {
        // List valid departments for the error message
        const allDepts = (await sbFetch(
          "/rest/v1/abra_departments?select=name&order=name",
        )) as Array<{ name: string }>;
        const validNames = allDepts.map((d) => d.name).join(", ");
        return NextResponse.json(
          {
            error: `Department "${department}" not found. Valid: ${validNames || "none configured"}`,
          },
          { status: 400 },
        );
      }
    }

    const taughtBy = session?.user?.email || "cron@system";
    const embeddingText = `${title}. ${content}`;
    const embedding = await buildEmbedding(embeddingText.slice(0, 8000));

    const existing = (await sbFetch(
      `/rest/v1/open_brain_entries?source_ref=eq.${encodeURIComponent(sourceRef)}&select=id&limit=1`,
    )) as Array<{ id: string }>;
    if (existing[0]?.id) {
      await markSupabaseSuccess();
      return NextResponse.json({
        success: true,
        id: existing[0].id,
        message: "Teaching already stored. Existing entry reused.",
      });
    }

    // Write to open_brain_entries as a high-priority teaching entry
    const rows = (await sbFetch("/rest/v1/open_brain_entries", {
      method: "POST",
      headers: {
        Prefer: "return=representation",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_type: "manual",
        source_ref: sourceRef,
        entry_type: "teaching",
        title,
        raw_text: `Taught by ${taughtBy}:\n${content}`,
        summary_text: content.slice(0, 500),
        category: "teaching",
        department: department || "executive",
        confidence: "high",
        priority: "important",
        processed: true,
        embedding,
      }),
    })) as Array<{ id: string }>;

    const resultId = rows[0]?.id;
    await markSupabaseSuccess();

    // Index entities from the teaching (best-effort, never blocks)
    if (resultId) {
      import("@/lib/ops/signals/entity-graph").then(({ indexEntities }) =>
        indexEntities(resultId, content).catch(() => {}),
      ).catch(() => {});
    }

    // For corrections: find and supersede conflicting entries via semantic search
    let supersededCount = 0;
    if (isCorrection && resultId && embedding.length > 0) {
      try {
        const similar = (await sbFetch("/rest/v1/rpc/search_memory", {
          method: "POST",
          body: JSON.stringify({
            query_embedding: `[${embedding.join(",")}]`,
            match_count: 5,
          }),
        })) as Array<{ id: string; title: string; similarity: number }>;

        const toSupersede = (Array.isArray(similar) ? similar : [])
          .filter((s) => s.id !== resultId); // Don't supersede self
        for (const old of toSupersede) {
          await sbFetch(
            `/rest/v1/open_brain_entries?id=eq.${encodeURIComponent(old.id)}&superseded_by=is.null`,
            {
              method: "PATCH",
              headers: { Prefer: "return=minimal" },
              body: JSON.stringify({
                superseded_by: resultId,
                superseded_at: new Date().toISOString(),
              }),
            },
          );
          supersededCount++;
        }
      } catch (err) {
        console.warn("[teach] Supersession search failed (non-fatal):", err instanceof Error ? err.message : err);
      }
    }

    return NextResponse.json({
      success: true,
      id: resultId,
      message: isCorrection
        ? `Correction stored. ${supersededCount > 0 ? `${supersededCount} conflicting entr${supersededCount === 1 ? "y" : "ies"} superseded.` : "No conflicting entries found to supersede."} Abra will use the corrected info going forward.`
        : `Teaching stored in ${department || "general"} knowledge. Abra will use this in future answers.`,
    });
  } catch (error) {
    if (isSupabaseRelatedError(error)) {
      await markSupabaseFailure(error);
    }
    console.error("[teach] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Teaching failed" }, { status: 500 });
  }
}
