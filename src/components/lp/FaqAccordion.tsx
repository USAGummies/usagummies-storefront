"use client";

// FAQ — every answer here is verifiable from (a) the bag ingredient
// panel, (b) the published returns policy, or (c) the BagSlider copy
// already live on the site. No fabricated shelf-life numbers, no
// location reveals, no unverified allergen claims.

const FAQ = [
  {
    q: "How are they colored, if not with artificial dyes?",
    // Straight off the bag ingredient panel:
    // "Colors (From Fruits, Vegetables, Spirulina and Curcumin)"
    a: "Colors come from fruits, vegetables, spirulina, and curcumin. That is the entire coloring line on the ingredient panel — no artificial dyes.",
  },
  {
    q: "Where are they made?",
    // Bag back panel: "Sourced, made, and packed right here in the USA!"
    a: "Sourced, made, and packed right here in the United States of America.",
  },
  {
    q: "What are the flavors?",
    a: "Cherry, Lemon, Green Apple, Orange, and Watermelon — the five natural flavors printed on every 7.5 oz bag.",
  },
  {
    q: "How fast do orders ship?",
    // From BagSlider copy already live on the site: "Ships within 24 hours"
    a: "Within 24 hours. Standard ground is 3–5 days, free on every order.",
  },
  {
    q: "What's your return policy?",
    // Verified against /policies/returns: "30-day satisfaction guarantee"
    a: "30-day satisfaction guarantee. If you're not happy with your order, reach out and we'll make it right.",
  },
];

export function FaqAccordion() {
  return (
    <section className="relative">
      <div className="mx-auto max-w-[820px] px-5 py-16 sm:px-8 sm:py-24">
        <p className="lp-label mb-3 text-[var(--lp-red)]">★ Questions We Get ★</p>
        <h2 className="lp-display text-[clamp(2rem,5vw,3.4rem)] text-[var(--lp-ink)]">
          The short
          <br />
          <span className="lp-script text-[var(--lp-red)]">answers.</span>
        </h2>

        <div className="mt-10">
          {FAQ.map((f, i) => (
            <details key={i} className="lp-faq">
              <summary>{f.q}</summary>
              <div>{f.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
