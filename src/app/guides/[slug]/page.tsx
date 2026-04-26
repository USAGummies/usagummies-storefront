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
    <main>
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

      <section className="relative overflow-hidden">
        <div className="lp-bunting" aria-hidden />
        <div className="bg-[var(--lp-cream)]">
          <div className="mx-auto max-w-[900px] px-5 py-12 text-center sm:px-8 sm:py-16">
            <span className="lp-label inline-flex items-center bg-[var(--lp-red)] px-3 py-1.5 text-[var(--lp-off-white)]">
              {guide.topic}
            </span>

            <h1 className="lp-display mt-5 text-[clamp(2.2rem,6vw,4rem)] leading-[1.05] text-[var(--lp-ink)]">
              {guide.title}
            </h1>

            <p className="lp-sans mx-auto mt-5 max-w-[60ch] text-[1.1rem] leading-[1.55] text-[var(--lp-ink)]/85">
              {guide.description}
            </p>

            <div className="lp-label mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[var(--lp-ink)]/75">
              <span>{formatBlogDate(guide.updated || guide.date)}</span>
              <span aria-hidden>·</span>
              <Link href="/shop" className="hover:text-[var(--lp-red)]">
                Shop gummies
              </Link>
            </div>
          </div>
          <div className="lp-bunting-thin" aria-hidden />
        </div>
      </section>

      {guide.coverImage ? (
        <section className="bg-[var(--lp-cream-soft)]">
          <div className="mx-auto max-w-[1100px] px-5 py-10 sm:px-8 sm:py-14">
            <div
              className="relative aspect-[16/9] w-full overflow-hidden border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)]"
              style={{ boxShadow: "8px 8px 0 var(--lp-red)" }}
            >
              <Image
                src={guide.coverImage}
                alt={guide.title}
                fill
                sizes="(max-width: 900px) 100vw, 1100px"
                className="object-cover"
                priority
              />
            </div>
          </div>
        </section>
      ) : null}

      <article className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[800px] px-5 py-10 sm:px-8 sm:py-14">
          <div className="lp-sans prose prose-lg max-w-none text-[var(--lp-ink)] [&_h2]:lp-display [&_h2]:text-[var(--lp-ink)] [&_h2]:mt-10 [&_h3]:lp-display [&_h3]:text-[var(--lp-ink)] [&_h3]:mt-8 [&_a]:text-[var(--lp-red)] [&_a]:underline [&_a]:underline-offset-4 [&_strong]:text-[var(--lp-ink)] [&_blockquote]:border-l-[3px] [&_blockquote]:border-[var(--lp-red)] [&_blockquote]:pl-5 [&_blockquote]:italic [&_li]:my-2">
            {content}
          </div>

          {guide.tags.length ? (
            <div className="mt-10 flex flex-wrap items-center gap-2 border-t-2 border-[var(--lp-ink)]/15 pt-6">
              <span className="lp-label text-[var(--lp-ink)]/65">Tagged</span>
              {guide.tags.map((tag) => (
                <span
                  key={`${guide.slug}-tag-${tag}`}
                  className="lp-label inline-flex items-center border-2 border-[var(--lp-ink)] bg-[var(--lp-off-white)] px-2.5 py-1 text-[var(--lp-ink)]"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}

          <footer className="mt-10 grid gap-4 border-t-2 border-[var(--lp-ink)]/15 pt-6 sm:grid-cols-2">
            <div>
              <div className="lp-label mb-2 text-[var(--lp-ink)]/65">Explore more</div>
              <Link
                href="/bundle-guides"
                className="lp-display text-[1.2rem] text-[var(--lp-ink)] hover:text-[var(--lp-red)]"
              >
                Bag count guides
              </Link>
            </div>
            <div className="sm:text-right">
              <div className="lp-label mb-2 text-[var(--lp-ink)]/65">Shop with savings</div>
              <Link href="/shop" className="lp-cta">
                Shop gummies
              </Link>
            </div>
          </footer>
        </div>
      </article>

      {hasModules ? (
        <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
          <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
            <div className="mb-10 text-center">
              <p className="lp-label mb-2 text-[var(--lp-red)]">★ Keep Reading ★</p>
              <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
                More from
                <br />
                <span className="lp-script text-[var(--lp-red)]">USA Gummies.</span>
              </h2>
            </div>
            <div className="link-modules">
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
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
