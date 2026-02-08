import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BlogArchive } from "@/components/blog/BlogArchive";
import {
  BLOG_PAGE_SIZE,
  getAuthorBySlug,
  getAuthors,
  getPostsByAuthorSlug,
  paginatePosts,
  resolveSiteUrl,
} from "@/lib/blog";

export const revalidate = 3600;

export function generateStaticParams() {
  const params: Array<{ author: string; page: string }> = [];
  for (const entry of getAuthors()) {
    const posts = getPostsByAuthorSlug(entry.author.slug);
    const totalPages = Math.ceil(posts.length / BLOG_PAGE_SIZE);
    for (let page = 2; page <= totalPages; page += 1) {
      params.push({ author: entry.author.slug, page: String(page) });
    }
  }
  return params;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ author: string; page: string }>;
}): Promise<Metadata> {
  const { author: authorSlug, page } = await params;
  const author = getAuthorBySlug(authorSlug);
  const pageNumber = Number(page);
  if (!author || !Number.isFinite(pageNumber) || pageNumber < 2) return {};

  const title = `${author.name} — Page ${pageNumber} | USA Gummies Blog`;
  const description = author.bio || `Posts by ${author.name} for USA Gummies.`;
  const canonical = `/blog/author/${author.slug}/page/${pageNumber}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "profile",
      images: [{ url: author.avatar || "/opengraph-image" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [author.avatar || "/opengraph-image"],
    },
  };
}

export default async function BlogAuthorPaginatedPage({
  params,
}: {
  params: Promise<{ author: string; page: string }>;
}) {
  const { author: authorSlug, page } = await params;
  const author = getAuthorBySlug(authorSlug);
  if (!author) {
    notFound();
  }

  const pageNumber = Number(page);
  if (!Number.isFinite(pageNumber) || pageNumber < 2) {
    redirect(`/blog/author/${author.slug}`);
  }

  const posts = getPostsByAuthorSlug(author.slug);
  const { items, totalPages } = paginatePosts(posts, pageNumber);

  if (pageNumber > totalPages) {
    notFound();
  }

  const siteUrl = resolveSiteUrl();
  const pageUrl = `${siteUrl}/blog/author/${author.slug}/page/${pageNumber}`;
  const offset = (pageNumber - 1) * BLOG_PAGE_SIZE;

  const personJsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${siteUrl}/blog/author/${author.slug}#person`,
    name: author.name,
    url: `${siteUrl}/blog/author/${author.slug}`,
    description: author.bio || undefined,
    image: author.avatar ? new URL(author.avatar, siteUrl).toString() : undefined,
    sameAs: author.links || undefined,
  };

  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${author.name} — Page ${pageNumber} | USA Gummies Blog`,
    description: author.bio || `Posts by ${author.name} for USA Gummies.`,
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify([personJsonLd, collectionJsonLd]) }}
      />
      <BlogArchive
        title={author.name}
        description={author.bio || `Posts by ${author.name} for USA Gummies.`}
        posts={items}
        currentPage={pageNumber}
        totalPages={totalPages}
        basePath={`/blog/author/${author.slug}`}
        heroBadge="Author"
        heroMeta={{
          avatar: author.avatar,
          name: author.name,
          title: author.title,
        }}
        breadcrumbs={[
          { name: "Home", href: "/" },
          { name: "Blog", href: "/blog" },
          { name: author.name, href: `/blog/author/${author.slug}` },
          { name: `Page ${pageNumber}`, href: `/blog/author/${author.slug}/page/${pageNumber}` },
        ]}
      />
    </>
  );
}
