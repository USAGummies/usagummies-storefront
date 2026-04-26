// LP-language blog post card. Shadow card with cover image, eyebrow
// (category + date + reading time), display headline, description,
// author, and tag chips. Drops the legacy `blog-card__*` classes in
// favor of inline LP-language classes so the visual matches the rest
// of the site.

import Link from "next/link";
import Image from "next/image";
import { formatBlogDate, type BlogListing } from "@/lib/blog";

export function BlogPostCard({ post }: { post: BlogListing }) {
  const postHref = `/blog/${post.slug}`;
  return (
    <article
      className="flex flex-col overflow-hidden border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] transition-transform hover:-translate-x-[2px] hover:-translate-y-[2px] hover:shadow-[8px_8px_0_var(--lp-red)]"
      style={{ boxShadow: "5px 5px 0 var(--lp-ink)" }}
    >
      {post.coverImage ? (
        <Link href={postHref} className="block" aria-label={post.title}>
          <div className="relative aspect-[16/9] w-full overflow-hidden border-b-[3px] border-[var(--lp-ink)] bg-[var(--lp-cream)]">
            <Image
              src={post.coverImage}
              alt={post.title}
              fill
              sizes="(max-width: 900px) 100vw, 50vw"
              className="object-cover transition duration-500 hover:scale-105"
            />
          </div>
        </Link>
      ) : null}

      <div className="flex flex-1 flex-col gap-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[var(--lp-ink)]/65">
          <Link
            href={`/blog/category/${post.categorySlug}`}
            className="lp-label inline-flex items-center bg-[var(--lp-red)] px-2.5 py-1 text-[var(--lp-off-white)] no-underline"
          >
            {post.category}
          </Link>
          <span>{formatBlogDate(post.updated || post.date)}</span>
          <span>{post.readingTime}</span>
        </div>

        <h2 className="lp-display text-[1.5rem] leading-[1.05] text-[var(--lp-ink)] sm:text-[1.75rem]">
          <Link href={postHref} className="hover:text-[var(--lp-red)]">
            {post.title}
          </Link>
        </h2>

        <p className="lp-sans text-[0.98rem] leading-[1.55] text-[var(--lp-ink)]/82">
          {post.description}
        </p>

        <div className="mt-auto flex flex-wrap items-center gap-3 pt-2 text-[0.85rem] text-[var(--lp-ink)]/75">
          <Link
            href={`/blog/author/${post.authorSlug}`}
            className="lp-sans font-semibold hover:text-[var(--lp-red)]"
          >
            {post.authorName}
          </Link>
        </div>

        {post.tags.length ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {post.tags.map((tag, index) => (
              <Link
                key={`${post.slug}-tag-${tag}`}
                href={`/blog/tag/${post.tagSlugs[index]}`}
                className="lp-label inline-flex items-center border-2 border-[var(--lp-ink)] bg-[var(--lp-cream-soft)] px-2 py-0.5 text-[var(--lp-ink)] no-underline hover:bg-[var(--lp-ink)] hover:text-[var(--lp-cream)]"
              >
                {tag}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
