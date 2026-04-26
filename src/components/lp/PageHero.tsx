// PageHero — LP-language hero for non-product brand / SEO / informational
// pages. Mirrors the visual language of `HeroSection` (used on the homepage,
// shop, and PDP) but without the BagSlider buy widget — so it ships a tight
// title + script-accent + sub block on a cream backdrop bracketed by
// striped bunting. Use anywhere a page needs a brand-consistent header
// without a purchase action right at the top.
//
// Optional CTAs render as `lp-cta` + `lp-cta lp-cta-light` to keep two-tone
// rhythm.

import Link from "next/link";

type CTA = {
  href: string;
  label: string;
  variant?: "primary" | "light";
};

type PageHeroProps = {
  /** Small uppercase eyebrow above the headline (e.g. breadcrumb tail). */
  eyebrow?: string;
  /** Main headline — first line in solid ink. */
  headline: string;
  /** Optional second line rendered in red ink. */
  headlineLine2?: string;
  /** Optional script-accent line (Allison) in red. */
  scriptAccent?: string;
  /** Sub-paragraph under the headline. */
  sub?: string;
  /** Optional CTAs rendered side-by-side under the sub. */
  ctas?: CTA[];
};

export function PageHero({
  eyebrow,
  headline,
  headlineLine2,
  scriptAccent,
  sub,
  ctas,
}: PageHeroProps) {
  return (
    <section className="relative overflow-hidden">
      <div className="lp-bunting" aria-hidden />

      <div className="relative bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 text-center sm:px-8 sm:py-20">
          {eyebrow ? (
            <p className="lp-label mb-4 text-[var(--lp-red)]">★ {eyebrow} ★</p>
          ) : null}

          <h1 className="lp-display text-[clamp(2.6rem,7vw,5rem)] text-[var(--lp-ink)]">
            <span className="block">{headline}</span>
            {headlineLine2 ? (
              <span className="block text-[var(--lp-red)]">{headlineLine2}</span>
            ) : null}
            {scriptAccent ? (
              <span className="lp-script mt-2 block text-[1.05em] text-[var(--lp-red)]">
                {scriptAccent}
              </span>
            ) : null}
          </h1>

          {sub ? (
            <p className="lp-sans mx-auto mt-6 max-w-[52ch] text-[1.1rem] leading-[1.55] text-[var(--lp-ink)]/85">
              {sub}
            </p>
          ) : null}

          {ctas && ctas.length ? (
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              {ctas.map((cta) => (
                <Link
                  key={cta.href}
                  href={cta.href}
                  className={
                    cta.variant === "light" ? "lp-cta lp-cta-light" : "lp-cta"
                  }
                >
                  {cta.label}
                </Link>
              ))}
            </div>
          ) : null}
        </div>

        <div className="lp-bunting-thin" aria-hidden />
      </div>
    </section>
  );
}
