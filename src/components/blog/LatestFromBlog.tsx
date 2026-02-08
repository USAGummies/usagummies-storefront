import Link from "next/link";
import { BlogPostCard } from "@/components/blog/BlogPostCard";
import { getAllPosts } from "@/lib/blog";

export function LatestFromBlog({
  title = "Latest from the Blog",
  description = "Fresh stories, gifting tips, and patriotic candy inspiration from USA Gummies.",
  limit = 3,
}: {
  title?: string;
  description?: string;
  limit?: number;
}) {
  const posts = getAllPosts().slice(0, limit);
  if (!posts.length) return null;

  return (
    <section className="blog-latest" aria-labelledby="blog-latest-title">
      <div className="blog-latest__header">
        <div>
          <div className="blog-latest__kicker">Blog</div>
          <h2 id="blog-latest-title" className="blog-latest__title">
            {title}
          </h2>
          <p className="blog-latest__subtitle">{description}</p>
        </div>
        <Link href="/blog" className="btn btn-outline btn-compact">
          View all posts
        </Link>
      </div>
      <div className="blog-grid">
        {posts.map((post) => (
          <BlogPostCard key={post.slug} post={post} />
        ))}
      </div>
    </section>
  );
}
