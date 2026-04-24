// Hero — the entire sales pitch in 375×667.
// Layout priorities (top to bottom on mobile):
//   1. Batch line + 4.8★ (tiny, builds authority instantly)
//   2. Monumental headline
//   3. One editorial sub-line
//   4. Product photograph (right-aligned, overlapping stamp)
//   5. Price + "free shipping on 5+"
//   6. CTA
//   7. Trust row — made in USA · no dyes · ships in 24h

import Image from "next/image";
import Link from "next/link";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      {/* Top meta strip — batch + stars */}
      <div className="relative border-b border-[var(--lp-rule)]">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 px-5 py-2.5 sm:px-8">
          <span className="lp-mono text-[0.65rem] sm:text-[0.7rem]">
            Batch №1402 · Spokane, WA · 10 / 14 / 2027
          </span>
          <span className="lp-mono flex items-center gap-1.5 text-[0.65rem] sm:text-[0.7rem]">
            <span aria-hidden className="tracking-[0.3em] text-[var(--lp-blood)]">★★★★★</span>
            <span>4.8 · 219 reviews</span>
          </span>
        </div>
      </div>

      {/* Hero body */}
      <div className="relative mx-auto grid max-w-[1200px] grid-cols-1 gap-6 px-5 pb-10 pt-8 sm:px-8 sm:pb-16 sm:pt-14 md:grid-cols-[1.1fr_1fr] md:gap-12 md:pb-24 md:pt-20">
        {/* Left column — type does the work */}
        <div className="relative">
          <p
            data-reveal="1"
            className="lp-mono text-[var(--lp-blood)]"
          >
            Dye-Free Since 2025
          </p>

          <h1
            data-reveal="2"
            className="lp-display lp-letterpress mt-3 text-[clamp(3.2rem,11vw,7.75rem)]"
          >
            Real
            <br />
            <span className="text-[var(--lp-blood)]">Gummy</span>
            <br />
            Bears.
          </h1>

          <p
            data-reveal="3"
            className="lp-editorial mt-5 max-w-[28ch] text-[1.25rem] leading-[1.45] text-[var(--lp-ink)]/90 sm:text-[1.45rem]"
          >
            Made in America.{" "}
            <span className="text-[var(--lp-blood)]">Colored by fruit.</span>{" "}
            No Red 40, ever.
          </p>

          {/* Price + CTA block */}
          <div data-reveal="4" className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/go/checkout?qty=1&utm_source=lp&utm_medium=hero"
              className="lp-cta"
              aria-label="Order one 7.5 oz bag for $5.99"
            >
              Order a bag — $5.99
            </Link>
            <p className="lp-mono text-[var(--lp-ink)]/70">
              Free shipping on orders 5+
            </p>
          </div>

          {/* Trust row */}
          <ul
            data-reveal="5"
            className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--lp-rule)] pt-5 text-sm"
          >
            <li className="lp-mono flex items-center gap-2 text-[var(--lp-ink)]">
              <svg aria-hidden viewBox="0 0 24 24" className="h-[14px] w-[14px]" fill="none">
                <path
                  d="M4 8 L12 4 L20 8 L20 16 L12 20 L4 16 Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </svg>
              Made in USA
            </li>
            <li className="lp-mono flex items-center gap-2">
              <svg aria-hidden viewBox="0 0 24 24" className="h-[14px] w-[14px]" fill="none">
                <path
                  d="M5 19 L19 5 M5 5 L19 19"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
              No Artificial Dyes
            </li>
            <li className="lp-mono flex items-center gap-2">
              <svg aria-hidden viewBox="0 0 24 24" className="h-[14px] w-[14px]" fill="none">
                <path
                  d="M4 12 L10 18 L20 6"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Ships in 24 Hrs
            </li>
          </ul>
        </div>

        {/* Right column — product photo with overlapping stamp badge */}
        <div
          data-reveal="3"
          className="relative mx-auto w-full max-w-[420px] md:max-w-none"
        >
          <div className="relative aspect-[4/5] w-full">
            {/* Halftone backdrop panel */}
            <div
              aria-hidden
              className="lp-halftone absolute inset-[6%] -z-0 rounded-[2px]"
            />
            {/* Blood-red rectangle behind photo for the "printed poster" effect */}
            <div
              aria-hidden
              className="absolute left-[8%] top-[6%] bottom-[6%] right-[28%] -z-0 bg-[var(--lp-blood)]"
            />
            <Image
              src="/brand/americana/bag-dramatic-smoke.jpg"
              alt="USA Gummies All American Gummy Bears — 7.5 oz bag"
              fill
              priority
              sizes="(max-width: 768px) 88vw, 520px"
              className="object-contain drop-shadow-[4px_4px_0_rgba(15,13,11,0.95)]"
            />
            {/* Corner stamp — not rotated INTO the photo, it's bolted to the top-right of the frame */}
            <div className="absolute right-0 top-0 translate-x-2 -translate-y-3 md:translate-x-4 md:-translate-y-4">
              <div className="lp-stamp">
                <span>No.&nbsp;1402</span>
              </div>
            </div>
            {/* Price tag — old-school hang tag in the bottom-left */}
            <div className="absolute -bottom-2 left-0 -translate-x-1 rotate-[-6deg] bg-[var(--lp-cream-soft)] px-3 py-2 shadow-[3px_3px_0_rgba(15,13,11,0.9)]">
              <span className="lp-mono block text-[0.55rem] text-[var(--lp-ink)]/70">
                net 7.5 oz
              </span>
              <span className="lp-display block text-[1.25rem] leading-none">
                $5.99
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Decorative monumental rule */}
      <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
        <hr className="lp-rule" />
      </div>
    </section>
  );
}
