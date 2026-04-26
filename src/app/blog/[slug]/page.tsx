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

const DYE_RELATED_TAGS = new Set([
  "dye-free",
  "no-artificial-dyes",
  "red-40",
  "ingredients",
  "clean-label",
  "artificial-dyes",
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

  const isDyeRelated = post.tagSlugs.some((s) => DYE_RELATED_TAGS.has(s)) ||
    post.category.toLowerCase().includes("dye");

  const blogPostingJsonLd: Record<string, unknown> = {
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
    ...(isDyeRelated && {
      mentions: {
        "@type": "Product",
        name: "USA Gummies All American Gummy Bears",
        url: `${siteUrl}/shop`,
        brand: { "@type": "Brand", name: "USA Gummies" },
        description: "Premium dye-free gummy bears made in the USA with natural fruit and vegetable colors.",
      },
    }),
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
    <main>
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

      {/* Post hero — LP language. Eyebrow = category. Striped bunting
       * + cream backdrop. Title + lede + meta + tags. */}
      <section className="relative overflow-hidden">
        <div className="lp-bunting" aria-hidden />
        <div className="bg-[var(--lp-cream)]">
          <div className="mx-auto max-w-[900px] px-5 py-12 text-center sm:px-8 sm:py-16">
            <Link
              href={`/blog/category/${post.categorySlug}`}
              className="lp-label inline-flex items-center bg-[var(--lp-red)] px-3 py-1.5 text-[var(--lp-off-white)] no-underline"
            >
              {post.category}
            </Link>

            <h1 className="lp-display mt-5 text-[clamp(2.2rem,6vw,4rem)] leading-[1.05] text-[var(--lp-ink)]">
              {post.title}
            </h1>

            <p className="lp-sans mx-auto mt-5 max-w-[60ch] text-[1.1rem] leading-[1.55] text-[var(--lp-ink)]/85">
              {post.description}
            </p>

            <div className="lp-label mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[var(--lp-ink)]/75">
              <span>{formatBlogDate(post.updated || post.date)}</span>
              <span aria-hidden>·</span>
              <span>{post.readingTime}</span>
              <span aria-hidden>·</span>
              <Link
                href={`/blog/author/${post.authorSlug}`}
                className="hover:text-[var(--lp-red)]"
              >
                {post.authorName}
              </Link>
            </div>
          </div>
          <div className="lp-bunting-thin" aria-hidden />
        </div>
      </section>

      {/* Cover image, framed in LP shadow card */}
      {post.coverImage ? (
        <section className="bg-[var(--lp-cream-soft)]">
          <div className="mx-auto max-w-[1100px] px-5 py-10 sm:px-8 sm:py-14">
            <div
              className="relative aspect-[16/9] w-full overflow-hidden border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)]"
              style={{ boxShadow: "8px 8px 0 var(--lp-red)" }}
            >
              <Image
                src={post.coverImage}
                alt={post.title}
                fill
                sizes="(max-width: 900px) 100vw, 1100px"
                className="object-cover"
                priority
              />
            </div>
          </div>
        </section>
      ) : null}

      {/* MDX article body */}
      <article className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[800px] px-5 py-10 sm:px-8 sm:py-14">
          <div className="lp-sans prose prose-lg max-w-none text-[var(--lp-ink)] [&_h2]:lp-display [&_h2]:text-[var(--lp-ink)] [&_h2]:mt-10 [&_h3]:lp-display [&_h3]:text-[var(--lp-ink)] [&_h3]:mt-8 [&_a]:text-[var(--lp-red)] [&_a]:underline [&_a]:underline-offset-4 [&_strong]:text-[var(--lp-ink)] [&_blockquote]:border-l-[3px] [&_blockquote]:border-[var(--lp-red)] [&_blockquote]:pl-5 [&_blockquote]:italic [&_li]:my-2">
            {content}
          </div>

          {post.tags.length ? (
            <div className="mt-10 flex flex-wrap items-center gap-2 border-t-2 border-[var(--lp-ink)]/15 pt-6">
              <span className="lp-label text-[var(--lp-ink)]/65">Tagged</span>
              {post.tags.map((tag, index) => (
                <Link
                  key={`${post.slug}-tag-${tag}`}
                  href={`/blog/tag/${post.tagSlugs[index]}`}
                  className="lp-label inline-flex items-center border-2 border-[var(--lp-ink)] bg-[var(--lp-off-white)] px-2.5 py-1 text-[var(--lp-ink)] no-underline hover:bg-[var(--lp-ink)] hover:text-[var(--lp-cream)]"
                >
                  {tag}
                </Link>
              ))}
            </div>
          ) : null}

          {shouldShowPillarGuide ? (
            <aside
              className="mt-10 border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
              style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
            >
              <p className="lp-label mb-2 text-[var(--lp-red)]">★ Related Guide ★</p>
              <h2 className="lp-display text-[1.6rem] text-[var(--lp-ink)]">
                <Link
                  href="/no-artificial-dyes-gummy-bears"
                  className="hover:text-[var(--lp-red)]"
                >
                  No Artificial Dyes Gummy Bears
                </Link>
              </h2>
              <p className="lp-sans mt-3 text-[1rem] leading-[1.55] text-[var(--lp-ink)]/82">
                Explore the science, label rules, and FAQs behind red 40 free
                gummies and dye-free candy.
              </p>
            </aside>
          ) : null}

          <footer className="mt-10 grid gap-4 border-t-2 border-[var(--lp-ink)]/15 pt-6 sm:grid-cols-2">
            <div>
              <div className="lp-label mb-2 text-[var(--lp-ink)]/65">Filed under</div>
              <Link
                href={`/blog/category/${post.categorySlug}`}
                className="lp-display text-[1.2rem] text-[var(--lp-ink)] hover:text-[var(--lp-red)]"
              >
                {post.category}
              </Link>
            </div>
            <div className="sm:text-right">
              <div className="lp-label mb-2 text-[var(--lp-ink)]/65">Loved this?</div>
              <Link href="/shop" className="lp-cta">
                Shop USA Gummies
              </Link>
            </div>
          </footer>
        </div>
      </article>

      {/* Related modules — posts, products, guides */}
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
                  {topGuides.map((guide) => (
                    <GuideCard key={guide.href} guide={guide} />
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
