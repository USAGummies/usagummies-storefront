// /patriotic-party-snacks — party-snack funnel page in LP design language.
// Structure: PageHero → ScarcityBar → Party-sizing tips → OccasionBagPicker
// (client) → Related guides → ThreePromises → GuaranteeBlock → bottom CTA.
// Article + Breadcrumb JSON-LD preserved for SEO.

import type { Metadata } from "next";
import Link from "next/link";

import { PageHero } from "@/components/lp/PageHero";
import { ScarcityBar } from "@/components/lp/ScarcityBar";
import { ThreePromises } from "@/components/lp/ThreePromises";
import { GuaranteeBlock } from "@/components/lp/GuaranteeBlock";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";

import { OccasionBagPicker } from "@/components/guides/OccasionBagPicker.client";
import { OCCASION_BAG_OPTIONS } from "@/data/occasionBagOptions";
import { getBundleVariants } from "@/lib/bundles/getBundleVariants";
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
const PAGE_TITLE = "Patriotic Party Snacks | USA Gummies";
const PAGE_DESCRIPTION =
  "Plan a red, white, and blue spread with patriotic candy and dye-free gummies made in the USA - party-ready ideas.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/patriotic-party-snacks` },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${SITE_URL}/patriotic-party-snacks`,
    type: "article",
    images: [{ url: "/opengraph-image" }],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: ["/opengraph-image"],
  },
};

const PARTY_TIPS = [
  "8 bags is the most popular pick for backyard parties.",
  "12 bags is best for large groups and team events.",
  "5+ bags unlock free shipping on every party order.",
];

const RELATED_GUIDES = [
  { href: "/gummy-gift-bundles", label: "Gummy gift bag options" },
  { href: "/bulk-gummy-bears", label: "Bulk gummy bears" },
  { href: "/bundle-guides", label: "All bag count guides" },
];

const articleJsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Patriotic party snacks and gummy bag options",
  description: PAGE_DESCRIPTION,
  // Conservative publish date — page predates audit but exact date unknown.
  datePublished: "2026-01-01",
  dateModified: "2026-04-29",
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": `${SITE_URL}/patriotic-party-snacks`,
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
};

export default async function PatrioticPartySnacksPage() {
  let bundleVariants: Awaited<ReturnType<typeof getBundleVariants>> | null = null;
  try {
    bundleVariants = await getBundleVariants();
  } catch {
    bundleVariants = null;
  }
  const singleBagVariantId = bundleVariants?.singleBagVariantId;

  return (
    <main>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Bag count guides", href: "/bundle-guides" },
          { name: "Patriotic party snacks", href: "/patriotic-party-snacks" },
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />

      <PageHero
        eyebrow="Party Snacks"
        headline="Patriotic party snacks"
        scriptAccent="& gummy bag options."
        sub="Hosting a July 4th party or an America-themed event? USA Gummies bags make easy shareable snacks — crowd-ready, dye-free, made in the USA."
        ctas={[
          { href: "/shop#bundle-pricing", label: "Shop party bundles" },
          { href: "/made-in-usa", label: "Made in USA", variant: "light" },
        ]}
      />

      <ScarcityBar />

      {/* Party tips */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[900px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Party Sizing Tips ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Plan the spread,
              <br />
              <span className="lp-script text-[var(--lp-red)]">skip the leftovers.</span>
            </h2>
          </div>
          <ul className="grid gap-4">
            {PARTY_TIPS.map((tip, i) => (
              <li
                key={tip}
                className="flex items-start gap-4 border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] px-5 py-4"
                style={{ boxShadow: i === 0 ? "4px 4px 0 var(--lp-red)" : "4px 4px 0 var(--lp-ink)" }}
              >
                <span className="lp-display mt-1 text-[1.4rem] leading-none text-[var(--lp-red)]">★</span>
                <span className="lp-sans text-[1rem] leading-[1.6] text-[var(--lp-ink)]/85">{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Bag picker */}
      <section className="bg-[var(--lp-cream)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Pick Your Bag Count ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Match the count
              <br />
              <span className="lp-script text-[var(--lp-red)]">to the crowd.</span>
            </h2>
          </div>
          <div
            className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] p-5 sm:p-7"
            style={{ boxShadow: "5px 5px 0 var(--lp-red)" }}
          >
            <OccasionBagPicker
              options={OCCASION_BAG_OPTIONS}
              defaultKey="party"
              singleBagVariantId={singleBagVariantId}
            />
          </div>
        </div>
      </section>

      {/* Related guides */}
      <section className="bg-[var(--lp-cream-soft)] border-y-2 border-[var(--lp-ink)]">
        <div className="mx-auto max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <div className="mb-10 text-center">
            <p className="lp-label mb-2 text-[var(--lp-red)]">★ Keep Reading ★</p>
            <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
              Other bag-count
              <br />
              <span className="lp-script text-[var(--lp-red)]">guides.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {RELATED_GUIDES.map((guide, i) => (
              <Link
                key={guide.href}
                href={guide.href}
                className="border-[3px] border-[var(--lp-ink)] bg-[var(--lp-off-white)] px-5 py-5 transition-transform hover:-translate-y-0.5"
                style={{ boxShadow: i === 0 ? "4px 4px 0 var(--lp-red)" : "4px 4px 0 var(--lp-ink)" }}
              >
                <span className="lp-display text-[1.15rem] leading-snug text-[var(--lp-ink)]">
                  {guide.label}
                </span>
                <span className="lp-label mt-3 block text-[var(--lp-red)]">View guide →</span>
              </Link>
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
          <p className="lp-label mb-3 text-[var(--lp-red)]">★ Throw the Party ★</p>
          <h2 className="lp-display text-[clamp(2rem,5vw,3.2rem)] text-[var(--lp-ink)]">
            Bring the bag,
            <br />
            <span className="lp-script text-[var(--lp-red)]">be the host.</span>
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/shop#bundle-pricing" className="lp-cta">
              Shop party bundles
            </Link>
            <Link href="/faq" className="lp-cta lp-cta-light">
              Bag count FAQ
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
