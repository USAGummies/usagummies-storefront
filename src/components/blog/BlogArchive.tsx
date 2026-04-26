// LP-language blog archive shell — drives the index, category, tag,
// author, and paginated archive pages from one component. Uses the
// PageHero + LP section pattern instead of the legacy `blog-shell`
// CSS namespace.

import Link from "next/link";
import Image from "next/image";

import { PageHero } from "@/components/lp/PageHero";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { BlogPagination } from "@/components/blog/BlogPagination";
import { BlogPostCard } from "@/components/blog/BlogPostCard";
import type { BlogListing } from "@/lib/blog";

export type BlogBreadcrumb = { name: string; href: string };

export function BlogArchive({
  title,
  description,
  posts,
  currentPage,
  totalPages,
  basePath,
  breadcrumbs,
  heroBadge,
  heroMeta,
  featuredGuide,
}: {
  title: string;
  description: string;
  posts: BlogListing[];
  currentPage: number;
  totalPages: number;
  basePath: string;
  breadcrumbs: BlogBreadcrumb[];
  heroBadge?: string;
  heroMeta?: {
    avatar?: string;
    name?: string;
    title?: string;
  };
  featuredGuide?: {
    title: string;
    description: string;
    href: string;
    eyebrow?: string;
    ctaLabel?: string;
  };
}) {
  return (
    <main>
      <BreadcrumbJsonLd items={breadcrumbs} />

      <PageHero
        eyebrow={heroBadge || "From the Journal"}
        headline={title}
        sub={description}
        ctas={[{ href: "/blog/rss.xml", label: "RSS feed", variant: "light" }]}
      />

      {/* Author / category / tag meta strip — only renders when an
       * author archive provides a portrait + bio. */}
      {heroMeta ? (
        <section className="bg-[var(--lp-cream)]">
          <div className="mx-auto flex max-w-[1100px] items-center gap-5 px-5 py-8 sm:px-8">
            {heroMeta.avatar ? (
              <div className="relative h-20 w-20 shrink-0 overflow-hidden border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)]">
                <Image
                  src={heroMeta.avatar}
                  alt={
                    heroMeta.name ? `Portrait of ${heroMeta.name}` : "Author portrait"
                  }
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              </div>
            ) : null}
            <div>
              {heroMeta.name ? (
                <div className="lp-display text-[1.4rem] text-[var(--lp-ink)]">
                  {heroMeta.name}
                </div>
              ) : null}
              {heroMeta.title ? (
                <div className="lp-sans mt-1 text-[0.95rem] text-[var(--lp-ink)]/80">
                  {heroMeta.title}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {/* Featured guide callout — for pillar guide spotlights. */}
      {featuredGuide ? (
        <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
          <div className="mx-auto max-w-[1100px] px-5 py-10 sm:px-8 sm:py-12">
            <div
              className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-8"
              style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
            >
              <p className="lp-label mb-2 text-[var(--lp-red)]">
                ★ {featuredGuide.eyebrow || "Featured Guide"} ★
              </p>
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div className="flex-1">
                  <h2 className="lp-display text-[clamp(1.6rem,4vw,2.4rem)] text-[var(--lp-ink)]">
                    {featuredGuide.title}
                  </h2>
                  <p className="lp-sans mt-3 text-[1rem] leading-[1.55] text-[var(--lp-ink)]/82">
                    {featuredGuide.description}
                  </p>
                </div>
                <Link href={featuredGuide.href} className="lp-cta whitespace-nowrap">
                  {featuredGuide.ctaLabel || "Read guide"}
                </Link>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Post grid */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1200px] px-5 py-12 sm:px-8 sm:py-16">
          {posts.length ? (
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:gap-10">
              {posts.map((post) => (
                <BlogPostCard key={post.slug} post={post} />
              ))}
            </div>
          ) : (
            <div className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-10 text-center">
              <p className="lp-sans text-[1rem] text-[var(--lp-ink)]/80">
                No posts yet. Check back soon.
              </p>
            </div>
          )}

          <div className="mt-10">
            <BlogPagination
              currentPage={currentPage}
              totalPages={totalPages}
              basePath={basePath}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
