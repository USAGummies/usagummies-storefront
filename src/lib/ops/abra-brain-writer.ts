/**
 * Abra Brain Writer — shared helper for creating brain entries with embeddings.
 *
 * ALL code that inserts into open_brain_entries should use this module
 * to ensure every entry gets an embedding for pgvector search.
 *
 * Usage:
 *   import { createBrainEntry } from "@/lib/ops/abra-brain-writer";
 *   await createBrainEntry({ title, raw_text, source_type: "agent", ... });
 */

const SUPABASE_URL = () =>
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const OPENAI_KEY = () => process.env.OPENAI_API_KEY || "";

interface BrainEntryParams {
  title: string;
  raw_text: string;
  summary_text?: string;
  source_type: "api" | "agent" | "manual" | "system";
  source_ref?: string;
  entry_type?: string;
  category?: string;
  department?: string;
  confidence?: string;
  priority?: string;
  tags?: string[];
  processed?: boolean;
  /** Skip embedding generation (use only when embedding is done elsewhere) */
  skip_embedding?: boolean;
}

async function generateEmbedding(text: string): Promise<number[]> {
  const key = OPENAI_KEY();
  if (!key) {
    console.warn("[brain-writer] No OPENAI_API_KEY — skipping embedding");
    return [];
  }

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.slice(0, 8000),
        dimensions: 1536,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.warn(`[brain-writer] Embedding API error: ${res.status}`);
      return [];
    }

    const data = await res.json();
    return data?.data?.[0]?.embedding || [];
  } catch (err) {
    console.warn(
      "[brain-writer] Embedding failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/**
 * Create a brain entry with automatic embedding generation.
 * Returns the entry ID if successful, null if failed.
 */
export async function createBrainEntry(
  params: BrainEntryParams,
): Promise<string | null> {
  const baseUrl = SUPABASE_URL();
  const serviceKey = SUPABASE_KEY();
  if (!baseUrl || !serviceKey) {
    console.warn("[brain-writer] Supabase not configured — skipping");
    return null;
  }

  // Generate embedding from title + content
  let embedding: number[] = [];
  if (!params.skip_embedding) {
    const embeddingText = [params.title, params.summary_text, params.raw_text]
      .filter(Boolean)
      .join("\n");
    embedding = await generateEmbedding(embeddingText);
  }

  const body: Record<string, unknown> = {
    title: params.title,
    raw_text: params.raw_text,
    summary_text: params.summary_text || params.raw_text.slice(0, 500),
    source_type: params.source_type,
    source_ref: params.source_ref || undefined,
    entry_type: params.entry_type || "summary",
    category: params.category || "general",
    department: params.department || "executive",
    confidence: params.confidence || "medium",
    priority: params.priority || "normal",
    tags: params.tags || [],
    processed: params.processed ?? true,
  };

  // Only include embedding if we got one
  if (embedding.length > 0) {
    body.embedding = JSON.stringify(embedding);
  }

  try {
    const res = await fetch(`${baseUrl}/rest/v1/open_brain_entries`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[brain-writer] Insert failed: ${res.status} — ${text}`);
      return null;
    }

    const rows = await res.json();
    const id = Array.isArray(rows) ? rows[0]?.id : rows?.id;
    return id || null;
  } catch (err) {
    console.error(
      "[brain-writer] Insert error:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Backfill embeddings for entries that are missing them.
 * Call this periodically to catch any entries that slipped through.
 */
export async function backfillMissingEmbeddings(
  limit = 50,
): Promise<{ processed: number; succeeded: number; failed: number }> {
  const baseUrl = SUPABASE_URL();
  const serviceKey = SUPABASE_KEY();
  if (!baseUrl || !serviceKey) return { processed: 0, succeeded: 0, failed: 0 };

  // Fetch entries without embeddings
  const res = await fetch(
    `${baseUrl}/rest/v1/open_brain_entries?embedding=is.null&select=id,title,raw_text,summary_text&order=created_at.desc&limit=${limit}`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      signal: AbortSignal.timeout(15000),
    },
  );

  if (!res.ok) return { processed: 0, succeeded: 0, failed: 0 };

  const entries = (await res.json()) as Array<{
    id: string;
    title: string;
    raw_text: string;
    summary_text: string;
  }>;

  let succeeded = 0;
  let failed = 0;

  for (const entry of entries) {
    const text = [entry.title, entry.summary_text, entry.raw_text]
      .filter(Boolean)
      .join("\n");
    const embedding = await generateEmbedding(text);

    if (embedding.length === 0) {
      failed++;
      continue;
    }

    const patchRes = await fetch(
      `${baseUrl}/rest/v1/open_brain_entries?id=eq.${entry.id}`,
      {
        method: "PATCH",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ embedding: JSON.stringify(embedding) }),
        signal: AbortSignal.timeout(10000),
      },
    );

    if (patchRes.ok) {
      succeeded++;
    } else {
      failed++;
    }

    // Rate limit — OpenAI embedding API allows ~3000 RPM
    await new Promise((r) => setTimeout(r, 200));
  }

  return { processed: entries.length, succeeded, failed };
}
