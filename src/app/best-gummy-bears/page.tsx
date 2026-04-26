// /best-gummy-bears — "best of" SEO funnel page in LP design language.
// Structure: PageHero → ScarcityBar → Highlights → What-makes-best → How-we-
// compare grid + BagSlider (client) → FAQ accordion → ThreePromises →
// GuaranteeBlock → bottom CTA.
// Article + FAQPage + Breadcrumb JSON-LD preserved for SEO.

import type { Metadata } from "next";
import Link from "next/link";

import { PageHero } from "@/components/lp/PageHero";
import { ScarcityBar } from "@/components/lp/ScarcityBar";
import { ThreePromises } from "@/components/lp/ThreePromises";
import { GuaranteeBlock } from "@/components/lp/GuaranteeBlock";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";

import BagSlider from "@/components/purchase/BagSlider.client";
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
const PAGE_TITLE = "Best Gummy Bears of 2026 | USA Gummies";
const PAGE_DESCRIPTION =
  "Discover the best gummy bears of 2026. USA Gummies are made in the USA with no artificial dyes, all natural flavors, and a classic soft chew. Free shipping on 5+ bags.";
const PAGE_URL = `${SITE_URL}/best-gummy-bears`;
const OG_IMAGE = "/opengraph-image";
const ARTICLE_HEADLINE = "Best Gummy Bears of 2026";

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

const HIGHLIGHTS = [
  {
    title: "Made in the USA",
    body: "Sourced, made, and packed in the United States. No outsourced production or mystery supply chains.",
  },
  {
    title: "All Natural Flavors",
    body: "Five classic fruit flavors — cherry, watermelon, orange, green apple, and lemon — from natural sources.",
  },
  {
    title: "No Artificial Dyes",
    body: "Colors come from fruit and vegetable extracts, spirulina, and curcumin. No synthetic dyes.",
  },
];

const WHAT_MAKES_BEST = [
  {
    title: "Texture and chew quality",
    body: "The best gummy bears have a soft, satisfying chew that isn't too hard or too sticky. USA Gummies use a classic gelatin-based recipe for a consistent bite every time.",
  },
  {
    title: "Clean ingredients",
    body: "Premium gummy bears skip the artificial dyes and synthetic flavors. USA Gummies are made with no artificial dyes and all natural flavors for a cleaner ingredient list.",
  },
  {
    title: "Flavor variety",
    body: "A great gummy bear bag offers distinct, recognizable fruit flavors. Each USA Gummies bag includes five flavors you can actually tell apart — cherry, watermelon, orange, green apple, and lemon.",
  },
];

const COMPARISON_POINTS = [
  {
    title: "Ingredients you can read",
    body: "Most mass-market gummy bears use Red 40, Yellow 5, and Blue 1. USA Gummies use fruit and vegetable extracts for color and all natural flavors.",
  },
  {
    title: "Made domestically",
    body: "Many popular gummy bears are manufactured overseas and imported. USA Gummies are sourced, made, and packed entirely in the United States.",
  },
  {
    title: "No artificial dyes or synthetic colors",
    body: "Generic gummy bears rely on certified synthetic color additives. USA Gummies get their color from spirulina, curcumin, and fruit and vegetable extracts.",
  },
];

const FAQS = [
  {
    question: "What makes USA Gummies the best gummy bears?",
    answer:
      "USA Gummies combine a classic soft chew with clean ingredients — no artificial dyes, all natural flavors, and domestic production. They are sourced, made, and packed in the USA.",
  },
  {
    question: "What ingredients are in USA Gummies?",
    answer:
      "USA Gummies are made with all natural flavors and colored with fruit and vegetable extracts, spirulina, and curcumin. They contain gelatin and are free from artificial dyes and synthetic colors.",
  },
  {
    question: "What flavors do USA Gummies come in?",
    answer:
      "Each bag includes five fruit flavors: cherry, watermelon, orange, green apple, and lemon.",
  },
  {
    question: "Do you offer free shipping?",
    answer:
      "Yes. Orders of 5 or more bags ship free within the United States.",
  },
  {
    question: "Where are USA Gummies made?",
    answer:
      "USA Gummies are sourced, made, and packed in the United States.",
  },
  {
    question: "Are USA Gummies gluten free?",
    answer:
      "USA Gummies are made in a facility that processes wheat, so we cannot guarantee they are gluten free. Always check the bag for the most current allergen information.",
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

const articleJsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: ARTICLE_HEADLINE,
  description: PAGE_DESCRIPTION,
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": PAGE_URL,
  },
  author: {
    "@type": "Organization",
    name: "USA Gummies",
  },
  publisher: {
    "@type": "Organization",
    name: "USA Gummies",
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/brand/logo.png`,
    },
  },
  image: [`${SITE_URL}/brand/usa-gummies-family.webp`],
};

export default function BestGummyBearsPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Best Gummy Bears of 2026", href: "/best-gummy-bears" },
        ]}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      <PageHero
        eyebrow="Best Gummy Bears of 2026"
        headline="The best gummy bears,"
        scriptAccent="hands down."
        sub="A clean ingredient list, a classic soft chew, and flavors you can actually taste. USA Gummies are made in the USA with no artificial dyes — five distinct fruit flavors in every bag."
        ctas={[
          { href: "/shop", label: "Shop &amp; save" },
          { href: "/ingredients", label: "See ingredients", variant: "light" },
        ]}
      />

      <ScarcityBar />

      {/* Highlights */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Why USA Gummies ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Three reasons
              <br />
              <span className="lp-script text-[var(--lp-red)]">they top the list.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {HIGHLIGHTS.map((item, i) => (
              <div
                key={item.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.4rem] leading-tight text-[var(--lp-ink)] sm:text-[1.55rem]">
                  {item.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.98rem] leading-[1.6] text-[var(--lp-ink)]/82">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
          <p className="lp-sans mx-auto mt-8 max-w-[60ch] text-center text-[0.9rem] leading-[1.5] text-[var(--lp-ink)]/65">
            {FREE_SHIPPING_PHRASE}.
          </p>
        </div>
      </section>

      {/* What makes the best */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ What Makes the Best ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Three things separate
              <br />
              <span className="lp-script text-[var(--lp-red)]">great from the rest.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {WHAT_MAKES_BEST.map((item, i) => (
              <div
                key={item.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.3rem] leading-tight text-[var(--lp-ink)] sm:text-[1.45rem]">
                  {item.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.95rem] leading-[1.55] text-[var(--lp-ink)]/82">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Compare + BagSlider */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ How We Compare ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Stack us up
              <br />
              <span className="lp-script text-[var(--lp-red)]">against the rest.</span>
            </h2>
          </div>
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <ul className="grid gap-4">
              {COMPARISON_POINTS.map((item, i) => (
                <li
                  key={item.title}
                  className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5"
                  style={{ boxShadow: i === 0 ? "4px 4px 0 var(--lp-red)" : "4px 4px 0 var(--lp-ink)" }}
                >
                  <h3 className="lp-display text-[1.15rem] leading-tight text-[var(--lp-ink)]">
                    {item.title}
                  </h3>
                  <p className="lp-sans mt-2 text-[0.95rem] leading-[1.55] text-[var(--lp-ink)]/82">
                    {item.body}
                  </p>
                </li>
              ))}
            </ul>
            <div
              id="best-gummy-bears-buy"
              className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5 sm:p-6"
              style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
            >
              <p className="lp-label mb-2 text-[var(--lp-red)]">★ Shop the Best ★</p>
              <h3 className="lp-display text-[1.5rem] leading-tight text-[var(--lp-ink)]">
                Bundle up to save more per bag.
              </h3>
              <p className="lp-sans mt-2 text-[0.95rem] leading-[1.6] text-[var(--lp-ink)]/82">
                {FREE_SHIPPING_PHRASE}.
              </p>
              <div className="mt-5">
                <BagSlider variant="full" defaultQty={5} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Best Gummy Bears FAQs ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Quick answers
              <br />
              <span className="lp-script text-[var(--lp-red)]">about USA Gummies.</span>
            </h2>
          </div>
          <div className="space-y-3">
            {FAQS.map((item, i) => (
              <details
                key={item.question}
                className="group border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] px-5 py-4"
                style={{ boxShadow: i === 0 ? "4px 4px 0 var(--lp-red)" : "4px 4px 0 var(--lp-ink)" }}
              >
                <summary className="flex cursor-pointer items-center justify-between gap-3 lp-display text-[1.05rem] leading-snug text-[var(--lp-ink)]">
                  <span>{item.question}</span>
                  <span className="text-[var(--lp-red)] transition-transform group-open:rotate-45">+</span>
                </summary>
                <div className="lp-sans mt-3 text-[0.98rem] leading-[1.6] text-[var(--lp-ink)]/82">
                  {item.answer}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <ThreePromises />
      <GuaranteeBlock />

      {/* Latest blog */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-16">
          <LatestFromBlog />
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Ready to Order ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            Stop searching.
            <br />
            <span className="lp-script text-[var(--lp-red)]">Start chewing.</span>
          </h2>
          <p className="lp-sans mx-auto mt-6 max-w-[52ch] text-[1.05rem] leading-[1.6] text-[var(--lp-ink)]/85">
            Save more per bag when you add 4+ bags. {FREE_SHIPPING_PHRASE}.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop" className="lp-cta">
              Shop &amp; save
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
