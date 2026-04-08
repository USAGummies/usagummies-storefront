const PRODUCT_FAQS = [
  {
    question: "What flavors are included?",
    answer:
      "Every bag includes five classic flavors: Cherry, Lemon, Green Apple, Orange, and Watermelon — all colored naturally with fruit and vegetable extracts.",
  },
  {
    question: "Are these really dye-free?",
    answer:
      "Yes. USA Gummies contain zero artificial dyes or synthetic colors. All colors come from real fruit and vegetable extracts like black carrot, turmeric, and spirulina.",
  },
  {
    question: "Where are they made?",
    answer:
      "100% sourced, manufactured, and packed in the USA in FDA-registered facilities. We never outsource production overseas.",
  },
  {
    question: "How should I store them?",
    answer:
      "Keep them in a cool, dry place away from direct sunlight. Reseal the bag after opening to maintain freshness and texture.",
  },
  {
    question: "What's your return policy?",
    answer:
      "We offer a 30-day satisfaction guarantee. If you're not happy with your gummies, contact us and we'll make it right.",
  },
  {
    question: "Do you offer bulk or wholesale pricing?",
    answer:
      "Yes! Bundle pricing starts at 5 bags on our site. For larger wholesale orders, visit our wholesale page or contact us directly.",
  },
];

export default function ProductFaqAccordion() {
  return (
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
  );
}
