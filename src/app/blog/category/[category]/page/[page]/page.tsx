import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BlogArchive } from "@/components/blog/BlogArchive";
import {
  BLOG_PAGE_SIZE,
  getCategories,
  getPostsByCategorySlug,
  paginatePosts,
  resolveSiteUrl,
} from "@/lib/blog";

export const revalidate = 3600;

export function generateStaticParams() {
  const params: Array<{ category: string; page: string }> = [];
  for (const category of getCategories()) {
    const posts = getPostsByCategorySlug(category.slug);
    const totalPages = Math.ceil(posts.length / BLOG_PAGE_SIZE);
    for (let page = 2; page <= totalPages; page += 1) {
      params.push({ category: category.slug, page: String(page) });
    }
  }
  return params;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string; page: string }>;
}): Promise<Metadata> {
  const { category: categorySlug, page } = await params;
  const category = getCategories().find((item) => item.slug === categorySlug);
  const pageNumber = Number(page);
  if (!category || !Number.isFinite(pageNumber) || pageNumber < 2) return {};

  const title = `${category.name} Articles — Page ${pageNumber} | USA Gummies Blog`;
  const description = `Browse USA Gummies posts in the ${category.name} category.`;
  const canonical = `/blog/category/${category.slug}/page/${pageNumber}`;

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

export default async function BlogCategoryPaginatedPage({
  params,
}: {
  params: Promise<{ category: string; page: string }>;
}) {
  const { category: categorySlug, page } = await params;
  const category = getCategories().find((item) => item.slug === categorySlug);
  if (!category) {
    notFound();
  }

  const pageNumber = Number(page);
  if (!Number.isFinite(pageNumber) || pageNumber < 2) {
    redirect(`/blog/category/${category.slug}`);
  }

  const posts = getPostsByCategorySlug(category.slug);
  const { items, totalPages } = paginatePosts(posts, pageNumber);

  if (pageNumber > totalPages) {
    notFound();
  }

  const siteUrl = resolveSiteUrl();
  const pageUrl = `${siteUrl}/blog/category/${category.slug}/page/${pageNumber}`;
  const offset = (pageNumber - 1) * BLOG_PAGE_SIZE;

  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${category.name} Articles — Page ${pageNumber} | USA Gummies Blog`,
    description: `Browse USA Gummies posts in the ${category.name} category.`,
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
        title={`${category.name} Articles`}
        description={`Browse USA Gummies posts in the ${category.name} category.`}
        posts={items}
        currentPage={pageNumber}
        totalPages={totalPages}
        basePath={`/blog/category/${category.slug}`}
        heroBadge="Category"
        breadcrumbs={[
          { name: "Home", href: "/" },
          { name: "Blog", href: "/blog" },
          { name: category.name, href: `/blog/category/${category.slug}` },
          { name: `Page ${pageNumber}`, href: `/blog/category/${category.slug}/page/${pageNumber}` },
        ]}
      />
    </>
  );
}
