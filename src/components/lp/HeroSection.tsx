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

      {/* Hero body — solid cream backdrop. The bag-1776 background photo
          was pulled per Ben's audit ("the image you used as the hero
          image is the background, i am not a fan"). The hero now leads
          with the actual product photo (hero.jpg) as a foreground
          card, not a wash, so visitors immediately see what they're
          buying. */}
      <div className="relative bg-[var(--lp-cream)]">
        <div className="relative mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-8 px-5 pb-10 pt-10 sm:px-8 sm:pb-16 sm:pt-14 md:grid-cols-[1.05fr_1fr] md:gap-12 md:pb-20 md:pt-18">
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

            {/* Bag slider tucked under the copy on mobile-first stacks;
                on desktop it shares the right column with the product
                photo (see grid below). */}
            <div
              data-reveal="3"
              className="relative mt-8 rounded-sm border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-4 shadow-[6px_6px_0_var(--lp-red)] sm:p-6 md:hidden"
            >
              <BagSlider variant="full" defaultQty={5} />
            </div>
          </div>

          {/* Product hero column — actual product photo first
              (so visitors immediately see what they're buying), bag
              slider directly under it for the purchase action. Hidden
              on small screens where the slider lives in the copy
              column above. Capped width + 4:3 landscape aspect keeps
              the photo from dominating the fold so the H1 + intro
              copy still leads (Ben's audit: "the hero image is so
              large, that you dont have any intro with text"). */}
          <div className="relative hidden flex-col items-end gap-5 md:flex">
            <figure
              data-reveal="3"
              className="relative w-full max-w-[360px] overflow-hidden border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)]"
              style={{ boxShadow: "6px 6px 0 var(--lp-red)" }}
            >
              {/* Square aspect matches the hero-pack-icon asset
                  natively (512×512) so the bag + 5-bear lineup shows
                  in full without cropping. */}
              <div className="relative aspect-square w-full">
                <Image
                  src="/brand/hero-pack-icon.png"
                  alt="USA Gummies — All American Gummy Bears 7.5 oz bag"
                  fill
                  priority
                  sizes="(max-width: 1200px) 40vw, 360px"
                  className="object-contain p-3"
                />
              </div>
            </figure>

            <div
              data-reveal="3"
              className="relative w-full rounded-sm border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-4 shadow-[6px_6px_0_var(--lp-red)] sm:p-6"
            >
              <BagSlider variant="full" defaultQty={5} />
            </div>
          </div>

          {/* Mobile-only product photo — sits between the trust row
              and the buy widget (in the copy column above) so the
              product is still the first thing visitors see when the
              page stacks. Compact 4:3 keeps the headline above the
              fold even on narrow screens. */}
          <figure
            className="relative -order-1 mx-auto w-full max-w-[360px] overflow-hidden border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] md:hidden"
            style={{ boxShadow: "6px 6px 0 var(--lp-red)" }}
          >
            <div className="relative aspect-square w-full">
              <Image
                src="/brand/hero-pack-icon.png"
                alt="USA Gummies — All American Gummy Bears 7.5 oz bag"
                fill
                priority
                sizes="100vw"
                className="object-contain p-3"
              />
            </div>
          </figure>
        </div>

        <div className="lp-bunting-thin" aria-hidden />
      </div>
    </section>
  );
}
