import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { AmericanDreamCallout } from "@/components/story/AmericanDreamCallout";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";

function resolveSiteUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || null;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : null;
  if (vercel) return vercel;
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return "https://www.usagummies.com";
}

const SITE_URL = resolveSiteUrl();
const PAGE_TITLE = "FAQ | USA Gummies";
const PAGE_DESCRIPTION =
  "USA Gummies FAQ. Answers about All American gummy bears, ingredients, flavor notes, bundles, shipping, and pricing.";
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
      "Yes. You can order 1-3 bags on our site at standard price, or bundle up for savings on 4+ bags.",
  },
  {
    question: "How does bundle pricing work?",
    answer:
      `Bundle pricing lowers the per-bag cost as you add more bags. Most customers choose 5, 8, or 12 bags, and ${FREE_SHIPPING_PHRASE.toLowerCase()}.`,
  },
  {
    question: "Which bundle should I choose?",
    answer:
      "Use our bundle guides to match the right size for gifts, parties, or bulk orders.",
    answerNode: (
      <>
        Use our bundle guides to match the right size for{" "}
        <Link href="/gummy-gift-bundles" className="link-underline font-semibold text-[var(--navy)]">
          gifts
        </Link>
        ,{" "}
        <Link
          href="/patriotic-party-snacks"
          className="link-underline font-semibold text-[var(--navy)]"
        >
          patriotic parties
        </Link>
        , or{" "}
        <Link href="/bulk-gummy-bears" className="link-underline font-semibold text-[var(--navy)]">
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
      text: item.answer,
    },
  })),
};

export default function FaqPage() {
  return (
    <main className="relative overflow-hidden bg-[var(--bg)] text-[var(--text)] min-h-screen home-candy">
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(circle at 12% 18%, rgba(255,77,79,0.14), transparent 48%), radial-gradient(circle at 85% 5%, rgba(255,199,44,0.14), transparent 38%)",
            opacity: 0.5,
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-10">
          <BreadcrumbJsonLd
            items={[
              { name: "Home", href: "/" },
              { name: "FAQ", href: "/faq" },
            ]}
          />

          <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
            <div className="space-y-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)]">
                FAQ
              </div>
              <h1 className="text-3xl font-black leading-[1.1] tracking-tight text-[var(--text)] sm:text-4xl lg:text-5xl">
                USA Gummies FAQ
              </h1>
              <p className="text-sm text-[var(--muted)] sm:text-base max-w-prose">
                Quick answers about our All American gummy bears, ingredients, flavor notes, bundles,
                and where to buy.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/shop" className="btn btn-candy">
                  Shop bundles
                </Link>
                <span className="text-xs text-[var(--muted)]">{FREE_SHIPPING_PHRASE}</span>
              </div>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {FAQS.map((item) => (
                <div
                  key={item.question}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4"
                >
                  <div className="text-sm font-semibold text-[var(--text)]">{item.question}</div>
                  <div className="mt-2 text-sm text-[var(--muted)]">
                    {item.answerNode ?? item.answer}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <AmericanDreamCallout variant="compact" ctaHref="/shop" ctaLabel="Shop bundles" tone="light" />
          </div>

          <div className="mt-6 candy-panel rounded-[32px] border border-[var(--border)] p-5 sm:p-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
              Still have questions?
            </div>
            <h2 className="mt-2 text-2xl font-black text-[var(--text)]">We are here to help.</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Need ingredient details or order help? Send a note and we will respond within one
              business day.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Link href="/contact" className="btn btn-outline">
                Contact support
              </Link>
              <Link href="/about" className="btn btn-candy">
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
