// Hero v3 (2026-04-28) — MOBILE-FIRST RESTRUCTURE. Clarity data 4/28
// showed 99.5% bounce on mobile because:
//   - 540px of empty space + 96px H1 ate the entire viewport
//   - Product image was 360x360 square (off-fold)
//   - ATC button at y=1140 (~700px BELOW the iPhone fold)
//   - 281 link clicks → 202 LPVs → 1 view_content → 0 ATC
// Fix: compressed mobile image (200-260px tall, not square), smaller H1
// font, and the BagSlider buy widget MOVED right after the H1 so the
// price + ATC are visible in the first viewport on mobile. Description,
// flavor strip, and trust row pushed below the fold on mobile (still
// above the fold on desktop). Desktop layout unchanged.
//
// Hero v2 (2026-04-26) — earlier rev. Eyebrow, star-rating, flavor
// strip, and bigger product image to fill the cream void Ben flagged on
// desktop. Copy verified-only: wordmark, "Made in the U.S.A." (on bag),
// "Five natural flavors" (panel), "No artificial dyes" (panel).

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
        {/* Top padding compressed on mobile (pt-4) to remove the 540px
            empty space that was eating the entire mobile viewport.
            Desktop padding unchanged (md:pt-18). */}
        <div className="relative mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-5 px-5 pb-10 pt-4 sm:gap-7 sm:px-8 sm:pb-16 sm:pt-10 md:grid-cols-[1.05fr_1fr] md:gap-12 md:pb-20 md:pt-18">
          {/* MOBILE-ONLY product photo — must be FIRST in DOM order on
              mobile (-order-1 in single-column grid). Height-capped
              200/260px (was 360x360 square) so it doesn't eat the
              fold. Sits BEFORE the copy column. */}
          <figure
            className="relative -order-1 mx-auto w-full max-w-[260px] overflow-hidden border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] sm:max-w-[320px] md:hidden"
            style={{ boxShadow: "6px 6px 0 var(--lp-red)" }}
          >
            <div className="relative h-[200px] w-full sm:h-[240px]">
              <Image
                src="/brand/hero-pack-icon.png"
                alt="USA Gummies — All American Gummy Bears 7.5 oz bag"
                fill
                priority
                sizes="(max-width: 640px) 260px, 320px"
                className="object-contain p-2"
              />
            </div>
          </figure>

          {/* Copy column */}
          <div className="relative">
            {/* Eyebrow — small caps tag */}
            <p
              data-reveal="1"
              className="lp-label flex items-center gap-2 text-[0.72rem] uppercase tracking-[0.16em] text-[var(--lp-ink)]/80 sm:text-[0.78rem] sm:tracking-[0.18em]"
            >
              <span aria-hidden className="lp-star-ornament h-[10px] w-[10px] text-[var(--lp-red)]" />
              <span>Dye-Free</span>
              <span aria-hidden className="opacity-50">·</span>
              <span>Made in the U.S.A.</span>
            </p>

            {/* H1 — smaller mobile font (clamp 1.85rem) so it fits 1
                line height + still reads large. Desktop unchanged. */}
            <h1
              data-reveal="2"
              className="lp-display mt-2 text-[clamp(1.85rem,7vw,6rem)] leading-[1.05] text-[var(--lp-ink)] md:mt-3"
            >
              <span className="block">All American</span>
              <span className="block text-[var(--lp-red)]">Gummy Bears.</span>
            </h1>

            {/* Star-rating row — renders only when real review data is present */}
            {showRating && (
              <div
                data-reveal="3"
                className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 md:mt-4"
              >
                <StarRow value={review!.ratingValue} />
                <span className="lp-sans text-[0.9rem] text-[var(--lp-ink)]/85 sm:text-[0.95rem]">
                  <span className="font-semibold text-[var(--lp-ink)]">
                    {review!.ratingValue.toFixed(1)}
                  </span>{" "}
                  · {review!.reviewCount.toLocaleString()} customer
                  {review!.reviewCount === 1 ? "" : "s"}
                </span>
              </div>
            )}

            {/* MOBILE BAG SLIDER — moved here (right after H1) so the
                price + qty + ATC button are in the first viewport on
                mobile. Was previously ~700px below this position. */}
            <div
              data-reveal="3"
              className="relative mt-4 rounded-sm border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-3 shadow-[6px_6px_0_var(--lp-red)] sm:p-5 md:hidden"
            >
              <BagSlider variant="full" defaultQty={5} />
            </div>

            {/* DESCRIPTION — pushed below the buy widget on mobile.
                On desktop, sits in normal flow (Bag slider on desktop
                lives in the right column, so this stays under H1). */}
            <p
              data-reveal="3"
              className="lp-sans mt-6 max-w-[32ch] text-[1.05rem] leading-[1.5] text-[var(--lp-ink)]/85 sm:text-[1.2rem]"
            >
              Real gummy bears. Five natural flavors.{" "}
              <span className="font-bold text-[var(--lp-red)]">
                No artificial dyes.
              </span>
            </p>

            {/* Flavor strip — five real bears (below fold on mobile) */}
            <ul
              data-reveal="4"
              aria-label="Five natural flavors"
              className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-3 sm:mt-6 sm:gap-x-5"
            >
              {FLAVORS.map((f) => (
                <li
                  key={f.label}
                  className="group flex flex-col items-center gap-1.5"
                >
                  <span className="relative block h-[40px] w-[40px] sm:h-[52px] sm:w-[52px]">
                    <Image
                      src={f.src}
                      alt={`${f.label} gummy bear`}
                      fill
                      sizes="52px"
                      className="object-contain drop-shadow-[2px_2px_0_var(--lp-red)] transition-transform duration-200 group-hover:-translate-y-0.5"
                    />
                  </span>
                  <span className="lp-label text-[0.65rem] uppercase tracking-[0.12em] text-[var(--lp-ink)]/80 sm:text-[0.7rem] sm:tracking-[0.14em]">
                    {f.label}
                  </span>
                </li>
              ))}
            </ul>

            {/* Trust row — bag claims (below fold on mobile) */}
            <ul
              data-reveal="4"
              className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 sm:mt-6"
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

          {/* Desktop product hero column — unchanged, only renders ≥md */}
          <div className="relative hidden flex-col items-end gap-5 md:flex">
            <figure
              data-reveal="3"
              className="relative w-full max-w-[480px] overflow-hidden border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)]"
              style={{ boxShadow: "8px 8px 0 var(--lp-red)" }}
            >
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
        </div>

        <div className="lp-bunting-thin" aria-hidden />
      </div>
    </section>
  );
}
