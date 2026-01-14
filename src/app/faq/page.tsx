import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { AmericanDreamCallout } from "@/components/story/AmericanDreamCallout";
import { AMAZON_LISTING_URL } from "@/lib/amazon";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";

export const metadata: Metadata = {
  title: "FAQ | USA Gummies",
  description:
    "USA Gummies FAQ. Answers about All American gummy bears, ingredients, flavor notes, bundles, shipping, and Amazon availability.",
};

const FAQS = [
  {
    question: "Are USA Gummies gluten-free?",
    answer:
      "We do not make a gluten-free claim. Please review the ingredient panel on the bag or the Amazon listing for the most current allergen details. If you have sensitivities, contact us before ordering.",
  },
  {
    question: "Do your gummy bears contain artificial dyes or synthetic colors?",
    answer:
      "No. USA Gummies are made with no artificial dyes or synthetic colors, and colors come from real fruit and vegetable extracts.",
  },
  {
    question: "Where are USA Gummies made?",
    answer:
      "Our All American gummy bears are sourced, made, and packed right here in the USA.",
  },
  {
    question: "What flavors are in the bag?",
    answer:
      "Every 7.5 oz bag includes five fruit flavors: cherry, watermelon, orange, green apple, and lemon.",
  },
  {
    question: "How long do the gummies last?",
    answer:
      "Each bag is stamped with a best-by date. For the freshest chew, enjoy your gummies before that date and store them in a cool, dry place.",
  },
  {
    question: "Can I buy a single bag?",
    answer:
      "Yes. We direct 1-3 bag orders to Amazon. Bundles on our site are designed to save you more per bag.",
  },
  {
    question: "How does bundle pricing work?",
    answer:
      `Bundle pricing lowers the per-bag cost as you add more bags. Most customers choose 5, 8, or 12 bags, and ${FREE_SHIPPING_PHRASE.toLowerCase()}.`,
  },
  {
    question: "Are these the same gummy bears sold on Amazon?",
    answer:
      "Yes. USA Gummies on this site and on Amazon are the same All American gummy bears. The difference is bundle savings here and single-bag convenience on Amazon.",
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.answer,
    },
  })),
};

export default function FaqPage() {
  return (
    <main className="relative overflow-hidden bg-[var(--navy)] text-white min-h-screen home-metal">
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(circle at 12% 18%, rgba(199,54,44,0.2), transparent 45%), radial-gradient(circle at 85% 5%, rgba(255,255,255,0.08), transparent 35%)",
            opacity: 0.6,
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-10">
          <BreadcrumbJsonLd
            items={[
              { name: "Home", href: "/" },
              { name: "FAQ", href: "/faq" },
            ]}
          />

          <div className="metal-panel rounded-[36px] border border-white/12 p-6 sm:p-8 shadow-[0_32px_90px_rgba(7,12,20,0.55)]">
            <div className="space-y-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/60">
                FAQ
              </div>
              <h1 className="text-3xl font-black leading-[1.1] tracking-tight text-white sm:text-4xl lg:text-5xl">
                USA Gummies FAQ
              </h1>
              <p className="text-sm text-white/80 sm:text-base max-w-prose">
                Quick answers about our All American gummy bears, ingredients, flavor notes, bundles,
                and where to buy.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/shop" className="btn btn-red">
                  Shop bundles
                </Link>
                <a
                  href={AMAZON_LISTING_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline-white"
                >
                  Buy 1-3 bags on Amazon
                </a>
                <span className="text-xs text-white/70">{FREE_SHIPPING_PHRASE}</span>
              </div>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {FAQS.map((item) => (
                <div
                  key={item.question}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="text-sm font-semibold text-white">{item.question}</div>
                  <div className="mt-2 text-sm text-white/75">{item.answer}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <AmericanDreamCallout variant="compact" ctaHref="/shop" ctaLabel="Shop bundles" />
          </div>

          <div className="mt-6 metal-panel rounded-[32px] border border-white/12 p-5 sm:p-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">
              Still have questions?
            </div>
            <h2 className="mt-2 text-2xl font-black text-white">We are here to help.</h2>
            <p className="mt-2 text-sm text-white/75">
              Need ingredient details or order help? Send a note and we will respond within one
              business day.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Link href="/contact" className="btn btn-outline-white">
                Contact support
              </Link>
              <Link href="/about" className="btn btn-red">
                Learn our story
              </Link>
            </div>
          </div>
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
    </main>
  );
}
