const PRODUCT_FAQS = [
  {
    question: "What flavors are in USA Gummies?",
    answer:
      "Our All American Gummy Bears come in 5 all-natural flavors: Cherry, Lemon, Green Apple, Orange, and Watermelon.",
  },
  {
    question: "Are USA Gummies dye-free?",
    answer:
      "Yes! We use fruit and vegetable extracts for color instead of artificial dyes like Red 40 or Yellow 5. No petroleum-based dyes, ever.",
  },
  {
    question: "Where are USA Gummies made?",
    answer:
      "Every bag is sourced, manufactured, and packed in the United States in FDA-registered facilities.",
  },
  {
    question: "Are USA Gummies gluten-free?",
    answer:
      "Yes, our gummy bears are gluten-free. They contain gelatin, cane sugar, corn syrup, citric acid, natural flavors, fruit and vegetable extracts, and carnauba wax.",
  },
  {
    question: "What is the 5-pack deal?",
    answer:
      "The 5-pack is $25.00 ($5.00 per bag) — that's over 15% off the single-bag retail price. Free shipping is included on every order.",
  },
  {
    question: "How should I store gummy bears?",
    answer:
      "Store in a cool, dry place. Unopened bags stay fresh for months. Once opened, seal the bag and consume within 2 weeks for best quality.",
  },
  {
    question: "Do you ship to all 50 states?",
    answer:
      "Yes! We ship to all 50 states with free shipping on every order — no minimum.",
  },
];

export default function ProductFaqAccordion() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: PRODUCT_FAQS.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <div className="divide-y divide-[var(--border,rgba(15,27,45,0.1))] rounded-2xl border border-[var(--border,rgba(15,27,45,0.1))] bg-white">
        {PRODUCT_FAQS.map((faq) => (
          <details key={faq.question} className="group">
            <summary className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4 text-sm font-bold text-[var(--text)] hover:bg-[var(--surface-strong)] transition-colors [&::-webkit-details-marker]:hidden">
              <span>{faq.question}</span>
              <span className="shrink-0 text-[var(--muted)] transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <div className="px-5 pb-4 text-sm text-[var(--muted)] leading-relaxed">
              {faq.answer}
            </div>
          </details>
        ))}
      </div>
    </>
  );
}
