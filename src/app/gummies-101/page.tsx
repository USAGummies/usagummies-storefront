// /gummies-101 — quick-reference brand primer in LP design language.
// Structure: PageHero → ScarcityBar → Quick Facts grid → Flavor Lineup
// → FAQ accordion → bottom CTA. Article + FAQ JSON-LD preserved for SEO.

import type { Metadata } from "next";
import Link from "next/link";

import { PageHero } from "@/components/lp/PageHero";
import { ScarcityBar } from "@/components/lp/ScarcityBar";
import { GuaranteeBlock } from "@/components/lp/GuaranteeBlock";

import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { LatestFromBlog } from "@/components/blog/LatestFromBlog";

function resolveSiteUrl() {
  const preferred = "https://www.usagummies.com";
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || null;
  const nodeEnv = (process.env.NODE_ENV as string | undefined) || "";
  if (fromEnv && fromEnv.includes("usagummies.com")) return fromEnv.replace(/\/$/, "");
  if (nodeEnv === "production") return preferred;
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : null;
  if (vercel) return vercel;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (nodeEnv !== "production") return "http://localhost:3000";
  return preferred;
}

const SITE_URL = resolveSiteUrl();
const PAGE_TITLE = "Gummies 101 | Dye-Free Gummies Guide";
const PAGE_DESCRIPTION =
  "Learn about gummy ingredients, textures, and flavors, plus why we skip artificial dyes in our made in USA candy.";
const PAGE_URL = `${SITE_URL}/gummies-101`;
const OG_IMAGE = `${SITE_URL}/opengraph-image`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: PAGE_URL,
    type: "article",
    images: [{ url: OG_IMAGE }],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [OG_IMAGE],
  },
};

const QUICK_FACTS = [
  "Made in the USA",
  "No artificial dyes",
  "All natural flavors",
  "7.5 oz bag",
  "Ships within 24 hours",
  FREE_SHIPPING_PHRASE,
  "Bundles start at 5 bags",
];

const FAQS = [
  {
    question: "Are USA Gummies made in the USA?",
    answer:
      "Yes. USA Gummies are sourced, made, and packed in the USA at FDA-registered facilities.",
  },
  {
    question: "Do USA Gummies use artificial dyes?",
    answer:
      "No. Colors come from fruit and vegetable extracts. No artificial dyes or synthetic colors.",
  },
  {
    question: "What flavors are in each bag?",
    answer:
      "Cherry, watermelon, orange, green apple, and lemon.",
  },
  {
    question: "Where should I buy 1-4 bags?",
    answer:
      "For small orders, Amazon is the fastest option. On-site bundles start at 5 bags with free shipping.",
  },
  {
    question: "How does bundle pricing work?",
    answer:
      "Savings start at 5 bags, free shipping begins at 5+ bags, and the best per-bag price is at 12 bags.",
  },
  {
    question: "What is America's 250th?",
    answer:
      "America's 250th is a USA Gummies hub for patriotic gifts, events, and limited drops tied to America's 250th.",
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

export default function Gummies101Page() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Gummies 101", href: "/gummies-101" },
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <PageHero
        eyebrow="USA Gummies Facts"
        headline="Gummies"
        scriptAccent="101."
        sub="The quick reference for buyers, gift planners, and America's 250th supporters."
        ctas={[
          { href: "/shop", label: "Shop bundles", variant: "primary" },
          { href: "/ingredients", label: "See ingredients", variant: "light" },
        ]}
      />

      <ScarcityBar />

      {/* Quick Facts grid */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Quick Facts ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Everything you need
              <br />
              <span className="lp-script text-[var(--lp-red)]">in one glance.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {QUICK_FACTS.map((fact, i) => (
              <div
                key={fact}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] px-5 py-4 text-center"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <span className="lp-display text-[1.15rem] text-[var(--lp-ink)]">{fact}</span>
              </div>
            ))}
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link href="/shop" className="lp-cta">
              Shop bundles
            </Link>
            <Link href="/gummy-gift-bundles" className="lp-cta lp-cta-light">
              Gift bundles
            </Link>
            <Link href="/america-250" className="lp-cta lp-cta-light">
              America's 250th
            </Link>
          </div>
        </div>
      </section>

      {/* Flavor Lineup */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1000px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-8 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Flavor Lineup ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              What you&rsquo;re
              <br />
              <span className="lp-script text-[var(--lp-red)]">getting.</span>
            </h2>
          </div>
          <div className="lp-sans text-center text-[1.05rem] leading-[1.7] text-[var(--lp-ink)]/88">
            <p className="mx-auto max-w-[60ch]">
              Cherry, watermelon, orange, green apple, and lemon — classic gummy bear flavor without
              artificial dyes. Clean ingredient list, made in the USA, packed for gifting or bulk
              orders.
            </p>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/ingredients" className="lp-cta lp-cta-light">
              See ingredients
            </Link>
            <Link href="/no-artificial-dyes-gummy-bears" className="lp-cta lp-cta-light">
              Red 40 Free Gummies
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[820px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-8 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Frequently Asked ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              The short
              <br />
              <span className="lp-script text-[var(--lp-red)]">answers.</span>
            </h2>
          </div>
          <div className="mt-4">
            {FAQS.map((item) => (
              <details key={item.question} className="lp-faq">
                <summary>{item.question}</summary>
                <div>{item.answer}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <GuaranteeBlock />

      <section className="bg-transparent">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <LatestFromBlog />
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Ready When You Are ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            Pick your
            <br />
            <span className="lp-script text-[var(--lp-red)]">bundle.</span>
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop" className="lp-cta">
              Shop best value
            </Link>
            <Link href="/ingredients" className="lp-cta lp-cta-light">
              See ingredients
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
