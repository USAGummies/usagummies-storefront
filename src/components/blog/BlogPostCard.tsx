import Link from "next/link";
import Image from "next/image";
import { formatBlogDate, type BlogListing } from "@/lib/blog";

export function BlogPostCard({ post }: { post: BlogListing }) {
  const postHref = `/blog/${post.slug}`;
  return (
    <article className="blog-card">
      {post.coverImage ? (
        <Link href={postHref} className="blog-card__media" aria-label={post.title}>
          <div className="blog-card__imageFrame">
            <Image
              src={post.coverImage}
              alt={post.title}
              fill
              sizes="(max-width: 900px) 100vw, 50vw"
              className="blog-card__image"
            />
          </div>
        </Link>
      ) : null}

      <div className="blog-card__body">
        <div className="blog-card__eyebrow">
          <Link href={`/blog/category/${post.categorySlug}`} className="badge badge--red">
            {post.category}
          </Link>
          <span>{formatBlogDate(post.updated || post.date)}</span>
          <span>{post.readingTime}</span>
        </div>

        <h2 className="blog-card__title">
          <Link href={postHref} className="blog-link">
            {post.title}
          </Link>
        </h2>

        <p className="blog-card__desc">{post.description}</p>

        <div className="blog-card__meta">
          <Link href={`/blog/author/${post.authorSlug}`} className="blog-link">
            {post.authorName}
          </Link>
        </div>

        {post.tags.length ? (
          <div className="blog-card__tags">
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
      </div>
    </article>
  );
}
