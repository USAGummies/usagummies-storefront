// /dye-free-candy — pillar guide in LP design language. Structure:
// PageHero → ScarcityBar → Education cards → Comparison rows →
// HowTo checklist → Color sources → SustainabilityBlock → FAQ →
// GuaranteeBlock → Related links → bottom CTA.
// Article + FAQ + HowTo JSON-LD all preserved for SEO.

import type { Metadata } from "next";
import Link from "next/link";

import { PageHero } from "@/components/lp/PageHero";
import { ScarcityBar } from "@/components/lp/ScarcityBar";
import { SustainabilityBlock } from "@/components/lp/SustainabilityBlock";
import { GuaranteeBlock } from "@/components/lp/GuaranteeBlock";

import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
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
const PAGE_TITLE = "Dye-Free Candy Guide | USA Gummies";
const PAGE_DESCRIPTION =
  "Learn how to spot dye-free gummies and no artificial dyes on labels, plus why made in USA candy matters for patriotic gifts.";
const PAGE_URL = `${SITE_URL}/dye-free-candy`;
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

const EDUCATION_CARDS = [
  {
    title: "What dye-free candy means",
    body:
      "Dye-free candy uses color sources like fruit and vegetable extracts instead of synthetic FD&C dyes. You will often see phrases like \"colors from fruit and vegetable extracts\" on the label.",
  },
  {
    title: "Why shoppers look for it",
    body:
      "Many people choose candy without artificial dyes for ingredient transparency, personal preference, or sensitivity concerns. The choice is about how the color is made, not a change to sugar content.",
  },
  {
    title: "How to confirm it on a label",
    body:
      "Scan the ingredient list for dye names such as Red 40, Yellow 5, Yellow 6, or Blue 1. If those are missing and color sources are listed instead, the candy is likely dye-free.",
  },
];

const COMPARISON_ROWS = [
  {
    label: "Color source",
    dyeFree: "Fruit and vegetable extracts, spirulina, turmeric, or other plant-based colors.",
    dyed: "Synthetic FD&C dyes like Red 40, Yellow 5, Yellow 6, or Blue 1.",
  },
  {
    label: "Label cues",
    dyeFree: "Phrases like \"colors from fruit and vegetable extracts\" or specific plant sources.",
    dyed: "Numbered dyes listed explicitly in the ingredients panel.",
  },
  {
    label: "Look in the bag",
    dyeFree: "Natural-looking hues that can be slightly softer or more fruit-toned.",
    dyed: "More uniform, bright, or neon-leaning colors.",
  },
  {
    label: "Who it fits",
    dyeFree: "Great for shoppers prioritizing ingredient transparency or dye-free gifting.",
    dyed: "Best if color vibrancy is the top priority and dyes are not a concern.",
  },
];

const HOW_TO_STEPS = [
  {
    title: "Read the ingredient list",
    body:
      "Look for numbered dyes like Red 40 or Yellow 5. If they appear, the candy is not dye-free.",
  },
  {
    title: "Confirm the color sources",
    body:
      "Dye-free candy will list fruit and vegetable extracts or plant-based sources like spirulina or turmeric.",
  },
  {
    title: "Match the candy to your needs",
    body:
      "If you have dietary needs beyond dyes, check the full ingredient panel and allergen information.",
  },
  {
    title: "Choose your format",
    body:
      "Pick single bags for everyday snacking or bundles for gifts and events.",
  },
];

const COLOR_SOURCES = [
  "Fruit and vegetable extracts",
  "Spirulina",
  "Turmeric (curcumin)",
  "Beet or carrot concentrates",
  "Paprika or annatto",
];

const FAQS = [
  {
    question: "What is dye-free candy?",
    answer:
      "Dye-free candy is colored without synthetic FD&C dyes and instead uses plant-based sources like fruit and vegetable extracts.",
  },
  {
    question: "Is candy without artificial dyes the same as sugar-free candy?",
    answer:
      "No. Dye-free refers to color sources, while sugar-free refers to sweeteners. The two are separate choices.",
  },
  {
    question: "How do I know if candy contains artificial dyes?",
    answer:
      "Check the ingredient list for dye names like Red 40, Yellow 5, Yellow 6, or Blue 1. If those are absent and plant sources are listed, it is likely dye-free.",
  },
  {
    question: "Do USA Gummies contain artificial dyes?",
    answer:
      "No. USA Gummies use colors from fruits, vegetables, spirulina, and curcumin instead of artificial dyes.",
  },
  {
    question: "Does dye-free candy taste different?",
    answer:
      "Flavor comes from the flavoring, not the dye. Dye-free candy can taste the same as candy with artificial dyes.",
  },
  {
    question: "Where can I see full ingredients for USA Gummies?",
    answer:
      "Visit the ingredients page for the full ingredient list and nutrition facts.",
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

const howToJsonLd = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "How to shop for dye-free candy",
  description: "A simple checklist for finding candy without artificial dyes.",
  step: HOW_TO_STEPS.map((step, index) => ({
    "@type": "HowToStep",
    position: index + 1,
    name: step.title,
    text: step.body,
  })),
};

const articleJsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Dye-free candy guide",
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

export default function DyeFreeCandyPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Dye-Free Candy", href: "/dye-free-candy" },
        ]}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(howToJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      <PageHero
        eyebrow="Pillar Guide"
        headline="Dye-free candy,"
        scriptAccent="explained."
        sub="What dye-free candy means, how to read ingredient labels, and how to compare dye-free candy to candy with artificial dyes. If you are shopping for candy without artificial dyes, start here."
        ctas={[
          { href: "/shop", label: "Shop dye-free candy", variant: "primary" },
          { href: "/ingredients", label: "Ingredients", variant: "light" },
        ]}
      />

      <ScarcityBar />

      {/* Education cards */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ The Basics ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              What you need
              <br />
              <span className="lp-script text-[var(--lp-red)]">to know.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {EDUCATION_CARDS.map((card, i) => (
              <div
                key={card.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.4rem] leading-tight text-[var(--lp-ink)] sm:text-[1.55rem]">
                  {card.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.98rem] leading-[1.55] text-[var(--lp-ink)]/82">
                  {card.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section id="comparison" className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Side by Side ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Dye-free vs.
              <br />
              <span className="lp-script text-[var(--lp-red)]">artificial dyes.</span>
            </h2>
            <p className="lp-sans mx-auto mt-6 max-w-[60ch] text-[1.05rem] leading-[1.65] text-[var(--lp-ink)]/85">
              Both options can taste great. The main difference is how color is created and how that
              choice shows up on the ingredient label.
            </p>
          </div>
          <div className="grid gap-4">
            {COMPARISON_ROWS.map((row) => (
              <div
                key={row.label}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5 sm:p-6"
              >
                <p className="lp-label mb-4 text-[var(--lp-red)]">{row.label}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="border-l-[3px] border-[var(--lp-red)] bg-[var(--lp-cream-soft)] p-4">
                    <p className="lp-label mb-2 text-[var(--lp-ink)]">Dye-free candy</p>
                    <p className="lp-sans text-[0.98rem] leading-[1.55] text-[var(--lp-ink)]/85">{row.dyeFree}</p>
                  </div>
                  <div className="border-l-[3px] border-[var(--lp-ink)]/30 bg-[var(--lp-cream-soft)] p-4">
                    <p className="lp-label mb-2 text-[var(--lp-ink)]/65">Artificial dyes</p>
                    <p className="lp-sans text-[0.98rem] leading-[1.55] text-[var(--lp-ink)]/75">{row.dyed}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HowTo checklist */}
      <section id="checklist" className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Dye-Free Checklist ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              How to shop
              <br />
              <span className="lp-script text-[var(--lp-red)]">without artificial dyes.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {HOW_TO_STEPS.map((step, index) => (
              <div
                key={step.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
                style={{ boxShadow: index === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <span className="lp-display block text-[2.2rem] leading-none text-[var(--lp-red)]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="lp-display mt-2 text-[1.35rem] leading-tight text-[var(--lp-ink)] sm:text-[1.5rem]">
                  {step.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.98rem] leading-[1.55] text-[var(--lp-ink)]/82">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Color sources */}
      <section id="color-sources" className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Common Natural Color Sources ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
            What plant-based
            <br />
            <span className="lp-script text-[var(--lp-red)]">color looks like.</span>
          </h2>
          <p className="lp-sans mx-auto mt-6 max-w-[52ch] text-[1.05rem] leading-[1.6] text-[var(--lp-ink)]/85">
            These are typical plant-based color sources you might see on dye-free candy labels.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {COLOR_SOURCES.map((source) => (
              <span
                key={source}
                className="lp-label border-2 border-[var(--lp-ink)] bg-[var(--lp-off-white)] px-4 py-2 text-[var(--lp-ink)]"
                style={{ boxShadow: "3px 3px 0 var(--lp-red)" }}
              >
                {source}
              </span>
            ))}
          </div>
        </div>
      </section>

      <SustainabilityBlock />

      {/* FAQ */}
      <section id="faqs" className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[820px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-8 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Dye-Free Questions ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Answered
              <br />
              <span className="lp-script text-[var(--lp-red)]">honestly.</span>
            </h2>
          </div>
          <div className="mt-6">
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

      {/* Related links */}
      <section id="related-links" className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1000px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Keep Exploring ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3rem)] text-[var(--lp-ink)]">
            More to
            <br />
            <span className="lp-script text-[var(--lp-red)]">discover.</span>
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/dye-free-movement" className="lp-cta lp-cta-light">
              Dye-free timeline
            </Link>
            <Link href="/vs" className="lp-cta lp-cta-light">
              Brand comparisons
            </Link>
            <Link href="/bulk-gummy-bears" className="lp-cta lp-cta-light">
              Bulk gummy bears
            </Link>
            <Link href="/gummy-gift-bundles" className="lp-cta lp-cta-light">
              Gift bundles
            </Link>
            <Link href="/made-in-usa" className="lp-cta lp-cta-light">
              Made in USA
            </Link>
            <Link href="/faq" className="lp-cta lp-cta-light">
              FAQ
            </Link>
            <Link href="/contact" className="lp-cta lp-cta-light">
              Contact
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-transparent">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <LatestFromBlog />
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ USA Gummies Standard ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            A dye-free option
            <br />
            <span className="lp-script text-[var(--lp-red)]">made in the USA.</span>
          </h2>
          <p className="lp-sans mx-auto mt-6 max-w-[52ch] text-[1.05rem] leading-[1.6] text-[var(--lp-ink)]/85">
            USA Gummies are colored with fruit and vegetable extracts and avoid artificial dyes.
            A clean-label gummy bear for everyday snacking or gifting.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop" className="lp-cta">
              Shop bundles
            </Link>
            <Link href="/ingredients" className="lp-cta lp-cta-light">
              See ingredients
            </Link>
            <Link href="/gummies-101" className="lp-cta lp-cta-light">
              Gummies 101
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
