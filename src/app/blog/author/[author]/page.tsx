import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlogArchive } from "@/components/blog/BlogArchive";
import {
  getAuthorBySlug,
  getAuthors,
  getPostsByAuthorSlug,
  paginatePosts,
  resolveSiteUrl,
} from "@/lib/blog";

export const revalidate = 3600;

export function generateStaticParams() {
  return getAuthors().map((item) => ({ author: item.author.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ author: string }>;
}): Promise<Metadata> {
  const { author: authorSlug } = await params;
  const author = getAuthorBySlug(authorSlug);
  if (!author) return {};

  const title = `${author.name} | USA Gummies Blog`;
  const description = author.bio || `Posts by ${author.name} for USA Gummies.`;
  const canonical = `/blog/author/${author.slug}`;

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

export default async function BlogAuthorPage({
  params,
}: {
  params: Promise<{ author: string }>;
}) {
  const { author: authorSlug } = await params;
  const author = getAuthorBySlug(authorSlug);
  if (!author) {
    notFound();
  }

  const posts = getPostsByAuthorSlug(author.slug);
  if (!posts.length) {
    notFound();
  }

  const { items, totalPages } = paginatePosts(posts, 1);
  const siteUrl = resolveSiteUrl();
  const pageUrl = `${siteUrl}/blog/author/${author.slug}`;

  const personJsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${pageUrl}#person`,
    name: author.name,
    url: pageUrl,
    description: author.bio || undefined,
    image: author.avatar ? new URL(author.avatar, siteUrl).toString() : undefined,
    sameAs: author.links || undefined,
  };

  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${author.name} | USA Gummies Blog`,
    description: author.bio || `Posts by ${author.name} for USA Gummies.`,
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify([personJsonLd, collectionJsonLd]) }}
      />
      <BlogArchive
        title={author.name}
        description={author.bio || `Posts by ${author.name} for USA Gummies.`}
        posts={items}
        currentPage={1}
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
        ]}
      />
    </>
  );
}
