/**
 * Abra Entity Graph — Structured knowledge layer
 *
 * Extracts and stores entities (vendors, people, products, accounts) and
 * their relationships from brain entries. Provides direct lookups instead
 * of relying solely on semantic search for factual queries.
 *
 * Uses Supabase tables: entity_nodes, entity_edges
 * Falls back gracefully if tables don't exist (feature flag behavior).
 */

type EntityType = "vendor" | "person" | "product" | "account" | "channel" | "metric" | "company";

type EntityNode = {
  id?: string;
  entity_type: EntityType;
  name: string;
  canonical_name: string; // lowercase, trimmed
  properties: Record<string, unknown>;
  source_entry_id?: string;
  updated_at?: string;
};

type EntityEdge = {
  source_name: string;
  relation: string;
  target_name: string;
  properties?: Record<string, unknown>;
};

// Known entity patterns for USA Gummies
const KNOWN_ENTITIES: Array<{ pattern: RegExp; type: EntityType; name: string }> = [
  { pattern: /powers?\s*confections?/i, type: "vendor", name: "Powers Confections" },
  { pattern: /albanese/i, type: "vendor", name: "Albanese Confectionery" },
  { pattern: /belmark/i, type: "vendor", name: "Belmark" },
  { pattern: /pirate\s*ship/i, type: "vendor", name: "Pirate Ship" },
  { pattern: /ninja\s*print\s*house/i, type: "vendor", name: "NinjaPrintHouse" },
  { pattern: /dutch\s*valley/i, type: "vendor", name: "Dutch Valley Foods" },
  { pattern: /inderbitzin/i, type: "company", name: "Inderbitzin Distributors" },
  { pattern: /greg\s*kroetch/i, type: "person", name: "Greg Kroetch" },
  { pattern: /patrick\s*mcdonald/i, type: "person", name: "Patrick McDonald" },
  { pattern: /rene\s*gonzalez/i, type: "person", name: "Rene Gonzalez" },
  { pattern: /andrew\s*slater/i, type: "person", name: "Andrew Slater" },
  { pattern: /ben\s*stutman/i, type: "person", name: "Ben Stutman" },
  { pattern: /bank\s*of\s*america/i, type: "account", name: "Bank of America" },
  { pattern: /found\s*banking/i, type: "account", name: "Found Banking" },
  { pattern: /shopify/i, type: "channel", name: "Shopify" },
  { pattern: /amazon/i, type: "channel", name: "Amazon" },
];

// Relationship extraction patterns
const RELATION_PATTERNS: Array<{ pattern: RegExp; relation: string; extract: (m: RegExpMatchArray) => { value: string } | null }> = [
  {
    pattern: /(?:rate|price|cost)\s*(?:is|of|at|=|:)\s*\$?([\d.]+)/i,
    relation: "has_rate",
    extract: (m) => ({ value: m[1] }),
  },
  {
    pattern: /(?:located|based)\s*(?:in|at)\s+([A-Z][a-z]+(?:\s*,?\s*[A-Z]{2})?)/,
    relation: "located_in",
    extract: (m) => ({ value: m[1] }),
  },
  {
    pattern: /(?:co-?pack|packing|assembl|manufactur)/i,
    relation: "provides_service",
    extract: () => ({ value: "co-packing" }),
  },
  {
    pattern: /(?:contact|email|reach)\s*(?:is|at|:)\s*(\S+@\S+)/i,
    relation: "has_contact",
    extract: (m) => ({ value: m[1] }),
  },
];

/**
 * Extract entities and relationships from text.
 * Returns structured data for graph storage.
 */
export function extractEntities(text: string): {
  entities: EntityNode[];
  edges: EntityEdge[];
} {
  const entities: EntityNode[] = [];
  const edges: EntityEdge[] = [];
  const seen = new Set<string>();

  for (const known of KNOWN_ENTITIES) {
    if (known.pattern.test(text) && !seen.has(known.name)) {
      seen.add(known.name);
      const props: Record<string, unknown> = {};

      // Extract properties for this entity
      for (const rp of RELATION_PATTERNS) {
        const match = text.match(rp.pattern);
        if (match) {
          const extracted = rp.extract(match);
          if (extracted) {
            props[rp.relation] = extracted.value;
            edges.push({
              source_name: known.name,
              relation: rp.relation,
              target_name: extracted.value,
              properties: { extracted_from: "text_pattern" },
            });
          }
        }
      }

      entities.push({
        entity_type: known.type,
        name: known.name,
        canonical_name: known.name.toLowerCase().trim(),
        properties: props,
      });
    }
  }

  return { entities, edges };
}

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

/**
 * Upsert entities into the graph (best-effort, never throws).
 * Uses open_brain_entries tags field as lightweight entity storage
 * until dedicated entity tables are created.
 */
export async function indexEntities(
  entryId: string,
  text: string,
): Promise<{ indexed: number }> {
  const { entities } = extractEntities(text);
  if (entities.length === 0) return { indexed: 0 };

  const env = getSupabaseEnv();
  if (!env) return { indexed: 0 };

  try {
    // Store entity names as tags on the brain entry for structured lookup
    const entityTags = entities.map((e) => `entity:${e.entity_type}:${e.canonical_name}`);

    await fetch(`${env.baseUrl}/rest/v1/open_brain_entries?id=eq.${encodeURIComponent(entryId)}`, {
      method: "PATCH",
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ tags: entityTags }),
      signal: AbortSignal.timeout(5000),
    });

    return { indexed: entities.length };
  } catch {
    return { indexed: 0 };
  }
}

/**
 * Look up brain entries by entity name.
 * Faster than semantic search for known entity queries.
 */
export async function lookupEntity(
  entityName: string,
): Promise<Array<{ id: string; title: string; summary_text: string; created_at: string }>> {
  const env = getSupabaseEnv();
  if (!env) return [];

  const canonical = entityName.toLowerCase().trim();
  // Find the entity type from known entities
  const known = KNOWN_ENTITIES.find((e) => e.name.toLowerCase() === canonical);
  const tag = known
    ? `entity:${known.type}:${known.name.toLowerCase()}`
    : `entity:%:${canonical}`;

  try {
    const res = await fetch(
      `${env.baseUrl}/rest/v1/open_brain_entries?tags=cs.{${encodeURIComponent(tag)}}&select=id,title,summary_text,created_at&order=created_at.desc&limit=10`,
      {
        headers: {
          apikey: env.serviceKey,
          Authorization: `Bearer ${env.serviceKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return [];
    return (await res.json()) as Array<{ id: string; title: string; summary_text: string; created_at: string }>;
  } catch {
    return [];
  }
}
