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
  if (results.all.length === 0) return "No relevant records found in the brain.";

  const sections: string[] = [];

  if (results.hot.length > 0) {
    sections.push("=== AUTHORITATIVE (corrections & KPIs — always trust) ===");
    for (const row of results.hot) {
      sections.push(formatRow(row));
    }
  }

  if (results.warm.length > 0) {
    sections.push("\n=== RECENT (teachings & sessions — high confidence) ===");
    for (const row of results.warm) {
      sections.push(formatRow(row));
    }
  }

  if (results.cold.length > 0) {
    sections.push("\n=== GENERAL (older data — verify recency before citing) ===");
    for (const row of results.cold) {
      sections.push(formatRow(row));
    }
  }

  return sections.join("\n");
}

function formatRow(row: TieredSearchRow): string {
  const MAX_CONTEXT_CHARS = 2500;
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

  const header = [
    `[${tier}]`,
    `[${source}] ${title}`,
    `${daysAgo}d ago`,
    `sim: ${sim}`,
    `score: ${tScore}`,
  ]
    .filter(Boolean)
    .join(" | ");

  return `${header}\n${text || "(empty)"}`;
}
