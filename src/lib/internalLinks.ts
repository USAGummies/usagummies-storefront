import "server-only";

type KeywordInput = string | string[] | null | undefined;

export type LinkSignals = {
  url: string;
  category: string;
  tags: string[];
  keywords: string[];
  productType?: string;
  date: number;
};

type BaseSignalInput = {
  url: string;
  category?: string | null;
  tags?: KeywordInput;
  keywords?: KeywordInput;
  productType?: string | null;
  date?: string | number | null;
};

const TOKEN_SPLIT = /[^a-z0-9]+/gi;
export const MIN_RELATED_SCORE = 6;

function normalizeText(value?: string | null) {
  return String(value ?? "").trim().toLowerCase();
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeList(value?: KeywordInput): string[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : splitList(String(value));
  const cleaned = raw.map((entry) => normalizeText(entry)).filter(Boolean);
  return Array.from(new Set(cleaned));
}

function toTimestamp(value?: string | number | null): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function buildKeywordTokens(category: string, tags: string[], keywords: string[]) {
  const tokens = new Set<string>();
  const input = [category, ...tags, ...keywords];
  input.forEach((entry) => {
    const normalized = normalizeText(entry);
    if (!normalized) return;
    normalized
      .split(TOKEN_SPLIT)
      .map((token) => token.trim())
      .filter(Boolean)
      .forEach((token) => tokens.add(token));
  });
  return Array.from(tokens);
}

export function buildSignalsFromValues(input: BaseSignalInput): LinkSignals {
  const category = normalizeText(input.category);
  const tags = normalizeList(input.tags);
  const keywords = normalizeList(input.keywords);
  const keywordTokens = buildKeywordTokens(category, tags, keywords);
  const productType = normalizeText(input.productType);
  return {
    url: input.url,
    category,
    tags,
    keywords: keywordTokens,
    productType: productType || undefined,
    date: toTimestamp(input.date),
  };
}

export function buildPostSignals(input: {
  slug: string;
  category?: string | null;
  tags?: string[] | null;
  keywords?: KeywordInput;
  date?: string | null;
  updated?: string | null;
}): LinkSignals {
  return buildSignalsFromValues({
    url: `/blog/${input.slug}`,
    category: input.category,
    tags: input.tags,
    keywords: input.keywords,
    date: input.updated || input.date,
  });
}

export function buildGuideSignals(input: {
  slug: string;
  topic?: string | null;
  tags?: string[] | null;
  keywords?: KeywordInput;
  date?: string | null;
  updated?: string | null;
}): LinkSignals {
  return buildSignalsFromValues({
    url: `/guides/${input.slug}`,
    category: input.topic,
    tags: input.tags,
    keywords: input.keywords,
    date: input.updated || input.date,
  });
}

export function buildProductSignals(input: {
  handle: string;
  productType?: string | null;
  tags?: string[] | null;
  collections?: Array<{ title?: string | null }> | null;
  seoKeywords?: KeywordInput;
  seoCategory?: string | null;
  createdAt?: string | null;
}): LinkSignals {
  const collectionTags =
    input.collections?.map((c) => c.title || "").filter(Boolean) ?? [];
  const keywords = normalizeList(input.seoKeywords);
  if (input.seoCategory) keywords.push(input.seoCategory);
  return buildSignalsFromValues({
    url: `/products/${input.handle}`,
    category: input.productType,
    tags: [...(input.tags ?? []), ...collectionTags],
    keywords,
    productType: input.productType,
    date: input.createdAt,
  });
}

function countShared(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let count = 0;
  for (const item of new Set(a)) {
    if (setB.has(item)) count += 1;
  }
  return count;
}

export function scoreRelated(
  source: LinkSignals,
  candidate: LinkSignals,
  options?: { includeProductType?: boolean }
) {
  if (source.url && candidate.url && source.url === candidate.url) return -999;
  let score = 0;
  if (source.category && candidate.category && source.category === candidate.category) {
    score += 5;
  }
  const sharedTags = countShared(source.tags, candidate.tags);
  score += Math.min(sharedTags, 4) * 3;
  const sharedKeywords = countShared(source.keywords, candidate.keywords);
  score += Math.min(sharedKeywords, 6) * 2;
  if (
    options?.includeProductType &&
    source.productType &&
    candidate.productType &&
    source.productType === candidate.productType
  ) {
    score += 1;
  }
  return score;
}

export function rankRelated<T>(
  source: LinkSignals,
  candidates: Array<{ item: T; signals: LinkSignals }>,
  options?: { limit?: number; includeProductType?: boolean; minScore?: number; minCount?: number }
): T[] {
  const minScore = options?.minScore ?? 1;
  const scored = candidates
    .map((entry) => ({
      ...entry,
      score: scoreRelated(source, entry.signals, { includeProductType: options?.includeProductType }),
    }))
    .filter((entry) => entry.score >= minScore);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.signals.date - a.signals.date;
  });

  const limit = options?.limit ?? scored.length;
  const results = scored.slice(0, limit).map((entry) => entry.item);
  const minCount = options?.minCount ?? 0;
  if (minCount && results.length < minCount) return [];
  return results;
}
