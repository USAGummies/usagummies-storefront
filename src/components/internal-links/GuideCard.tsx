// LP-language guide card. Mirrors BlogPostCard's shadow-card pattern so
// the related-content modules read consistently across the site.

import Link from "next/link";
import Image from "next/image";
import { formatBlogDate } from "@/lib/blog";
import type { GuideCardEntry } from "@/lib/guides";

export function GuideCard({ guide }: { guide: GuideCardEntry }) {
  const guideHref = guide.href;
  return (
    <article
      className="flex flex-col overflow-hidden border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] transition-transform hover:-translate-x-[2px] hover:-translate-y-[2px] hover:shadow-[8px_8px_0_var(--lp-red)]"
      style={{ boxShadow: "5px 5px 0 var(--lp-ink)" }}
    >
      {guide.coverImage ? (
        <Link href={guideHref} className="block" aria-label={guide.title}>
          <div className="relative aspect-[16/9] w-full overflow-hidden border-b-[3px] border-[var(--lp-ink)] bg-[var(--lp-cream)]">
            <Image
              src={guide.coverImage}
              alt={guide.title}
              fill
              sizes="(max-width: 900px) 100vw, 50vw"
              className="object-cover transition duration-500 hover:scale-105"
            />
          </div>
        </Link>
      ) : null}

      <div className="flex flex-1 flex-col gap-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[var(--lp-ink)]/65">
          <span className="lp-label inline-flex items-center bg-[var(--lp-red)] px-2.5 py-1 text-[var(--lp-off-white)]">
            {guide.topic}
          </span>
          <span>{formatBlogDate(guide.updated || guide.date)}</span>
        </div>

        <h3 className="lp-display text-[1.4rem] leading-[1.05] text-[var(--lp-ink)] sm:text-[1.6rem]">
          <Link href={guideHref} className="hover:text-[var(--lp-red)]">
            {guide.title}
          </Link>
        </h3>

        <p className="lp-sans text-[0.98rem] leading-[1.55] text-[var(--lp-ink)]/82">
          {guide.description}
        </p>

        {guide.tags.length ? (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
            {guide.tags.slice(0, 3).map((tag) => (
              <span
                key={`${guideHref}-tag-${tag}`}
                className="lp-label inline-flex items-center border-2 border-[var(--lp-ink)] bg-[var(--lp-cream-soft)] px-2 py-0.5 text-[var(--lp-ink)]"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
