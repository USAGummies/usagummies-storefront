// Three promises — the "why this is different" in one scrollable viewport.
// Each card is monumental numerals + a tight claim. Keeps copy under 12 words.

import Image from "next/image";

const PROMISES = [
  {
    n: "01",
    title: "No dyes. None.",
    body: "Colored with real fruit and vegetable extract. If a gummy needs Red 40 to look like candy, it isn't candy we'll eat.",
  },
  {
    n: "02",
    title: "Made in America.",
    body: "Pressed in Spokane, Washington in an FDA-registered facility. Packaged by hand. Shipped from one warehouse at the foot of Mt. Rainier.",
  },
  {
    n: "03",
    title: "Real gummy bear flavor.",
    body: "Cherry. Lemon. Green apple. Orange. Watermelon. The five classics — chewy, balanced, not overly sweet. The way they're supposed to taste.",
  },
] as const;

export function ThreePromises() {
  return (
    <section className="relative border-y border-[var(--lp-rule)]">
      <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
        <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="lp-display text-[clamp(2rem,6vw,3.75rem)]">
            The Reason
            <br />
            <span className="lp-editorial italic text-[var(--lp-blood)]">
              we bother.
            </span>
          </h2>
          <p className="lp-mono max-w-[28ch] text-[var(--lp-ink)]/70">
            Three promises. No fine print.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-0 border-t border-[var(--lp-rule)] sm:grid-cols-3">
          {PROMISES.map((p, i) => (
            <div
              key={p.n}
              className={`relative py-8 sm:py-10 ${i > 0 ? "sm:border-l sm:border-[var(--lp-rule)] sm:pl-8" : "sm:pr-8"} ${i < PROMISES.length - 1 ? "border-b border-[var(--lp-rule)] sm:border-b-0" : ""}`}
            >
              <span className="lp-display block text-[2.5rem] leading-none text-[var(--lp-blood)]">
                {p.n}
              </span>
              <h3 className="lp-display mt-3 text-[1.6rem] sm:text-[1.85rem]">
                {p.title}
              </h3>
              <p className="mt-3 max-w-[34ch] text-[1rem] leading-[1.55] text-[var(--lp-ink)]/82">
                {p.body}
              </p>
            </div>
          ))}
        </div>

        {/* Ingredient strip — five tiny gummies, in a row */}
        <div
          className="mt-14 flex items-center justify-between gap-4 border-t border-[var(--lp-rule)] pt-8"
          aria-label="Five classic flavors"
        >
          {[
            { src: "/brand/gummies/gummy-red.png", label: "Cherry" },
            { src: "/brand/gummies/gummy-yellow.png", label: "Lemon" },
            { src: "/brand/gummies/gummy-green.png", label: "Green Apple" },
            { src: "/brand/gummies/gummy-orange.png", label: "Orange" },
            { src: "/brand/gummies/gummy-pink.png", label: "Watermelon" },
          ].map((g) => (
            <figure key={g.label} className="flex flex-1 flex-col items-center gap-2">
              <div className="relative h-14 w-14 sm:h-20 sm:w-20">
                <Image
                  src={g.src}
                  alt={g.label}
                  fill
                  sizes="80px"
                  className="object-contain"
                />
              </div>
              <figcaption className="lp-mono text-center text-[0.6rem] sm:text-[0.65rem]">
                {g.label}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
