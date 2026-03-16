/**
 * Abra Tiered Memory Architecture
 *
 * Three-tier search system:
 * - HOT:  Corrections + KPIs (2x boost) — always-correct authoritative data
 * - WARM: Teachings + recent sessions < 30 days (1.5x boost)
 * - COLD: Everything else with standard temporal decay
 *
 * Uses the `search_temporal_tiered` RPC for efficient single-call retrieval.
 * Falls back to `search_temporal` if tiered RPC doesn't exist yet.
 */

import type { TemporalSearchRow } from "@/lib/ops/abra-system-prompt";
import { resolveTemporalDates, type TemporalRange } from "@/lib/ops/abra-temporal-resolver";

export type TieredSearchRow = TemporalSearchRow & {
  memory_tier: "hot" | "warm" | "cold";
};

export type TieredSearchResult = {
  hot: TieredSearchRow[];
  warm: TieredSearchRow[];
  cold: TieredSearchRow[];
  all: TieredSearchRow[];
  tierCounts: { hot: number; warm: number; cold: number };
};

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbRpc(
  rpcName: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase not configured");

  const res = await fetch(`${env.baseUrl}/rest/v1/rpc/${rpcName}`, {
    method: "POST",
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RPC ${rpcName} failed (${res.status}): ${text.slice(0, 300)}`);
  }

  return res.json();
}

/**
 * Search with tiered memory architecture.
 *
 * Tries `search_temporal_tiered` first. If it doesn't exist (migration
 * not yet deployed), falls back to `search_temporal` and tags results
 * as 'cold' (no tier differentiation).
 */
export async function searchTiered(params: {
  embedding: number[];
  matchCount?: number;
  filterTables?: string[];
}): Promise<TieredSearchResult> {
  const matchCount = params.matchCount || 10;
  const filterTables = params.filterTables || ["brain", "email"];

  try {
    // Try tiered search first — RPC takes per-tier counts
    const hotCount = Math.max(3, Math.ceil(matchCount * 0.35));
    const warmCount = Math.max(3, Math.ceil(matchCount * 0.35));
    const coldCount = Math.max(2, Math.ceil(matchCount * 0.3));

    const rows = (await sbRpc("search_temporal_tiered", {
      query_embedding: params.embedding,
      hot_count: hotCount,
      warm_count: warmCount,
      cold_count: coldCount,
    })) as TieredSearchRow[];

    return categorizeTieredResults(rows);
  } catch (error) {
    // Fallback: tiered RPC may not exist yet
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("42883") || msg.includes("does not exist")) {
      console.log("[memory-tiers] Tiered RPC not available, falling back to search_temporal");
      return searchFallback(params.embedding, matchCount, filterTables);
    }
    throw error;
  }
}

/**
 * Fallback to standard search_temporal and tag everything as 'cold'.
 */
async function searchFallback(
  embedding: number[],
  matchCount: number,
  filterTables: string[],
): Promise<TieredSearchResult> {
  const rows = (await sbRpc("search_temporal", {
    query_embedding: embedding,
    match_count: matchCount,
    filter_tables: filterTables,
  })) as TemporalSearchRow[];

  // Tag all results based on heuristics
  const tagged: TieredSearchRow[] = rows.map((row) => {
    let tier: "hot" | "warm" | "cold" = "cold";
    const category = row.category?.toLowerCase() || "";
    const entryType =
      row.metadata && typeof row.metadata.entry_type === "string"
        ? row.metadata.entry_type.toLowerCase()
        : "";

    if (category === "correction" || entryType === "correction" || entryType === "kpi") {
      tier = "hot";
    } else if (
      entryType === "teaching" ||
      entryType === "session_summary" ||
      (row.days_ago !== undefined && row.days_ago <= 30)
    ) {
      tier = "warm";
    }

    return { ...row, memory_tier: tier };
  });

  return categorizeTieredResults(tagged);
}

/**
 * Split results by tier.
 */
function categorizeTieredResults(rows: TieredSearchRow[]): TieredSearchResult {
  const hot = rows.filter((r) => r.memory_tier === "hot");
  const warm = rows.filter((r) => r.memory_tier === "warm");
  const cold = rows.filter((r) => r.memory_tier === "cold");

  return {
    hot,
    warm,
    cold,
    all: rows,
    tierCounts: { hot: hot.length, warm: warm.length, cold: cold.length },
  };
}

/**
 * Build a tier-aware context string for the LLM.
 *
 * Hot tier results are labeled as authoritative; warm are labeled as recent;
 * cold results include standard temporal warnings.
 */
export function buildTieredContext(results: TieredSearchResult): string {
  if (results.all.length === 0) return "ZERO BRAIN RESULTS: No relevant records found. Follow the ZERO-RESULTS BEHAVIOR instructions in the system prompt. Do NOT fill this gap with speculation.";

  const sections: string[] = [];

  if (results.hot.length > 0) {
    sections.push("=== AUTHORITATIVE (corrections & KPIs — always trust) ===");
    for (const row of results.hot.slice(0, 5)) {
      sections.push(formatRow(row));
    }
  }

  if (results.warm.length > 0) {
    sections.push("\n=== RECENT (teachings & sessions — high confidence) ===");
    for (const row of results.warm.slice(0, 5)) {
      sections.push(formatRow(row));
    }
  }

  if (results.cold.length > 0) {
    sections.push("\n=== GENERAL (older data — verify recency before citing) ===");
    for (const row of results.cold.slice(0, 3)) {
      sections.push(formatRow(row));
    }
  }

  return sections.join("\n");
}

/**
 * Fetch brain entries by date range (direct SQL, no embedding needed).
 * Used to supplement semantic search when temporal references are detected.
 * Returns results tagged as HOT tier since they're date-exact matches.
 */
async function fetchEntriesByDateRange(
  startDate: string,
  endDate: string,
  limit = 10,
): Promise<TieredSearchRow[]> {
  const env = getSupabaseEnv();
  if (!env) return [];

  const startTs = `${startDate}T00:00:00Z`;
  const endTs = `${endDate}T23:59:59Z`;

  const res = await fetch(
    `${env.baseUrl}/rest/v1/open_brain_entries?` +
    `created_at=gte.${encodeURIComponent(startTs)}&` +
    `created_at=lte.${encodeURIComponent(endTs)}&` +
    `superseded_by=is.null&` +
    `select=id,title,raw_text,summary_text,category,entry_type,tags,created_at,updated_at&` +
    `order=created_at.desc&limit=${limit}`,
    {
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    },
  );

  if (!res.ok) return [];
  const rows = await res.json() as Array<{
    id: string;
    title?: string;
    raw_text?: string;
    summary_text?: string;
    category?: string;
    entry_type?: string;
    tags?: string[];
    created_at?: string;
    updated_at?: string;
  }>;

  if (!Array.isArray(rows)) return [];

  return rows.map((row) => ({
    id: row.id,
    source_table: "brain" as const,
    title: row.title || "(untitled)",
    raw_text: row.raw_text || "",
    summary_text: row.summary_text || "",
    category: row.category || null,
    department: null,
    similarity: 1.0,         // perfect match by date
    temporal_score: 1.0,     // date-exact is max temporal relevance
    days_ago: 0,             // treat as maximally recent for display
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || new Date().toISOString(),
    metadata: {
      entry_type: row.entry_type || "finding",
      tags: row.tags || [],
      date_matched: true,    // flag so LLM knows this is a date-exact hit
    },
    memory_tier: "hot" as const,
  }));
}

/**
 * Enhanced search that combines semantic search with date-based retrieval.
 * If the user message contains temporal references ("yesterday", "last Tuesday"),
 * we run a parallel date-range query and merge results into the HOT tier.
 */
export async function searchWithTemporalAwareness(params: {
  message: string;
  embedding: number[];
  matchCount?: number;
  filterTables?: string[];
}): Promise<{ results: TieredSearchResult; temporalRange: TemporalRange | null }> {
  const temporalRange = resolveTemporalDates(params.message);

  // Always run semantic search
  const semanticPromise = searchTiered({
    embedding: params.embedding,
    matchCount: params.matchCount,
    filterTables: params.filterTables,
  });

  // If temporal reference detected, also run date-based query
  const datePromise = temporalRange
    ? fetchEntriesByDateRange(temporalRange.start, temporalRange.end, 8)
    : Promise.resolve([] as TieredSearchRow[]);

  const [semanticResults, dateResults] = await Promise.all([semanticPromise, datePromise]);

  if (dateResults.length === 0) {
    return { results: semanticResults, temporalRange };
  }

  // Merge: deduplicate by ID, date-matched entries go to HOT tier at the top
  const existingIds = new Set(semanticResults.all.map((r) => r.id));
  const newDateResults = dateResults.filter((r) => !existingIds.has(r.id));

  const mergedHot = [...newDateResults, ...semanticResults.hot];
  const mergedAll = [...newDateResults, ...semanticResults.all];

  return {
    results: {
      hot: mergedHot,
      warm: semanticResults.warm,
      cold: semanticResults.cold,
      all: mergedAll,
      tierCounts: {
        hot: mergedHot.length,
        warm: semanticResults.warm.length,
        cold: semanticResults.cold.length,
      },
    },
    temporalRange,
  };
}

function formatRow(row: TieredSearchRow): string {
  const MAX_CONTEXT_CHARS = 1200;
  const title = row.title || "(untitled)";
  const source = row.source_table;
  const sim =
    typeof row.similarity === "number" ? row.similarity.toFixed(3) : "0.000";
  const tScore =
    typeof row.temporal_score === "number"
      ? row.temporal_score.toFixed(3)
      : "0.000";
  const daysAgo = typeof row.days_ago === "number" ? row.days_ago : "?";
  const text = (row.raw_text || row.summary_text || "").slice(
    0,
    MAX_CONTEXT_CHARS,
  );
  const tier = row.memory_tier.toUpperCase();
  const tags =
    row.metadata && Array.isArray(row.metadata.tags) && row.metadata.tags.length > 0
      ? (row.metadata.tags as string[]).join(", ")
      : "";
  const entryType =
    row.metadata && typeof row.metadata.entry_type === "string"
      ? row.metadata.entry_type
      : "";

  const isTeaching = entryType === "teaching" || entryType === "auto_teach";

  const header = [
    `[${tier}]`,
    isTeaching ? "⚠️ INDUSTRY REFERENCE (not company data)" : "",
    `[${source}] ${title}`,
    `${daysAgo}d ago`,
    `sim: ${sim}`,
    `score: ${tScore}`,
    entryType ? `type: ${entryType}` : "",
    tags ? `tags: [${tags}]` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  return `${header}\n${text || "(empty)"}`;
}
