import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BlogArchive } from "@/components/blog/BlogArchive";
import {
  BLOG_PAGE_SIZE,
  getTags,
  getPostsByTagSlug,
  paginatePosts,
  resolveSiteUrl,
} from "@/lib/blog";

export const revalidate = 3600;

const PILLAR_TAG_SLUGS = new Set([
  "dye-free",
  "no-artificial-dyes",
  "red-40",
  "ingredients",
  "kids",
  "clean-label",
]);

export function generateStaticParams() {
  const params: Array<{ tag: string; page: string }> = [];
  for (const tag of getTags()) {
    const posts = getPostsByTagSlug(tag.slug);
    const totalPages = Math.ceil(posts.length / BLOG_PAGE_SIZE);
    for (let page = 2; page <= totalPages; page += 1) {
      params.push({ tag: tag.slug, page: String(page) });
    }
  }
  return params;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tag: string; page: string }>;
}): Promise<Metadata> {
  const { tag: tagSlug, page } = await params;
  const tag = getTags().find((item) => item.slug === tagSlug);
  const pageNumber = Number(page);
  if (!tag || !Number.isFinite(pageNumber) || pageNumber < 2) return {};

  const title = `${tag.name} Posts — Page ${pageNumber} | USA Gummies Blog`;
  const description = `Browse USA Gummies posts tagged with ${tag.name}.`;
  const canonical = `/blog/tag/${tag.slug}/page/${pageNumber}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      images: [{ url: "/opengraph-image" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/opengraph-image"],
    },
  };
}

export default async function BlogTagPaginatedPage({
  params,
}: {
  params: Promise<{ tag: string; page: string }>;
}) {
  const { tag: tagSlug, page } = await params;
  const tag = getTags().find((item) => item.slug === tagSlug);
  if (!tag) {
    notFound();
  }

  const pageNumber = Number(page);
  if (!Number.isFinite(pageNumber) || pageNumber < 2) {
    redirect(`/blog/tag/${tag.slug}`);
  }

  const posts = getPostsByTagSlug(tag.slug);
  const { items, totalPages } = paginatePosts(posts, pageNumber);

  if (pageNumber > totalPages) {
    notFound();
  }

  const shouldShowGuide = PILLAR_TAG_SLUGS.has(tag.slug);
  const siteUrl = resolveSiteUrl();
  const pageUrl = `${siteUrl}/blog/tag/${tag.slug}/page/${pageNumber}`;
  const offset = (pageNumber - 1) * BLOG_PAGE_SIZE;

  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${tag.name} Posts — Page ${pageNumber} | USA Gummies Blog`,
    description: `Browse USA Gummies posts tagged with ${tag.name}.`,
    url: pageUrl,
    publisher: { "@id": `${siteUrl}#organization` },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: items.map((post, index) => ({
        "@type": "ListItem",
        position: offset + index + 1,
        url: `${siteUrl}/blog/${post.slug}`,
        name: post.title,
      })),
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }}
      />
      <BlogArchive
        title={`${tag.name} Posts`}
        description={`Browse USA Gummies posts tagged with ${tag.name}.`}
        posts={items}
        currentPage={pageNumber}
        totalPages={totalPages}
        basePath={`/blog/tag/${tag.slug}`}
        heroBadge="Tag"
        breadcrumbs={[
          { name: "Home", href: "/" },
          { name: "Blog", href: "/blog" },
          { name: tag.name, href: `/blog/tag/${tag.slug}` },
          { name: `Page ${pageNumber}`, href: `/blog/tag/${tag.slug}/page/${pageNumber}` },
        ]}
        featuredGuide={
          shouldShowGuide
            ? {
                eyebrow: "Featured guide",
                title: "Red 40 Free Gummies",
                description:
                  "A deep dive into no artificial dyes gummy bears, label rules, and dye-free shopping tips.",
                href: "/no-artificial-dyes-gummy-bears",
                ctaLabel: "Red 40 Free Gummies",
              }
            : undefined
        }
      />
    </>
  );
}
