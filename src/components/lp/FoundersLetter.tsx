// Founder's letter — handset letterpress feel. Gives the brand a voice.
// Uses editorial serif, drop cap, tight measure.

import Image from "next/image";

export function FoundersLetter() {
  return (
    <section className="relative">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-10 px-5 py-16 sm:px-8 sm:py-24 md:grid-cols-[1fr_1.25fr] md:gap-16">
        {/* Image column — portrait/place */}
        <div className="relative order-2 md:order-1">
          <div className="relative aspect-[4/5] w-full overflow-hidden">
            <Image
              src="/brand/lifestyle/hand-tractor.jpg"
              alt="American farmland"
              fill
              sizes="(max-width: 768px) 88vw, 480px"
              className="object-cover"
            />
            <div
              aria-hidden
              className="absolute inset-0 bg-[var(--lp-blood)] mix-blend-multiply opacity-[0.28]"
            />
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[var(--lp-ink)]/60"
            />
          </div>
          <figcaption className="lp-mono mt-3 text-[var(--lp-ink)]/70">
            Ashford, Washington · 46°45′ N, 121°57′ W
          </figcaption>
        </div>

        {/* Letter column */}
        <article className="order-1 md:order-2">
          <p className="lp-mono text-[var(--lp-blood)]">A letter from the founder</p>
          <h2 className="lp-display mt-3 text-[clamp(2.2rem,5vw,3.4rem)] leading-[0.95]">
            We built
            <br />
            <span className="italic lp-editorial text-[var(--lp-blood)]">
              the gummy
            </span>
            <br />
            we wanted
            <br />
            our kids to eat.
          </h2>
          <div className="mt-6 space-y-4 text-[1.05rem] leading-[1.7] text-[var(--lp-ink)]/85">
            <p>
              <span className="lp-display float-left mr-3 pt-1 text-[3rem] leading-[0.85] text-[var(--lp-blood)]">
                I
              </span>
              grew up thinking a gummy bear was supposed to taste like Red 40
              and corn syrup. Then I had kids, turned the bag over, and
              realized the ingredient list read like a chemistry test.
            </p>
            <p>
              So we made our own — small batches, pressed in America, colored
              by fruit and vegetable extract. No artificial dyes. No apology
              for tasting exactly like a proper gummy bear.
            </p>
            <p>
              If the first bag doesn&rsquo;t bring you back to being seven
              years old on a porch in July, I&rsquo;ll refund it myself.
            </p>
          </div>
          <p className="lp-editorial mt-8 text-[1.6rem] italic">
            — Ben Stutman,{" "}
            <span className="lp-mono text-[0.8rem] italic-none tracking-[0.14em]">
              founder, USA Gummies
            </span>
          </p>
        </article>
      </div>
    </section>
  );
}
