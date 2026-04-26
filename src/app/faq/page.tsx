// /faq — frequently asked questions in LP design language. Structure:
// PageHero → ScarcityBar → custom FAQ accordion (preserves rich answer
// nodes with internal links) → GuaranteeBlock → bottom CTA.
// FAQPage JSON-LD preserved for SEO.

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { PageHero } from "@/components/lp/PageHero";
import { ScarcityBar } from "@/components/lp/ScarcityBar";
import { GuaranteeBlock } from "@/components/lp/GuaranteeBlock";

import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { BRAND_STORY_SHORT } from "@/data/brandStory";

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
const PAGE_TITLE = "USA Gummies FAQ | Dye-Free Gummies";
const PAGE_DESCRIPTION =
  "Answers on ingredients, shipping, and orders for our made in USA candy, including dye-free gummies with no artificial dyes.";
const OG_IMAGE = "/opengraph-image";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/faq` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/faq`,
    type: "website",
    images: [{ url: OG_IMAGE }],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [OG_IMAGE],
  },
};

type FaqItem = {
  question: string;
  answer: string;
  answerText?: string;
  answerNode?: ReactNode;
};

const FAQS: FaqItem[] = [
  {
    question: "Are USA Gummies gluten-free?",
    answer:
      "We do not make a gluten-free claim. Please review the ingredient panel on the bag for the most current allergen details. If you have sensitivities, contact us before ordering.",
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
    question: "What is the USA Gummies story?",
    answer: BRAND_STORY_SHORT.join(" "),
    answerText: `${BRAND_STORY_SHORT.join("\n\n")}\n\nRead the full story`,
    answerNode: (
      <div className="space-y-2">
        {BRAND_STORY_SHORT.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <Link href="/about" className="font-semibold text-[var(--lp-red)] underline">
          Read the full story
        </Link>
      </div>
    ),
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
      "Yes. You can order 1-3 bags on our site at standard price, or save more per bag on 4+ bags.",
  },
  {
    question: "How do bag count savings work?",
    answer:
      `Savings pricing lowers the per-bag cost as you add more bags. Most customers choose 5, 8, or 12 bags, and ${FREE_SHIPPING_PHRASE.toLowerCase()}.`,
  },
  {
    question: "Which bag count should I choose?",
    answer:
      "Use our bag count guides to match the right size for gifts, patriotic parties, or bulk orders.",
    answerText:
      "Use our bag count guides to match the right size for gifts, patriotic parties, or bulk orders.",
    answerNode: (
      <>
        Use our bag count guides to match the right size for{" "}
        <Link href="/gummy-gift-bundles" className="font-semibold text-[var(--lp-red)] underline">
          gifts
        </Link>
        ,{" "}
        <Link
          href="/patriotic-party-snacks"
          className="font-semibold text-[var(--lp-red)] underline"
        >
          patriotic parties
        </Link>
        , or{" "}
        <Link href="/bulk-gummy-bears" className="font-semibold text-[var(--lp-red)] underline">
          bulk orders
        </Link>
        .
      </>
    ),
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
      text: item.answerText ?? item.answer,
    },
  })),
};

export default function FaqPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "FAQ", href: "/faq" },
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <PageHero
        eyebrow="Frequently Asked Questions"
        headline="USA Gummies"
        scriptAccent="FAQ."
        sub="Quick answers about our All American gummy bears, ingredients, flavor notes, bag count savings, and where to buy."
        ctas={[
          { href: "/shop", label: "Shop USA Gummies", variant: "primary" },
          { href: "/contact", label: "Contact support", variant: "light" },
        ]}
      />

      <ScarcityBar />

      {/* FAQ accordion — preserves rich answerNode (with internal links). */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[820px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-8 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Questions We Get ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.4rem)] text-[var(--lp-ink)]">
              The short
              <br />
              <span className="lp-script text-[var(--lp-red)]">answers.</span>
            </h2>
          </div>
          <div className="mt-6">
            {FAQS.map((item) => (
              <details key={item.question} className="lp-faq">
                <summary>{item.question}</summary>
                <div>{item.answerNode ?? item.answer}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Still have questions */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Still Have Questions? ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            We are
            <br />
            <span className="lp-script text-[var(--lp-red)]">here to help.</span>
          </h2>
          <p className="lp-sans mx-auto mt-6 max-w-[52ch] text-[1.05rem] leading-[1.6] text-[var(--lp-ink)]/85">
            Need ingredient details or order help? Send a note and we will respond within one
            business day.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/contact" className="lp-cta">
              Contact support
            </Link>
            <Link href="/about" className="lp-cta lp-cta-light">
              Learn our story
            </Link>
          </div>
        </div>
      </section>

      <GuaranteeBlock />

      {/* Bottom CTA */}
      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Ready to Order ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            Shop the best
            <br />
            <span className="lp-script text-[var(--lp-red)]">value bundles.</span>
          </h2>
          <p className="lp-sans mx-auto mt-6 max-w-[52ch] text-[1.05rem] leading-[1.6] text-[var(--lp-ink)]/85">
            Save more per bag when you add 4+ bags. {FREE_SHIPPING_PHRASE}.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop" className="lp-cta">
              Shop best value
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
