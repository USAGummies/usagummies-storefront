import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import readingTime from "reading-time";
import { blogAuthors, blogAuthorList, type BlogAuthor } from "@/content/blog/authors";

export const BLOG_PAGE_SIZE = 9;

export type BlogFrontmatter = {
  title?: string;
  description?: string;
  date?: string;
  updated?: string;
  category?: string;
  tags?: string[] | string;
  keywords?: string[] | string;
  author?: string;
  coverImage?: string;
  seoTitle?: string;
  seoDescription?: string;
  canonicalUrl?: string;
  draft?: boolean;
};

export type BlogListing = {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  category: string;
  categorySlug: string;
  tags: string[];
  tagSlugs: string[];
  keywords: string[];
  authorId: string;
  authorName: string;
  authorSlug: string;
  coverImage?: string;
  readingTime: string;
  canonicalUrl?: string;
  seoTitle?: string;
  seoDescription?: string;
  draft: boolean;
};

export type BlogPost = BlogListing & {
  content: string;
};

const CONTENT_DIR = path.join(process.cwd(), "content", "blog");

const DEFAULT_AUTHOR = "usa-gummies";
const DEFAULT_CATEGORY = "General";

function toString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
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

function resolveAuthor(authorId?: string): BlogAuthor {
  const id = toString(authorId) || DEFAULT_AUTHOR;
  return blogAuthors[id] || blogAuthors[DEFAULT_AUTHOR] || blogAuthorList[0];
}

function getPostFiles(): string[] {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  return fs.readdirSync(CONTENT_DIR).filter((file) => file.endsWith(".mdx"));
}

function parsePost(fileName: string): BlogPost {
  const slug = fileName.replace(/\.mdx$/, "");
  const filePath = path.join(CONTENT_DIR, fileName);
  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);

  const frontmatter = data as BlogFrontmatter;
  const title = toString(frontmatter.title) || slug.replace(/-/g, " ");
  const description =
    toString(frontmatter.description) ||
    "Patriotic gummy stories, gifting ideas, and USA Gummies updates.";
  const date = normalizeDate(frontmatter.date);
  const updated = normalizeOptionalDate(frontmatter.updated);
  const category = toString(frontmatter.category) || DEFAULT_CATEGORY;
  const categorySlug = slugify(category || DEFAULT_CATEGORY) || "general";
  const tags = normalizeTags(frontmatter.tags);
  const tagSlugs = tags.map((tag) => slugify(tag));
  const keywords = normalizeTags(frontmatter.keywords);
  const author = resolveAuthor(frontmatter.author);
  const draft = Boolean(frontmatter.draft);

  return {
    slug,
    title,
    description,
    date,
    updated,
    category,
    categorySlug,
    tags,
    tagSlugs,
    keywords,
    authorId: author.id,
    authorName: author.name,
    authorSlug: author.slug,
    coverImage: toString(frontmatter.coverImage) || undefined,
    readingTime: readingTime(content).text,
    canonicalUrl: toString(frontmatter.canonicalUrl) || undefined,
    seoTitle: toString(frontmatter.seoTitle) || undefined,
    seoDescription: toString(frontmatter.seoDescription) || undefined,
    draft,
    content,
  };
}

function sortPosts(posts: BlogPost[]): BlogPost[] {
  return posts.sort((a, b) => {
    const dateA = new Date(a.updated || a.date).getTime();
    const dateB = new Date(b.updated || b.date).getTime();
    return dateB - dateA;
  });
}

export function getAllPosts(options: { includeDrafts?: boolean } = {}): BlogListing[] {
  const posts = getPostFiles().map(parsePost);
  const filtered = options.includeDrafts ? posts : posts.filter((post) => !post.draft);
  return sortPosts(filtered).map((post) => ({
    slug: post.slug,
    title: post.title,
    description: post.description,
    date: post.date,
    updated: post.updated,
    category: post.category,
    categorySlug: post.categorySlug,
    tags: post.tags,
    tagSlugs: post.tagSlugs,
    keywords: post.keywords,
    authorId: post.authorId,
    authorName: post.authorName,
    authorSlug: post.authorSlug,
    coverImage: post.coverImage,
    readingTime: post.readingTime,
    canonicalUrl: post.canonicalUrl,
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
    draft: post.draft,
  }));
}

export function getPostBySlug(slug: string): BlogPost | null {
  const fileName = `${slug}.mdx`;
  const filePath = path.join(CONTENT_DIR, fileName);
  if (!fs.existsSync(filePath)) return null;
  const post = parsePost(fileName);
  if (post.draft) return null;
  return post;
}

export function getCategories(): { name: string; slug: string; count: number }[] {
  const posts = getAllPosts();
  const map = new Map<string, { name: string; slug: string; count: number }>();
  for (const post of posts) {
    if (!map.has(post.categorySlug)) {
      map.set(post.categorySlug, { name: post.category, slug: post.categorySlug, count: 1 });
    } else {
      const item = map.get(post.categorySlug);
      if (item) item.count += 1;
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function getTags(): { name: string; slug: string; count: number }[] {
  const posts = getAllPosts();
  const map = new Map<string, { name: string; slug: string; count: number }>();
  for (const post of posts) {
    post.tags.forEach((tag, index) => {
      const slug = post.tagSlugs[index];
      if (!slug) return;
      if (!map.has(slug)) {
        map.set(slug, { name: tag, slug, count: 1 });
      } else {
        const item = map.get(slug);
        if (item) item.count += 1;
      }
    });
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function getAuthors(): { author: BlogAuthor; count: number }[] {
  const posts = getAllPosts();
  const map = new Map<string, { author: BlogAuthor; count: number }>();
  for (const post of posts) {
    const author = resolveAuthor(post.authorId);
    if (!map.has(author.slug)) {
      map.set(author.slug, { author, count: 1 });
    } else {
      const item = map.get(author.slug);
      if (item) item.count += 1;
    }
  }
  return Array.from(map.values()).sort((a, b) => a.author.name.localeCompare(b.author.name));
}

export function getAuthorBySlug(slug: string): BlogAuthor | undefined {
  return blogAuthorList.find((author) => author.slug === slug);
}

export function getPostsByCategorySlug(slug: string): BlogListing[] {
  return getAllPosts().filter((post) => post.categorySlug === slug);
}

export function getPostsByTagSlug(slug: string): BlogListing[] {
  return getAllPosts().filter((post) => post.tagSlugs.includes(slug));
}

export function getPostsByAuthorSlug(slug: string): BlogListing[] {
  return getAllPosts().filter((post) => post.authorSlug === slug);
}

export function paginatePosts(posts: BlogListing[], page: number): {
  items: BlogListing[];
  totalPages: number;
} {
  const totalPages = Math.max(1, Math.ceil(posts.length / BLOG_PAGE_SIZE));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = (currentPage - 1) * BLOG_PAGE_SIZE;
  const end = start + BLOG_PAGE_SIZE;
  return {
    items: posts.slice(start, end),
    totalPages,
  };
}

export function resolveSiteUrl(): string {
  const preferred = "https://www.usagummies.com";
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "";
  if (fromEnv && fromEnv.includes("usagummies.com")) return fromEnv.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") return preferred;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  return preferred;
}

export function formatBlogDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
