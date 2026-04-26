// /made-in-usa — Made in USA brand page in LP design language. Structure:
// PageHero → ScarcityBar → Brand story column → Three values grid →
// FoundersLetter → SustainabilityBlock → FAQ → GuaranteeBlock → bottom CTA.
// Article + FAQ JSON-LD preserved for SEO.

import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";

import { PageHero } from "@/components/lp/PageHero";
import { ScarcityBar } from "@/components/lp/ScarcityBar";
import { FoundersLetter } from "@/components/lp/FoundersLetter";
import { SustainabilityBlock } from "@/components/lp/SustainabilityBlock";
import { GuaranteeBlock } from "@/components/lp/GuaranteeBlock";

import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { BRAND_STORY_HEADLINE, BRAND_STORY_MEDIUM } from "@/data/brandStory";
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
const PAGE_TITLE = "Made in USA Candy";
const PAGE_DESCRIPTION =
  "Learn how our gummies are crafted in the USA, with dye-free recipes and no artificial dyes for a patriotic candy you can trust.";
const OG_IMAGE = "/opengraph-image";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/made-in-usa` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/made-in-usa`,
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

const VALUES = [
  {
    title: "Sourced, made, and packed in America",
    body:
      "USA Gummies are produced in the USA with a focus on quality, consistency, and a cleaner ingredient standard.",
  },
  {
    title: "All natural flavors, no artificial dyes",
    body:
      "Our gummy bears use all natural flavors and are colored with fruit and vegetable extracts. No artificial dyes.",
  },
  {
    title: "Built for everyday snacking",
    body:
      "Chewy, fruity, and smooth. A classic gummy bear flavor that feels premium and easy to share.",
  },
];

const FAQS = [
  {
    question: "Where are USA Gummies made?",
    answer: "USA Gummies are sourced, made, and packed in the USA.",
  },
  {
    question: "Do you use artificial dyes?",
    answer: "No. Colors come from fruit and vegetable extracts, not synthetic dyes.",
  },
  {
    question: "How fast do orders ship?",
    answer: "Most orders ship within 24 hours with tracking once labels are created.",
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
  headline: "Made in USA gummies",
  description: PAGE_DESCRIPTION,
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": `${SITE_URL}/made-in-usa`,
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

export default function MadeInUsaPage() {
  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Made in USA", href: "/made-in-usa" },
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <PageHero
        eyebrow="Made in the USA"
        headline="All American"
        scriptAccent="gummy bears."
        sub="USA Gummies are built on American manufacturing and American pride. From sourcing to packing, every bag stays in the USA."
        ctas={[
          { href: "/shop", label: "Shop now", variant: "primary" },
          { href: "/no-artificial-dyes-gummy-bears", label: "Dye-free guide", variant: "light" },
        ]}
      />

      <ScarcityBar />

      {/* Brand story */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-8 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Our Story ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              {BRAND_STORY_HEADLINE}
            </h2>
          </div>
          <div className="lp-sans space-y-4 text-[1.05rem] leading-[1.75] text-[var(--lp-ink)]/88">
            {BRAND_STORY_MEDIUM.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/about" className="lp-cta lp-cta-light">
              Read our story
            </Link>
            <Link href="/shop" className="lp-cta">
              Shop now
            </Link>
          </div>
          <p className="lp-label mt-6 text-center text-[var(--lp-ink)]/65">
            {FREE_SHIPPING_PHRASE}
          </p>
        </div>
      </section>

      {/* Three values grid */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ What Made in USA Means ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              American quality
              <br />
              <span className="lp-script text-[var(--lp-red)]">in every bag.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {VALUES.map((value, i) => (
              <div
                key={value.title}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-6 sm:p-7"
                style={{ boxShadow: i === 0 ? "5px 5px 0 var(--lp-red)" : "5px 5px 0 var(--lp-ink)" }}
              >
                <h3 className="lp-display text-[1.4rem] leading-tight text-[var(--lp-ink)] sm:text-[1.55rem]">
                  {value.title}
                </h3>
                <p className="lp-sans mt-3 text-[0.98rem] leading-[1.55] text-[var(--lp-ink)]/82">
                  {value.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <FoundersLetter />

      {/* Made-here proof shot — bag in a Pacific Northwest scene
       * (the author's own backyard). Reinforces the "American
       * landscape" half of the made-in-USA claim, complementing the
       * "American jobs / American business" half from FoundersLetter. */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-[0.95fr_1.05fr]">
            <div>
              <p className="lp-label mb-3 text-[var(--lp-red)]">★ American Landscape ★</p>
              <h2 className="lp-display text-[clamp(2rem,5vw,3.4rem)] leading-[1] text-[var(--lp-ink)]">
                Sourced &amp; packed
                <br />
                <span className="lp-script text-[var(--lp-red)]">in our backyard.</span>
              </h2>
              <p className="lp-sans mt-5 text-[1.1rem] leading-[1.6] text-[var(--lp-ink)]/85">
                Every bag of USA Gummies is sourced, manufactured, and
                packed in the United States — a lot of it within sight of
                Mount Rainier, where the Pacific Northwest&rsquo;s biggest
                trees and biggest stories live.
              </p>
              <p className="lp-sans mt-3 text-[1rem] leading-[1.55] text-[var(--lp-ink)]/75">
                Real American work, in real American places. The bag goes
                where you go.
              </p>
            </div>

            <figure
              className="relative overflow-hidden border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] lg:order-last"
              style={{ boxShadow: "8px 8px 0 var(--lp-red)" }}
            >
              <div className="relative aspect-square w-full">
                <Image
                  src="/brand/ad-assets-round2/photo-pacific-northwest.png"
                  alt="USA Gummies bag with snow-capped mountain and Pacific Northwest forest"
                  fill
                  sizes="(max-width: 1024px) 88vw, 600px"
                  className="object-cover"
                />
              </div>
            </figure>
          </div>
        </div>
      </section>

      <SustainabilityBlock />

      {/* FAQ */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[820px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-8 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Made in USA FAQs ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Quick answers
              <br />
              <span className="lp-script text-[var(--lp-red)]">before you buy.</span>
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

      <section className="bg-transparent">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <LatestFromBlog />
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-[var(--lp-cream-soft)] border-t-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 text-center sm:px-8 sm:py-16">
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Built for Real Life ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            Support American jobs.
            <br />
            <span className="lp-script text-[var(--lp-red)]">Snack with confidence.</span>
          </h2>
          <p className="lp-sans mx-auto mt-6 max-w-[52ch] text-[1.05rem] leading-[1.6] text-[var(--lp-ink)]/85">
            Every bag of USA Gummies is a vote for the America you believe in and the American
            Dream you are still chasing.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop" className="lp-cta">
              Shop now
            </Link>
            <Link href="/ingredients" className="lp-cta lp-cta-light">
              Ingredients
            </Link>
            <Link href="/made-in-usa-candy" className="lp-cta lp-cta-light">
              American-Made Candy
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
