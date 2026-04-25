// Manifesto block — replaces the fabricated founder's letter. All copy
// is paraphrased or lifted directly from the bag's back panel ("Land of
// the Free, Home of the Brave / sourced, made, and packed right here
// in the USA / symbol of strength, grit... / backing American jobs...").
// No location reveals, no invented personal narrative. When Ben wants
// to write a real founder note, drop it in where the <article> is.

import Image from "next/image";

export function FoundersLetter() {
  return (
    <section className="relative">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-10 px-5 py-16 sm:px-8 sm:py-24 md:grid-cols-[1fr_1.25fr] md:gap-16">
        {/* Scene column — billboard is naturally panoramic (~2:1), so
            the card aspect matches the asset instead of cropping
            severely (Ben's audit: "the format of the other images are
            incorrect"). object-contain with a cream backdrop preserves
            the full billboard composition. */}
        <div className="relative order-2 md:order-1">
          <div
            className="relative aspect-[16/9] w-full overflow-hidden border-[3px] border-[var(--lp-ink)] bg-[var(--lp-cream)]"
            style={{ boxShadow: "8px 8px 0 var(--lp-red)" }}
          >
            <Image
              src="/brand/billboards/founders.jpg"
              alt="USA Gummies Founders billboard"
              fill
              sizes="(max-width: 768px) 88vw, 540px"
              className="object-contain"
            />
          </div>
        </div>

        {/* Manifesto column — every line is on the bag */}
        <article className="order-1 md:order-2">
          <p className="lp-label text-[var(--lp-red)]">
            Land of the Free, Home of the Brave
          </p>
          <h2 className="lp-display mt-3 text-[clamp(2.2rem,5.5vw,3.6rem)] text-[var(--lp-ink)]">
            Sourced, made
            <br />
            <span className="lp-script text-[var(--lp-red)]">&amp; packed</span>
            <br />
            right here in
            <br />
            <span className="text-[var(--lp-red)]">the U.S.A.</span>
          </h2>
          <div className="lp-sans mt-6 space-y-4 text-[1.05rem] font-normal leading-[1.75] text-[var(--lp-ink)]/88">
            <p>
              A symbol of strength, grit, and the unstoppable American
              spirit — in a resealable 7.5 oz bag.
            </p>
            <p>
              When you choose USA Gummies, you&rsquo;re backing American
              jobs, American business, and the star-spangled pursuit of
              greatness.
            </p>
            <p className="lp-display text-[1.35rem] text-[var(--lp-red)]">
              Join the revolution.
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}
