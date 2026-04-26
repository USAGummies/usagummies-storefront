// /natural-gummy-bears — natural-ingredients SEO funnel page in LP design
// language. Structure: PageHero → ScarcityBar → Highlights → What-natural-
// means → Ingredients (in/out) + label tips + BagSlider (client) → FAQ →
// ThreePromises → GuaranteeBlock → bottom CTA.
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
const PAGE_TITLE = "All Natural Gummy Bears | No Artificial Ingredients | USA Gummies";
const PAGE_DESCRIPTION =
  "All natural gummy bears made in the USA with fruit and vegetable colors, natural flavors, and no artificial dyes. Clean ingredients you can trust. Free shipping on 5+ bags.";
const PAGE_URL = `${SITE_URL}/natural-gummy-bears`;
const OG_IMAGE = "/opengraph-image";
const ARTICLE_HEADLINE = "All Natural Gummy Bears";

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
    title: "Natural Colors Only",
    body: "Every color comes from fruit and vegetable extracts like spirulina, curcumin, and beta-carotene. Zero synthetic dyes.",
  },
  {
    title: "All Natural Flavors",
    body: "Real fruit-derived flavoring in every bear. No artificial flavoring agents or synthetic taste enhancers.",
  },
  {
    title: "Clean Label",
    body: "A simple ingredient list you can actually read. No high-fructose corn syrup, no artificial preservatives.",
  },
];

const WHAT_NATURAL_MEANS = [
  {
    title: "Natural vs. artificial colors",
    body:
      "Natural colors are derived from plant, mineral, or animal sources such as fruit and vegetable extracts, spirulina, and curcumin. Artificial colors are chemically synthesized and must be batch-certified by the FDA before use.",
  },
  {
    title: "Natural flavoring explained",
    body:
      "Natural flavors are derived from real food sources including fruits, vegetables, herbs, and spices. They capture the taste profile of the original ingredient without synthetic chemical compounds.",
  },
  {
    title: "Clean manufacturing",
    body:
      "Our gummies are produced in a USA-based facility with strict quality controls. Every batch is made with the same commitment to natural ingredients from sourcing through packaging.",
  },
];

const OUR_INGREDIENTS = {
  whatsIn: [
    "Fruit and vegetable extracts for color (spirulina, curcumin, beta-carotene, black carrot)",
    "Natural fruit flavors (cherry, watermelon, orange, green apple, lemon)",
    "Cane sugar and glucose syrup",
    "Gelatin for the classic gummy chew",
    "Citric acid for a touch of tartness",
  ],
  whatsOut: [
    "No artificial dyes or synthetic colors (no Red 40, Yellow 5, Blue 1)",
    "No artificial flavors",
    "No high-fructose corn syrup",
    "No artificial preservatives",
    "No wax coatings",
  ],
};

const LABEL_TIPS = [
  "Check for \"natural flavors\" instead of \"artificial flavors\" in the ingredient list.",
  "Look for colors listed as fruit or vegetable extracts rather than FD&C dye names like Red 40.",
  "A shorter ingredient list usually means fewer additives and a cleaner product.",
];

const FAQS = [
  {
    question: "Are USA Gummies all natural?",
    answer:
      "USA Gummies are made with all natural flavors and colors derived from fruit and vegetable extracts. We do not use artificial dyes, artificial flavors, or high-fructose corn syrup.",
  },
  {
    question: "What natural colors do you use?",
    answer:
      "Our colors come from fruit and vegetable extracts including spirulina, curcumin, beta-carotene, and black carrot extract. No synthetic dyes like Red 40 or Yellow 5 are used.",
  },
  {
    question: "Are these gummies organic?",
    answer:
      "USA Gummies are not certified organic. However, we use natural colors and natural flavors with a clean, simple ingredient list.",
  },
  {
    question: "Do they contain common allergens?",
    answer:
      "USA Gummies contain gelatin. They are free from the top allergens including peanuts, tree nuts, milk, eggs, wheat, soy, fish, and shellfish. Always check the bag for the most current label information.",
  },
  {
    question: "Where are USA Gummies made?",
    answer: "USA Gummies are sourced, made, and packed in the USA.",
  },
  {
    question: "Are these gummies vegan?",
    answer: "No. USA Gummies contain gelatin, which is an animal-derived ingredient.",
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

export default function NaturalGummyBearsPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "All Natural Gummy Bears", href: "/natural-gummy-bears" },
        ]}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      <PageHero
        eyebrow="All Natural Gummy Bears"
        headline="Real fruit colors,"
        scriptAccent="real fruit flavors."
        sub="Clean ingredients, real fruit flavors, and absolutely no synthetic anything. USA Gummies are colored with fruit and vegetable extracts and flavored with natural flavors — a classic gummy bear you can feel good about. Made in the USA."
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
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ The Standard ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Three reasons
              <br />
              <span className="lp-script text-[var(--lp-red)]">to keep it natural.</span>
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

      {/* What natural means */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ What &ldquo;Natural&rdquo; Means ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              All-natural,
              <br />
              <span className="lp-script text-[var(--lp-red)]">explained.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {WHAT_NATURAL_MEANS.map((item, i) => (
              <div
                key={item.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.25rem] leading-tight text-[var(--lp-ink)] sm:text-[1.4rem]">
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

      {/* Ingredients in/out + Label tips + BagSlider */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Our Ingredients ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              What goes in.
              <br />
              <span className="lp-script text-[var(--lp-red)]">What stays out.</span>
            </h2>
          </div>
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="grid gap-4">
              <div
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5 sm:p-6"
                style={{ boxShadow: "4px 4px 0 var(--lp-red)" }}
              >
                <p className="lp-label mb-2 text-[var(--lp-red)]">★ What goes in ★</p>
                <ul className="grid gap-3">
                  {OUR_INGREDIENTS.whatsIn.map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <span className="lp-display mt-1 text-[1.2rem] leading-none text-[var(--lp-red)]">★</span>
                      <span className="lp-sans text-[0.95rem] leading-[1.55] text-[var(--lp-ink)]/85">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5 sm:p-6"
                style={{ boxShadow: "4px 4px 0 var(--lp-ink)" }}
              >
                <p className="lp-label mb-2 text-[var(--lp-red)]">★ What stays out ★</p>
                <ul className="grid gap-3">
                  {OUR_INGREDIENTS.whatsOut.map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <span className="lp-display mt-1 text-[1.2rem] leading-none text-[var(--lp-red)]">×</span>
                      <span className="lp-sans text-[0.95rem] leading-[1.55] text-[var(--lp-ink)]/85">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="border-2 border-[var(--lp-ink)]/30 bg-[var(--lp-cream-soft)] p-5">
                <p className="lp-label mb-2 text-[var(--lp-red)]">★ How to Read Labels ★</p>
                <ul className="grid gap-2">
                  {LABEL_TIPS.map((tip) => (
                    <li key={tip} className="flex items-start gap-3">
                      <span className="lp-display mt-1 text-[1.1rem] leading-none text-[var(--lp-red)]">★</span>
                      <span className="lp-sans text-[0.9rem] leading-[1.55] text-[var(--lp-ink)]/82">{tip}</span>
                    </li>
                  ))}
                </ul>
                <p className="lp-sans mt-3 text-[0.82rem] leading-[1.5] text-[var(--lp-ink)]/65">
                  Ingredient lists can change. Always check the bag for the most current label information.
                </p>
              </div>
            </div>

            <div
              id="natural-gummy-bears-buy"
              className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5 sm:p-6"
              style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
            >
              <p className="lp-label mb-2 text-[var(--lp-red)]">★ Shop All Natural ★</p>
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
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ All-Natural FAQs ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Quick answers
              <br />
              <span className="lp-script text-[var(--lp-red)]">about ingredients.</span>
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
            Real ingredients,
            <br />
            <span className="lp-script text-[var(--lp-red)]">real candy.</span>
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
