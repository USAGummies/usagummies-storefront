import Image from "next/image";
import Link from "next/link";
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
    <main className="blog-shell">
      <BreadcrumbJsonLd items={breadcrumbs} />

      <div className="blog-hero">
        {heroBadge ? <span className="badge badge--navy">{heroBadge}</span> : null}
        <div className="blog-hero__header">
          <div>
            <h1 className="blog-title">{title}</h1>
            <p className="blog-subtitle">{description}</p>
          </div>
          <Link href="/blog/rss.xml" className="btn btn-outline btn-compact">
            RSS feed
          </Link>
        </div>

        {heroMeta ? (
          <div className="blog-hero__meta">
            {heroMeta.avatar ? (
              <div className="blog-hero__avatar">
                <Image
                  src={heroMeta.avatar}
                  alt={heroMeta.name ? `Portrait of ${heroMeta.name}` : "Author portrait"}
                  fill
                  sizes="72px"
                  className="blog-hero__avatarImage"
                />
              </div>
            ) : null}
            <div>
              {heroMeta.name ? <div className="blog-hero__name">{heroMeta.name}</div> : null}
              {heroMeta.title ? <div className="blog-hero__title">{heroMeta.title}</div> : null}
            </div>
          </div>
        ) : null}
      </div>

      {featuredGuide ? (
        <section className="mt-8 rounded-3xl border border-[var(--border)] bg-white p-5 shadow-[0_18px_40px_rgba(15,27,45,0.08)]">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
            {featuredGuide.eyebrow || "Featured guide"}
          </div>
          <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xl font-black text-[var(--text)]">
                {featuredGuide.title}
              </div>
              <p className="mt-2 text-sm text-[var(--muted)]">{featuredGuide.description}</p>
            </div>
            <Link href={featuredGuide.href} className="btn btn-outline btn-compact">
              {featuredGuide.ctaLabel || "Read guide"}
            </Link>
          </div>
        </section>
      ) : null}

      {posts.length ? (
        <div className="blog-grid">
          {posts.map((post) => (
            <BlogPostCard key={post.slug} post={post} />
          ))}
        </div>
      ) : (
        <div className="blog-empty">
          <p>No posts yet. Check back soon.</p>
        </div>
      )}

      <BlogPagination currentPage={currentPage} totalPages={totalPages} basePath={basePath} />
    </main>
  );
}
