import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlogArchive } from "@/components/blog/BlogArchive";
import {
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
  return getTags().map((tag) => ({ tag: tag.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tag: string }>;
}): Promise<Metadata> {
  const { tag: tagSlug } = await params;
  const tag = getTags().find((item) => item.slug === tagSlug);
  if (!tag) return {};

  const siteUrl = resolveSiteUrl();
  const title = `${tag.name} Posts | USA Gummies Blog`;
  const description = `Browse USA Gummies posts tagged with ${tag.name}.`;
  const canonical = `${siteUrl}/blog/tag/${tag.slug}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      images: [{ url: `${siteUrl}/opengraph-image` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${siteUrl}/opengraph-image`],
    },
  };
}

export default async function BlogTagPage({
  params,
}: {
  params: Promise<{ tag: string }>;
}) {
  const { tag: tagSlug } = await params;
  const tag = getTags().find((item) => item.slug === tagSlug);
  if (!tag) {
    notFound();
  }

  const posts = getPostsByTagSlug(tag.slug);
  if (!posts.length) {
    notFound();
  }

  const shouldShowGuide = PILLAR_TAG_SLUGS.has(tag.slug);
  const { items, totalPages } = paginatePosts(posts, 1);
  const siteUrl = resolveSiteUrl();
  const pageUrl = `${siteUrl}/blog/tag/${tag.slug}`;

  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${tag.name} Posts | USA Gummies Blog`,
    description: `Browse USA Gummies posts tagged with ${tag.name}.`,
    url: pageUrl,
    publisher: { "@id": `${siteUrl}#organization` },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: items.map((post, index) => ({
        "@type": "ListItem",
        position: index + 1,
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
        currentPage={1}
        totalPages={totalPages}
        basePath={`/blog/tag/${tag.slug}`}
        heroBadge="Tag"
        breadcrumbs={[
          { name: "Home", href: "/" },
          { name: "Blog", href: "/blog" },
          { name: tag.name, href: `/blog/tag/${tag.slug}` },
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
