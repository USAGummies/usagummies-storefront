// /no-artificial-dyes-gummy-bears — Red-40-free SEO funnel page in LP design
// language. Structure: PageHero → ScarcityBar → Highlights → Science context
// → Regulatory references + Label tips + BagSlider (client) → FAQ →
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
const PAGE_TITLE = "Red 40 Free Gummies | No Artificial Dyes Gummy Bears";
const PAGE_DESCRIPTION =
  "Looking for red 40 free gummies? USA Gummies are no artificial dyes gummy bears made in the USA with colors from fruit and vegetable extracts.";
const PAGE_URL = `${SITE_URL}/no-artificial-dyes-gummy-bears`;
const OG_IMAGE = "/opengraph-image";
const ARTICLE_HEADLINE = "No Artificial Dyes Gummy Bears";

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
    title: "Red 40 free gummies",
    body: "No FD&C Red No. 40 or other certified synthetic colors anywhere in the bag.",
  },
  {
    title: "No artificial dyes",
    body: "Colors come from fruit and vegetable extracts, spirulina, and curcumin.",
  },
  {
    title: "Made in the USA",
    body: "All natural flavors with a clean, classic gummy bear chew.",
  },
];

const SCIENCE_CONTEXT = [
  {
    title: "Certified colors are synthetic",
    body:
      "FDA notes that certified colors are synthetic and require batch certification before use.",
  },
  {
    title: "Exempt colors come from natural sources",
    body:
      "FDA describes exempt colors as pigments from sources like vegetables, minerals, or animals, and they still require FDA approval.",
  },
  {
    title: "What FDA says about behavior",
    body:
      "FDA reports that most children show no adverse effects from color additives, but some evidence suggests sensitivity in certain children and the agency continues to evaluate new science.",
  },
];

const REGULATORY_REFERENCES = [
  {
    title: "U.S. label rules for certified colors",
    body:
      "FDA requires certified color additives to be listed by name on food labels (for example, FD&C Red No. 40 or Red 40).",
  },
  {
    title: "Red 40 in the CFR",
    body:
      "FD&C Red No. 40 is listed in 21 CFR 74.340, may be used for coloring foods consistent with good manufacturing practice, and batches must be certified under 21 CFR Part 80.",
  },
  {
    title: "UK warning labels for certain colors",
    body:
      "UK guidance requires warning labels for foods containing certain colors, including Allura Red (E129), indicating they may have an adverse effect on activity and attention in children.",
  },
];

const LABEL_TIPS = [
  "Look for certified colors listed by name, such as FD&C Red No. 40 or the shortened Red 40.",
  "Exempt colors can appear as 'color added' or 'artificial colors' instead of each individual name.",
  "If you want dye-free gummies, confirm the ingredient list calls out fruit or vegetable-based colors.",
];

const FAQS = [
  {
    question: "Are USA Gummies red 40 free?",
    answer:
      "Yes. USA Gummies do not use FD&C Red No. 40. Color comes from fruit and vegetable extracts, spirulina, and curcumin.",
  },
  {
    question: "Do you use any artificial dyes or synthetic colors?",
    answer: "No. We do not use artificial dyes or synthetic colors.",
  },
  {
    question: "How is Red 40 listed on U.S. labels?",
    answer:
      "Certified colors are listed by name in the ingredient list, such as FD&C Red No. 40 or Red 40.",
  },
  {
    question: "Are these gummies vegan?",
    answer: "No. USA Gummies contain gelatin.",
  },
  {
    question: "Where are USA Gummies made?",
    answer: "USA Gummies are sourced, made, and packed in the USA.",
  },
  {
    question: "Where can I see full ingredient and nutrition details?",
    answer: "Visit the ingredients page for the most current label information.",
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
  // Conservative publish date — page predates audit but exact date unknown.
  datePublished: "2026-01-01",
  dateModified: "2026-04-29",
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

export default function NoArtificialDyesPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "No Artificial Dyes Gummy Bears", href: "/no-artificial-dyes-gummy-bears" },
        ]}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      <PageHero
        eyebrow="No Artificial Dyes Gummy Bears"
        headline="Red 40 free,"
        scriptAccent="dye-free, USA-made."
        sub="USA Gummies are colored with fruit and vegetable extracts for a classic gummy bear look — without artificial dyes or synthetic colors. All natural flavors, made in the USA."
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
              <span className="lp-script text-[var(--lp-red)]">to skip the dyes.</span>
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

      {/* Science context */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Scientific Context ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              The science &amp; regs
              <br />
              <span className="lp-script text-[var(--lp-red)]">behind dye-free.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {SCIENCE_CONTEXT.map((item, i) => (
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

      {/* Regulatory + Label tips + BagSlider */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Reading the Label ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              How to spot
              <br />
              <span className="lp-script text-[var(--lp-red)]">Red 40 in the wild.</span>
            </h2>
          </div>
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="grid gap-4">
              <div
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5 sm:p-6"
                style={{ boxShadow: "4px 4px 0 var(--lp-red)" }}
              >
                <p className="lp-label mb-3 text-[var(--lp-red)]">★ Regulatory References ★</p>
                <div className="grid gap-3">
                  {REGULATORY_REFERENCES.map((item) => (
                    <div key={item.title} className="border-2 border-[var(--lp-ink)]/30 bg-[var(--lp-cream-soft)] p-4">
                      <h3 className="lp-display text-[1.05rem] leading-tight text-[var(--lp-ink)]">
                        {item.title}
                      </h3>
                      <p className="lp-sans mt-2 text-[0.92rem] leading-[1.55] text-[var(--lp-ink)]/82">
                        {item.body}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <div
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5 sm:p-6"
                style={{ boxShadow: "4px 4px 0 var(--lp-ink)" }}
              >
                <p className="lp-label mb-2 text-[var(--lp-red)]">★ How to Spot Red 40 ★</p>
                <ul className="grid gap-3">
                  {LABEL_TIPS.map((tip) => (
                    <li key={tip} className="flex items-start gap-3">
                      <span className="lp-display mt-1 text-[1.2rem] leading-none text-[var(--lp-red)]">★</span>
                      <span className="lp-sans text-[0.95rem] leading-[1.55] text-[var(--lp-ink)]/85">{tip}</span>
                    </li>
                  ))}
                </ul>
                <p className="lp-sans mt-4 text-[0.85rem] leading-[1.5] text-[var(--lp-ink)]/65">
                  Ingredient lists can change. Always check the bag for the most current label information.
                </p>
              </div>
            </div>

            <div
              id="red-40-free-buy"
              className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5 sm:p-6"
              style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
            >
              <p className="lp-label mb-2 text-[var(--lp-red)]">★ Shop Red 40 Free ★</p>
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
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ No Artificial Dyes FAQs ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Quick answers
              <br />
              <span className="lp-script text-[var(--lp-red)]">about Red 40.</span>
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
            Skip the synthetics.
            <br />
            <span className="lp-script text-[var(--lp-red)]">Keep the chew.</span>
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
