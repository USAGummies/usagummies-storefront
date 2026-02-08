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
import {
  MIN_RELATED_SCORE,
  buildPostSignals,
  buildProductSignals,
  buildSignalsFromValues,
  rankRelated,
} from "@/lib/internalLinks";
import {
  formatBlogDate,
  getAllPosts,
  getAuthorBySlug,
  getPostBySlug,
  resolveSiteUrl,
} from "@/lib/blog";
import { getTopGuideCandidates } from "@/lib/guides";
import { getProductsForInternalLinks } from "@/lib/shopify/internalLinks";

export const revalidate = 3600;

const PILLAR_TAG_SLUGS = new Set([
  "dye-free",
  "no-artificial-dyes",
  "red-40",
  "ingredients",
  "kids",
  "clean-label",
]);

type PageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};

  const title = post.seoTitle || post.title;
  const description = post.seoDescription || post.description;
  const canonical = post.canonicalUrl || `/blog/${post.slug}`;
  const image = post.coverImage || "/opengraph-image";

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "article",
      publishedTime: post.date,
      modifiedTime: post.updated || post.date,
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

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) {
    notFound();
  }

  const author = getAuthorBySlug(post.authorSlug);
  const { content } = await compileMDX({
    source: post.content,
    components: mdxComponents,
  });
  const shouldShowPillarGuide = post.tagSlugs.some((slug) => PILLAR_TAG_SLUGS.has(slug));

  const siteUrl = resolveSiteUrl();
  const pageUrl = `${siteUrl}/blog/${post.slug}`;
  const imageUrl = post.coverImage
    ? new URL(post.coverImage, siteUrl).toString()
    : `${siteUrl}/opengraph-image`;

  const authorJsonLd = {
    "@type": "Person",
    name: author?.name || post.authorName,
    url: `${siteUrl}/blog/author/${post.authorSlug}`,
    image: author?.avatar ? new URL(author.avatar, siteUrl).toString() : undefined,
    description: author?.bio || undefined,
    sameAs: author?.links || undefined,
  };

  const blogPostingJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.seoTitle || post.title,
    description: post.seoDescription || post.description,
    url: pageUrl,
    image: [imageUrl],
    datePublished: post.date,
    dateModified: post.updated || post.date,
    author: authorJsonLd,
    publisher: {
      "@type": "Organization",
      "@id": `${siteUrl}#organization`,
      name: "USA Gummies",
      logo: {
        "@type": "ImageObject",
        url: `${siteUrl}/brand/logo.png`,
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": pageUrl,
    },
    keywords: post.tags.join(", "),
  };

  const sourceSignals = buildPostSignals({
    slug: post.slug,
    category: post.category,
    tags: post.tags,
    keywords: post.keywords,
    date: post.date,
    updated: post.updated,
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
    const candidates = guides.map((guide) => ({
      item: guide,
      signals: buildSignalsFromValues({
        url: guide.href || (guide.slug ? `/guides/${guide.slug}` : ""),
        category: guide.topic,
        tags: guide.tags,
        keywords: guide.keywords,
        date: guide.updated || guide.date,
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(blogPostingJsonLd) }}
      />
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Blog", href: "/blog" },
          { name: post.title, href: `/blog/${post.slug}` },
        ]}
      />

      <article className="blog-article">
        <header className="blog-post__header">
          <div className="blog-post__eyebrow">
            <Link href={`/blog/category/${post.categorySlug}`} className="badge badge--red">
              {post.category}
            </Link>
          </div>
          <h1 className="blog-post__title">{post.title}</h1>
          <p className="blog-post__subtitle">{post.description}</p>

          <div className="blog-post__meta">
            <span>{formatBlogDate(post.updated || post.date)}</span>
            <span>{post.readingTime}</span>
            <Link href={`/blog/author/${post.authorSlug}`} className="blog-link">
              {post.authorName}
            </Link>
          </div>

          {post.coverImage ? (
            <div className="blog-post__cover">
              <Image
                src={post.coverImage}
                alt={post.title}
                fill
                sizes="(max-width: 900px) 100vw, 900px"
                className="blog-post__coverImage"
                priority
              />
            </div>
          ) : null}

          {post.tags.length ? (
            <div className="blog-post__tags">
              {post.tags.map((tag, index) => (
                <Link
                  key={`${post.slug}-tag-${tag}`}
                  href={`/blog/tag/${post.tagSlugs[index]}`}
                  className="badge badge--navy"
                >
                  {tag}
                </Link>
              ))}
            </div>
          ) : null}
        </header>

        <div className="blog-content">{content}</div>

        {shouldShowPillarGuide ? (
          <aside className="mt-10 rounded-3xl border border-[var(--border)] bg-[var(--surface-strong)] p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
              Related guide
            </div>
            <h2 className="mt-2 text-xl font-black text-[var(--text)]">
              <Link href="/no-artificial-dyes-gummy-bears" className="hover:text-[var(--navy)]">
                No Artificial Dyes Gummy Bears
              </Link>
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Explore the science, label rules, and FAQs behind red 40 free gummies and dye-free candy.
            </p>
          </aside>
        ) : null}

        <footer className="blog-post__footer">
          <div>
            <div className="blog-post__footerLabel">Filed under</div>
            <Link href={`/blog/category/${post.categorySlug}`} className="blog-link">
              {post.category}
            </Link>
          </div>
          <div>
            <div className="blog-post__footerLabel">Share with</div>
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
              {topGuides.map((guide) => (
                <GuideCard key={guide.href} guide={guide} />
              ))}
            </LinkModule>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
