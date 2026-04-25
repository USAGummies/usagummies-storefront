// Hero — clean centerpiece. Bag slider is the star (per Ben's feedback).
// Copy is verified-only: wordmark, "Made in the U.S.A." (on the bag itself),
// five natural flavors (panel claim), "No artificial dyes" (ingredient panel).
// No fictional batch numbers, no review counts, no location reveals.

import Image from "next/image";
// BagSlider is already a client component; App Router can render it directly
// from a server component without `dynamic({ssr:false})` (which is banned
// from server components in Next.js 15).
import BagSlider from "@/components/purchase/BagSlider.client";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      <div className="lp-bunting" aria-hidden />

      {/* Navy header — solid navy with a gold hairline. The dotted
          starfield treatment was pulled here because the gold pin-dots
          were visually peeking through the wordmark and "Made in the
          U.S.A." script at small sizes (Ben's audit). Solid navy keeps
          the patriotic palette without competing with the typography. */}
      <div
        className="relative"
        style={{
          backgroundColor: "var(--lp-navy)",
          color: "var(--lp-off-white)",
          borderBottom: "2px solid var(--lp-gold)",
        }}
      >
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 px-5 py-2.5 sm:px-8">
          <span className="lp-display text-[1.2rem] tracking-[0.04em] sm:text-[1.35rem]">
            USA <span className="text-[var(--lp-red)]">★</span> Gummies
          </span>
          <span className="lp-script text-[1.2rem] text-[var(--lp-gold)] sm:text-[1.4rem]">
            Made in the U.S.A.
          </span>
        </div>
      </div>

      {/* Hero body */}
      <div className="relative">
        {/* Real product photo backdrop — replaced the illustrated
            meadow with the actual bag-in-Americana photo so the top of
            the page leads with real imagery (Ben's audit: "needs a real
            image here at the top"). Cream wash keeps the H1 + bag
            slider readable against a busy photograph. */}
        <div aria-hidden className="absolute inset-0 -z-10">
          <Image
            src="/brand/photos/bag-1776.jpg"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          {/* Two-stop wash: top is mostly transparent so the real
              photo carries the visual weight; the wash deepens behind
              the headline + bag slider so type stays legible. */}
          <div className="absolute inset-0 bg-gradient-to-b from-[var(--lp-cream)]/15 via-[var(--lp-cream)]/55 to-[var(--lp-cream)]" />
        </div>

        <div className="relative mx-auto grid max-w-[1200px] grid-cols-1 gap-8 px-5 pb-10 pt-10 sm:px-8 sm:pb-16 sm:pt-14 md:grid-cols-[1fr_1.05fr] md:gap-12 md:pb-20 md:pt-18">
          {/* Copy column */}
          <div className="relative">
            <h1
              data-reveal="2"
              className="lp-display text-[clamp(2.8rem,9.5vw,6rem)] text-[var(--lp-ink)]"
            >
              <span className="block">All American</span>
              <span className="block text-[var(--lp-red)]">Gummy Bears.</span>
            </h1>

            <p
              data-reveal="3"
              className="lp-sans mt-5 max-w-[32ch] text-[1.1rem] leading-[1.5] text-[var(--lp-ink)]/85 sm:text-[1.2rem]"
            >
              Real gummy bears. Five natural flavors.{" "}
              <span className="font-bold text-[var(--lp-red)]">
                No artificial dyes.
              </span>
            </p>

            {/* Trust row — three claims that are all on the bag itself */}
            <ul
              data-reveal="4"
              className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3"
            >
              {["Made in the U.S.A.", "No Artificial Dyes", "All Natural Flavors"].map(
                (t) => (
                  <li
                    key={t}
                    className="lp-label flex items-center gap-2 text-[var(--lp-ink)]"
                  >
                    <span
                      aria-hidden
                      className="lp-star-ornament h-[14px] w-[14px] text-[var(--lp-red)]"
                    />
                    {t}
                  </li>
                ),
              )}
            </ul>
          </div>

          {/* Bag slider — the real purchase interaction */}
          <div
            data-reveal="3"
            className="relative rounded-sm border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)]/95 p-4 shadow-[6px_6px_0_var(--lp-red)] sm:p-6"
          >
            <BagSlider variant="full" defaultQty={5} />
          </div>
        </div>

        <div className="lp-bunting-thin" aria-hidden />
      </div>
    </section>
  );
}
