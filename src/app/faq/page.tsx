import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
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
        <Link href="/about" className="link-underline font-semibold text-[var(--navy)]">
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
      text: item.answerText ?? item.answer,
    },
  })),
};

export default function FaqPage() {
  return (
    <main className="relative overflow-hidden text-[var(--text)] min-h-screen home-candy">
      <div className="relative w-full h-[320px] sm:h-[400px] lg:h-[440px] overflow-hidden">
        <Image
          src="/brand/gallery/neon-sign.jpg"
          alt="USA Gummies neon sign"
          fill
          sizes="100vw"
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#1B2A4A]/25 to-[#1B2A4A]/55" />
        <div className="relative z-10 flex flex-col items-center justify-center h-full text-center px-4">
          <div className="relative w-56 h-28 mb-3">
            <Image src="/brand/logo-full.png" alt="USA Gummies" fill sizes="224px" className="object-contain drop-shadow-[0_4px_20px_rgba(0,0,0,0.4)]" />
          </div>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold uppercase tracking-wide text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.4)]">
            Frequently Asked Questions
          </h1>
          <p className="mt-2 text-sm text-white/85 max-w-md drop-shadow-sm">
            Everything you need to know about our all-natural gummy bears.
          </p>
        </div>
      </div>

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

          <div className="flex justify-center py-6">
            <div className="relative w-40 h-20">
              <Image src="/brand/logo-full.png" alt="USA Gummies" fill sizes="160px" className="object-contain" />
            </div>
          </div>

          <div className="candy-panel rounded-[36px] border border-[var(--border)] p-6 sm:p-8">
            <div className="space-y-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--muted)]">
                FAQ
              </div>
              <h2 className="text-3xl font-black leading-[1.1] tracking-tight text-[var(--text)] sm:text-4xl lg:text-5xl">
                USA Gummies FAQ
              </h2>
              <p className="text-sm text-[var(--muted)] sm:text-base max-w-prose">
                Quick answers about our All American gummy bears, ingredients, flavor notes, bag count
                savings, and where to buy.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/shop" className="btn btn-candy">
                  Shop USA Gummies
                </Link>
                <span className="text-xs text-[var(--muted)]">{FREE_SHIPPING_PHRASE}</span>
              </div>
            </div>

            <div className="mt-6 space-y-2">
              {FAQS.map((item) => (
                <details
                  key={item.question}
                  className="group rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3"
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-[var(--text)]">
                    <span>{item.question}</span>
                    <span className="text-[var(--muted)] transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <div className="mt-2 text-sm text-[var(--muted)]">
                    {item.answerNode ?? item.answer}
                  </div>
                </details>
              ))}
            </div>

            <div className="mt-6 border-t border-[var(--border)] pt-5">
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

            <div className="mt-6 border-t border-[var(--border)] pt-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">
                Ready to order
              </div>
              <h2 className="mt-2 text-2xl font-black text-[var(--text)]">
                Shop the best value bundles.
              </h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Save more per bag when you add 4+ bags. {FREE_SHIPPING_PHRASE}.
              </p>
              <div className="mt-3">
                <Link href="/shop" className="btn btn-candy">
                  Shop best value
                </Link>
              </div>
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
