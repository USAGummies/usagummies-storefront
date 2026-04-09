import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import readingTime from "reading-time";

export type LearnFrontmatter = {
  title?: string;
  description?: string;
  date?: string;
  category?: string;
  tags?: string[] | string;
  author?: string;
  seoTitle?: string;
  seoDescription?: string;
  slug?: string;
};

export type LearnPost = {
  slug: string;
  title: string;
  description: string;
  date: string;
  category: string;
  tags: string[];
  author: string;
  seoTitle?: string;
  seoDescription?: string;
  readingTime: string;
  content: string;
};

const CONTENT_DIR = path.join(process.cwd(), "content", "learn");

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

function normalizeTags(value: unknown): string[] {
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

function getPostFiles(): string[] {
  try {
    if (!fs.existsSync(CONTENT_DIR)) return [];
    return fs.readdirSync(CONTENT_DIR).filter((file) => file.endsWith(".mdx"));
  } catch {
    return [];
  }
}

function parsePost(fileName: string): LearnPost {
  const slug = fileName.replace(/\.mdx$/, "");
  const filePath = path.join(CONTENT_DIR, fileName);
  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);

  const fm = data as LearnFrontmatter;

  return {
    slug: toString(fm.slug) || slug,
    title: toString(fm.title) || slug.replace(/-/g, " "),
    description:
      toString(fm.description) ||
      "Learn about dye-free gummy candy and USA Gummies.",
    date: normalizeDate(fm.date),
    category: toString(fm.category) || "General",
    tags: normalizeTags(fm.tags),
    author: toString(fm.author) || "USA Gummies",
    seoTitle: toString(fm.seoTitle) || undefined,
    seoDescription: toString(fm.seoDescription) || undefined,
    readingTime: readingTime(content).text,
    content,
  };
}

export function getLearnPosts(): LearnPost[] {
  try {
    const posts = getPostFiles().map(parsePost);
    return posts.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  } catch {
    return [];
  }
}

export function getLearnPostBySlug(slug: string): LearnPost | null {
  try {
    const fileName = `${slug}.mdx`;
    const filePath = path.join(CONTENT_DIR, fileName);
    if (!fs.existsSync(filePath)) return null;
    return parsePost(fileName);
  } catch {
    return null;
  }
}

export function formatLearnDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
