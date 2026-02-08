import type { Metadata } from "next";
import { BlogArchive } from "@/components/blog/BlogArchive";
import { getAllPosts, paginatePosts, resolveSiteUrl } from "@/lib/blog";

const PAGE_TITLE = "Blog | USA Gummies";
const PAGE_DESCRIPTION =
  "Dye-free and made in USA candy stories from USA Gummies, with patriotic gummy tips.";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: {
    canonical: "/blog",
  },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: "/blog",
    type: "website",
    images: [{ url: "/opengraph-image" }],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: ["/opengraph-image"],
  },
};

export default function BlogIndexPage() {
  const posts = getAllPosts();
  const { items, totalPages } = paginatePosts(posts, 1);
  const siteUrl = resolveSiteUrl();
  const pageUrl = `${siteUrl}/blog`;

  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
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
        title={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
        posts={items}
        currentPage={1}
        totalPages={totalPages}
        basePath="/blog"
        breadcrumbs={[
          { name: "Home", href: "/" },
          { name: "Blog", href: "/blog" },
        ]}
        featuredGuide={{
          eyebrow: "Featured guide",
          title: "Dye-Free Gummy Bears",
          description:
            "The pillar guide to red 40 free gummies, label rules, and how to shop dye-free candy with confidence.",
          href: "/no-artificial-dyes-gummy-bears",
          ctaLabel: "Dye-Free Gummy Bears",
        }}
      />
    </>
  );
}
