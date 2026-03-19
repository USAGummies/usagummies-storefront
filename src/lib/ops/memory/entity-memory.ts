import { generateEmbedding } from "@/lib/ops/abra-embeddings";

export type EntityType = "person" | "company" | "account";

export type Fact = {
  fact: string;
  confidence: number;
  source: string;
  date?: string;
};

export type EntityRecord = {
  entity_id: string;
  name: string;
  type: EntityType;
  source_ref: string;
};

type EntitySnapshot = {
  id: string;
  title: string | null;
  raw_text: string;
  summary_text: string | null;
  source_ref: string;
  tags: string[] | null;
};

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Supabase not configured");
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 300)}`,
    );
  }

  return json;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function entityCategory(type: EntityType): string {
  if (type === "account") return "financial";
  if (type === "company") return "company_info";
  return "founder";
}

function sourceRefFor(name: string, type: EntityType): string {
  return `entity:${type}:${slugify(name)}`;
}

function extractLine(text: string, label: string): string {
  const match = text.match(new RegExp(`^${label}:\\s*(.+)$`, "mi"));
  return match?.[1]?.trim() || "";
}

function extractBullets(text: string, label: string): string[] {
  const marker = `${label}:\n`;
  const start = text.indexOf(marker);
  if (start === -1) return [];
  const body = text.slice(start + marker.length);
  const lines = body.split("\n");
  const bullets: string[] = [];
  for (const line of lines) {
    if (line.startsWith("- ")) {
      bullets.push(line.slice(2).trim());
      continue;
    }
    if (!line.trim()) continue;
    break;
  }
  return bullets.filter(Boolean);
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(value.trim());
  }
  return unique;
}

function renderEntityMemory(params: {
  name: string;
  type: EntityType;
  interactionCount: number;
  lastInteraction?: string;
  facts: string[];
  openItems: string[];
  communicationPreferences?: string;
}): string {
  return [
    `Entity: ${params.name}`,
    `Type: ${params.type}`,
    `Interaction count: ${Math.max(1, params.interactionCount)}`,
    `Last interaction: ${params.lastInteraction || new Date().toISOString()}`,
    params.communicationPreferences
      ? `Communication preferences: ${params.communicationPreferences}`
      : "",
    "",
    "Known facts:",
    ...(params.facts.length > 0 ? params.facts.map((fact) => `- ${fact}`) : ["- None recorded yet"]),
    "",
    "Open items:",
    ...(params.openItems.length > 0 ? params.openItems.map((item) => `- ${item}`) : ["- None"]),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSummaryText(name: string, facts: string[], openItems: string[]): string {
  const pieces = [
    `${name} memory`,
    facts.slice(0, 2).join(" "),
    openItems.length > 0 ? `Open items: ${openItems.slice(0, 2).join("; ")}` : "",
  ]
    .filter(Boolean)
    .join(". ");
  return pieces.slice(0, 500);
}

async function fetchEntityBySourceRef(sourceRef: string): Promise<EntitySnapshot | null> {
  const rows = (await sbFetch(
    `/rest/v1/open_brain_entries?source_ref=eq.${encodeURIComponent(sourceRef)}&select=id,title,raw_text,summary_text,source_ref,tags&limit=1`,
  )) as EntitySnapshot[];
  return rows[0] || null;
}

async function fetchEntityById(entityId: string): Promise<EntitySnapshot | null> {
  const rows = (await sbFetch(
    `/rest/v1/open_brain_entries?id=eq.${encodeURIComponent(entityId)}&select=id,title,raw_text,summary_text,source_ref,tags&limit=1`,
  )) as EntitySnapshot[];
  return rows[0] || null;
}

export async function findOrCreateEntity(
  name: string,
  type: EntityType,
): Promise<EntityRecord> {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Entity name is required");

  const source_ref = sourceRefFor(normalizedName, type);
  const existing = await fetchEntityBySourceRef(source_ref);
  if (existing) {
    return {
      entity_id: existing.id,
      name: normalizedName,
      type,
      source_ref,
    };
  }

  const rawText = renderEntityMemory({
    name: normalizedName,
    type,
    interactionCount: 1,
    facts: [],
    openItems: [],
  });
  const embedding = await generateEmbedding(`${normalizedName}\n${type}\n${rawText}`);
  const created = (await sbFetch("/rest/v1/open_brain_entries", {
    method: "POST",
    headers: {
      Prefer: "return=representation",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_type: "agent",
      source_ref,
      entry_type: "teaching",
      title: `Entity Memory — ${normalizedName}`,
      raw_text: rawText,
      summary_text: `${normalizedName} entity memory`,
      category: entityCategory(type),
      department: "executive",
      confidence: "high",
      priority: "normal",
      processed: true,
      tags: ["entity_memory", type, slugify(normalizedName)].slice(0, 10),
      embedding,
    }),
  })) as Array<{ id: string }>;

  if (!created[0]?.id) throw new Error("Failed to create entity memory");

  return {
    entity_id: created[0].id,
    name: normalizedName,
    type,
    source_ref,
  };
}

export async function updateEntityMemory(
  entityId: string,
  facts: Fact[],
  options?: {
    lastInteraction?: string;
    interactionIncrement?: number;
    openItems?: string[];
    communicationPreferences?: string;
  },
): Promise<void> {
  const existing = await fetchEntityById(entityId);
  if (!existing) return;

  const title = existing.title || "Entity Memory";
  const name = title.replace(/^Entity Memory\s+—\s+/i, "").trim() || "Unknown";
  const rawText = existing.raw_text || "";
  const entityType = (existing.tags || []).find((tag) =>
    tag === "person" || tag === "company" || tag === "account",
  ) as EntityType | undefined;
  const type = entityType || "person";

  const priorFacts = extractBullets(rawText, "Known facts");
  const priorOpenItems = extractBullets(rawText, "Open items");
  const priorCount = Number.parseInt(extractLine(rawText, "Interaction count"), 10);
  const interactionCount =
    (Number.isFinite(priorCount) ? priorCount : 1) +
    Math.max(0, options?.interactionIncrement || 0);
  const mergedFacts = dedupe([
    ...priorFacts,
    ...facts
      .map((fact) => {
        const parts = [fact.fact.trim()];
        if (fact.source) parts.push(`source: ${fact.source}`);
        if (fact.date) parts.push(`date: ${fact.date}`);
        return parts.filter(Boolean).join(" | ");
      })
      .filter(Boolean),
  ]).slice(0, 12);
  const mergedOpenItems = dedupe([
    ...priorOpenItems,
    ...(options?.openItems || []).map((item) => item.trim()).filter(Boolean),
  ]).slice(0, 8);
  const communicationPreferences =
    options?.communicationPreferences ||
    extractLine(rawText, "Communication preferences") ||
    undefined;
  const rendered = renderEntityMemory({
    name,
    type,
    interactionCount: Math.max(1, interactionCount),
    lastInteraction: options?.lastInteraction || new Date().toISOString(),
    facts: mergedFacts,
    openItems: mergedOpenItems,
    communicationPreferences,
  });
  const summaryText = buildSummaryText(name, mergedFacts, mergedOpenItems);
  const embedding = await generateEmbedding(`${title}\n${summaryText}\n${rendered}`);

  await sbFetch(`/rest/v1/open_brain_entries?id=eq.${encodeURIComponent(entityId)}`, {
    method: "PATCH",
    headers: {
      Prefer: "return=minimal",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      raw_text: rendered,
      summary_text: summaryText,
      embedding,
      updated_at: new Date().toISOString(),
      tags: dedupe(["entity_memory", type, ...(existing.tags || [])]).slice(0, 10),
    }),
  });
}
