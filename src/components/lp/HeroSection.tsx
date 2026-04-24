// Hero — patriotic, bold, character-led.
// Mobile (375×667) layout: bunting → wordmark strip → ribbon → chunky
// headline → script subline → bag art with flying gummy bears →
// big red CTA → 3-item trust row. Everything above the fold.

import Image from "next/image";
import Link from "next/link";

const GUMMIES = [
  { src: "/brand/gummies/gummy-red.png",    alt: "Cherry",      top: "6%",     left: "-4%",  size: 72, rot: -14 },
  { src: "/brand/gummies/gummy-yellow.png", alt: "Lemon",       top: "2%",     right: "-6%", size: 84, rot: 18 },
  { src: "/brand/gummies/gummy-green.png",  alt: "Green apple", bottom: "22%", left: "-8%",  size: 68, rot: 22 },
  { src: "/brand/gummies/gummy-orange.png", alt: "Orange",      bottom: "8%",  right: "-2%", size: 76, rot: -10 },
  { src: "/brand/gummies/gummy-pink.png",   alt: "Watermelon",  top: "48%",    right: "4%",  size: 56, rot: 8 },
];

export function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      <div className="lp-bunting" aria-hidden />

      {/* Navy starfield header strip — wordmark + ★ rating */}
      <div className="lp-starfield relative">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 px-5 py-2.5 sm:px-8">
          <span className="lp-display text-[1.15rem] tracking-[0.04em] sm:text-[1.3rem]">
            USA <span className="text-[var(--lp-red)]">★</span> Gummies
          </span>
          <span className="lp-label flex items-center gap-1.5 text-[var(--lp-gold)]">
            <span aria-hidden className="tracking-[0.2em]">★★★★★</span>
            <span className="hidden sm:inline">4.8 · 219 Reviews</span>
            <span className="sm:hidden">4.8★</span>
          </span>
        </div>
      </div>

      <div className="relative overflow-hidden">
        {/* Soft meadow backdrop — adds depth without shouting */}
        <div aria-hidden className="absolute inset-0 -z-10">
          <Image
            src="/brand/brand-scenes/home-bg-meadow-mountains.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-30"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[var(--lp-cream)]/70 via-[var(--lp-cream)]/60 to-[var(--lp-cream)]" />
        </div>

        <div className="relative mx-auto grid max-w-[1200px] grid-cols-1 gap-6 px-5 pb-10 pt-8 sm:px-8 sm:pb-16 sm:pt-12 md:grid-cols-[1.15fr_1fr] md:gap-10 md:pb-20 md:pt-16">
          {/* Copy column */}
          <div className="relative order-2 md:order-1">
            <div data-reveal="1" className="lp-ribbon mb-5">
              Dye-Free · Since 2025
            </div>

            <h1
              data-reveal="2"
              className="lp-display text-[clamp(3rem,10.5vw,6.8rem)] text-[var(--lp-ink)]"
            >
              <span className="block">All American</span>
              <span className="block text-[var(--lp-red)]">Gummy Bears.</span>
            </h1>

            <p
              data-reveal="3"
              className="lp-script mt-2 text-[clamp(1.75rem,5vw,2.5rem)] text-[var(--lp-red)]"
            >
              Made in the U.S.A.
            </p>

            <p
              data-reveal="3"
              className="lp-sans mt-5 max-w-[30ch] text-[1.1rem] leading-[1.5] text-[var(--lp-ink)]/85 sm:text-[1.25rem]"
            >
              Real gummy bears, pressed in America. Colored by fruit.{" "}
              <span className="font-bold text-[var(--lp-red)]">
                No Red 40, ever.
              </span>
            </p>

            <div data-reveal="4" className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-center">
              <Link
                href="/go/checkout?qty=1&utm_source=lp&utm_medium=hero"
                className="lp-cta"
                aria-label="Order one 7.5 oz bag for $5.99"
              >
                Order a Bag · $5.99
              </Link>
              <p className="lp-label text-[var(--lp-ink)]/70">
                Free shipping on 5+ · Ships in 24 hrs
              </p>
            </div>

            <ul
              data-reveal="5"
              className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 border-t-2 border-[var(--lp-ink)] pt-5"
            >
              {["Made in the USA", "No Artificial Dyes", "Ships in 24 Hrs"].map((t) => (
                <li key={t} className="lp-label flex items-center gap-2 text-[var(--lp-ink)]">
                  <span aria-hidden className="lp-star-ornament h-[14px] w-[14px] text-[var(--lp-red)]" />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          {/* Bag column */}
          <div
            data-reveal="3"
            className="relative order-1 mx-auto w-full max-w-[420px] md:order-2 md:max-w-none"
          >
            <div className="relative aspect-[4/5] w-full">
              {/* Gold sunburst */}
              <div
                aria-hidden
                className="absolute inset-[4%] rounded-full"
                style={{
                  background:
                    "radial-gradient(closest-side, var(--lp-gold-light) 0%, var(--lp-gold) 45%, transparent 72%)",
                  opacity: 0.55,
                }}
              />
              {/* Red poster plate */}
              <div
                aria-hidden
                className="absolute inset-[12%] rotate-[-3deg] bg-[var(--lp-red)]"
                style={{ boxShadow: "6px 6px 0 var(--lp-ink)" }}
              />
              <Image
                src="/brand/americana/bag-dramatic-smoke.jpg"
                alt="USA Gummies All American Gummy Bears — 7.5 oz bag"
                fill
                priority
                sizes="(max-width: 768px) 88vw, 520px"
                className="relative object-contain drop-shadow-[4px_6px_0_rgba(14,22,56,0.85)]"
              />

              {/* Flying gummies */}
              {GUMMIES.map((g, i) => (
                <div
                  key={i}
                  className="lp-float absolute"
                  style={{
                    top: g.top,
                    left: g.left,
                    right: g.right,
                    bottom: g.bottom,
                    width: g.size,
                    height: g.size,
                    // @ts-expect-error CSS custom prop
                    "--r": `${g.rot}deg`,
                    transform: `rotate(${g.rot}deg)`,
                    animationDelay: `${i * 320}ms`,
                  }}
                >
                  <Image
                    src={g.src}
                    alt={g.alt}
                    width={g.size}
                    height={g.size}
                    className="drop-shadow-[2px_3px_0_rgba(14,22,56,0.7)]"
                  />
                </div>
              ))}

              {/* Price stamp bottom-left */}
              <div className="absolute -bottom-2 left-0 -translate-x-1">
                <div className="lp-stamp">
                  <span>
                    <span className="block text-[0.6rem]">Net 7.5 oz</span>
                    <span className="lp-display block text-[1.7rem] leading-none text-[var(--lp-red)]">
                      $5.99
                    </span>
                    <span className="block text-[0.58rem]">Per Bag</span>
                  </span>
                </div>
              </div>

              {/* Dye-free stamp top-right */}
              <div className="absolute right-0 top-2 translate-x-2 -translate-y-2">
                <div
                  className="lp-stamp"
                  style={{
                    transform: "rotate(10deg)",
                    color: "var(--lp-navy)",
                    width: "5.5rem",
                    height: "5.5rem",
                    fontSize: "0.65rem",
                  }}
                >
                  <span>
                    100%
                    <br />
                    Dye
                    <br />
                    Free
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lp-bunting-thin" aria-hidden />
      </div>
    </section>
  );
}
