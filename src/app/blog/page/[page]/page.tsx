import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BlogArchive } from "@/components/blog/BlogArchive";
import { BLOG_PAGE_SIZE, getAllPosts, paginatePosts, resolveSiteUrl } from "@/lib/blog";

const PAGE_TITLE = "USA Gummies Blog";
const PAGE_DESCRIPTION =
  "Patriotic gummy stories, gifting guides, and behind-the-scenes updates from USA Gummies.";

export const revalidate = 3600;

export function generateStaticParams() {
  const posts = getAllPosts();
  const totalPages = Math.ceil(posts.length / BLOG_PAGE_SIZE);
  if (totalPages <= 1) return [];
  return Array.from({ length: totalPages - 1 }, (_, index) => ({
    page: String(index + 2),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ page: string }>;
}): Promise<Metadata> {
  const { page } = await params;
  const pageNumber = Number(page);
  const siteUrl = resolveSiteUrl();
  if (!Number.isFinite(pageNumber) || pageNumber < 2) {
    return {
      title: PAGE_TITLE,
      description: PAGE_DESCRIPTION,
      alternates: { canonical: `${siteUrl}/blog` },
    };
  }

  const title = `${PAGE_TITLE} — Page ${pageNumber}`;
  const canonical = `${siteUrl}/blog/page/${pageNumber}`;

  return {
    title,
    description: PAGE_DESCRIPTION,
    alternates: { canonical },
    openGraph: {
      title,
      description: PAGE_DESCRIPTION,
      url: canonical,
      type: "website",
      images: [{ url: `${siteUrl}/opengraph-image` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: PAGE_DESCRIPTION,
      images: [`${siteUrl}/opengraph-image`],
    },
  };
}

export default async function BlogPaginatedPage({
  params,
}: {
  params: Promise<{ page: string }>;
}) {
  const { page } = await params;
  const pageNumber = Number(page);
  if (!Number.isFinite(pageNumber) || pageNumber < 2) {
    redirect("/blog");
  }

  const posts = getAllPosts();
  const { items, totalPages } = paginatePosts(posts, pageNumber);

  if (pageNumber > totalPages) {
    notFound();
  }

  const siteUrl = resolveSiteUrl();
  const pageUrl = `${siteUrl}/blog/page/${pageNumber}`;
  const offset = (pageNumber - 1) * BLOG_PAGE_SIZE;

  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${PAGE_TITLE} — Page ${pageNumber}`,
    description: PAGE_DESCRIPTION,
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
        title={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
        posts={items}
        currentPage={pageNumber}
        totalPages={totalPages}
        basePath="/blog"
        breadcrumbs={[
          { name: "Home", href: "/" },
          { name: "Blog", href: "/blog" },
          { name: `Page ${pageNumber}`, href: `/blog/page/${pageNumber}` },
        ]}
        featuredGuide={{
          eyebrow: "Featured guide",
          title: "No Artificial Dyes Gummy Bears",
          description:
            "The pillar guide to red 40 free gummies, label rules, and how to shop dye-free candy.",
          href: "/no-artificial-dyes-gummy-bears",
          ctaLabel: "No Artificial Dyes Gummy Bears",
        }}
      />
    </>
  );
}
