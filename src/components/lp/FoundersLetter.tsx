// Founder's letter — styled like a framed declaration / presidential address.
// Image column uses the cowboy + flag illustration on the desert background,
// pulled from the brand ARTWORK ASSETS library (same art that's on the bag).

import Image from "next/image";

export function FoundersLetter() {
  return (
    <section className="relative">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-10 px-5 py-16 sm:px-8 sm:py-24 md:grid-cols-[1fr_1.25fr] md:gap-16">
        {/* Scene column — cowboy + flag on desert */}
        <div className="relative order-2 md:order-1">
          <div
            className="relative aspect-[5/6] w-full overflow-hidden border-[3px] border-[var(--lp-ink)] bg-[var(--lp-cream)]"
            style={{ boxShadow: "8px 8px 0 var(--lp-red)" }}
          >
            <Image
              src="/brand/illustrations/background-desert.png"
              alt=""
              fill
              sizes="(max-width: 768px) 88vw, 480px"
              className="object-cover"
            />
            <div className="absolute inset-0 flex items-end justify-center">
              <div className="relative aspect-square w-[92%]">
                <Image
                  src="/brand/illustrations/cowboy.png"
                  alt="Cowboy riding with American flag"
                  fill
                  sizes="(max-width: 768px) 82vw, 420px"
                  className="object-contain drop-shadow-[4px_5px_0_rgba(14,22,56,0.45)]"
                />
              </div>
            </div>
            {/* Batch-number stamp in the corner */}
            <div className="absolute right-2 top-2 rotate-[8deg]">
              <div
                className="lp-stamp"
                style={{
                  width: "5rem",
                  height: "5rem",
                  fontSize: "0.6rem",
                  color: "var(--lp-navy)",
                }}
              >
                <span>
                  BATCH
                  <br />
                  №1402
                </span>
              </div>
            </div>
          </div>
          <p className="lp-label mt-3 text-[var(--lp-ink)]/75">
            ★ Ashford, Washington · 46°45′ N, 121°57′ W
          </p>
        </div>

        {/* Letter column */}
        <article className="order-1 md:order-2">
          <p className="lp-label text-[var(--lp-red)]">A Letter From The Founder</p>
          <h2 className="lp-display mt-3 text-[clamp(2.2rem,5.5vw,3.6rem)] text-[var(--lp-ink)]">
            We Built
            <br />
            <span className="lp-script text-[var(--lp-red)]">
              the gummy
            </span>
            <br />
            we wanted
            <br />
            our kids to eat.
          </h2>
          <div className="lp-sans mt-6 space-y-4 text-[1.05rem] font-normal leading-[1.75] text-[var(--lp-ink)]/88">
            <p>
              <span className="lp-display float-left mr-3 pt-1 text-[3.5rem] leading-[0.85] text-[var(--lp-red)]">
                I
              </span>
              grew up thinking a gummy bear was supposed to taste like Red 40
              and corn syrup. Then I had kids, turned the bag over, and
              realized the ingredient list read like a chemistry test.
            </p>
            <p>
              So we made our own. Small batches, pressed in America, colored
              by fruit and vegetable extract. No artificial dyes. No apology
              for tasting like a proper gummy bear.
            </p>
            <p>
              If the first bag doesn&rsquo;t bring you back to being seven
              years old on a porch in July, I&rsquo;ll refund it myself.
            </p>
          </div>
          <p className="mt-8">
            <span className="lp-script text-[2rem] leading-none text-[var(--lp-red)]">
              Ben Stutman
            </span>
            <br />
            <span className="lp-label mt-2 inline-block text-[var(--lp-ink)]/70">
              Founder · USA Gummies
            </span>
          </p>
        </article>
      </div>
    </section>
  );
}
