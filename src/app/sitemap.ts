// src/app/sitemap.ts (FULL REPLACE)
import type { MetadataRoute } from "next";

// Revalidate periodically so the sitemap stays fresh.
export const revalidate = 3600; // 1 hour

function siteUrl() {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    "https://www.usagummies.com";
  return raw.replace(/\/$/, "");
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const now = new Date();

  // Core routes (always include)
  const routes: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/shop`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/join-the-revolution`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/faq`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/ingredients`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/made-in-usa`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },

    // Policies hub + subpages
    { url: `${base}/policies`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/policies/shipping`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/policies/returns`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/policies/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/policies/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },

    // Campaign / collection pages
    { url: `${base}/america-250`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
  ];

  // Optional: add product URLs if Shopify is reachable.
  // IMPORTANT: This must never fail the sitemap.
  try {
    const { getProductsPage } = await import("@/lib/shopify/products");

    // Pull a reasonable batch; pagination can be added later if needed.
    const conn = await getProductsPage({ pageSize: 100, sort: "featured" });
    const products = conn?.nodes || [];

    for (const p of products) {
      if (!p?.handle) continue;
      routes.push({
        url: `${base}/products/${p.handle}`,
        lastModified: now,
        changeFrequency: "weekly",
        priority: 0.8,
      });
    }
  } catch {
    // If env vars aren't set on Vercel yet, or Shopify isn't reachable,
    // we still return the core sitemap routes.
  }

  return routes;
}
