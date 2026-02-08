import Link from "next/link";
import Image from "next/image";
import { formatBlogDate } from "@/lib/blog";
import type { GuideCardEntry } from "@/lib/guides";

export function GuideCard({ guide }: { guide: GuideCardEntry }) {
  const guideHref = guide.href;
  return (
    <article className="blog-card">
      {guide.coverImage ? (
        <Link href={guideHref} className="blog-card__media" aria-label={guide.title}>
          <div className="blog-card__imageFrame">
            <Image
              src={guide.coverImage}
              alt={guide.title}
              fill
              sizes="(max-width: 900px) 100vw, 50vw"
              className="blog-card__image"
            />
          </div>
        </Link>
      ) : null}

      <div className="blog-card__body">
        <div className="blog-card__eyebrow">
          <span className="badge badge--red">{guide.topic}</span>
          <span>{formatBlogDate(guide.updated || guide.date)}</span>
        </div>

        <h3 className="blog-card__title">
          <Link href={guideHref} className="blog-link">
            {guide.title}
          </Link>
        </h3>

        <p className="blog-card__desc">{guide.description}</p>

    {guide.tags.length ? (
      <div className="blog-card__tags">
        {guide.tags.slice(0, 3).map((tag) => (
          <span key={`${guideHref}-tag-${tag}`} className="badge badge--navy">
            {tag}
          </span>
        ))}
      </div>
    ) : null}
      </div>
    </article>
  );
}
