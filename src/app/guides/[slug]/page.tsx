import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { compileMDX } from "next-mdx-remote/rsc";
import { mdxComponents } from "@/components/blog/MDXComponents";
import { BlogPostCard } from "@/components/blog/BlogPostCard";
import { GuideCard } from "@/components/internal-links/GuideCard";
import { LinkModule } from "@/components/internal-links/LinkModule";
import { RelatedProductCard } from "@/components/internal-links/RelatedProductCard";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { formatBlogDate, getAllPosts } from "@/lib/blog";
import { getAllGuides, getGuideBySlug, getTopGuideCandidates } from "@/lib/guides";
import {
  MIN_RELATED_SCORE,
  buildPostSignals,
  buildProductSignals,
  buildSignalsFromValues,
  rankRelated,
} from "@/lib/internalLinks";
import { resolveSiteUrl } from "@/lib/seo/canonical";
import { getProductsForInternalLinks } from "@/lib/shopify/internalLinks";

export const revalidate = 3600;

export function generateStaticParams() {
  return getAllGuides().map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guide = getGuideBySlug(slug);
  if (!guide) return {};

  const title = guide.seoTitle || guide.title;
  const description = guide.seoDescription || guide.description;
  const canonical = `/guides/${guide.slug}`;
  const image = guide.coverImage || "/opengraph-image";

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "article",
      publishedTime: guide.date,
      modifiedTime: guide.updated || guide.date,
      images: [{ url: image }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = getGuideBySlug(slug);
  if (!guide) {
    notFound();
  }

  const { content } = await compileMDX({
    source: guide.content,
    components: mdxComponents,
  });

  const siteUrl = resolveSiteUrl();
  const pageUrl = `${siteUrl}/guides/${guide.slug}`;
  const imageUrl = guide.coverImage
    ? new URL(guide.coverImage, siteUrl).toString()
    : `${siteUrl}/opengraph-image`;

  const sourceSignals = buildSignalsFromValues({
    url: `/guides/${guide.slug}`,
    category: guide.topic,
    tags: guide.tags,
    keywords: guide.keywords,
    date: guide.updated || guide.date,
  });

  const relatedPosts = (() => {
    const candidates = getAllPosts().map((item) => ({
      item,
      signals: buildPostSignals({
        slug: item.slug,
        category: item.category,
        tags: item.tags,
        keywords: item.keywords,
        date: item.date,
        updated: item.updated,
      }),
    }));
    return rankRelated(sourceSignals, candidates, { limit: 4 });
  })();

  let relatedProducts: Awaited<ReturnType<typeof getProductsForInternalLinks>> = [];
  try {
    relatedProducts = await getProductsForInternalLinks();
  } catch {
    relatedProducts = [];
  }

  const relatedProductCards = (() => {
    if (!relatedProducts.length) return [];
    const candidates = relatedProducts.map((product) => ({
      item: product,
      signals: buildProductSignals({
        handle: product.handle,
        productType: product.productType,
        tags: product.tags,
        collections: product.collections?.nodes,
        seoKeywords: product.seoKeywords?.value,
        seoCategory: product.seoCategory?.value,
        createdAt: product.createdAt,
      }),
    }));
    return rankRelated(sourceSignals, candidates, {
      limit: 4,
      minScore: MIN_RELATED_SCORE,
      minCount: 4,
    });
  })();

  const topGuides = (() => {
    const guides = getTopGuideCandidates();
    if (!guides.length) return [];
    const candidates = guides.map((item) => ({
      item,
      signals: buildSignalsFromValues({
        url: item.href,
        category: item.topic,
        tags: item.tags,
        keywords: item.keywords,
        date: item.updated || item.date,
      }),
    }));
    return rankRelated(sourceSignals, candidates, {
      limit: 3,
      minScore: MIN_RELATED_SCORE,
      minCount: 3,
    });
  })();

  const hasModules = relatedPosts.length || relatedProductCards.length || topGuides.length;

  return (
    <main className="blog-shell blog-shell--post">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: guide.seoTitle || guide.title,
            description: guide.seoDescription || guide.description,
            url: pageUrl,
            image: [imageUrl],
            datePublished: guide.date,
            dateModified: guide.updated || guide.date,
            mainEntityOfPage: { "@type": "WebPage", "@id": pageUrl },
          }),
        }}
      />
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: guide.title, href: `/guides/${guide.slug}` },
        ]}
      />

      <article className="blog-article">
        <header className="blog-post__header">
          <div className="blog-post__eyebrow">
            <span className="badge badge--red">{guide.topic}</span>
          </div>
          <h1 className="blog-post__title">{guide.title}</h1>
          <p className="blog-post__subtitle">{guide.description}</p>

          <div className="blog-post__meta">
            <span>{formatBlogDate(guide.updated || guide.date)}</span>
            <Link href="/shop" className="blog-link">
              Shop gummies
            </Link>
          </div>

          {guide.coverImage ? (
            <div className="blog-post__cover">
              <Image
                src={guide.coverImage}
                alt={guide.title}
                fill
                sizes="(max-width: 900px) 100vw, 900px"
                className="blog-post__coverImage"
                priority
              />
            </div>
          ) : null}

          {guide.tags.length ? (
            <div className="blog-post__tags">
              {guide.tags.map((tag) => (
                <span key={`${guide.slug}-tag-${tag}`} className="badge badge--navy">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </header>

        <div className="blog-content">{content}</div>

        <footer className="blog-post__footer">
          <div>
            <div className="blog-post__footerLabel">Explore more</div>
            <Link href="/bundle-guides" className="blog-link">
              Bag count guides
            </Link>
          </div>
          <div>
            <div className="blog-post__footerLabel">Shop with savings</div>
            <Link href="/shop" className="blog-link">
              Shop gummies
            </Link>
          </div>
        </footer>
      </article>

      {hasModules ? (
        <section className="link-modules" aria-label="Related content">
          {relatedPosts.length ? (
            <LinkModule title="Related Posts">
              {relatedPosts.map((related) => (
                <BlogPostCard key={related.slug} post={related} />
              ))}
            </LinkModule>
          ) : null}

          {relatedProductCards.length ? (
            <LinkModule title="Related Products">
              {relatedProductCards.map((product) => (
                <RelatedProductCard key={product.id} product={product} />
              ))}
            </LinkModule>
          ) : null}

          {topGuides.length ? (
            <LinkModule title="Top Guides">
              {topGuides.map((item) => (
                <GuideCard key={item.href} guide={item} />
              ))}
            </LinkModule>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
