// Three promises — tied directly to the bag panel. Everything here
// appears on the product itself (the bag or the ingredient statement),
// so no new unverified claims.

import Image from "next/image";

const PROMISES = [
  {
    n: "01",
    icon: "/brand/gummies/gummy-red.png",
    title: "No Artificial Dyes.",
    // Paraphrasing the ingredient panel on the bag.
    body: "Colors come from fruits, vegetables, spirulina, and curcumin — the only coloring ingredients on the panel. Not one dye on the label.",
  },
  {
    n: "02",
    icon: "/brand/gummies/gummy-yellow.png",
    title: "Made in the U.S.A.",
    // Exact wording from the bag back panel.
    body: "Sourced, made, and packed right here in the U.S.A. Backing American jobs and American business with every bag.",
  },
  {
    n: "03",
    icon: "/brand/gummies/gummy-green.png",
    title: "Five Natural Flavors.",
    // Flavor list is printed on the bag's "5 All Natural Flavors" strip.
    body: "Cherry, Lemon, Green Apple, Orange, Watermelon. The five classics in a 7.5 oz bag.",
  },
] as const;

export function ThreePromises() {
  return (
    <section className="relative border-y-2 border-[var(--lp-ink)] bg-[var(--lp-cream-soft)]">
      <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
        <div className="mb-10 flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="lp-label mb-2 text-[var(--lp-red)]">What&rsquo;s On the Bag</p>
            <h2 className="lp-display text-[clamp(2.2rem,6vw,3.75rem)] text-[var(--lp-ink)]">
              Straight from
              <br />
              <span className="lp-script text-[1.1em] text-[var(--lp-red)]">
                the label.
              </span>
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 sm:gap-7">
          {PROMISES.map((p) => (
            <div
              key={p.n}
              className="relative border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
              style={{ boxShadow: "5px 5px 0 var(--lp-ink)" }}
            >
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

        {/* Five flavor line-up — each bear character is verified bag art */}
        <div className="mt-12 rounded-sm border-2 border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5 sm:mt-16 sm:p-7">
          <p className="lp-label mb-5 text-center text-[var(--lp-red)]">
            ★ ★ ★ Five Natural Flavors ★ ★ ★
          </p>
          {/* Image-file note: `gummy-red.png` is actually the pink/raspberry
           * bear (Watermelon) and `gummy-pink.png` is the dark wine-red
           * bear (Cherry). The file names predate this rebuild and were
           * mislabeled — Cherry/Watermelon mappings here match the actual
           * pixel colors so the brand reads correctly on the page. */}
          <div className="flex flex-wrap items-start justify-center gap-x-2 gap-y-5 sm:flex-nowrap sm:gap-2">
            {[
              { src: "/brand/gummies/gummy-pink.png", label: "Cherry" },
              { src: "/brand/gummies/gummy-yellow.png", label: "Lemon" },
              { src: "/brand/gummies/gummy-green.png", label: "Green Apple" },
              { src: "/brand/gummies/gummy-orange.png", label: "Orange" },
              { src: "/brand/gummies/gummy-red.png", label: "Watermelon" },
            ].map((g) => (
              <figure
                key={g.label}
                /* Mobile: 30% width (3 per row, 5 items wrap to 3+2 with the
                 * second row centered by `justify-center` on the parent).
                 * Desktop: flex-1 distributes all 5 evenly on one row. */
                className="flex w-[30%] flex-col items-center gap-2 sm:w-auto sm:flex-1"
              >
                <div className="relative h-14 w-14 sm:h-20 sm:w-20">
                  <Image
                    src={g.src}
                    alt={g.label}
                    fill
                    sizes="80px"
                    className="object-contain drop-shadow-[2px_3px_0_rgba(14,22,56,0.6)]"
                  />
                </div>
                {/* Mobile: tighter tracking + smaller font + leading-tight
                 * so two-word labels ("Green Apple") wrap cleanly to 2
                 * lines and one-word labels ("Watermelon") stay on a
                 * single line within the 30%-wide cell. */}
                <figcaption className="text-center text-[0.58rem] font-bold uppercase leading-tight tracking-[0.06em] text-[var(--lp-ink)] sm:text-[0.7rem] sm:tracking-[0.14em]">
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
