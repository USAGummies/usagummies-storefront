// Three promises — big chunky numerals, star bullets, flag stripe accents.
// Each card leans into a character element (gummy bear illustration).

import Image from "next/image";

const PROMISES = [
  {
    n: "01",
    icon: "/brand/gummies/gummy-red.png",
    title: "No Dyes. None.",
    body: "Colored with real fruit and vegetable extract. If it needs Red 40 to look like candy, it isn't candy we'll eat.",
  },
  {
    n: "02",
    icon: "/brand/gummies/gummy-yellow.png",
    title: "Made in the USA.",
    body: "Pressed in Spokane, Washington in an FDA-registered facility. Packaged by hand. Shipped from Mt. Rainier country.",
  },
  {
    n: "03",
    icon: "/brand/gummies/gummy-green.png",
    title: "Real Gummy Flavor.",
    body: "Cherry, lemon, green apple, orange, watermelon — the five classics. Chewy, balanced, not overly sweet. How they should taste.",
  },
] as const;

export function ThreePromises() {
  return (
    <section className="relative border-y-2 border-[var(--lp-ink)] bg-[var(--lp-cream-soft)]">
      <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
        <div className="mb-10 flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="lp-label mb-2 text-[var(--lp-red)]">Three Promises</p>
            <h2 className="lp-display text-[clamp(2.2rem,6vw,3.75rem)] text-[var(--lp-ink)]">
              The Reason
              <br />
              <span className="lp-script text-[1.1em] text-[var(--lp-red)]">
                we bother.
              </span>
            </h2>
          </div>
          <p className="lp-label max-w-[28ch] text-[var(--lp-ink)]/75">
            No fine print · No weird ingredients · No apology
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 sm:gap-0">
          {PROMISES.map((p, i) => (
            <div
              key={p.n}
              className={`relative bg-[var(--lp-off-white)] p-6 sm:p-8 ${
                i > 0 ? "sm:border-l-2 sm:border-[var(--lp-ink)]" : ""
              }`}
              style={{ boxShadow: i === 0 ? "4px 4px 0 var(--lp-ink)" : undefined }}
            >
              {/* Character */}
              <div className="relative mb-4 h-16 w-16">
                <Image
                  src={p.icon}
                  alt=""
                  fill
                  sizes="64px"
                  className="object-contain drop-shadow-[2px_3px_0_rgba(14,22,56,0.6)]"
                />
              </div>
              <span className="lp-display block text-[2.5rem] leading-none text-[var(--lp-red)]">
                {p.n}
              </span>
              <h3 className="lp-display mt-2 text-[1.6rem] text-[var(--lp-ink)] sm:text-[1.85rem]">
                {p.title}
              </h3>
              <p className="lp-sans mt-3 max-w-[36ch] text-[1rem] font-normal leading-[1.55] text-[var(--lp-ink)]/82">
                {p.body}
              </p>
            </div>
          ))}
        </div>

        {/* Flavor strip */}
        <div className="mt-12 rounded-sm border-2 border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5 sm:mt-16 sm:p-7">
          <p className="lp-label mb-4 text-center text-[var(--lp-red)]">
            ★ ★ ★ Five Classic Flavors ★ ★ ★
          </p>
          <div className="flex items-center justify-between gap-2">
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
                    className="object-contain drop-shadow-[2px_3px_0_rgba(14,22,56,0.6)]"
                  />
                </div>
                <figcaption className="lp-label text-center text-[0.62rem] text-[var(--lp-ink)] sm:text-[0.7rem]">
                  {g.label}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
