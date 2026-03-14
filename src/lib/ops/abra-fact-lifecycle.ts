/**
 * Abra Fact Lifecycle Management
 *
 * When a correction is submitted, this module:
 * 1. Finds old brain entries that match the original claim (by embedding similarity)
 * 2. Marks them as superseded (superseded_by = correction ID)
 * 3. Ensures search_temporal filters out superseded entries
 *
 * This prevents Abra from citing stale facts alongside the correction.
 */

const SIMILARITY_THRESHOLD = 0.78; // Only supersede entries above this similarity
const MAX_SUPERSEDE = 5; // Don't supersede more than 5 entries at once

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

export type SupersededResult = {
  supersededCount: number;
  supersededIds: string[];
};

/**
 * After a correction is stored, find and mark old brain entries as superseded.
 *
 * Uses the correction's embedding to find similar entries, then marks them
 * with superseded_by pointing to the new correction brain entry.
 *
 * @param correctionEmbedding - The embedding of the correction text
 * @param correctionBrainEntryId - The ID of the correction's brain entry (source_ref)
 * @param correctionId - The ID from abra_corrections table
 * @param originalClaim - The original wrong claim text (for logging)
 */
export async function supersedeStaleEntries(params: {
  correctionEmbedding: number[];
  correctionBrainEntrySourceRef: string;
  correctionId: string;
  originalClaim: string;
}): Promise<SupersededResult> {
  try {
    // 1. Find similar brain entries using search_temporal
    const results = (await sbFetch("/rest/v1/rpc/search_temporal", {
      method: "POST",
      body: JSON.stringify({
        query_embedding: params.correctionEmbedding,
        match_count: 15, // Cast a wide net, filter below
        filter_tables: ["brain"],
      }),
    })) as Array<{
      id: string;
      source_table: string;
      title: string | null;
      similarity: number;
      category: string | null;
      metadata: Record<string, unknown> | null;
    }>;

    // 2. Filter: high similarity, not already a correction, not already superseded
    const candidates = results.filter((r) => {
      if (r.similarity < SIMILARITY_THRESHOLD) return false;
      // Don't supersede other corrections
      if (r.category === "correction") return false;
      // Don't supersede the correction entry itself
      const sourceRef =
        r.metadata && typeof r.metadata.source_ref === "string"
          ? r.metadata.source_ref
          : "";
      if (sourceRef === params.correctionBrainEntrySourceRef) return false;
      return true;
    });

    if (candidates.length === 0) {
      return { supersededCount: 0, supersededIds: [] };
    }

    // 3. Mark top N as superseded
    const toSupersede = candidates.slice(0, MAX_SUPERSEDE);
    const ids = toSupersede.map((c) => c.id);

    // Batch update using PATCH with filter
    for (const id of ids) {
      await sbFetch(
        `/rest/v1/open_brain_entries?id=eq.${id}&superseded_by=is.null`,
        {
          method: "PATCH",
          headers: {
            Prefer: "return=minimal",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            superseded_by: params.correctionId,
            superseded_at: new Date().toISOString(),
          }),
        },
      );
    }

    console.log(
      `[fact-lifecycle] Superseded ${ids.length} entries for correction: "${params.originalClaim.slice(0, 60)}"`,
    );

    return { supersededCount: ids.length, supersededIds: ids };
  } catch (error) {
    // Best-effort — log but don't block the correction
    console.error(
      "[fact-lifecycle] Failed to supersede entries:",
      error instanceof Error ? error.message : error,
    );
    return { supersededCount: 0, supersededIds: [] };
  }
}

/**
 * Get all entries superseded by a specific correction.
 * Useful for auditing and displaying correction impact.
 */
export async function getSupersededEntries(
  correctionId: string,
): Promise<Array<{ id: string; title: string | null; superseded_at: string }>> {
  try {
    return (await sbFetch(
      `/rest/v1/open_brain_entries?superseded_by=eq.${correctionId}&select=id,title,superseded_at`,
    )) as Array<{ id: string; title: string | null; superseded_at: string }>;
  } catch {
    return [];
  }
}

/**
 * Restore a superseded entry (undo supersession).
 */
export async function restoreEntry(entryId: string): Promise<boolean> {
  try {
    await sbFetch(
      `/rest/v1/open_brain_entries?id=eq.${entryId}`,
      {
        method: "PATCH",
        headers: {
          Prefer: "return=minimal",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          superseded_by: null,
          superseded_at: null,
        }),
      },
    );
    return true;
  } catch {
    return false;
  }
}
