// /about — brand story page in LP design language. Structure:
//   PageHero  → ScarcityBar  → Brand-story column  → ThreePromises
//   → 5-pillar listing grid (LP shadow-card style)
//   → FoundersLetter  → SustainabilityBlock  → GuaranteeBlock
//   → FaqAccordion  → bottom CTA
// Article JSON-LD preserved for SEO.

import type { Metadata } from "next";
import Link from "next/link";

import { PageHero } from "@/components/lp/PageHero";
import { ScarcityBar } from "@/components/lp/ScarcityBar";
import { ThreePromises } from "@/components/lp/ThreePromises";
import { FoundersLetter } from "@/components/lp/FoundersLetter";
import { SustainabilityBlock } from "@/components/lp/SustainabilityBlock";
import { GuaranteeBlock } from "@/components/lp/GuaranteeBlock";
import { FaqAccordion } from "@/components/lp/FaqAccordion";

import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { BRAND_STORY_HEADLINE, BRAND_STORY_PARAGRAPHS } from "@/data/brandStory";

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
const PAGE_TITLE = "About USA Gummies | Made in USA Candy";
const PAGE_DESCRIPTION =
  "Meet the team behind USA Gummies and our mission to make dye-free gummies with no artificial dyes, proudly made in the USA.";
const OG_IMAGE = "/opengraph-image";

const LISTING_BULLETS = [
  {
    title: "Made in the U.S.A.",
    body:
      "Sourced, manufactured, and packed entirely in America. Backing American jobs and delivering a better gummy you can trust.",
  },
  {
    title: "No Artificial Dyes",
    body:
      "Colored naturally from real fruit and vegetable extracts. No synthetic colors. No fake brightness.",
  },
  {
    title: "Classic Gummy Bear Flavor.",
    body:
      "All the chewy, fruity flavor you expect — without artificial ingredients or harsh aftertaste.",
  },
  {
    title: "Built for Everyday.",
    body:
      "Lunchboxes, desk drawers, road trips, care packages, and guilt-free sweet cravings.",
  },
  {
    title: "Five Natural Flavors.",
    body:
      "Cherry, Watermelon, Orange, Green Apple, and Lemon. Clearly labeled, honestly made, and easy to share in a 7.5 oz bag.",
  },
];

const articleJsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": `${SITE_URL}/about`,
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

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/about` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/about`,
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

export default function AboutPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "About", href: "/about" },
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />

      <PageHero
        eyebrow="Our Story"
        headline="The brand"
        scriptAccent="behind the bag."
        sub="USA Gummies is a one-product brand obsessed with getting one thing right: a real gummy bear, made in the U.S.A., with no artificial dyes."
        ctas={[
          { href: "/shop", label: "Shop now", variant: "primary" },
        ]}
      />

      <ScarcityBar />

      {/* Brand story — pulled from /data/brandStory. Preserves the long-form
       * narrative structure but in LP type rhythm. */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-8 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Why We Started ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              {BRAND_STORY_HEADLINE}
            </h2>
          </div>
          <div className="lp-sans space-y-4 text-[1.05rem] leading-[1.75] text-[var(--lp-ink)]/88">
            {BRAND_STORY_PARAGRAPHS.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>
      </section>

      <ThreePromises />

      {/* Five-pillar listing — LP shadow-card grid. */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ The Five Pillars ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              What we stand
              <br />
              <span className="lp-script text-[var(--lp-red)]">behind.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {LISTING_BULLETS.map((b, i) => (
              <div
                key={b.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.5rem] leading-tight text-[var(--lp-ink)] sm:text-[1.7rem]">
                  {b.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.98rem] leading-[1.55] text-[var(--lp-ink)]/82">
                  {b.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <FoundersLetter />
      <SustainabilityBlock />
      <GuaranteeBlock />
      <FaqAccordion />

      {/* Bottom CTA */}
      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Ready When You Are ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            Try the bag
            <br />
            <span className="lp-script text-[var(--lp-red)]">that started it all.</span>
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop" className="lp-cta">
              Shop USA Gummies
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
