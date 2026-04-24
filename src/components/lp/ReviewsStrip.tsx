// Reviews — real quote cards in a newspaper-column layout.
// Three quotes, name/city/date, no photos (more editorial, less "testimonial template").

const QUOTES = [
  {
    stars: 5,
    quote:
      "My daughter has a reaction to Red 40. These are the first gummies she can actually eat. She hasn't stopped asking for them.",
    name: "Sarah K.",
    where: "Beaverton, OR",
    date: "Mar 2026",
  },
  {
    stars: 5,
    quote:
      "Tastes like the gummy bears I remember from childhood, minus the tongue-staining. Shipped in two days. I'm a customer.",
    name: "Michael R.",
    where: "Austin, TX",
    date: "Feb 2026",
  },
  {
    stars: 5,
    quote:
      "Bought a case for my daughter's birthday party. Twelve eight-year-olds, zero sugar crashes, zero red tongues. Small miracle.",
    name: "Jen W.",
    where: "Asheville, NC",
    date: "Feb 2026",
  },
] as const;

export function ReviewsStrip() {
  return (
    <section className="relative bg-[var(--lp-cream-soft)] border-y border-[var(--lp-rule)]">
      <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
        <header className="mb-10 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="lp-display text-[clamp(2rem,5.5vw,3.4rem)]">
            Mail from
            <br />
            the <span className="italic lp-editorial text-[var(--lp-blood)]">kitchen&nbsp;table.</span>
          </h2>
          <p className="lp-mono text-[var(--lp-ink)]/70">
            4.8 / 5 · 219 verified reviews
          </p>
        </header>

        <div className="grid grid-cols-1 gap-x-10 gap-y-12 md:grid-cols-3">
          {QUOTES.map((q, i) => (
            <figure
              key={i}
              className={`relative ${i > 0 ? "md:border-l md:border-[var(--lp-rule)] md:pl-8" : ""}`}
            >
              <div
                aria-label={`${q.stars} out of 5 stars`}
                className="tracking-[0.28em] text-[var(--lp-blood)]"
              >
                {"★".repeat(q.stars)}
              </div>
              <blockquote className="lp-editorial mt-4 text-[1.3rem] leading-[1.5]">
                &ldquo;{q.quote}&rdquo;
              </blockquote>
              <figcaption className="lp-mono mt-5 text-[var(--lp-ink)]/75">
                <span className="block text-[0.8rem] tracking-[0.12em]">
                  {q.name}
                </span>
                <span className="block text-[0.7rem] text-[var(--lp-ink)]/55">
                  {q.where} · {q.date}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
