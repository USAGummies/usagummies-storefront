import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlogArchive } from "@/components/blog/BlogArchive";
import {
  getCategories,
  getPostsByCategorySlug,
  paginatePosts,
  resolveSiteUrl,
} from "@/lib/blog";

export const revalidate = 3600;

export function generateStaticParams() {
  return getCategories().map((category) => ({ category: category.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category: categorySlug } = await params;
  const category = getCategories().find((item) => item.slug === categorySlug);
  if (!category) return {};

  const title = `${category.name} Articles | USA Gummies Blog`;
  const description = `Browse USA Gummies posts in the ${category.name} category.`;
  const canonical = `/blog/category/${category.slug}`;

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

export default async function BlogCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category: categorySlug } = await params;
  const category = getCategories().find((item) => item.slug === categorySlug);
  if (!category) {
    notFound();
  }

  const posts = getPostsByCategorySlug(category.slug);
  if (!posts.length) {
    notFound();
  }

  const { items, totalPages } = paginatePosts(posts, 1);
  const siteUrl = resolveSiteUrl();
  const pageUrl = `${siteUrl}/blog/category/${category.slug}`;

  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${category.name} Articles | USA Gummies Blog`,
    description: `Browse USA Gummies posts in the ${category.name} category.`,
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
        title={`${category.name} Articles`}
        description={`Browse USA Gummies posts in the ${category.name} category.`}
        posts={items}
        currentPage={1}
        totalPages={totalPages}
        basePath={`/blog/category/${category.slug}`}
        heroBadge="Category"
        breadcrumbs={[
          { name: "Home", href: "/" },
          { name: "Blog", href: "/blog" },
          { name: category.name, href: `/blog/category/${category.slug}` },
        ]}
      />
    </>
  );
}
