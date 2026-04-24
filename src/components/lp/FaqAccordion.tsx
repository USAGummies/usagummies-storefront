"use client";

// FAQ — native <details> elements, zero client JS needed for basic
// interaction. "use client" only to silence any future hydration work.

const FAQ = [
  {
    q: "What are they colored with, if not artificial dyes?",
    a: "Real fruit and vegetable extract — black carrot, turmeric, apple, pumpkin, and spirulina — depending on the color. The colors are a little softer than a Red 40 bear, and we think that's a feature, not a bug.",
  },
  {
    q: "How are they made, and where?",
    a: "Pressed and packaged in an FDA-registered confectionery in Spokane, Washington. Every batch gets a lot number (see your bag), which ties to a specific production run and best-by date — roughly 18 months out from press.",
  },
  {
    q: "Are they gluten-free? Peanut-free?",
    a: "Yes to both. Gluten-free and produced in a facility that does not handle peanuts or tree nuts. Full ingredient panel on every bag.",
  },
  {
    q: "How fast do orders ship?",
    a: "Within 24 hours on weekdays, directly from our warehouse in Ashford, WA. Standard ground is 3–5 days nationwide. Free on orders of 5 bags or more.",
  },
  {
    q: "Do you ship wholesale?",
    a: "Yes — 50 bags and up at wholesale pricing, available through Faire or by emailing ben@usagummies.com. We supply several independent grocers, museum gift shops, and souvenir stores.",
  },
  {
    q: "Refund policy?",
    a: "Eat the bag. If you don't love it, reply to your order email within 30 days and we'll refund you. No questionnaires, no return shipping hoops.",
  },
];

export function FaqAccordion() {
  return (
    <section className="relative">
      <div className="mx-auto max-w-[820px] px-5 py-16 sm:px-8 sm:py-24">
        <p className="lp-mono mb-3 text-[var(--lp-blood)]">Questions We Get</p>
        <h2 className="lp-display text-[clamp(2rem,5vw,3.4rem)] leading-[0.95]">
          Everything you&rsquo;d
          <br />
          <span className="italic lp-editorial text-[var(--lp-blood)]">
            actually ask.
          </span>
        </h2>

        <div className="mt-10">
          {FAQ.map((f, i) => (
            <details key={i} className="lp-faq" open={i === 0 ? undefined : undefined}>
              <summary>{f.q}</summary>
              <div>{f.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
