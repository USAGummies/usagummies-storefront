"use client";

import * as React from "react";

const FAQS = [
  {
    q: "What makes USA Gummies different from other gummy bears?",
    a: "Every bag is made in the USA in an FDA-registered facility. We use real fruit and vegetable extracts for color — zero artificial dyes. The flavors are all natural, and the texture is soft and chewy, not hard or waxy. We're a small American business, not a big candy conglomerate.",
  },
  {
    q: "How does bundle pricing work?",
    a: "The more bags you buy, the lower your per-bag price drops. A single bag is $5.99. At 5 bags you unlock free shipping. At 8 bags you save $7.73. At 12 bags you hit the best price — $4.25 per bag — and save over $20. Your selection replaces your cart, so you always see the exact total.",
  },
  {
    q: "Do you offer free shipping?",
    a: "Yes — free shipping on every order of 5 or more bags, shipped direct from us. For 1–4 bags, we send you to Amazon so you can take advantage of Prime shipping and avoid paying extra.",
  },
  {
    q: "How long does shipping take?",
    a: "Orders typically ship within 1–2 business days. Most US orders arrive in 3–5 business days. We ship via USPS Priority or UPS depending on your location.",
  },
  {
    q: "What if I don't like them?",
    a: "We stand behind every bag. If you're not happy, reach out to us and we'll make it right. Our customers consistently rate us 4.8 out of 5 stars — but your satisfaction is guaranteed.",
  },
] as const;

export default function FAQSection() {
  const [openIndex, setOpenIndex] = React.useState<number | null>(null);

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.a,
      },
    })),
  };

  return (
    <div className="mx-auto max-w-3xl">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <div className="text-center mb-6 sm:mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--muted)]/70 mb-2">
          Common questions
        </div>
        <h2 className="text-2xl font-black text-[var(--text)] sm:text-3xl">
          Got questions? We&apos;ve got answers.
        </h2>
      </div>
      <div className="divide-y divide-[rgba(15,27,45,0.08)] rounded-[20px] border border-[rgba(15,27,45,0.08)] bg-white shadow-[0_8px_24px_rgba(15,27,45,0.04)] overflow-hidden">
        {FAQS.map((faq, i) => {
          const isOpen = openIndex === i;
          return (
            <div key={i}>
              <button
                type="button"
                onClick={() => setOpenIndex(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-[rgba(15,27,45,0.02)] sm:px-6 sm:py-5"
              >
                <span className="text-[15px] font-bold text-[var(--text)] sm:text-base">
                  {faq.q}
                </span>
                <span
                  className={[
                    "shrink-0 text-[var(--muted)] transition-transform duration-200",
                    isOpen ? "rotate-180" : "",
                  ].join(" ")}
                  aria-hidden="true"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path
                      d="M5 7.5L10 12.5L15 7.5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </button>
              <div
                className={[
                  "overflow-hidden transition-all duration-200",
                  isOpen ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0",
                ].join(" ")}
              >
                <div className="px-5 pb-4 text-[14px] leading-relaxed text-[var(--muted)] sm:px-6 sm:pb-5 sm:text-[15px]">
                  {faq.a}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
