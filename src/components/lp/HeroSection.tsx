// Hero v2 (2026-04-26) — adds eyebrow, star-rating row, flavor strip, and a
// bigger product image to fill the cream void Ben flagged on desktop. Copy is
// still verified-only: wordmark, "Made in the U.S.A." (on the bag itself),
// "Five natural flavors" (panel claim), "No artificial dyes" (ingredient
// panel). Star ratings come from getReviewAggregate() (legacy + Shopify
// verified reviews) and the row only renders when real numbers exist.

import Image from "next/image";
// BagSlider is already a client component; App Router can render it directly
// from a server component without `dynamic({ssr:false})` (which is banned
// from server components in Next.js 15).
import BagSlider from "@/components/purchase/BagSlider.client";

type ReviewAggregate = {
  ratingValue: number;
  reviewCount: number;
} | null;

// Flavor lineup — canonical mapping verified against ThreePromises.tsx +
// FaqAccordion.tsx (file names predate the rebuild and were mislabeled,
// so the actual pixel colors are: pink → Cherry, red → Watermelon).
const FLAVORS: Array<{ src: string; label: string }> = [
  { src: "/brand/gummies/gummy-pink.png", label: "Cherry" },
  { src: "/brand/gummies/gummy-yellow.png", label: "Lemon" },
  { src: "/brand/gummies/gummy-green.png", label: "Green Apple" },
  { src: "/brand/gummies/gummy-orange.png", label: "Orange" },
  { src: "/brand/gummies/gummy-red.png", label: "Watermelon" },
];

function StarRow({ value }: { value: number }) {
  // Fixed 5 stars; render half-fills via CSS clip-path so 4.8 looks correct.
  const filled = Math.max(0, Math.min(5, value));
  return (
    <span aria-hidden className="relative inline-flex items-center">
      <span className="text-[1rem] tracking-[0.05em] text-[var(--lp-ink)]/20">
        ★★★★★
      </span>
      <span
        className="absolute inset-y-0 left-0 overflow-hidden text-[1rem] tracking-[0.05em] text-[var(--lp-red)]"
        style={{ width: `${(filled / 5) * 100}%` }}
      >
        ★★★★★
      </span>
    </span>
  );
}

export function HeroSection({ review }: { review?: ReviewAggregate } = {}) {
  const showRating =
    !!review && review.reviewCount >= 5 && review.ratingValue >= 1;

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
            {/* Eyebrow — small caps tag that frames the H1 instead of
                starting cold. All claims here are panel-verified. */}
            <p
              data-reveal="1"
              className="lp-label flex items-center gap-2 text-[0.78rem] uppercase tracking-[0.18em] text-[var(--lp-ink)]/80"
            >
              <span aria-hidden className="lp-star-ornament h-[10px] w-[10px] text-[var(--lp-red)]" />
              <span>Dye-Free</span>
              <span aria-hidden className="opacity-50">·</span>
              <span>Made in the U.S.A.</span>
            </p>

            <h1
              data-reveal="2"
              className="lp-display mt-3 text-[clamp(2.8rem,9.5vw,6rem)] text-[var(--lp-ink)]"
            >
              <span className="block">All American</span>
              <span className="block text-[var(--lp-red)]">Gummy Bears.</span>
            </h1>

            {/* Star-rating row — only renders when real review data is
                present. ratingValue + reviewCount come from
                getReviewAggregate(); no fabricated numbers. */}
            {showRating && (
              <div
                data-reveal="3"
                className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1"
              >
                <StarRow value={review!.ratingValue} />
                <span className="lp-sans text-[0.95rem] text-[var(--lp-ink)]/85">
                  <span className="font-semibold text-[var(--lp-ink)]">
                    {review!.ratingValue.toFixed(1)}
                  </span>{" "}
                  · {review!.reviewCount.toLocaleString()} customer
                  {review!.reviewCount === 1 ? "" : "s"}
                </span>
              </div>
            )}

            <p
              data-reveal="3"
              className="lp-sans mt-5 max-w-[32ch] text-[1.1rem] leading-[1.5] text-[var(--lp-ink)]/85 sm:text-[1.2rem]"
            >
              Real gummy bears. Five natural flavors.{" "}
              <span className="font-bold text-[var(--lp-red)]">
                No artificial dyes.
              </span>
            </p>

            {/* Flavor strip — five real bears for visual proof of the
                "Five natural flavors" claim. Same canonical mapping as
                ThreePromises (pink → Cherry, red → Watermelon — the
                file names were mislabeled before the rebuild). */}
            <ul
              data-reveal="4"
              aria-label="Five natural flavors"
              className="mt-6 flex flex-wrap items-end gap-x-4 gap-y-3 sm:gap-x-5"
            >
              {FLAVORS.map((f) => (
                <li
                  key={f.label}
                  className="group flex flex-col items-center gap-1.5"
                >
                  <span className="relative block h-[44px] w-[44px] sm:h-[52px] sm:w-[52px]">
                    <Image
                      src={f.src}
                      alt={`${f.label} gummy bear`}
                      fill
                      sizes="52px"
                      className="object-contain drop-shadow-[2px_2px_0_var(--lp-red)] transition-transform duration-200 group-hover:-translate-y-0.5"
                    />
                  </span>
                  <span className="lp-label text-[0.7rem] uppercase tracking-[0.14em] text-[var(--lp-ink)]/80">
                    {f.label}
                  </span>
                </li>
              ))}
            </ul>

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
              column above. Bumped max-width 360 → 480 on 2026-04-26
              per Ben's audit ("really lacking some design") to fill
              the cream void on the desktop fold. */}
          <div className="relative hidden flex-col items-end gap-5 md:flex">
            <figure
              data-reveal="3"
              className="relative w-full max-w-[480px] overflow-hidden border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)]"
              style={{ boxShadow: "8px 8px 0 var(--lp-red)" }}
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
                  sizes="(max-width: 1200px) 45vw, 480px"
                  className="object-contain p-3"
                />
              </div>
            </figure>

            <div
              data-reveal="3"
              className="relative w-full max-w-[480px] rounded-sm border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-4 shadow-[6px_6px_0_var(--lp-red)] sm:p-6"
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
