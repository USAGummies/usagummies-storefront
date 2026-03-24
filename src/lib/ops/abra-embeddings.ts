const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  return key;
}

function normalizeEmbedding(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid embedding payload");
  }
  return value.map((item) => Number(item));
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const [embedding] = await generateEmbeddings([text]);
  if (!embedding) throw new Error("Missing embedding output");
  return embedding;
}

// ---------------------------------------------------------------------------
// Supabase helpers (for embedding backfill)
// ---------------------------------------------------------------------------

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetchEmbed(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase not configured");

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
    signal: init.signal || AbortSignal.timeout(15000),
  });

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try { json = JSON.parse(text); } catch { json = text; }
  }
  if (!res.ok) {
    throw new Error(`Supabase ${init.method || "GET"} failed (${res.status})`);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Backfill NULL embeddings
// ---------------------------------------------------------------------------

type NullEmbeddingEntry = {
  id: string;
  title: string | null;
  raw_text: string | null;
  summary_text: string | null;
};

/**
 * Find brain entries with NULL embeddings and generate+save them.
 * Designed to be called from the scheduler's embedding backfill step.
 * Processes up to `limit` entries per call to avoid timeouts.
 */
export async function backfillNullEmbeddings(limit = 20): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  ids: string[];
}> {
  // Query for entries with NULL embedding
  const entries = (await sbFetchEmbed(
    `/rest/v1/open_brain_entries?embedding=is.null&select=id,title,raw_text,summary_text&order=created_at.desc&limit=${limit}`,
  )) as NullEmbeddingEntry[];

  if (!entries || entries.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, ids: [] };
  }

  let succeeded = 0;
  let failed = 0;
  const processedIds: string[] = [];

  for (const entry of entries) {
    const text = `${entry.title || ""}: ${entry.raw_text || entry.summary_text || ""}`.trim();
    if (!text || text === ":") {
      failed++;
      continue;
    }

    try {
      const embedding = await generateEmbedding(text.slice(0, 8000));
      await sbFetchEmbed(
        `/rest/v1/open_brain_entries?id=eq.${encodeURIComponent(entry.id)}`,
        {
          method: "PATCH",
          headers: {
            Prefer: "return=minimal",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ embedding }),
        },
      );
      succeeded++;
      processedIds.push(entry.id);
    } catch (err) {
      console.error(`[embeddings] Backfill failed for entry ${entry.id}:`, err);
      failed++;
    }
  }

  return {
    processed: entries.length,
    succeeded,
    failed,
    ids: processedIds,
  };
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const cleaned = texts
    .map((text) => (typeof text === "string" ? text.trim() : ""))
    .filter(Boolean);
  if (cleaned.length === 0) return [];

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getOpenAIKey()}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: cleaned.map((text) => text.slice(0, 8000)),
      dimensions: EMBEDDING_DIMENSIONS,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Embedding failed (${res.status}): ${errText.slice(0, 220)}`);
  }

  const payload = await res.json();
  const data = Array.isArray(payload?.data) ? payload.data : [];
  if (!data.length) {
    throw new Error("Embedding API returned no vectors");
  }

  return data
    .sort(
      (a: { index?: number }, b: { index?: number }) =>
        Number(a?.index ?? 0) - Number(b?.index ?? 0),
    )
    .map((row: { embedding?: unknown }) => normalizeEmbedding(row.embedding));
}
