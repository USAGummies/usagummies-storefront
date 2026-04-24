// Reviews — "Mail Call" stamped-envelope cards.

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
    <section className="relative border-y-2 border-[var(--lp-ink)] bg-[var(--lp-cream)]">
      {/* Top bunting */}
      <div className="lp-bunting-thin" aria-hidden />
      <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
        <header className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Mail Call ★</p>
            <h2 className="lp-display text-[clamp(2.2rem,5.5vw,3.4rem)] text-[var(--lp-ink)]">
              From the
              <br />
              <span className="lp-script text-[var(--lp-red)]">kitchen table.</span>
            </h2>
          </div>
          <p className="lp-label text-[var(--lp-ink)]/75">
            4.8 / 5 · 219 Verified Reviews
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {QUOTES.map((q, i) => (
            <figure
              key={i}
              className="relative border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6"
              style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
            >
              <div
                aria-label={`${q.stars} out of 5 stars`}
                className="tracking-[0.3em] text-[var(--lp-gold)]"
              >
                {"★".repeat(q.stars)}
              </div>
              <blockquote className="lp-sans mt-4 text-[1.1rem] font-medium leading-[1.55] text-[var(--lp-ink)]">
                &ldquo;{q.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-5 border-t-2 border-[var(--lp-ink)] pt-3">
                <span className="lp-display block text-[1rem] text-[var(--lp-red)]">
                  {q.name}
                </span>
                <span className="lp-label text-[var(--lp-ink)]/60">
                  {q.where} · {q.date}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
      <div className="lp-bunting-thin" aria-hidden />
    </section>
  );
}
