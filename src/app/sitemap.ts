// src/app/sitemap.ts (FULL REPLACE)
import type { MetadataRoute } from "next";
import { getShopifySitemapResources } from "@/lib/shopify/sitemap";
import { getAllCompetitorSlugs } from "@/data/competitors";

// Revalidate periodically so the sitemap stays fresh.
export const revalidate = 3600; // 1 hour

function siteUrl() {
  const preferred = "https://www.usagummies.com";
  const raw = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "";
  if (raw && raw.includes("usagummies.com")) return raw.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") return preferred;
  if (raw) return raw.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  return preferred;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const now = new Date();
  const toDate = (value?: string | null) => {
    if (!value) return now;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? now : parsed;
  };

  // Core routes (always include)
  const routes: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/shop`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/join-the-revolution`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/faq`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/ingredients`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/no-artificial-dyes-gummy-bears`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/made-in-usa`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/made-in-usa-candy`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/help`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/bundle-guides`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/gummy-gift-bundles`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/patriotic-party-snacks`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/patriotic-candy`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/bulk-gummy-bears`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/dye-free-candy`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/gummies-101`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/wholesale`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },

    // Policies hub + subpages
    { url: `${base}/policies`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/policies/shipping`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/policies/returns`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/policies/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/policies/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },

    // Campaign pages
    { url: `${base}/america-250`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${base}/america-250/events`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/america-250/gifts`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/america-250/celebrations`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },

    // Competitor comparison pages
    { url: `${base}/vs`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    ...getAllCompetitorSlugs().map((slug) => ({
      url: `${base}/vs/${slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];

  const seenUrls = new Set<string>(routes.map((route) => route.url));
  const pushRoute = (route: MetadataRoute.Sitemap[number]) => {
    if (!route?.url || seenUrls.has(route.url)) return;
    seenUrls.add(route.url);
    routes.push(route);
  };

  let mdxPosts: Array<{ slug: string; date: string; updated?: string }> = [];
  try {
    const { getAllPosts } = await import("@/lib/blog");
    mdxPosts = getAllPosts();
  } catch {
    mdxPosts = [];
  }

  let pillarGuides: Array<{ slug: string; date: string; updated?: string }> = [];
  try {
    const { getPillarGuides } = await import("@/lib/guides");
    pillarGuides = getPillarGuides();
  } catch {
    pillarGuides = [];
  }

  const guidesLastModified =
    pillarGuides.length > 0
      ? pillarGuides
          .map((guide) => toDate(guide.updated || guide.date).getTime())
          .reduce((latest, ts) => Math.max(latest, ts), now.getTime())
      : now.getTime();
  pushRoute({
    url: `${base}/guides`,
    lastModified: new Date(guidesLastModified),
    changeFrequency: "weekly",
    priority: 0.7,
  });

  const { products, collections, pages, articles } = await getShopifySitemapResources();
  const articleBySlug = new Map(articles.map((article) => [article.handle, article]));

  for (const product of products) {
    if (!product?.handle) continue;
    pushRoute({
      url: `${base}/products/${product.handle}`,
      lastModified: toDate(product.updatedAt),
      changeFrequency: "weekly",
      priority: 0.8,
    });
  }

  for (const collection of collections) {
    if (!collection?.handle) continue;
    pushRoute({
      url: `${base}/collections/${collection.handle}`,
      lastModified: toDate(collection.updatedAt),
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }

  for (const page of pages) {
    if (!page?.handle) continue;
    pushRoute({
      url: `${base}/pages/${page.handle}`,
      lastModified: toDate(page.updatedAt),
      changeFrequency: "monthly",
      priority: 0.5,
    });
  }

  for (const post of mdxPosts) {
    if (!post?.slug) continue;
    const article = articleBySlug.get(post.slug);
    pushRoute({
      url: `${base}/blog/${post.slug}`,
      lastModified: article?.updatedAt
        ? toDate(article.updatedAt)
        : post.updated
          ? new Date(post.updated)
          : new Date(post.date),
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }

  for (const guide of pillarGuides) {
    if (!guide?.slug) continue;
    pushRoute({
      url: `${base}/guides/${guide.slug}`,
      lastModified: guide.updated ? toDate(guide.updated) : toDate(guide.date),
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }

  return routes;
}
