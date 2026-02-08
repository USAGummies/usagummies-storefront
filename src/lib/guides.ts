import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export type GuideFrontmatter = {
  title?: string;
  description?: string;
  date?: string;
  updated?: string;
  topic?: string;
  tags?: string[] | string;
  keywords?: string[] | string;
  pillar?: boolean;
  coverImage?: string;
  seoTitle?: string;
  seoDescription?: string;
  canonicalUrl?: string;
};

export type GuideListing = {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  topic: string;
  tags: string[];
  keywords: string[];
  pillar: boolean;
  coverImage?: string;
  seoTitle?: string;
  seoDescription?: string;
  canonicalUrl?: string;
};

export type GuidePage = GuideListing & {
  content: string;
};

export type GuideCardEntry = {
  slug?: string;
  href: string;
  canonicalUrl?: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  topic: string;
  tags: string[];
  keywords: string[];
  coverImage?: string;
};

const CONTENT_DIR = path.join(process.cwd(), "content", "guides");
const DEFAULT_TOPIC = "Guide";

function toString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeDate(value: unknown): string {
  const raw = toString(value);
  if (!raw) return new Date().toISOString();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function normalizeOptionalDate(value: unknown): string | undefined {
  const raw = toString(value);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((tag) => toString(tag)).filter(Boolean);
  }
  const raw = toString(value);
  if (!raw) return [];
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function getGuideFiles(): string[] {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  return fs.readdirSync(CONTENT_DIR).filter((file) => file.endsWith(".mdx"));
}

function parseGuide(fileName: string): GuidePage {
  const slug = fileName.replace(/\.mdx$/, "");
  const filePath = path.join(CONTENT_DIR, fileName);
  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);
  const frontmatter = data as GuideFrontmatter;
  const title = toString(frontmatter.title) || slug.replace(/-/g, " ");
  const description =
    toString(frontmatter.description) ||
    "Explore USA Gummies guides, product tips, and candy buying advice.";
  const date = normalizeDate(frontmatter.date);
  const updated = normalizeOptionalDate(frontmatter.updated);
  const topic = toString(frontmatter.topic) || DEFAULT_TOPIC;
  const tags = normalizeList(frontmatter.tags);
  const keywords = normalizeList(frontmatter.keywords);
  const pillar = Boolean(frontmatter.pillar);

  return {
    slug,
    title,
    description,
    date,
    updated,
    topic,
    tags,
    keywords,
    pillar,
    coverImage: toString(frontmatter.coverImage) || undefined,
    seoTitle: toString(frontmatter.seoTitle) || undefined,
    seoDescription: toString(frontmatter.seoDescription) || undefined,
    canonicalUrl: toString(frontmatter.canonicalUrl) || undefined,
    content,
  };
}

function sortGuides(guides: GuidePage[]): GuidePage[] {
  return guides.sort((a, b) => {
    const dateA = new Date(a.updated || a.date).getTime();
    const dateB = new Date(b.updated || b.date).getTime();
    if (dateB !== dateA) return dateB - dateA;
    return a.slug.localeCompare(b.slug);
  });
}

export function getAllGuides(): GuideListing[] {
  const guides = getGuideFiles().map(parseGuide);
  return sortGuides(guides).map((guide) => ({
    slug: guide.slug,
    title: guide.title,
    description: guide.description,
    date: guide.date,
    updated: guide.updated,
    topic: guide.topic,
    tags: guide.tags,
    keywords: guide.keywords,
    pillar: guide.pillar,
    coverImage: guide.coverImage,
    seoTitle: guide.seoTitle,
    seoDescription: guide.seoDescription,
    canonicalUrl: guide.canonicalUrl,
  }));
}

export function getPillarGuides(): GuideListing[] {
  return getAllGuides().filter((guide) => guide.pillar);
}

export function getGuideBySlug(slug: string): GuidePage | null {
  const fileName = `${slug}.mdx`;
  const filePath = path.join(CONTENT_DIR, fileName);
  if (!fs.existsSync(filePath)) return null;
  return parseGuide(fileName);
}

type LegacyGuide = GuideCardEntry & {
  guideSlug?: string;
};

const LEGACY_PILLAR_GUIDES: LegacyGuide[] = [
  {
    guideSlug: "made-in-usa-candy",
    href: "/made-in-usa-candy",
    title: "Made in USA candy",
    description: "Why American-made gummies matter, plus how to choose the right bundle.",
    topic: "Made in USA",
    tags: ["made in usa candy", "american made candy", "usa made gummies"],
    keywords: ["made in usa", "american made", "usa candy"],
    date: "2024-01-01",
  },
  {
    guideSlug: "dye-free-candy",
    href: "/dye-free-candy",
    title: "Dye-free candy",
    description: "Learn how to spot dye-free gummies and avoid artificial colors.",
    topic: "Dye-Free",
    tags: ["dye free candy", "no artificial dyes", "red 40 free"],
    keywords: ["dye-free", "no artificial dyes", "red 40"],
    date: "2024-01-01",
  },
  {
    guideSlug: "no-artificial-dyes-gummy-bears",
    href: "/no-artificial-dyes-gummy-bears",
    title: "No artificial dyes gummy bears",
    description: "Explore the science, labels, and FAQs behind dye-free gummies.",
    topic: "Dye-Free",
    tags: ["no artificial dyes", "dye-free gummies", "red 40 free"],
    keywords: ["dye-free", "red 40", "no artificial dyes"],
    date: "2024-01-01",
  },
  {
    guideSlug: "gummies-101",
    href: "/gummies-101",
    title: "Gummies 101",
    description: "Ingredients, textures, flavors, and dye-free basics.",
    topic: "Guide",
    tags: ["gummies", "ingredients", "dye free"],
    keywords: ["gummies", "ingredients", "dye free"],
    date: "2024-01-01",
  },
  {
    guideSlug: "made-in-usa",
    href: "/made-in-usa",
    title: "Made in USA",
    description: "The USA Gummies story and why domestic production matters.",
    topic: "Made in USA",
    tags: ["made in usa", "american made", "usa gummies"],
    keywords: ["made in usa", "american made"],
    date: "2024-01-01",
  },
  {
    guideSlug: "bundle-guides",
    href: "/bundle-guides",
    title: "Bundle guides",
    description: "Match bag count to gifts, parties, and bulk events.",
    topic: "Bundles",
    tags: ["bundle guides", "bag count", "gummy bundles"],
    keywords: ["bundle guides", "bag count"],
    date: "2024-01-01",
  },
  {
    guideSlug: "gummy-gift-bundles",
    href: "/gummy-gift-bundles",
    title: "Gummy gift bundles",
    description: "Gift-ready bag counts for birthdays, thank yous, and care packages.",
    topic: "Gifting",
    tags: ["gummy gift bundles", "gummy gifts", "bag count"],
    keywords: ["gifts", "gummy bundles"],
    date: "2024-01-01",
  },
  {
    guideSlug: "patriotic-party-snacks",
    href: "/patriotic-party-snacks",
    title: "Patriotic party snacks",
    description: "Bag-count picks for July 4th and USA-themed events.",
    topic: "Patriotic",
    tags: ["patriotic snacks", "party snacks", "july 4th"],
    keywords: ["patriotic", "party snacks"],
    date: "2024-01-01",
  },
  {
    guideSlug: "patriotic-candy",
    href: "/patriotic-candy",
    title: "Patriotic candy gifts",
    description: "American made candy gifts for July 4th, Veterans Day, and America 250.",
    topic: "Patriotic",
    tags: ["patriotic candy", "american made candy", "gifts"],
    keywords: ["patriotic candy", "american made"],
    date: "2024-01-01",
  },
  {
    guideSlug: "bulk-gummy-bears",
    href: "/bulk-gummy-bears",
    title: "Bulk gummy bears",
    description: "Crowd-ready bag counts for teams, clients, and events.",
    topic: "Bulk",
    tags: ["bulk gummy bears", "bulk candy", "events"],
    keywords: ["bulk candy", "bulk gummy bears"],
    date: "2024-01-01",
  },
];

export function getTopGuideCandidates(): GuideCardEntry[] {
  const pillarGuides = getPillarGuides();
  const guideEntries: GuideCardEntry[] = pillarGuides.map((guide) => ({
    slug: guide.slug,
    href: `/guides/${guide.slug}`,
    title: guide.title,
    description: guide.description,
    date: guide.date,
    updated: guide.updated,
    topic: guide.topic,
    tags: guide.tags,
    keywords: guide.keywords,
    coverImage: guide.coverImage,
  }));

  const guideSlugs = new Set(guideEntries.map((entry) => entry.slug).filter(Boolean));
  const legacyEntries = LEGACY_PILLAR_GUIDES.filter((entry) => {
    if (entry.guideSlug && guideSlugs.has(entry.guideSlug)) return false;
    return true;
  });

  const merged = [...guideEntries, ...legacyEntries];
  const seen = new Set<string>();
  return merged.filter((entry) => {
    if (seen.has(entry.href)) return false;
    seen.add(entry.href);
    return true;
  });
}
